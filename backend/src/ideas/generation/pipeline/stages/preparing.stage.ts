import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DomainResolutionSource, LanguageCode } from '@prisma/client';

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

type PreparedExplicitDomain = {
  readonly id: string;
  readonly name: string;
  readonly domainKeywords: readonly { readonly keyword: string }[];
};

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
  private readonly explicitDomainCache = new Map<string, { readonly expiresAt: number; readonly value: readonly PreparedExplicitDomain[] }>();
  private readonly explicitDomainInFlight = new Map<string, Promise<PreparedExplicitDomain[]>>();
  private static readonly EXPLICIT_DOMAIN_CACHE_TTL_MS = 15 * 60_000;

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
    const requestedDomainNames = this.normalizeStrings(
      context.requestedDomainNames ?? [],
    );
    const submittedKeywords = this.normalizeStrings(context.keywords).slice(0, 12);
    const rawKeywords = description
      ? this.filterKeywordsForCurrentRequest(submittedKeywords, description)
      : submittedKeywords;

    if (description && requestedDomainIds.length === 0) {
      this.domainResolutionService.primeDomainCatalog(
        context.location.language,
        true,
      );
    }

    this.logger.log(
      `[PREPARING] Pipeline stage started for run "${context.runId}". ` +
        'AI request/evidence planning and explicit-domain prefetch are running concurrently.',
    );
    const preparingStartedAt = Date.now();

    const planStartedAt = Date.now();
    let planElapsedMs = 0;
    const planPromise: Promise<RequestCollectionPlan | null> = description
      ? this.requestCollectionPlanningService
          .plan({
            description,
            keywords: rawKeywords,
            generationType: context.generationType,
            language: context.location.language,
            requestedDomainIds,
            ...(context.owner.type === IDEA_OWNER_TYPES.USER
              ? { userId: context.owner.userId }
              : { guestSessionId: context.owner.guestSessionId }),
          })
          .finally(() => {
            planElapsedMs = Date.now() - planStartedAt;
          })
      : Promise.resolve(null);

    const explicitDomainsStartedAt = Date.now();
    let explicitPrefetchMs = 0;
    const explicitDomainsPromise = requestedDomainIds.length > 0
      ? this.loadExplicitDomains(requestedDomainIds, context.location.language).finally(
          () => {
            explicitPrefetchMs = Date.now() - explicitDomainsStartedAt;
          },
        )
      : Promise.resolve<PreparedExplicitDomain[]>([]);

    const [rawCollectionPlan, explicitDomains] = await Promise.all([
      planPromise,
      explicitDomainsPromise,
    ]);
    const planningAndExplicitMs = Date.now() - planStartedAt;
    this.throwIfAborted(signal);

    if (requestedDomainIds.length > 0 && explicitDomains.length !== requestedDomainIds.length) {
      throw new BadRequestException(
        'One or more explicitly selected generation domains are unavailable or inactive.',
      );
    }

    this.assertExplicitDomainNameAssertions(
      requestedDomainIds,
      requestedDomainNames,
      explicitDomains,
    );
    if (requestedDomainIds.length > 0) {
      this.logger.log(
        `[PREPARING] Explicit domain boundary resolved | ${explicitDomains
          .map((domain, index) => `${index + 1}:${requestedDomainIds[index]}=>${domain.name}`)
          .join(' | ')} | uiAssertions=${requestedDomainNames.length > 0 ? requestedDomainNames.join(' | ') : 'legacy-single-domain/no-name-assertion'}.`,
      );
    }

    let collectionPlan = this.bindPlanToExplicitDomains(
      rawCollectionPlan,
      requestedDomainIds,
      explicitDomains,
    );

    /*
     * DOMAINS_ONLY already has the exact active domain names after the explicit
     * prefetch above. Start its provider-diverse discovery-plan race NOW and let
     * it overlap with primary-domain/selected-domain resolution. Previously the
     * stage waited for domain resolution first and only then started AI planning,
     * adding an avoidable serial 4-6 second window.
     */
    const domainDiscoveryPlanPromise: Promise<RequestCollectionPlan> | null =
      !description && explicitDomains.length > 0
        ? this.requestCollectionPlanningService.buildDomainDiscoveryPlan({
            domainNames: explicitDomains.map((domain) => domain.name),
            language: context.location.language,
            generationType: context.generationType,
            userId:
              context.owner.type === IDEA_OWNER_TYPES.USER
                ? context.owner.userId
                : undefined,
            guestSessionId:
              context.owner.type === IDEA_OWNER_TYPES.GUEST
                ? context.owner.guestSessionId
                : undefined,
          })
        : null;

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

    /*
     * Text + Domains already has an authoritative requester-selected domain
     * set, and those exact active rows were prefetched above. Re-running the
     * full semantic DomainResolutionService here duplicates a database catalog
     * scan and can add many seconds to PREPARING without changing the allowed
     * search space. Choose the semantic primary only from the explicit set and
     * reserve DomainResolutionService for Text Only / No Input paths.
     */
    const primaryResolutionStartedAt = Date.now();
    const warmPlannedPrimary =
      requestedDomainIds.length === 0
        ? this.resolveWarmPlannedExistingPrimary(collectionPlan)
        : null;
    const primary = requestedDomainIds.length > 0
      ? this.resolveExplicitPrimaryDomain(
          collectionPlan,
          requestedDomainIds,
          explicitDomains,
        )
      : warmPlannedPrimary ??
        await this.domainResolutionService.resolve({
          ...(context.owner.type === IDEA_OWNER_TYPES.USER
            ? { userId: context.owner.userId }
            : {}),
          ...(description ? { description } : {}),
          keywords: plannedKeywords,
          plannedExistingDomainId: collectionPlan?.selectedExistingDomainId ?? undefined,
          plannedDomainSelectionMode: collectionPlan?.domainSelectionMode ?? undefined,
          plannedDomainName: collectionPlan?.suggestedDomainName ?? undefined,
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
    const primaryResolutionMs = Date.now() - primaryResolutionStartedAt;
    this.throwIfAborted(signal);

    const selectedDomainsStartedAt = Date.now();
    const selectedDomains = await this.resolveSelectedDomains({
      context,
      primary,
      requestedDomainIds,
      explicitDomains,
      collectionPlan,
      rawKeywords,
    });
    this.assertExplicitDomainInvariant(requestedDomainIds, selectedDomains);
    const selectedDomainsMs = Date.now() - selectedDomainsStartedAt;

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
      collectionPlan = domainDiscoveryPlanPromise
        ? await domainDiscoveryPlanPromise
        : await this.requestCollectionPlanningService.buildDomainDiscoveryPlan({
            domainNames: selectedDomains.map((domain) => domain.name),
            language: context.location.language,
            generationType: context.generationType,
            userId:
              context.owner.type === IDEA_OWNER_TYPES.USER
                ? context.owner.userId
                : undefined,
            guestSessionId:
              context.owner.type === IDEA_OWNER_TYPES.GUEST
                ? context.owner.guestSessionId
                : undefined,
          });
    }

    collectionPlan = this.requestCollectionPlanningService.enrichPlanWithResolvedScope(
      collectionPlan,
      {
        description,
        selectedDomains,
        requestKeywords: rawKeywords,
        preferenceTerms: primary.trace.matchedInterests,
      },
    );

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
      primary.domainId,
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
      evidenceState: 'NO_VALID_EVIDENCE_FOUND',
      keywords,
    };

    this.logger.debug(
      `[PREPARING] timing | run=${context.runId} | parallelWait=${planningAndExplicitMs}ms | ` +
        `planElapsed=${planElapsedMs}ms | explicitPrefetch=${explicitPrefetchMs}ms | ` +
        `primaryResolution=${primaryResolutionMs}ms | selectedDomains=${selectedDomainsMs}ms | ` +
        `total=${Date.now() - preparingStartedAt}ms.`,
    );

    this.logger.log(
      `[PREPARING] Pipeline plan resolved | run=${context.runId} | ` +
        `aiUsed=${collectionPlan?.aiUsed ?? false} | ` +
        `fallbackUsed=${collectionPlan?.fallbackUsed ?? false} | ` +
        `queries=${collectionPlan?.searchQueries.length ?? 0} | ` +
        `plannedSources=${collectionPlan?.selectedSourceKeys?.length ?? collectionPlan?.sourcePlans?.length ?? 0} | ` +
        `primaryDomain="${primary.domainName}" | selectedDomains=${selectedDomains.length} ` +
        `[${selectedDomains.map((domain) => domain.name).join(' | ')}].`,
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

  private resolveWarmPlannedExistingPrimary(
    collectionPlan: RequestCollectionPlan | null,
  ): Awaited<ReturnType<DomainResolutionService['resolve']>> | null {
    if (
      collectionPlan?.domainSelectionMode !== 'EXISTING' ||
      !collectionPlan.selectedExistingDomainId?.trim() ||
      collectionPlan.confidence < 85
    ) {
      return null;
    }

    const cached =
      this.requestCollectionPlanningService.resolveActiveDomainByIdImmediate(
        collectionPlan.selectedExistingDomainId,
      );
    if (!cached) return null;

    const normalizedConfidence =
      collectionPlan.confidence > 1
        ? collectionPlan.confidence / 100
        : collectionPlan.confidence;

    return {
      domainId: cached.id,
      domainName: cached.name,
      source: DomainResolutionSource.KEYWORD_MATCH,
      confidence: Math.max(0.85, Math.min(1, normalizedConfidence)),
      trace: {
        reasons: [
          'Reused the exact active existing domain selected by the PREPARING AI plan from the warm active-domain catalog; no duplicate database lookup was required.',
        ],
        matchedInterests: [],
        candidates: [
          {
            domainId: cached.id,
            domainName: cached.name,
            score: 1,
            reasons: ['Exact warm-catalog AI domain selection'],
          },
        ],
      },
    };
  }

  private resolveExplicitPrimaryDomain(
    plan: RequestCollectionPlan | null,
    requestedDomainIds: readonly string[],
    explicitDomains: readonly {
      readonly id: string;
      readonly name: string;
      readonly domainKeywords: readonly { readonly keyword: string }[];
    }[],
  ): Awaited<ReturnType<DomainResolutionService['resolve']>> {
    const byId = new Map(explicitDomains.map((domain) => [domain.id, domain] as const));
    /*
     * Text + Domains must use the semantic problem anchor selected by the
     * PREPARING plan when that id belongs to the immutable requester-selected
     * set. Falling back to requestedDomainIds[0] made implementation/enabling
     * domains (for example AI) become the primary market lane merely because
     * the UI listed them first.
     */
    const plannedPreferredId =
      plan?.domainSelectionMode === 'EXISTING' &&
      plan.selectedExistingDomainId &&
      requestedDomainIds.includes(plan.selectedExistingDomainId)
        ? plan.selectedExistingDomainId
        : null;
    const preferredId = plannedPreferredId ?? requestedDomainIds[0];
    const primary =
      (preferredId ? byId.get(preferredId) : undefined) ?? explicitDomains[0];

    if (!primary) {
      throw new BadRequestException(
        'At least one active explicitly selected generation domain is required.',
      );
    }

    const candidates = requestedDomainIds
      .map((id, index) => {
        const domain = byId.get(id);
        if (!domain) return null;
        return {
          domainId: domain.id,
          domainName: domain.name,
          score: domain.id === primary.id ? 1 : Math.max(0.8, 0.95 - index * 0.02),
          reasons: [
            domain.id === primary.id
              ? 'Requester explicitly selected this domain and PREPARING selected it as the primary search lane.'
              : 'Requester explicitly selected this domain as a required cross-domain search constraint.',
          ],
        };
      })
      .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));

    return {
      domainId: primary.id,
      domainName: primary.name,
      source: DomainResolutionSource.USER_SELECTED,
      confidence: 1,
      trace: {
        reasons: [
          'The primary domain was resolved directly from the requester-selected active domain set; no second semantic catalog scan was required.',
        ],
        matchedInterests: [],
        candidates,
      },
    };
  }

  private bindSourcePlanProvenance(
    plan: RequestCollectionPlan,
    selectedDomains: readonly SelectedGenerationDomain[],
    problemFacetIds: readonly string[],
    primaryDomainId: string,
  ): RequestCollectionPlan {
    const priorityKeys = new Set(
      (plan.selectedSourceKeys ?? []).map((key) => key.toLocaleLowerCase()),
    );
    const domainByName = new Map(
      selectedDomains.map((domain) => [domain.name.trim().toLocaleLowerCase(), domain] as const),
    );
    const primaryDomain =
      selectedDomains.find((domain) => domain.id === primaryDomainId) ??
      selectedDomains[0] ??
      null;
    const normalizedDomainTokens = selectedDomains.map((domain) => ({
      domain,
      tokens: domain.name
        .normalize('NFKC')
        .toLocaleLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((token) => token.length >= 3),
    }));
    const sourcePlans = (plan.sourcePlans ?? []).map((sourcePlan, index) => {
      const explicitLaneDomains = [...new Map(
        [
          ...(sourcePlan.discoveryDomainNames ?? []),
          ...(sourcePlan.discoveryDomainName ? [sourcePlan.discoveryDomainName] : []),
        ]
          .map((name) => domainByName.get(name.trim().toLocaleLowerCase()))
          .filter((domain): domain is SelectedGenerationDomain => Boolean(domain))
          .map((domain) => [domain.id, domain] as const),
      ).values()];
      const boundByName = explicitLaneDomains.length === 1
        ? explicitLaneDomains[0]
        : undefined;
      const queryText = sourcePlan.queries
        .join(' ')
        .normalize('NFKC')
        .toLocaleLowerCase();
      const queryMatchedDomain = [...normalizedDomainTokens]
        .map(({ domain, tokens }) => ({
          domain,
          score: tokens.filter((token) => queryText.includes(token)).length,
        }))
        .sort((left, right) => right.score - left.score)[0];
      const boundDomain =
        explicitLaneDomains.length > 1
          ? null
          : boundByName ??
            (queryMatchedDomain && queryMatchedDomain.score > 0
              ? queryMatchedDomain.domain
              : primaryDomain);
      const candidateLaneDomains = explicitLaneDomains.length > 0
        ? explicitLaneDomains
        : boundDomain
          ? [boundDomain]
          : [];
      const sourceTier = sourcePlan.sourceTier ??
        (priorityKeys.has(sourcePlan.sourceKey.toLocaleLowerCase())
          ? 'PRIMARY'
          : index < Math.max(6, priorityKeys.size + 2)
            ? 'SECONDARY'
            : 'MICRO_PROBE');
      return {
        ...sourcePlan,
        // Planner-provided provenance is advisory only. Preserve it exclusively
        // when it resolves to one of the authoritative requester-selected
        // domains; otherwise overwrite both id and name with the selected-domain
        // binding inferred from the actual query. This prevents stale/planner
        // labels from introducing any unselected domain into a Text+Domains
        // run whose immutable selected set is different.
        discoveryDomainId: candidateLaneDomains.length === 1
          ? candidateLaneDomains[0]!.id
          : null,
        discoveryDomainName: candidateLaneDomains.length === 1
          ? candidateLaneDomains[0]!.name
          : null,
        discoveryDomainIds: candidateLaneDomains.map((domain) => domain.id),
        discoveryDomainNames: candidateLaneDomains.map((domain) => domain.name),
        queryIntentId:
          sourcePlan.queryIntentId ??
          `${candidateLaneDomains.map((domain) => domain.id).join('+') || 'request'}:${sourcePlan.sourceKey}:${index + 1}`,
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
    explicitDomains: readonly {
      readonly id: string;
      readonly name: string;
      readonly domainKeywords: readonly { readonly keyword: string }[];
    }[],
  ): RequestCollectionPlan | null {
    if (!plan || requestedDomainIds.length === 0 || explicitDomains.length === 0) {
      return plan;
    }

    const byId = new Map(explicitDomains.map((domain) => [domain.id, domain] as const));
    const requested = requestedDomainIds
      .map((id) => byId.get(id))
      .filter((domain): domain is NonNullable<typeof domain> => Boolean(domain));
    if (requested.length === 0) return plan;

    const normalize = (value: string): string =>
      value
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();

    const problemProfile = plan.problemProfile;
    const explicitProblemText = [
      plan.requestIntent?.explicitProblem ?? '',
      problemProfile?.actor ?? '',
      problemProfile?.object ?? '',
      problemProfile?.coreProblem ?? '',
      problemProfile?.workflow ?? '',
      problemProfile?.friction ?? '',
      ...(problemProfile?.failureModes ?? []),
      ...(problemProfile?.consequences ?? []),
      plan.domainIdentity?.actor ?? '',
      plan.domainIdentity?.object ?? '',
      plan.domainIdentity?.workflow ?? '',
      plan.domainIdentity?.failure ?? '',
    ]
      .join(' ');
    const hasExplicitProblemAnchor =
      plan.requestIntent?.mode === 'EXPLICIT_PROBLEM' &&
      normalize(explicitProblemText).length > 0;

    /*
     * In EXPLICIT_PROBLEM mode the problem statement, actor, object, and
     * workflow choose the primary lane. suggestedDomainName is intentionally
     * excluded from that score because it can describe an enabling technology
     * rather than the market/problem domain. In DISCOVERY_INTENT mode the
     * planner's suggested domain remains useful semantic context.
     */
    const semanticText = normalize(
      hasExplicitProblemAnchor
        ? explicitProblemText
        : [
            explicitProblemText,
            plan.suggestedDomainName ?? '',
            plan.requestIntent?.summary ?? '',
            plan.requestIntent?.desiredOutcome ?? '',
          ].join(' '),
    );

    const scoreDomain = (
      domain: (typeof requested)[number],
    ): number => {
      const normalizedName = normalize(domain.name);
      let score = normalizedName && semanticText.includes(normalizedName) ? 12 : 0;

      const nameTokens = normalizedName
        .split(' ')
        .filter((token) => token.length >= 4);
      score +=
        nameTokens.filter((token) => semanticText.includes(token)).length * 3;

      for (const entry of domain.domainKeywords) {
        const keyword = normalize(entry.keyword);
        if (!keyword || keyword.length < 4) continue;
        if (semanticText.includes(keyword)) {
          score += keyword.includes(' ') ? 4 : 2;
        }
      }

      return score;
    };

    const plannedExistingId =
      plan.domainSelectionMode === 'EXISTING' &&
      plan.selectedExistingDomainId &&
      requestedDomainIds.includes(plan.selectedExistingDomainId)
        ? plan.selectedExistingDomainId
        : null;
    const requestedOrder = new Map(
      requestedDomainIds.map((id, index) => [id, index] as const),
    );

    const ranked = requested
      .map((domain) => ({
        domain,
        score: scoreDomain(domain),
        plannerTieBreak: domain.id === plannedExistingId ? 1 : 0,
        requestIndex: requestedOrder.get(domain.id) ?? Number.MAX_SAFE_INTEGER,
      }))
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.plannerTieBreak - left.plannerTieBreak ||
          left.requestIndex - right.requestIndex,
      );

    const primary = ranked[0]?.domain ?? requested[0];
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
    const candidateIds = input.requestedDomainIds.length > 0
      ? [...input.requestedDomainIds]
      : this.normalizeIds([
          input.primary.domainId,
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
    const noInputDiscovery =
      !input.context.requestDescription?.trim() &&
      input.requestedDomainIds.length === 0;
    const traceCandidateById = new Map(
      input.primary.trace.candidates.map((candidate) => [
        candidate.domainId,
        candidate,
      ] as const),
    );
    const additional = missingIds.length > 0
      ? noInputDiscovery
        ? missingIds.flatMap((id) => {
            const candidate = traceCandidateById.get(id);
            if (!candidate?.domainName?.trim()) return [];
            return [{
              id: candidate.domainId,
              name: candidate.domainName,
              domainKeywords: [] as { readonly keyword: string }[],
            }];
          })
        : await this.domainResolutionService.resolveActiveDomainsByIds(
            missingIds,
            input.context.location.language,
          )
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

  private assertExplicitDomainNameAssertions(
    requestedDomainIds: readonly string[],
    requestedDomainNames: readonly string[],
    explicitDomains: readonly PreparedExplicitDomain[],
  ): void {
    if (requestedDomainNames.length === 0) return;

    if (requestedDomainNames.length !== requestedDomainIds.length) {
      throw new BadRequestException({
        code: 'DOMAIN_SELECTION_ASSERTION_LENGTH_MISMATCH',
        message:
          'The ordered domainNames assertion must contain exactly one name for every requested domainId.',
        requestedDomainIds: [...requestedDomainIds],
        requestedDomainNames: [...requestedDomainNames],
      });
    }

    const normalize = (value: string): string =>
      value
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/\s+/gu, ' ')
        .trim();
    const mismatches = explicitDomains.flatMap((domain, index) => {
      const assertedName = requestedDomainNames[index] ?? '';
      return normalize(domain.name) === normalize(assertedName)
        ? []
        : [{
            index,
            domainId: requestedDomainIds[index] ?? domain.id,
            assertedName,
            resolvedName: domain.name,
          }];
    });

    if (mismatches.length > 0) {
      this.logger.error(
        `[PREPARING] DOMAIN PAYLOAD MISMATCH | ${mismatches
          .map((item) => `${item.domainId}: ui="${item.assertedName}" db="${item.resolvedName}"`)
          .join(' | ')}.`,
      );
      throw new BadRequestException({
        code: 'DOMAIN_SELECTION_MAPPING_MISMATCH',
        message:
          'The submitted domain UUIDs do not resolve to the same ordered domain names selected by the client. Generation was stopped before collection.',
        mismatches,
      });
    }
  }

  private assertExplicitDomainInvariant(
    requestedDomainIds: readonly string[],
    selectedDomains: readonly SelectedGenerationDomain[],
  ): void {
    if (requestedDomainIds.length === 0) return;

    const requested = [...new Set(requestedDomainIds)];
    const selectedIds = selectedDomains.map((domain) => domain.id);
    const exactOrderedMatch =
      requested.length === selectedIds.length &&
      requested.every((id, index) => selectedIds[index] === id);
    const allMarkedExplicit = selectedDomains.every(
      (domain) => domain.isExplicitlySelected === true,
    );

    if (!exactOrderedMatch || !allMarkedExplicit) {
      throw new Error(
        'Explicit-domain immutability invariant failed: PREPARING must preserve exactly the requester-selected domain ids, order, and explicit-selection status.',
      );
    }
  }

  private filterKeywordsForCurrentRequest(
    keywords: readonly string[],
    description: string,
  ): string[] {
    const normalize = (value: string): string =>
      value
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
    const descriptionText = normalize(description);
    if (!descriptionText) return [...keywords];

    const generic = new Set([
      'system', 'systems', 'platform', 'software', 'application', 'applications',
      'workflow', 'workflows', 'management', 'service', 'services', 'business',
      'user', 'users', 'customer', 'customers', 'data', 'operations', 'process',
      'processes', 'support', 'tool', 'tools',
    ]);
    const descriptionTokens = new Set(
      descriptionText
        .split(' ')
        .filter((token) => token.length >= 3 && !generic.has(token)),
    );

    return keywords.filter((keyword) => {
      const normalized = normalize(keyword);
      if (!normalized) return false;
      if (descriptionText.includes(normalized)) return true;
      const tokens = normalized
        .split(' ')
        .filter((token) => token.length >= 3 && !generic.has(token));
      if (tokens.length === 0) return false;
      const matches = tokens.filter((token) =>
        [...descriptionTokens].some(
          (requestToken) =>
            requestToken === token ||
            (requestToken.length >= 5 && token.length >= 5 &&
              (requestToken.startsWith(token.slice(0, 5)) ||
                token.startsWith(requestToken.slice(0, 5)))),
        ),
      ).length;
      return matches >= (tokens.length >= 3 ? 2 : 1);
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
      ...(collectionPlan?.inferredSecondaryScopes ?? []),
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

  private async loadExplicitDomains(
    domainIds: readonly string[],
    language: LanguageCode,
  ): Promise<PreparedExplicitDomain[]> {
    const normalizedIds = [...new Set(domainIds.map((id) => id.trim()).filter(Boolean))];
    const cacheKey = `${language}:${normalizedIds.join(',')}`;
    const cached = this.explicitDomainCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value.map((domain) => ({
        ...domain,
        domainKeywords: domain.domainKeywords.map((item) => ({ ...item })),
      }));
    }
    const inFlight = this.explicitDomainInFlight.get(cacheKey);
    if (inFlight) return inFlight;

    const request = this.requestCollectionPlanningService
      .resolveActiveDomainsByIds(normalizedIds, language)
      .then((domains) => {
        const ordered = normalizedIds
          .map((id) => domains.find((domain) => domain.id === id))
          .filter((domain): domain is (typeof domains)[number] => Boolean(domain));
        this.explicitDomainCache.set(cacheKey, {
          expiresAt: Date.now() + PreparingStage.EXPLICIT_DOMAIN_CACHE_TTL_MS,
          value: ordered,
        });
        return ordered;
      })
      .finally(() => this.explicitDomainInFlight.delete(cacheKey));

    this.explicitDomainInFlight.set(cacheKey, request);
    return request;
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
