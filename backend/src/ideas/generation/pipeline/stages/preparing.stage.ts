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
    const submittedRequestedDomainIds = this.normalizeIds(context.requestedDomainIds);
    const requestedDomainNames = this.normalizeStrings(
      context.requestedDomainNames ?? [],
    );
    const submittedKeywords = this.normalizeStrings(context.keywords).slice(0, 12);
    const rawKeywords = description
      ? this.filterKeywordsForCurrentRequest(submittedKeywords, description)
      : submittedKeywords;

    if (description && submittedRequestedDomainIds.length === 0) {
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
            requestedDomainIds: submittedRequestedDomainIds,
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
    const explicitDomainsPromise = submittedRequestedDomainIds.length > 0
      ? this.loadExplicitDomains(submittedRequestedDomainIds, context.location.language).finally(
          () => {
            explicitPrefetchMs = Date.now() - explicitDomainsStartedAt;
          },
        )
      : Promise.resolve<PreparedExplicitDomain[]>([]);

    const [rawCollectionPlan, rawExplicitDomains] = await Promise.all([
      planPromise,
      explicitDomainsPromise,
    ]);
    const planningAndExplicitMs = Date.now() - planStartedAt;
    this.throwIfAborted(signal);

    if (
      submittedRequestedDomainIds.length > 0 &&
      rawExplicitDomains.length !== submittedRequestedDomainIds.length
    ) {
      throw new BadRequestException(
        'One or more explicitly selected generation domains are unavailable or inactive.',
      );
    }

    const explicitBoundary = this.reconcileExplicitDomainBoundary(
      submittedRequestedDomainIds,
      requestedDomainNames,
      rawExplicitDomains,
    );
    let requestedDomainIds = explicitBoundary.requestedDomainIds;
    let explicitDomains = explicitBoundary.explicitDomains;

    if (requestedDomainIds.length > 0) {
      this.logger.log(
        `[PREPARING] Explicit domain boundary resolved | ${explicitDomains
          .map((domain, index) => `${index + 1}:${requestedDomainIds[index]}=>${domain.name}`)
          .join(' | ')} | uiAssertions=${requestedDomainNames.length > 0 ? requestedDomainNames.join(' | ') : 'legacy-single-domain/no-name-assertion'} | reconciledOrder=${explicitBoundary.orderReconciled}.`,
      );
    }

    let collectionPlan = this.bindPlanToExplicitDomains(
      rawCollectionPlan,
      requestedDomainIds,
      explicitDomains,
    );

    /*
     * TEXT_AND_DOMAINS has two different input generations in the wild:
     *
     * 1. Current clients send ordered domainNames together with domainIds. That
     *    order is an explicit requester assertion and is already reconciled by
     *    reconcileExplicitDomainBoundary(). Never let the PREPARING AI reorder
     *    it: a workflow/enabling word inside the description (for example
     *    "transportation" inside an Agriculture problem) must not steal the
     *    primary market lane from the requester-selected first domain.
     *
     * 2. Legacy id-only clients have no ordering assertion. Only for that legacy
     *    shape may the semantic plan promote one selected domain to position 1.
     *
     * DOMAINS_ONLY remains requester-order preserving in both cases.
     */
    if (
      description &&
      requestedDomainIds.length > 1 &&
      requestedDomainNames.length === 0
    ) {
      const promoted = this.promoteExplicitPrimaryDomain(
        requestedDomainIds,
        explicitDomains,
        collectionPlan?.selectedExistingDomainId ?? null,
      );
      requestedDomainIds = promoted.requestedDomainIds;
      explicitDomains = promoted.explicitDomains;
    }

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
        resolvedPrimaryDomain: {
          id: primary.domainId,
          name: primary.domainName,
        },
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
      requestedDomainIds: [...requestedDomainIds],
      requestedDomainNames:
        requestedDomainIds.length > 0
          ? explicitDomains.map((domain) => domain.name)
          : requestedDomainNames,
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
    if (!collectionPlan) return null;

    const normalizedConfidence =
      collectionPlan.confidence > 1
        ? collectionPlan.confidence / 100
        : collectionPlan.confidence;

    const exactExisting =
      collectionPlan.domainSelectionMode === 'EXISTING' &&
      collectionPlan.selectedExistingDomainId?.trim()
        ? this.requestCollectionPlanningService.resolveActiveDomainByIdImmediate(
            collectionPlan.selectedExistingDomainId,
          )
        : null;

    /*
     * A deterministic/AI plan can occasionally call an exact hidden
     * auto-generated domain "NEW" even though that same domain was created by
     * an earlier run and is already present in the warmed active-domain
     * catalog. Reusing an exact name is an identity lookup, not a semantic
     * guess, and removes the extra remote resolve/create round trip that made
     * Text Only PREPARING wait once for planning and then again for the DB.
     */
    const exactNamed =
      !exactExisting && collectionPlan.suggestedDomainName?.trim()
        ? this.requestCollectionPlanningService.resolveActiveDomainByNameImmediate(
            collectionPlan.suggestedDomainName,
          )
        : null;
    const cached = exactExisting ?? exactNamed;
    if (!cached) return null;

    const confidenceFloor = exactExisting ? 0.85 : 0.72;
    if (normalizedConfidence < confidenceFloor) return null;

    return {
      domainId: cached.id,
      domainName: cached.name,
      source: DomainResolutionSource.KEYWORD_MATCH,
      confidence: Math.max(confidenceFloor, Math.min(1, normalizedConfidence)),
      trace: {
        reasons: [
          exactExisting
            ? 'Reused the exact active existing domain selected by the PREPARING plan from the warm active-domain catalog; no duplicate database lookup was required.'
            : 'Reused the exact active domain name already present in the warm PREPARING catalog; the plan did not trigger a duplicate remote resolve/create round trip.',
        ],
        matchedInterests: [],
        candidates: [
          {
            domainId: cached.id,
            domainName: cached.name,
            score: 1,
            reasons: [
              exactExisting
                ? 'Exact warm-catalog domain-id selection'
                : 'Exact warm-catalog domain-name identity match',
            ],
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
     * The explicit domain arrays define the allowed requester-selected set.
     * The AI plan may select the semantic primary only from that set; the
     * selected-domain arrays themselves are not reordered here.
     */
    const plannedPreferredId =
      plan?.selectedExistingDomainId &&
      requestedDomainIds.includes(plan.selectedExistingDomainId)
        ? plan.selectedExistingDomainId
        : null;
    /*
     * Ordered domain names remain a requester identity assertion, but they are
     * not a semantic classifier. For TEXT_AND_DOMAINS the AI request plan may
     * choose which member of the already-approved explicit set is the primary
     * problem lane without mutating the selected-domain set itself. This also
     * prevents a client that serializes the same selected set in catalog order
     * from accidentally forcing an enabling technology to become the problem
     * domain.
     */
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

    const normalizeIdentity = (value: string): string =>
      value
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();

    /*
     * The request-understanding AI owns semantic primary-domain selection.
     * This binding step is intentionally identity-only: it may map an AI
     * selected UUID or an exact AI-returned domain name back to the explicit
     * requester-selected set, but it must not independently infer semantics
     * from request words, configured keywords, or domain-specific regexes.
     *
     * If the planner did not select one of the explicit domains, keep the
     * requester serialization order only as a neutral compatibility fallback.
     */
    const plannedExistingId =
      plan.selectedExistingDomainId &&
      requestedDomainIds.includes(plan.selectedExistingDomainId)
        ? plan.selectedExistingDomainId
        : null;
    const normalizedSuggestedName = normalizeIdentity(
      plan.suggestedDomainName ?? '',
    );
    const plannedByExactName = normalizedSuggestedName
      ? requested.find(
          (domain) =>
            normalizeIdentity(domain.name) === normalizedSuggestedName,
        ) ?? null
      : null;
    const primary =
      (plannedExistingId ? byId.get(plannedExistingId) : undefined) ??
      plannedByExactName ??
      requested[0];
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

  private promoteExplicitPrimaryDomain(
    requestedDomainIds: readonly string[],
    explicitDomains: readonly PreparedExplicitDomain[],
    primaryDomainId: string | null,
  ): {
    readonly requestedDomainIds: string[];
    readonly explicitDomains: PreparedExplicitDomain[];
  } {
    const normalizedPrimaryId = primaryDomainId?.trim() ?? '';
    if (!normalizedPrimaryId || !requestedDomainIds.includes(normalizedPrimaryId)) {
      return {
        requestedDomainIds: [...requestedDomainIds],
        explicitDomains: [...explicitDomains],
      };
    }

    const orderedIds = [
      normalizedPrimaryId,
      ...requestedDomainIds.filter((id) => id !== normalizedPrimaryId),
    ];
    const byId = new Map(explicitDomains.map((domain) => [domain.id, domain] as const));
    const orderedDomains = orderedIds
      .map((id) => byId.get(id))
      .filter((domain): domain is PreparedExplicitDomain => Boolean(domain));

    if (orderedIds.some((id, index) => requestedDomainIds[index] !== id)) {
      this.logger.log(
        `[PREPARING] Promoted semantic problem-domain to the primary TEXT_AND_DOMAINS lane. canonicalOrder=${orderedDomains.map((domain) => domain.name).join(' | ')}.`,
      );
    }

    return {
      requestedDomainIds: orderedIds,
      explicitDomains: orderedDomains,
    };
  }

  /**
   * Treats the client-provided ordered domain names as an ordering assertion,
   * not as a reason to fail a semantically valid request when the parallel id
   * array was serialized in a different order. When both arrays describe the
   * exact same active domain set, rebuild the canonical id/domain order from
   * the UI names before any primary-domain or collection decision is made.
   *
   * A true id/name set mismatch still fails closed before collection.
   */
  private reconcileExplicitDomainBoundary(
    requestedDomainIds: readonly string[],
    requestedDomainNames: readonly string[],
    explicitDomains: readonly PreparedExplicitDomain[],
  ): {
    readonly requestedDomainIds: string[];
    readonly explicitDomains: PreparedExplicitDomain[];
    readonly orderReconciled: boolean;
  } {
    if (requestedDomainNames.length === 0) {
      return {
        requestedDomainIds: [...requestedDomainIds],
        explicitDomains: [...explicitDomains],
        orderReconciled: false,
      };
    }

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
    const byNormalizedName = new Map<string, PreparedExplicitDomain>();
    for (const domain of explicitDomains) {
      byNormalizedName.set(normalize(domain.name), domain);
    }

    const orderedDomains = requestedDomainNames.map((name) =>
      byNormalizedName.get(normalize(name)),
    );
    const missingAssertions = requestedDomainNames.flatMap((name, index) =>
      orderedDomains[index]
        ? []
        : [{ index, assertedName: name }],
    );
    const resolvedIdSet = new Set(explicitDomains.map((domain) => domain.id));
    const assertedIdSet = new Set(
      orderedDomains
        .filter((domain): domain is PreparedExplicitDomain => Boolean(domain))
        .map((domain) => domain.id),
    );
    const exactSetMatch =
      missingAssertions.length === 0 &&
      assertedIdSet.size === resolvedIdSet.size &&
      [...resolvedIdSet].every((id) => assertedIdSet.has(id));

    if (!exactSetMatch) {
      const mismatches = requestedDomainNames.map((assertedName, index) => ({
        index,
        domainId: requestedDomainIds[index] ?? null,
        assertedName,
        resolvedName: explicitDomains[index]?.name ?? null,
      }));
      this.logger.error(
        `[PREPARING] DOMAIN PAYLOAD MISMATCH | ${mismatches
          .map((item) => `${item.domainId ?? 'missing-id'}: ui="${item.assertedName}" db="${item.resolvedName ?? 'unresolved'}"`)
          .join(' | ')}.`,
      );
      throw new BadRequestException({
        code: 'DOMAIN_SELECTION_MAPPING_MISMATCH',
        message:
          'The submitted domain UUIDs and domain names do not resolve to the same active domain set. Generation was stopped before collection.',
        mismatches,
      });
    }

    const canonicalDomains = orderedDomains.filter(
      (domain): domain is PreparedExplicitDomain => Boolean(domain),
    );
    const canonicalIds = canonicalDomains.map((domain) => domain.id);
    const orderReconciled = canonicalIds.some(
      (id, index) => requestedDomainIds[index] !== id,
    );

    if (orderReconciled) {
      this.logger.warn(
        `[PREPARING] Reconciled explicit-domain id order from the authoritative UI name order before planning handoff. submittedIds=${requestedDomainIds.join(' | ')} canonicalIds=${canonicalIds.join(' | ')}.`,
      );
    }

    return {
      requestedDomainIds: canonicalIds,
      explicitDomains: canonicalDomains,
      orderReconciled,
    };
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
