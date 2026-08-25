import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { LanguageCode } from '@prisma/client';

import { PrismaService } from '../../../../prisma/prisma.service';
import {
  findIdeaGenerationStageDefinition,
  IDEA_GENERATION_STAGE_KEYS,
  type IdeaGenerationStageDefinition,
} from '../../constants/idea-generation-stages.constants';
import type {
  IdeaGenerationStage,
  IdeaGenerationStageExecutionResult,
} from '../../interfaces/idea-generation-stage.interface';
import { DomainResolutionService } from '../../services/domain-resolution.service';
import { RequestCollectionPlanningService } from '../../services/request-collection-planning.service';
import type {
  IdeaGenerationContext,
  SelectedGenerationDomain,
} from '../../types/idea-generation-context.type';
import type { RequestCollectionPlan } from '../../types/request-collection-plan.type';
import { IDEA_OWNER_TYPES } from '../../../shared/constants/ideas.constants';
import { CanonicalProblemSpecUtil } from '../../utils/canonical-problem-spec.util';

/**
 * First executable pipeline stage.
 *
 * The HTTP/queue boundary only creates the run and preserves the raw request.
 * Request understanding, AI evidence planning, and semantic domain resolution
 * begin only after IdeaGenerationPipelineService has started the run.
 */
@Injectable()
export class PreparingStage implements IdeaGenerationStage {
  readonly key = IDEA_GENERATION_STAGE_KEYS.PREPARING;
  readonly definition: IdeaGenerationStageDefinition = this.resolveDefinition();

  private readonly logger = new Logger(PreparingStage.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly requestCollectionPlanningService: RequestCollectionPlanningService,
    private readonly domainResolutionService: DomainResolutionService,
  ) {}

  async execute(
    context: IdeaGenerationContext,
    signal?: AbortSignal,
  ): Promise<IdeaGenerationStageExecutionResult> {
    this.throwIfAborted(signal);

    const description = context.requestDescription?.replace(/\s+/gu, ' ').trim() ?? '';
    const requestedDomainIds = this.normalizeIds(context.requestedDomainIds);
    const rawKeywords = this.normalizeStrings(context.keywords).slice(0, 12);

    this.logger.log(
      `[PREPARING] Pipeline stage started for run "${context.runId}". ` +
        'AI request/evidence planning and explicit-domain prefetch are running concurrently.',
    );

    const planPromise: Promise<RequestCollectionPlan | null> = description
      ? this.requestCollectionPlanningService.plan({
          description,
          keywords: rawKeywords,
          generationType: context.generationType,
          language: context.location.language,
          requestedDomainIds,
          ...(context.owner.type === IDEA_OWNER_TYPES.USER
            ? { userId: context.owner.userId }
            : { guestSessionId: context.owner.guestSessionId }),
        })
      : Promise.resolve(null);

    const explicitDomainsPromise = requestedDomainIds.length > 0
      ? this.prisma.domain.findMany({
          where: { id: { in: requestedDomainIds }, isActive: true },
          select: {
            id: true,
            name: true,
            domainKeywords: {
              where: {
                language: { in: [context.location.language, LanguageCode.ANY] },
              },
              select: { keyword: true },
              orderBy: { createdAt: 'asc' },
              take: 20,
            },
          },
        })
      : Promise.resolve([]);

    const [rawCollectionPlan, explicitDomains] = await Promise.all([
      planPromise,
      explicitDomainsPromise,
    ]);
    this.throwIfAborted(signal);

    if (requestedDomainIds.length > 0 && explicitDomains.length !== requestedDomainIds.length) {
      throw new BadRequestException(
        'One or more explicitly selected generation domains are unavailable or inactive.',
      );
    }

    let collectionPlan = this.bindPlanToExplicitDomains(
      rawCollectionPlan,
      requestedDomainIds,
      explicitDomains,
    );

    const profile = collectionPlan?.problemProfile;
    const plannedKeywords = this.normalizeStrings([
      ...(profile
        ? [
            profile.actor,
            profile.object,
            profile.coreProblem,
            profile.workflow,
            ...profile.failureModes,
            ...profile.consequences,
          ]
        : []),
      ...(collectionPlan?.intentConcepts ?? []),
      ...(collectionPlan?.evidenceTargets ?? []),
      ...rawKeywords,
    ]).slice(0, 30);

    const primary = await this.domainResolutionService.resolve({
      ...(context.owner.type === IDEA_OWNER_TYPES.USER
        ? { userId: context.owner.userId }
        : {}),
      ...(requestedDomainIds[0] ? { domainId: requestedDomainIds[0] } : {}),
      ...(description ? { description } : {}),
      keywords: plannedKeywords,
      plannedExistingDomainId: collectionPlan?.selectedExistingDomainId ?? undefined,
      plannedDomainSelectionMode: collectionPlan?.domainSelectionMode ?? undefined,
      plannedDomainName: collectionPlan?.suggestedDomainName ?? undefined,
      /*
       * Domain selection is already request-derived even when the remote planner
       * falls back. Pass that confidence through as well so EXISTING ids use the
       * exact-id fast path and NEW request domains use the exact-name/create fast
       * path instead of repeating a full visible+hidden semantic scan after the
       * planning race has already finished.
       */
      plannedDomainConfidence:
        collectionPlan?.domainSelectionMode
          ? collectionPlan.confidence
          : undefined,
      plannedKeywords: collectionPlan
        ? [
            ...plannedKeywords,
            ...collectionPlan.searchQueries,
            ...collectionPlan.evidenceTargets,
            ...collectionPlan.intentConcepts,
          ]
        : plannedKeywords,
      language: context.location.language,
    });
    this.throwIfAborted(signal);

    const selectedDomains = await this.resolveSelectedDomains({
      context,
      primary,
      requestedDomainIds,
      explicitDomains,
      collectionPlan,
      rawKeywords,
    });

    const requestMode = CanonicalProblemSpecUtil.resolveRequestMode({
      description,
      requestedDomainIds,
    });

    /*
     * DOMAINS_ONLY and NO_INPUT previously reached collectionPlan=null and the
     * source-selection stage responded by fanning out to almost every active
     * collector. Build a small evidence-first discovery plan after domain
     * resolution instead. No requester problem is invented here; the queries
     * only probe the selected/resolved domain for externally observed pain.
     */
    if (!collectionPlan) {
      collectionPlan = await this.requestCollectionPlanningService.buildDomainDiscoveryPlan({
        domainNames: selectedDomains.map((domain) => domain.name),
        language: context.location.language,
      });
    }

    const canonicalProblemSpec = CanonicalProblemSpecUtil.build({
      mode: requestMode,
      description,
      collectionPlan,
      selectedDomains,
      requestedDomainIds,
    });
    collectionPlan = this.bindSourcePlanProvenance(
      collectionPlan,
      selectedDomains,
      canonicalProblemSpec.facets.map((facet) => facet.id),
    );

    const keywords = this.buildRunKeywords(
      description,
      rawKeywords,
      collectionPlan,
      selectedDomains,
    );

    const updatedContext: IdeaGenerationContext = {
      ...context,
      domainId: primary.domainId,
      domainName: primary.domainName,
      selectedDomains,
      domainResolution: {
        source: String(primary.source),
        confidence: primary.confidence,
        selectedDomain: { id: primary.domainId, name: primary.domainName },
        matchedInterests: [...primary.trace.matchedInterests],
        reasons: [...primary.trace.reasons],
        candidates: primary.trace.candidates.map((candidate) => ({
          domainId: candidate.domainId,
          domainName: candidate.domainName,
          score: candidate.score,
          reasons: [...candidate.reasons],
        })),
      },
      collectionPlan,
      requestMode,
      canonicalProblemSpec,
      evidenceState: 'ZERO_VALIDATED_EVIDENCE',
      keywords,
    };

    this.logger.log(
      `[PREPARING] Pipeline plan resolved | run=${context.runId} | ` +
        `aiUsed=${collectionPlan?.aiUsed ?? false} | ` +
        `fallbackUsed=${collectionPlan?.fallbackUsed ?? false} | ` +
        `queries=${collectionPlan?.searchQueries.length ?? 0} | ` +
        `plannedSources=${collectionPlan?.selectedSourceKeys?.length ?? collectionPlan?.sourcePlans?.length ?? 0} | ` +
        `primaryDomain="${primary.domainName}" | selectedDomains=${selectedDomains.length}.`,
    );

    return {
      context: updatedContext,
      resultPreview:
        `Prepared semantic request scope${collectionPlan?.aiUsed ? ' with AI evidence planning' : ''}; ` +
        `resolved ${selectedDomains.length} domain(s).`,
      metadata: {
        aiUsed: collectionPlan?.aiUsed ?? false,
        fallbackUsed: collectionPlan?.fallbackUsed ?? false,
        queryCount: collectionPlan?.searchQueries.length ?? 0,
        plannedSourceCount:
          collectionPlan?.selectedSourceKeys?.length ??
          collectionPlan?.sourcePlans?.length ??
          0,
        primaryDomainId: primary.domainId,
        primaryDomainName: primary.domainName,
      },
    };
  }

  private bindSourcePlanProvenance(
    plan: RequestCollectionPlan,
    selectedDomains: readonly SelectedGenerationDomain[],
    problemFacetIds: readonly string[],
  ): RequestCollectionPlan {
    const priorityKeys = new Set(
      (plan.selectedSourceKeys ?? []).map((key) => key.toLocaleLowerCase()),
    );
    const domainByName = new Map(
      selectedDomains.map((domain) => [domain.name.trim().toLocaleLowerCase(), domain] as const),
    );
    const primaryDomain = selectedDomains[0] ?? null;
    const sourcePlans = (plan.sourcePlans ?? []).map((sourcePlan, index) => {
      const boundByName = sourcePlan.discoveryDomainName
        ? domainByName.get(sourcePlan.discoveryDomainName.trim().toLocaleLowerCase())
        : undefined;
      const boundDomain = boundByName ?? primaryDomain;
      const sourceTier = sourcePlan.sourceTier ??
        (priorityKeys.has(sourcePlan.sourceKey.toLocaleLowerCase())
          ? 'PRIMARY'
          : index < Math.max(6, priorityKeys.size + 2)
            ? 'SECONDARY'
            : 'MICRO_PROBE');
      return {
        ...sourcePlan,
        discoveryDomainId: sourcePlan.discoveryDomainId ?? boundDomain?.id ?? null,
        discoveryDomainName: sourcePlan.discoveryDomainName ?? boundDomain?.name ?? null,
        queryIntentId:
          sourcePlan.queryIntentId ??
          `${boundDomain?.id ?? 'request'}:${sourcePlan.sourceKey}:${index + 1}`,
        sourceTier,
        problemFacetIds:
          sourcePlan.problemFacetIds?.length
            ? sourcePlan.problemFacetIds
            : problemFacetIds,
      };
    });
    return { ...plan, sourcePlans };
  }

  private bindPlanToExplicitDomains(
    plan: RequestCollectionPlan | null,
    requestedDomainIds: readonly string[],
    explicitDomains: readonly { readonly id: string; readonly name: string }[],
  ): RequestCollectionPlan | null {
    if (!plan || requestedDomainIds.length === 0 || explicitDomains.length === 0) {
      return plan;
    }

    const byId = new Map(explicitDomains.map((domain) => [domain.id, domain] as const));
    const requested = requestedDomainIds
      .map((id) => byId.get(id))
      .filter((domain): domain is NonNullable<typeof domain> => Boolean(domain));
    const domainIdentity = plan.domainIdentity;
    const semanticText = [
      plan.suggestedDomainName ?? '',
      domainIdentity?.actor ?? '',
      domainIdentity?.object ?? '',
      domainIdentity?.workflow ?? '',
    ]
      .join(' ')
      .normalize('NFKC')
      .toLocaleLowerCase();
    const score = (name: string): number =>
      name
        .normalize('NFKC')
        .toLocaleLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((token) => token.length >= 4)
        .filter((token) => semanticText.includes(token)).length;
    const primary = [...requested].sort(
      (left, right) => score(right.name) - score(left.name),
    )[0] ?? requested[0];
    if (!primary) return plan;

    return {
      ...plan,
      domainSelectionMode: 'EXISTING',
      selectedExistingDomainId: primary.id,
      suggestedDomainName: primary.name,
    };
  }

  private async resolveSelectedDomains(input: {
    readonly context: IdeaGenerationContext;
    readonly primary: Awaited<ReturnType<DomainResolutionService['resolve']>>;
    readonly requestedDomainIds: readonly string[];
    readonly explicitDomains: readonly {
      readonly id: string;
      readonly name: string;
      readonly domainKeywords: readonly { readonly keyword: string }[];
    }[];
    readonly collectionPlan: RequestCollectionPlan | null;
    readonly rawKeywords: readonly string[];
  }): Promise<SelectedGenerationDomain[]> {
    /*
     * The PREPARING primary plus requester-explicit domains are the only
     * domains required for collection. Ranked trace alternatives are
     * explainability metadata, not extra collection scope. Avoiding another
     * database expansion for non-explicit trace candidates removes a remote
     * round-trip from every text-bearing run without dropping any user-selected
     * domain constraint.
     */
    const noInputDiscoveryCandidateIds =
      !input.context.requestDescription?.trim() && input.requestedDomainIds.length === 0
        ? input.primary.trace.candidates.slice(0, 3).map((candidate) => candidate.domainId)
        : [];
    const candidateIds = this.normalizeIds([
      input.primary.domainId,
      ...input.requestedDomainIds,
      ...noInputDiscoveryCandidateIds,
    ]).slice(0, 3);

    const explicitById = new Map(input.explicitDomains.map((domain) => [domain.id, domain]));
    /*
     * primary has already been resolved and validated by DomainResolutionService.
     * Do not immediately re-read that same row just to obtain generic stored
     * keywords. For a text-bearing generation request the request-specific
     * search terms below are strictly more useful, and avoiding this duplicate
     * remote Prisma round-trip removes another serial tail from PREPARING.
     */
    const primaryDomain = {
      id: input.primary.domainId,
      name: input.primary.domainName,
      domainKeywords: [] as { readonly keyword: string }[],
    };
    const missingIds = candidateIds.filter(
      (id) => id !== input.primary.domainId && !explicitById.has(id),
    );
    const additional = missingIds.length > 0
      ? await this.prisma.domain.findMany({
          where: { id: { in: missingIds }, isActive: true },
          select: {
            id: true,
            name: true,
            domainKeywords: {
              where: {
                language: {
                  in: [input.context.location.language, LanguageCode.ANY],
                },
              },
              select: { keyword: true },
              orderBy: { createdAt: 'asc' },
              take: 20,
            },
          },
        })
      : [];

    const byId = new Map([
      [primaryDomain.id, primaryDomain] as const,
      ...input.explicitDomains.map((domain) => [domain.id, domain] as const),
      ...additional.map((domain) => [domain.id, domain] as const),
    ]);

    const requestTerms = this.normalizeStrings([
      ...(input.collectionPlan?.intentConcepts ?? []),
      ...(input.collectionPlan?.evidenceTargets ?? []),
      ...(input.collectionPlan?.searchQueries ?? []).slice(0, 12),
      ...input.rawKeywords,
    ]);

    return candidateIds
      .map((id) => byId.get(id))
      .filter((domain): domain is NonNullable<typeof domain> => Boolean(domain))
      .map((domain) => {
        const configuredKeywords = this.normalizeStrings(
          domain.domainKeywords.map((entry) => entry.keyword),
        ).slice(0, 12);
        const requestIntentKeywords = this.rankTermsForDomain(
          domain.name,
          requestTerms,
        ).slice(0, 10);
        const effectiveSearchKeywords = this.normalizeStrings([
          ...requestIntentKeywords,
          domain.name,
          ...configuredKeywords,
        ]).slice(0, 16);

        return {
          id: domain.id,
          name: domain.name,
          keywords: effectiveSearchKeywords,
          configuredKeywords,
          requestIntentKeywords,
          effectiveSearchKeywords,
          isExplicitlySelected: input.requestedDomainIds.includes(domain.id),
        };
      });
  }

  private buildRunKeywords(
    description: string,
    rawKeywords: readonly string[],
    collectionPlan: RequestCollectionPlan | null,
    selectedDomains: readonly SelectedGenerationDomain[],
  ): string[] {
    const profile = collectionPlan?.problemProfile;
    return this.normalizeStrings([
      ...(profile
        ? [
            profile.actor,
            profile.object,
            profile.coreProblem,
            profile.workflow,
            ...profile.failureModes,
            ...profile.consequences,
          ]
        : []),
      ...(collectionPlan?.searchQueries ?? []),
      ...(collectionPlan?.evidenceTargets ?? []),
      ...(collectionPlan?.intentConcepts ?? []),
      ...rawKeywords,
      ...selectedDomains.flatMap((domain) => [
        domain.name,
        ...(domain.effectiveSearchKeywords ?? []),
      ]),
      ...(description ? this.extractDescriptionPhrases(description) : []),
    ]).slice(0, 72);
  }

  private rankTermsForDomain(domainName: string, terms: readonly string[]): string[] {
    const domainTokens = new Set(
      domainName
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .split(/\s+/u)
        .filter((token) => token.length >= 4),
    );

    return [...terms]
      .map((term, index) => ({
        term,
        index,
        score: term
          .normalize('NFKC')
          .toLocaleLowerCase()
          .split(/\s+/u)
          .filter((token) => domainTokens.has(token)).length,
      }))
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .map(({ term }) => term);
  }

  private extractDescriptionPhrases(description: string): string[] {
    const words = description
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}\s'-]+/gu, ' ')
      .split(/\s+/u)
      .filter((word) => word.length >= 4);
    const result: string[] = [];
    for (let index = 0; index < words.length - 2 && result.length < 8; index += 3) {
      result.push(words.slice(index, index + 5).join(' '));
    }
    return result;
  }

  private normalizeStrings(values: readonly (string | null | undefined)[]): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const raw of values) {
      if (typeof raw !== 'string') continue;
      const value = raw.replace(/\s+/gu, ' ').trim();
      if (!value) continue;
      const key = value.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(value);
    }
    return result;
  }

  private normalizeIds(values: readonly (string | null | undefined)[] | undefined): string[] {
    if (!values) return [];
    return this.normalizeStrings(values);
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new Error('Idea-generation PREPARING stage cancelled.');
    }
  }

  private resolveDefinition(): IdeaGenerationStageDefinition {
    const definition = findIdeaGenerationStageDefinition(this.key);
    if (!definition) {
      throw new Error(`Missing stage definition for "${this.key}".`);
    }
    return definition;
  }
}
