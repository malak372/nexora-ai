import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { Prisma } from '@prisma/client';

import {
  findIdeaGenerationStageDefinition,
  IDEA_GENERATION_STAGE_KEYS,
  type IdeaGenerationStageDefinition,
} from '../../constants/idea-generation-stages.constants';
import { IDEA_GENERATION_ERROR_CODES } from '../../constants/idea-generation.constants';
import type {
  IdeaGenerationStage,
  IdeaGenerationStageExecutionResult,
} from '../../interfaces/idea-generation-stage.interface';
import {
  CollectionJobResolverService,
  type ResolveCollectionJobResult,
} from '../../services/collection-job-resolver.service';
import type {
  IdeaGenerationContext,
  SelectedGenerationDomain,
} from '../../types/idea-generation-context.type';
import { IDEA_OWNER_TYPES } from '../../../shared/constants/ideas.constants';
import { classifyDirectCommunityEvidence } from '../../../../nlp/common/utils/community-evidence.util';
import { RequestEvidenceAlignmentUtil } from '../../utils/request-evidence-alignment.util';
import { RequestDynamicQueryUtil } from '../../utils/request-dynamic-query.util';
import { RequestQueryProvenanceUtil } from '../../utils/request-query-provenance.util';

/**
 * Resolves one bounded collection job for the complete generation request.
 *
 * All selected collectors run in parallel exactly once. Keywords from every
 * selected domain are merged into the same job, preventing the previous
 * multiplicative behavior where GitHub, DEV.to, Product Hunt, Hacker News, and
 * NLP persistence were repeated once per domain.
 *
 * @author Malak
 * @author Eman
 */
@Injectable()
export class CollectionJobResolutionStage implements IdeaGenerationStage {
  private readonly logger = new Logger(CollectionJobResolutionStage.name);

  readonly key = IDEA_GENERATION_STAGE_KEYS.COLLECTION_JOB_RESOLUTION;
  readonly definition: IdeaGenerationStageDefinition = this.resolveDefinition();

  constructor(
    private readonly collectionJobResolver: CollectionJobResolverService,
  ) {}

  async execute(
    context: IdeaGenerationContext,
    signal?: AbortSignal,
  ): Promise<IdeaGenerationStageExecutionResult> {
    this.validateContext(context);

    const domains = this.resolveDomains(context);
    const primaryDomain =
      domains.find((domain) => domain.id === context.domainId) ?? domains[0];

    if (!primaryDomain) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.DOMAIN_NOT_FOUND,
        message: 'At least one resolved generation domain is required.',
      });
    }

    /*
     * Execute one collection job for the complete request. Previously the same
     * collectors were executed once per selected domain, which duplicated
     * GitHub, DEV.to, Product Hunt, and Hacker News requests and repeated NLP
     * persistence. One merged job keeps every collector while removing the
     * multiplicative domain fan-out.
     */
    const aiOwnedTextPlan = Boolean(
      context.requestDescription?.trim() &&
      context.collectionPlan?.aiUsed &&
      !context.collectionPlan?.fallbackUsed &&
      (context.collectionPlan?.searchQueries.length ?? 0) >= 6,
    );
    const baseDomainAwarePlannedQueries: string[] = aiOwnedTextPlan
      ? [...new Set<string>((context.collectionPlan?.searchQueries ?? []).map((query) => String(query)))].slice(0, 24)
      : [...this.buildDomainAwarePlannedQueries(context, domains)];
    /*
     * PREPARING already gave us the canonical problem and the strongest AI
     * queries. Expand that SAME problem during the first parallel pass instead
     * of waiting for a sequential recovery job. Expansion is still grounded by
     * RequestQueryProvenanceUtil, so breadth increases without semantic drift.
     */
    const smartExpansionQueries = aiOwnedTextPlan
      ? []
      : this.buildSmartFirstPassExpansionQueries(
          context,
          baseDomainAwarePlannedQueries,
        );
    /*
     * Keep the six PREPARING-AI queries canonical. First-pass recall may add a
     * very small temporary supplemental set, but those expansions must not
     * replace the AI plan or leak into recovery/semantic guards later in the
     * run. This prevents a good travel/tour plan from being contaminated by
     * generic archetype expansions such as public-transit vocabulary.
     */
    const domainAwarePlannedQueries: string[] = [
      ...new Set<string>([
        ...baseDomainAwarePlannedQueries.slice(0, 6),
        ...smartExpansionQueries,
      ]),
    ].slice(0, 10);

    /*
     * All permitted request-scoped sources now participate in one parallel
     * first pass. Problem-family expansion queries are injected into that same
     * pass instead of launching a second sequential collection job when the
     * first corpus is sparse. This preserves breadth while removing the
     * 15-25s sparse-expansion tax observed on niche restoration requests.
     */
    const result = await this.resolveUnifiedCollection(
      context,
      primaryDomain,
      domains,
      domainAwarePlannedQueries,
      signal,
    );
    const smartFirstPassExpanded = smartExpansionQueries.length > 0;
    const rawEvidenceCorpus = this.buildRawEvidenceCorpus(
      result.rawEvidenceInputs ?? result.fastEvidenceInputs ?? [],
    );

    const nlp = result.nlpOutput;

    /*
     * FAST_GENERATION keeps a richer in-memory collector corpus than the
     * intentionally bounded NLP pass. Preserve direct problem evidence from
     * that first collection here so ranking never needs to recollect a bug or
     * complaint that was already found initially.
     */
    const compositeFastEvidenceTexts = this.buildCompositeFastEvidenceTextSet(
      result.fastEvidenceInputs ?? [],
      context,
      domains,
    );
    const fastEvidenceByDomain = new Map(
      domains.map((domain) => [
        domain.id,
        this.buildFastEvidenceForDomain(
          result.fastEvidenceInputs ?? [],
          domain,
          domains,
          compositeFastEvidenceTexts,
        ),
      ]),
    );

    const canonicalDirectNlpEvidence = this.buildCanonicalDirectNlpEvidence(
      nlp,
      result.fastEvidenceInputs ?? [],
    );

    const domainEvidence = domains.map((domain) => {
      /*
       * samplePosts/sampleComments may be empty while analyzedTexts already
       * contains the authoritative in-memory NLP evidence. Build the domain
       * evidence map from analyzedTexts first, then fall back to representative
       * samples. This fixes the previous contradiction where NLP reported
       * analyzed texts but every domainEvidence entry reported zero.
       */
      const analyzedDomainEvidence = this.buildAnalyzedEvidenceForDomain(
        nlp.analyzedTexts,
        domain,
        domains,
      );

      const fastDomainEvidence = fastEvidenceByDomain.get(domain.id) ?? {
        posts: [],
        comments: [],
      };
      const samplePosts = this.mergeRepresentativeEvidence(
        fastDomainEvidence.posts,
        analyzedDomainEvidence.posts.length > 0
          ? analyzedDomainEvidence.posts
          : this.filterEvidenceForDomain(nlp.samplePosts, domain, domains),
        10,
      );
      const canonicalNlpComments = canonicalDirectNlpEvidence.filter((item) =>
        this.evidenceBelongsToDomain(item.text, domain, domains),
      );
      const sampleComments = this.mergeRepresentativeEvidence(
        [
          ...canonicalNlpComments,
          ...fastDomainEvidence.comments,
        ],
        (analyzedDomainEvidence.comments.length > 0
          ? analyzedDomainEvidence.comments
          : this.filterEvidenceForDomain(nlp.sampleComments, domain, domains)
        ).filter((value) =>
          this.isRepresentativeProblemEvidence(this.extractEvidenceText(value)),
        ),
        14,
      );

      const totalPostsAnalyzed = samplePosts.length;
      const totalCommentsAnalyzed = sampleComments.length;
      const totalTextsAnalyzed = totalPostsAnalyzed + totalCommentsAnalyzed;

      return {
        domainId: domain.id,
        domainName: domain.name,
        collectionJobId: result.job.id,
        reused: result.reused,
        totalTextsAnalyzed,
        totalPostsAnalyzed,
        totalCommentsAnalyzed,
        evidenceAvailable: totalTextsAnalyzed > 0,
        samplePosts: this.toJsonValue(samplePosts),
        sampleComments: this.toJsonValue(sampleComments),
      };
    });

    const firstPassPosts = this.mergeRepresentativeEvidence(
      domains.flatMap((domain) =>
        fastEvidenceByDomain.get(domain.id)?.posts ?? [],
      ),
      Array.isArray(nlp.samplePosts) ? nlp.samplePosts : [],
      16,
    );
    const firstPassComments = this.mergeRepresentativeEvidence(
      domains.flatMap((domain) =>
        fastEvidenceByDomain.get(domain.id)?.comments ?? [],
      ),
      Array.isArray(nlp.sampleComments) ? nlp.sampleComments : [],
      20,
    );

    const effectiveTotalPostsAnalyzed = Math.max(
      nlp.totalPostsAnalyzed,
      firstPassPosts.length,
    );
    const effectiveTotalCommentsAnalyzed = Math.max(
      nlp.totalCommentsAnalyzed,
      firstPassComments.length,
    );
    const effectiveTotalTextsAnalyzed = Math.max(
      nlp.totalTextsAnalyzed,
      effectiveTotalPostsAnalyzed + effectiveTotalCommentsAnalyzed,
    );

    const updatedContext: IdeaGenerationContext = {
      ...context,
      domainId: result.job.domain.id,
      domainName: result.job.domain.name,
      collection: {
        collectionJobId: result.job.id,
        anchorDomainId: result.job.domain.id,
        anchorDomainName: result.job.domain.name,
        reused: result.reused,
        totalPosts: effectiveTotalPostsAnalyzed,
        totalComments: effectiveTotalCommentsAnalyzed,
      },
      nlp: {
        nlpAnalysisId:
          result.job.nlpAnalysis?.id ?? nlp.collectionJobId,
        totalTextsAnalyzed: effectiveTotalTextsAnalyzed,
        totalPostsAnalyzed: effectiveTotalPostsAnalyzed,
        totalCommentsAnalyzed: effectiveTotalCommentsAnalyzed,
        sentimentStats: this.toJsonValue(nlp.sentimentStats) as Prisma.JsonObject,
        keywords: this.toJsonValue(nlp.keywords) as Prisma.JsonArray,
        topics: this.toJsonValue(nlp.topics) as Prisma.JsonArray,
        recurringProblems: this.toJsonValue(nlp.recurringProblems) as Prisma.JsonArray,
        extractedNeeds: this.toJsonValue(nlp.extractedNeeds) as Prisma.JsonArray,
        featureRequests: this.toJsonValue(nlp.featureRequests) as Prisma.JsonArray,
        opportunities: this.toJsonValue(nlp.opportunities) as Prisma.JsonArray,
        insights: this.toJsonValue(nlp.insights) as Prisma.JsonArray,
        dataQuality: this.toJsonValue(nlp.dataQuality) as Prisma.JsonObject,
        samplePosts: this.toJsonValue(firstPassPosts) as Prisma.JsonArray,
        sampleComments: this.toJsonValue(firstPassComments) as Prisma.JsonArray,
        aiUsed: nlp.aiUsed,
        confidence: nlp.confidence,
      },
      domainEvidence,
      rawEvidenceCorpus,
      // Preserve the authoritative PREPARING plan. Supplemental first-pass
      // retrieval queries are execution-local and never become canonical
      // requester intent for Community/recovery/ranking.
      collectionPlan: context.collectionPlan,
    };

    return {
      context: updatedContext,
      resultPreview:
        `Executed smart selective parallel collection for ${domains.length} selected domain(s): ` +
        `${rawEvidenceCorpus.length} raw collector candidate(s) preserved for Community semantic triage, ` +
        `${effectiveTotalTextsAnalyzed} stricter NLP-preprocessed text(s) retained.`,
      metadata: {
        stageRole: 'SMART_ALL_SOURCE_PARALLEL_COLLECTION',
        smartFirstPassExpanded,
        collectionMode: 'FAST_GENERATION',
        domainCount: domains.length,
        collectionJobIds: [result.job.id],
        primaryCollectionJobId: result.job.id,
        reusedCollectionJobs: result.reused ? 1 : 0,
        totalTextsAnalyzed: effectiveTotalTextsAnalyzed,
        totalPostsAnalyzed: effectiveTotalPostsAnalyzed,
        totalCommentsAnalyzed: effectiveTotalCommentsAnalyzed,
        firstPassDirectEvidenceCount:
          firstPassPosts.length + firstPassComments.length,
        rawEvidenceCandidateCount: rawEvidenceCorpus.length,
        nlpAnalysisId:
          result.job.nlpAnalysis?.id ?? nlp.collectionJobId,
        nlpAiUsed: nlp.aiUsed,
        nlpConfidence: nlp.confidence,
      },
    };
  }

  private buildDomainAwarePlannedQueries(
    context: IdeaGenerationContext,
    domains: readonly SelectedGenerationDomain[],
  ): string[] {
    const base: string[] = (context.collectionPlan?.searchQueries ?? [])
      .filter((query): query is string => typeof query === 'string')
      .filter((query) =>
        this.isRequestCompatiblePlannedQuery(
          context.requestDescription?.trim() ?? '',
          query,
        ),
      );
    const explicitDomains = domains.filter((domain) => domain.isExplicitlySelected);
    const latentRequestContexts = this.resolveLatentRequestContexts(
      context,
      explicitDomains,
    );
    const requestDescription = context.requestDescription?.trim() ?? '';
    const actorAnchoredQueries = requestDescription
      ? this.buildGenericFacetExpansionQueries(context, requestDescription, 6)
      : [];
    const priorityQueries = Array.from(
      { length: Math.max(actorAnchoredQueries.length, base.length) },
      (_unused, index) => [actorAnchoredQueries[index], base[index]],
    )
      .flat()
      .filter((value): value is string => Boolean(value?.trim()));

    if (!requestDescription) {
      return [...new Set(base)].slice(0, 24);
    }

    /*
     * Text-only requests need the same actor/workflow-anchored queries as
     * Text+Domains. Several collectors inspect only the first few planned
     * queries, so keeping these first prevents truncation from dropping the
     * niche actor (for example "fitness center" or "taxidermy").
     */
    if (explicitDomains.length === 0) {
      return [...new Set(priorityQueries)].slice(0, 24);
    }

    const requestSeed = (context.collectionPlan?.intentConcepts ?? [])
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 3)
      .join(' ') || context.requestDescription!.slice(0, 140);
    const latentQueries = latentRequestContexts.map(
      (latentDomain) => `${requestSeed} ${latentDomain}`,
    );

    /*
     * Every explicitly selected domain gets request-specific retrieval lanes,
     * including domains that have never existed in our configured catalogue.
     * The lane is composed from the domain label plus AI intent/evidence
     * concepts and request-derived identity terms; no per-domain rule is
     * required for new verticals. Legacy bridge rules below remain as bounded
     * precision fallbacks for previously tuned cases.
     */
    const genericDomainQueries = explicitDomains.flatMap((domain) =>
      this.buildGenericDomainRetrievalQueries(context, domain, requestDescription),
    );

    /*
     * Text-derived planner queries are authoritative and must stay at the
     * front. Several collectors intentionally inspect only the first one to
     * three planned queries in FAST_GENERATION; placing generic domain lanes
     * first starved the AI's exact requester queries.
     */
    const ordered = [
      ...priorityQueries.slice(0, 6),
      ...genericDomainQueries,
      ...priorityQueries.slice(6),
      ...latentQueries,
    ];

    return [...new Set(ordered)].slice(0, 30);
  }

  private buildGenericDomainRetrievalQueries(
    context: IdeaGenerationContext,
    domain: SelectedGenerationDomain,
    requestDescription: string,
  ): string[] {
    const compact = (value: string, maxWords: number): string =>
      value
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim()
        .split(' ')
        .filter(Boolean)
        .slice(0, maxWords)
        .join(' ');

    const semanticDomainLane: string[] = (domain.requestIntentKeywords ?? [])
      .filter((value): value is string => typeof value === 'string')
      .map((value) => compact(value, 9))
      .filter((query) => query.split(/\s+/u).length >= 3);
    if (semanticDomainLane.length >= 2) {
      return [...new Set<string>(semanticDomainLane)].slice(0, 4);
    }

    const domainSeeds = [
      domain.name,
      ...(domain.effectiveSearchKeywords ?? domain.keywords ?? []),
    ]
      .map((value) => compact(value, 4))
      .filter(Boolean);
    const uniqueDomainSeeds = [...new Set(domainSeeds)].slice(0, 2);
    if (uniqueDomainSeeds.length === 0) return [];

    const identity = RequestDynamicQueryUtil.extractEvidenceIdentityTerms(
      requestDescription,
    );
    const primaryDomainTokens = new Set(
      compact(uniqueDomainSeeds[0] ?? '', 6).split(' ').filter(Boolean),
    );
    const identityPhrase = identity
      .filter((token) => !primaryDomainTokens.has(token.toLocaleLowerCase()))
      .slice(0, 3)
      .join(' ');

    const workflowCandidates = [
      ...(context.collectionPlan?.intentConcepts ?? []),
      ...RequestDynamicQueryUtil.extractWorkflowTerms(requestDescription),
    ]
      .map((value) => compact(value, 3))
      .filter(Boolean);
    const painCandidates = [
      ...(context.collectionPlan?.evidenceTargets ?? []).flatMap((value) =>
        RequestDynamicQueryUtil.extractPainTerms(value),
      ),
      ...RequestDynamicQueryUtil.extractPainTerms(requestDescription),
    ]
      .map((value) => compact(value, 3))
      .filter(Boolean);

    const workflow = workflowCandidates[0] ?? '';
    const secondaryWorkflow = workflowCandidates[1] ?? workflow;
    const pain = painCandidates[0] ?? '';
    const secondaryPain = painCandidates[1] ?? pain;
    const queries = [
      `${uniqueDomainSeeds[0]} ${identityPhrase} ${workflow}`,
      `${uniqueDomainSeeds[0]} ${identityPhrase} ${pain}`,
      `${uniqueDomainSeeds[1] ?? uniqueDomainSeeds[0]} ${secondaryWorkflow} ${secondaryPain}`,
    ];

    return [...new Set(
      queries
        .map((query) => compact(query, 9))
        .filter((query) => query.split(/\s+/u).length >= 3),
    )].slice(0, 3);
  }

  private resolveLatentRequestContexts(
    context: IdeaGenerationContext,
    explicitDomains: readonly SelectedGenerationDomain[],
  ): string[] {
    if (!context.requestDescription?.trim()) return [];

    const normalize = (value: string) =>
      value
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
    const explicit = new Set(explicitDomains.map((domain) => normalize(domain.name)));
    /*
     * Explicitly selected domains are authoritative. Do not re-inject broad
     * keyword-match candidates (for example E-commerce beside an explicitly
     * selected Real Estate + Cybersecurity + AI request) into text retrieval.
     * When there are no explicit domains, the planner/domain-resolution trace
     * may still provide useful latent context for text-only discovery.
     */
    const values = explicitDomains.length > 0
      ? [
          ...(context.collectionPlan?.inferredSecondaryScopes ?? []),
          context.collectionPlan?.suggestedDomainName ?? '',
        ]
      : [
          ...(context.collectionPlan?.inferredSecondaryScopes ?? []),
          context.collectionPlan?.suggestedDomainName ?? '',
          ...(context.domainResolution?.candidates ?? []).map(
            (candidate) => candidate.domainName,
          ),
        ];
    const output: string[] = [];
    const seen = new Set<string>();

    for (const value of values) {
      const trimmed = value.trim();
      const normalized = normalize(trimmed);
      if (!normalized || explicit.has(normalized) || seen.has(normalized)) {
        continue;
      }
      const transportSpecific =
        /\b(?:fleet|freight|logistics|transport|transportation|delivery|shipment|route)\b/u.test(
          normalized,
        );
      const normalizedRequest = normalize(context.requestDescription ?? '');
      const requestHasTransportContext =
        /\b(?:fleet|vehicle|vehicles|freight|logistics|transport|transportation|delivery|deliveries|shipment|shipments|route|routes|courier|carrier|last mile|3pl)\b/u.test(
          normalizedRequest,
        );
      if (transportSpecific && !requestHasTransportContext) continue;
      const energySpecific = /^(?:energy|energy operations?|power|utilities?)$/u.test(normalized);
      const requestHasEnergyContext =
        /\b(?:energy|electricity|power|utility|utilities|hvac|fuel|grid|meter|meters|kilowatt|kwh|electric consumption|energy consumption)\b/u.test(normalizedRequest);
      if (energySpecific && !requestHasEnergyContext) continue;
      if (normalized.split(/\s+/u).length > 9) continue;
      seen.add(normalized);
      output.push(trimmed);
      if (output.length >= 2) break;
    }

    return output;
  }

  private isRequestCompatiblePlannedQuery(
    requestDescription: string,
    query: string,
  ): boolean {
    if (!requestDescription) return true;
    const request = requestDescription.toLocaleLowerCase();
    const candidate = query.toLocaleLowerCase();

    const hasHrActor = /\b(?:human resources|\bhr\b|employee|employees|workforce|staffing|recruitment|recruiting|hiring|candidate|candidates|applicant|applicants|payroll)\b/u.test(request);
    if (!hasHrActor && /\bhr\s*&\s*recruitment\b/u.test(candidate)) {
      return false;
    }

    const weddingPreservation =
      /\b(?:wedding dress|wedding gown|bridal gown|bridal dress)\b/u.test(request) &&
      /\b(?:preservation|textile restoration|garment restoration|cleaning restriction|cleaning restrictions|fabric|stains?|decorative|alterations?)\b/u.test(request);
    if (weddingPreservation && /\b(?:venue|photographer|catering|guest list|event schedule|event vendor|wedding budget|event planning)\b/u.test(candidate)) {
      return false;
    }

    return true;
  }

  private async resolveUnifiedCollection(
    context: IdeaGenerationContext,
    primaryDomain: SelectedGenerationDomain,
    domains: readonly SelectedGenerationDomain[],
    domainAwarePlannedQueries: readonly string[],
    signal?: AbortSignal,
  ): Promise<ResolveCollectionJobResult> {
    const sourceKeys = this.selectRuntimeSourceKeys(
      context,
      context.selectedDataSources.map((source) => source.key),
    );

    return this.collectionJobResolver.resolve({
      userId:
        context.owner.type === IDEA_OWNER_TYPES.USER
          ? context.owner.userId
          : undefined,
      domainId: primaryDomain.id,
      country: context.location.country,
      city: context.location.city ?? undefined,
      region: context.location.region ?? undefined,
      language: context.location.language,
      radiusKm: context.location.radiusKm ?? undefined,
      dataSourceKeys: sourceKeys,
      keywords: this.buildUnifiedKeywords(context, domains),
      plannedQueries: context.collectionPlan
        ? [...domainAwarePlannedQueries]
        : undefined,
      queriesGeneratedByAi:
        context.collectionPlan?.aiUsed === true &&
        context.collectionPlan.fallbackUsed !== true,
      sourcePlans:
        context.collectionPlan?.sourcePlans?.length
          ? context.collectionPlan.sourcePlans
          : undefined,
      userDescription: context.requestDescription?.trim() || undefined,
      forceRefresh: context.forceRefresh,
      collectionMode: 'FAST_GENERATION',
      signal,
      resolvedDomain: {
        id: primaryDomain.id,
        name: primaryDomain.name,
        /*
         * Keep the persisted primary domain identity, but expose a balanced
         * vocabulary from every selected domain to collectors. This fixes the
         * old behavior where collectors received only the first domain even
         * though the request selected two or three domains.
         */
        keywords: this.buildCollectorVocabulary(context, domains),
      },
      resolvedDataSources: context.selectedDataSources
        .filter((source) => sourceKeys.includes(source.key.trim().toLowerCase()))
        .map((source) => ({
          id: source.id,
          key: source.key,
          displayName: source.displayName,
        })),
      /*
       * Collect a stronger first-pass corpus so most runs satisfy evidence
       * requirements without a second targeted-recovery collection. All
       * collectors still execute in parallel, therefore the additional depth
       * improves recall without creating one sequential request chain.
       */
      collectorLimits: this.resolveFirstPassCollectorLimits(context),
    });
  }

  private resolveFirstPassCollectorLimits(
    context: IdeaGenerationContext,
  ): {
    readonly maxFetchedPosts: number;
    readonly maxSavedPosts: number;
    readonly maxFetchedComments: number;
    readonly maxSavedComments: number;
  } {
    const hasRequesterText = Boolean(context.requestDescription?.trim());
    const plannedQueryCount = context.collectionPlan?.searchQueries?.length ?? 0;
    const sourceCount = Math.max(1, context.selectedDataSources.length);
    const sparsePlan = plannedQueryCount <= 2 || sourceCount <= 2;

    if (!hasRequesterText) {
      return {
        maxFetchedPosts: 28,
        maxSavedPosts: 18,
        maxFetchedComments: 52,
        maxSavedComments: 34,
      };
    }

    return sparsePlan
      ? {
          maxFetchedPosts: 40,
          maxSavedPosts: 32,
          maxFetchedComments: 56,
          maxSavedComments: 44,
        }
      : {
          maxFetchedPosts: 34,
          maxSavedPosts: 28,
          maxFetchedComments: 48,
          maxSavedComments: 38,
        };
  }

  private buildSmartFirstPassExpansionQueries(
    context: IdeaGenerationContext,
    currentQueries: readonly string[],
  ): string[] {
    const requestDescription = context.requestDescription?.trim() ?? '';
    if (!requestDescription) return [];

    const candidates = this.buildGenericFacetExpansionQueries(
      context,
      requestDescription,
      8,
    );
    const current = new Set(
      currentQueries.map((query) =>
        query.replace(/\s+/gu, ' ').trim().toLocaleLowerCase(),
      ),
    );

    return candidates
      .filter((query) => query.length >= 12)
      .filter((query) =>
        !current.has(query.replace(/\s+/gu, ' ').trim().toLocaleLowerCase()),
      )
      .filter((query) =>
        RequestQueryProvenanceUtil.isQueryGrounded({
          requestDescription,
          query,
        }),
      )
      .slice(0, 4);
  }

  private buildGenericFacetExpansionQueries(
    context: IdeaGenerationContext,
    requestDescription: string,
    maxQueries: number,
  ): string[] {
    const clean = (value: string, maxWords = 8): string =>
      value
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim()
        .split(/\s+/u)
        .filter(Boolean)
        .slice(0, maxWords)
        .join(' ');

    const profile = context.collectionPlan?.problemProfile;
    const actor = clean(
      profile?.actor || RequestDynamicQueryUtil.extractActor(requestDescription),
      5,
    );
    const object = clean(
      profile?.object ||
        RequestDynamicQueryUtil.extractEvidenceIdentityTerms(requestDescription)
          .slice(0, 5)
          .join(' '),
      6,
    );
    const workflows = [
      profile?.workflow ?? '',
      ...(context.collectionPlan?.intentConcepts ?? []),
      ...RequestDynamicQueryUtil.extractWorkflowTerms(requestDescription),
    ]
      .map((value) => clean(value, 5))
      .filter(Boolean);
    const failures = [
      ...(profile?.failureModes ?? []),
      ...(profile?.consequences ?? []),
      ...(context.collectionPlan?.evidenceTargets ?? []),
      ...RequestDynamicQueryUtil.extractPainTerms(requestDescription),
    ]
      .map((value) => clean(value, 5))
      .filter(Boolean);

    const queries: string[] = [];
    const add = (...parts: string[]) => {
      const query = clean(parts.filter(Boolean).join(' '), 10);
      if (query.split(/\s+/u).length >= 3) queries.push(query);
    };

    const width = Math.max(workflows.length, failures.length, 1);
    for (let index = 0; index < width && queries.length < maxQueries; index += 1) {
      add(
        actor || object,
        object,
        workflows[index % Math.max(1, workflows.length)] ?? '',
        failures[index % Math.max(1, failures.length)] ?? '',
      );
    }
    for (let index = 0; index < failures.length && queries.length < maxQueries; index += 1) {
      add(actor || object, object, failures[index]);
    }

    return [...new Set(queries)].slice(0, Math.max(1, maxQueries));
  }

  private async resolveSparseFirstPassExpansion(
    context: IdeaGenerationContext,
    primaryDomain: SelectedGenerationDomain,
    domains: readonly SelectedGenerationDomain[],
    expansionQueries: readonly string[],
    signal?: AbortSignal,
  ): Promise<ResolveCollectionJobResult> {
    const sourceKeys = context.selectedDataSources
      .map((source) => source.key.trim().toLocaleLowerCase())
      .filter(Boolean)
      .slice(0, 4);
    const effectiveSourceKeys = sourceKeys.length >= 2
      ? sourceKeys
      : this.selectAllActiveSourceKeys(
          context.selectedDataSources.map((source) => source.key),
        ).slice(0, 4);

    return this.collectionJobResolver.resolve({
      userId:
        context.owner.type === IDEA_OWNER_TYPES.USER
          ? context.owner.userId
          : undefined,
      domainId: primaryDomain.id,
      country: context.location.country,
      city: context.location.city ?? undefined,
      region: context.location.region ?? undefined,
      language: context.location.language,
      radiusKm: context.location.radiusKm ?? undefined,
      dataSourceKeys: effectiveSourceKeys,
      keywords: this.buildUnifiedKeywords(context, domains),
      plannedQueries: [...expansionQueries],
      userDescription: context.requestDescription?.trim() || undefined,
      forceRefresh: true,
      collectionMode: 'FAST_GENERATION',
      signal,
      resolvedDomain: {
        id: primaryDomain.id,
        name: primaryDomain.name,
        keywords: this.buildCollectorVocabulary(context, domains),
      },
      resolvedDataSources: context.selectedDataSources
        .filter((source) => effectiveSourceKeys.includes(source.key.toLowerCase()))
        .map((source) => ({
          id: source.id,
          key: source.key,
          displayName: source.displayName,
        })),
      collectorLimits: {
        maxFetchedPosts: 8,
        maxSavedPosts: 5,
        maxFetchedComments: 12,
        maxSavedComments: 6,
      },
    });
  }

  private resolveDomains(
    context: IdeaGenerationContext,
  ): SelectedGenerationDomain[] {
    return context.selectedDomains.length > 0
      ? context.selectedDomains
      : [
          {
            id: context.domainId,
            name: context.domainName!,
            keywords: context.keywords,
          },
        ];
  }

  /**
   * Text requests already have a semantic source plan. Execute every PRIMARY
   * and SECONDARY lane plus only the MICRO_PROBE lanes that are necessary to
   * preserve a unique planner query. This removes redundant low-fit collectors
   * (and their DB writes) without losing any planned query coverage.
   *
   * DOMAINS_ONLY / NO_INPUT remain intentionally broad because discovery, not
   * validation of a known requester problem, is the purpose of those paths.
   */
  private selectRuntimeSourceKeys(
    context: IdeaGenerationContext,
    activeKeys: readonly string[],
  ): string[] {
    const normalizedActive = this.selectAllActiveSourceKeys(activeKeys);
    if (!context.requestDescription?.trim()) {
      return normalizedActive;
    }

    const plans = context.collectionPlan?.sourcePlans ?? [];
    if (plans.length === 0) return normalizedActive;

    const active = new Set(normalizedActive);
    const strongPlans = plans.filter(
      (plan) =>
        active.has(plan.sourceKey.trim().toLowerCase()) &&
        plan.sourceTier !== 'MICRO_PROBE' &&
        plan.queries.length > 0,
    );
    const selected = new Set(
      strongPlans.map((plan) => plan.sourceKey.trim().toLowerCase()),
    );
    const coveredQueries = new Set(
      strongPlans.flatMap((plan) =>
        plan.queries.map((query) =>
          query.replace(/\s+/gu, ' ').trim().toLocaleLowerCase(),
        ),
      ),
    );

    for (const plan of plans) {
      const key = plan.sourceKey.trim().toLowerCase();
      if (!active.has(key) || selected.has(key) || plan.queries.length === 0) continue;
      const contributesUniqueQuery = plan.queries.some(
        (query) =>
          !coveredQueries.has(
            query.replace(/\s+/gu, ' ').trim().toLocaleLowerCase(),
          ),
      );
      if (!contributesUniqueQuery) continue;

      selected.add(key);
      for (const query of plan.queries) {
        coveredQueries.add(
          query.replace(/\s+/gu, ' ').trim().toLocaleLowerCase(),
        );
      }
    }

    // Keep at least four complementary sources for sparse/niche text requests.
    // Planner order is preferred; active catalog order is only a final fill.
    for (const key of [
      ...(context.collectionPlan?.selectedSourceKeys ?? []),
      ...normalizedActive,
    ]) {
      if (selected.size >= 4) break;
      const normalized = key.trim().toLowerCase();
      if (active.has(normalized)) selected.add(normalized);
    }

    return normalizedActive.filter((key) => selected.has(key));
  }

  private selectAllActiveSourceKeys(keys: readonly string[]): string[] {
    /*
     * DataSourceSelectionStage has already filtered this list to active,
     * allowed sources. Keep every active source and only normalize/deduplicate
     * the keys. Collectors still execute in parallel, while per-source limits
     * above prevent the aggregate corpus from becoming unnecessarily large.
     */
    return [...new Set(
      keys
        .map((key) => key.trim().toLowerCase())
        .filter(Boolean),
    )];
  }

  private buildUnifiedKeywords(
    context: IdeaGenerationContext,
    domains: readonly SelectedGenerationDomain[],
  ): string[] {
    const balanced: string[] = [];
    const environmentSelected = domains.some(
      (domain) => this.normalizeTerm(domain.name) === 'environment',
    );
    const addUnique = (value: string | null | undefined) => {
      let trimmed = value?.trim();

      if (!trimmed) {
        return;
      }

      let normalized = this.normalizeTerm(trimmed);
      if (environmentSelected && normalized === 'environment') {
        trimmed = 'environmental monitoring';
        normalized = 'environmental monitoring';
      }

      if (
        !balanced.some(
          (candidate) => this.normalizeTerm(candidate) === normalized,
        )
      ) {
        balanced.push(trimmed);
      }
    };

    for (const query of (context.collectionPlan?.searchQueries ?? []).slice(
      0,
      12,
    )) {
      addUnique(query);
    }

    for (const target of (context.collectionPlan?.evidenceTargets ?? []).slice(
      0,
      6,
    )) {
      addUnique(target);
    }

    for (const latentDomain of this.resolveLatentRequestContexts(
      context,
      domains.filter((domain) => domain.isExplicitlySelected),
    )) {
      addUnique(latentDomain);
    }

    if (!context.collectionPlan) {
      for (const intent of this.buildEvidenceSearchIntents(
        context.requestDescription,
      )) {
        addUnique(intent);
      }
    }

    /*
     * For text-bearing requests, a naked domain label is too broad to be a
     * retrieval keyword ("Government", "AI", "Finance", ...). Domains are
     * constraints and are projected through requestIntentKeywords below. Keep
     * standalone domain anchors only for no-text discovery paths.
     */
    if (!context.requestDescription?.trim()) {
      for (const domain of domains) addUnique(domain.name);
    }

    /*
     * In Text + Domains, project each explicit domain through the requester
     * description before falling back to its generic configured vocabulary.
     * This prevents broad Logistics terms such as shipment/fleet/warehouse from
     * dominating a hospital operating-room coordination request while keeping
     * the domain materially present in search.
     */
    if (context.requestDescription?.trim()) {
      for (const domain of domains.filter((item) => item.isExplicitlySelected)) {
        for (const keyword of (domain.requestIntentKeywords ?? []).slice(0, 4)) {
          addUnique(keyword);
        }
      }
    }

    // Keep direct requester terms near the front without sacrificing one slot
    // per selected domain. In text-only requests these terms are the strongest
    // available intent signal.
    for (const keyword of context.keywords.slice(0, 4)) {
      addUnique(keyword);
    }

    const buckets = domains.map((domain) => {
      const focused = this.buildProblemFocusedQueries(context, domain).slice(0, 3);
      const specific = this.selectSpecificDomainTerms(domain, 4).filter((term) =>
        this.isDomainKeywordRequestCompatible(context, term),
      );
      return [domain.name, ...specific, ...focused];
    });

    for (let index = 1; balanced.length < 24; index += 1) {
      let added = false;

      for (const bucket of buckets) {
        const value = bucket[index];
        if (!value) continue;
        const before = balanced.length;
        addUnique(value);
        added = added || balanced.length > before;
        if (balanced.length >= 24) break;
      }

      if (!added) break;
    }

    // Fill the remaining budget with the orchestrator's request-first terms.
    for (const keyword of context.keywords) {
      if (balanced.length >= 32) break;
      addUnique(keyword);
    }

    return balanced.slice(0, 32);
  }

  private buildCollectorVocabulary(
    context: IdeaGenerationContext,
    domains: readonly SelectedGenerationDomain[],
  ): string[] {
    if (!context.collectionPlan) {
      return this.buildBalancedDomainVocabulary(context, domains);
    }

    const textBearingRequest = Boolean(context.requestDescription?.trim());
    const profile = context.collectionPlan.problemProfile;
    const domainConstrainedTerms = textBearingRequest
      ? domains
          .filter((domain) => domain.isExplicitlySelected)
          .flatMap((domain) => (domain.requestIntentKeywords ?? []).slice(0, 3))
      : this.buildBalancedDomainVocabulary(context, domains);
    const values = [
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
      ...context.collectionPlan.searchQueries.slice(0, 12),
      ...context.collectionPlan.intentConcepts.slice(0, 8),
      ...context.collectionPlan.evidenceTargets.slice(0, 6),
      ...this.resolveLatentRequestContexts(
        context,
        domains.filter((domain) => domain.isExplicitlySelected),
      ),
      ...domainConstrainedTerms,
    ];
    const output: string[] = [];
    const seen = new Set<string>();

    for (const raw of values) {
      const value = raw?.trim();
      if (!value) continue;
      const key = this.normalizeTerm(value);
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(value);
      if (output.length >= 36) break;
    }

    return output;
  }

  /**
   * Creates a round-robin domain vocabulary for collectors that still consume
   * resolvedDomain.keywords. Domain names are emitted first, followed by each
   * domain's configured terms in layers, so secondary domains are never hidden
   * behind a primary-domain flatMap().slice().
   */
  private buildBalancedDomainVocabulary(
    context: IdeaGenerationContext,
    domains: readonly SelectedGenerationDomain[],
  ): string[] {
    const output: string[] = [];
    const seen = new Set<string>();
    const hasRequesterText = Boolean(context.requestDescription?.trim());
    const buckets = domains.map((domain) => [
      this.resolveCollectionDomainAnchor(domain),
      ...(hasRequesterText && domain.isExplicitlySelected
        ? (domain.requestIntentKeywords ?? []).slice(0, 8)
        : []),
      ...domain.keywords.filter((keyword) =>
        !hasRequesterText ||
        !domain.isExplicitlySelected ||
        this.isDomainKeywordRequestCompatible(context, keyword),
      ),
    ]);

    for (let index = 0; output.length < 36; index += 1) {
      let added = false;
      for (const bucket of buckets) {
        const value = bucket[index]?.trim();
        if (!value) continue;
        const normalized = this.normalizeTerm(value);
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        output.push(value);
        added = true;
        if (output.length >= 36) break;
      }
      if (!added) break;
    }

    return output;
  }

  private buildEvidenceSearchIntents(
    value: string | null | undefined,
  ): string[] {
    if (!value) {
      return [];
    }

    const normalized = value
      .replace(/\b(?:ai|artificial intelligence)[ -]?(?:enhance|enhanced|enhancement|powered)\b/giu, ' ')
      .replace(/\b(?:enhance|enhanced|improve|improved|optimize|optimized)\b[^.!?,;]{0,24}\b(?:with|using|by)\s+(?:ai|artificial intelligence)\b/giu, ' ')
      .replace(/\b(?:using|use|with)\s+(?:ai|artificial intelligence)\b/giu, ' ')
      .replace(/\b(?:and|or|with|using|by)\s*$/giu, ' ')
      .replace(/[^\p{L}\p{N}\s'-]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();

    if (!normalized) {
      return [];
    }

    const stopWords = new Set([
      'a',
      'an',
      'and',
      'are',
      'as',
      'at',
      'be',
      'by',
      'for',
      'from',
      'in',
      'is',
      'it',
      'of',
      'on',
      'or',
      'the',
      'to',
      'with',
      'often',
      'usually',
      'frequently',
      'commonly',
      'struggle',
      'struggles',
      'struggling',
      'difficult',
      'difficulty',
      'information',
      'separate',
      'systems',
      'system',
      'data',
    ]);

    const tokens = normalized
      .toLowerCase()
      .split(/\s+/u)
      .filter(Boolean)
      .filter((token) => token.length >= 3 && !stopWords.has(token));

    if (tokens.length === 0) {
      return [];
    }

    const queries: string[] = [];
    const seen = new Set<string>();
    const push = (parts: readonly string[]) => {
      const query = parts.join(' ').replace(/\s+/gu, ' ').trim();
      if (query.split(/\s+/u).length < 3) return;
      if (seen.has(query)) return;
      seen.add(query);
      queries.push(query);
    };

    const windowSize = tokens.length >= 7 ? 5 : Math.min(5, tokens.length);
    const step = Math.max(2, windowSize - 2);

    for (
      let index = 0;
      index < tokens.length && queries.length < 4;
      index += step
    ) {
      push(tokens.slice(index, index + windowSize));
    }

    return queries.slice(0, 4);
  }



  /** Builds high-intent queries that describe a user problem, not a topic. */
  private buildProblemFocusedQueries(
    context: IdeaGenerationContext,
    domain: SelectedGenerationDomain,
  ): string[] {
    const specificTerms = this.selectSpecificDomainTerms(domain, 5).filter((term) =>
      this.isDomainKeywordRequestCompatible(context, term),
    );
    const projectedTerms = context.requestDescription?.trim() && domain.isExplicitlySelected
      ? (domain.requestIntentKeywords ?? []).slice(0, 5)
      : [];
    const baseTerms = projectedTerms.length > 0
      ? projectedTerms
      : specificTerms.length > 0
        ? specificTerms
        : [domain.name];

    const intentSuffixes = [
      'user complaint problem',
      'not working difficult confusing',
      'review missing feature',
    ];

    return baseTerms
      .slice(0, 4)
      .flatMap((term, index) => [
        `${term} ${intentSuffixes[index % intentSuffixes.length]}`,
      ]);
  }

  /**
   * Prioritizes domain-specific problem spaces over generated generic phrases
   * such as "media platform", "media software", and "media dashboard".
   */
  private selectSpecificDomainTerms(
    domain: SelectedGenerationDomain,
    limit: number,
  ): string[] {
    const domainTokens = new Set(
      this.normalizeTerm(domain.name)
        .split(/[^\p{L}\p{N}]+/gu)
        .filter((token) => token.length >= 3),
    );
    const genericTail =
      /\b(?:platform|system|application|app|software|dashboard|analytics|monitoring|automation|management|optimization|prediction|recommendation|integration|smart)\b/iu;

    return domain.keywords
      .map((value) => value.trim())
      .filter(Boolean)
      .filter((value) => {
        const normalized = this.normalizeTerm(value);
        const tokens = normalized
          .split(/[^\p{L}\p{N}]+/gu)
          .filter(Boolean);
        const nonDomainTokens = tokens.filter(
          (token) => !domainTokens.has(token),
        );

        return (
          tokens.length >= 2 &&
          nonDomainTokens.length >= 1 &&
          !genericTail.test(normalized)
        );
      })
      .sort((left, right) => {
        const score = (value: string): number => {
          const normalized = this.normalizeTerm(value);
          const tokens = normalized.split(/\s+/u).filter(Boolean);
          const phraseBonus = Math.min(tokens.length, 4) * 5;
          const specificSignal =
            /\b(?:content creation|video streaming|music streaming|podcasting|digital publishing|social media|content moderation|audience analytics|creator economy|gaming|live streaming|interactive media|public service|municipal|urban mobility|traffic|waste|energy|citizen service|administrative operations|office administration|approval workflow|document workflow|back office operations|business operations|invoice|expense|reconciliation|payroll|procurement)\b/iu.test(
              normalized,
            )
              ? 25
              : 0;
          return phraseBonus + specificSignal - normalized.length / 100;
        };

        return score(right) - score(left);
      })
      .slice(0, limit);
  }


  /**
   * Generic domain dictionaries are useful when no description exists, but in
   * Text + Domains they can pull collection toward an unrelated sub-workflow
   * (for example Logistics -> shipment/fleet for a hospital OR request). Keep
   * the explicit domain anchor itself, then admit configured/domain keywords
   * only when they share a meaningful lexical identity with the requester
   * problem. Request-derived intent keywords are handled separately and are
   * always preferred for explicit domains.
   */
  private isDomainKeywordRequestCompatible(
    context: IdeaGenerationContext,
    keyword: string,
  ): boolean {
    const request = context.requestDescription?.trim();
    if (!request) return true;

    const stop = new Set([
      'and', 'the', 'for', 'with', 'from', 'into', 'system', 'systems',
      'platform', 'platforms', 'application', 'applications', 'software',
      'dashboard', 'management', 'monitoring', 'analytics', 'automation',
      'optimization', 'operations', 'operational', 'service', 'services',
      'business', 'businesses', 'solution', 'solutions', 'smart', 'digital',
      'data', 'information', 'tracking', 'track', 'using', 'use',
    ]);
    const normalizeToken = (token: string): string => {
      let value = token.toLocaleLowerCase();
      if (value.length > 5 && value.endsWith('ies')) value = `${value.slice(0, -3)}y`;
      else if (value.length > 5 && value.endsWith('es')) value = value.slice(0, -2);
      else if (value.length > 4 && value.endsWith('s')) value = value.slice(0, -1);
      return value;
    };
    const tokens = (value: string): Set<string> =>
      new Set(
        this.normalizeTerm(value)
          .split(/[^\p{L}\p{N}]+/gu)
          .map(normalizeToken)
          .filter((token) => token.length >= 3 && !stop.has(token)),
      );

    const requestTokens = tokens(request);
    const keywordTokens = [...tokens(keyword)];
    if (keywordTokens.length === 0) return false;
    return keywordTokens.some((token) => requestTokens.has(token));
  }

  private validateContext(context: IdeaGenerationContext): void {
    if (!context.policy) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.INVALID_REQUEST,
        message:
          'Generation entitlement must be resolved before collection-job resolution.',
      });
    }
    if (!context.domainName) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.DOMAIN_NOT_FOUND,
        message:
          'Generation domain must be resolved before collection-job resolution.',
      });
    }
    if (context.selectedDataSources.length === 0) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.NO_DATA_SOURCES_AVAILABLE,
        message:
          'At least one active data source must be selected before resolving a collection job.',
      });
    }
  }

  private normalizeTerm(value: string): string {
    return value.toLowerCase().replace(/\s+/gu, ' ').trim();
  }


  /**
   * Converts the complete FAST_GENERATION in-memory collector ledger into the
   * raw Community-AI corpus. Inputs arrive before central relevance/persistence
   * pruning, so this method intentionally performs only normalization and exact
   * id deduplication. Semantic trust is decided later by Community AI plus the
   * structural/provenance post-AI admission guard.
   */
  private buildRawEvidenceCorpus(
    inputs: readonly {
      readonly id: string;
      readonly sourceType: 'POST' | 'COMMENT';
      readonly postId?: string;
      readonly title?: string | null;
      readonly content: string;
      readonly sourceKey?: string;
      readonly isComplaintEvidence?: boolean;
      readonly requiresAiSemanticTriage?: boolean;
      readonly discoveryDomainId?: string | null;
      readonly discoveryDomainName?: string | null;
      readonly discoveryDomainIds?: readonly string[];
      readonly discoveryDomainNames?: readonly string[];
      readonly queryIntentId?: string | null;
      readonly queryText?: string | null;
      readonly problemFacetIds?: readonly string[];
      readonly collectionPhase?: 'INITIAL' | 'RECOVERY';
      readonly sourceTier?: 'PRIMARY' | 'SECONDARY' | 'MICRO_PROBE';
    }[],
  ): IdeaGenerationContext['rawEvidenceCorpus'] {
    const normalized = inputs
      .map((input) => {
        const title = input.title?.replace(/\s+/gu, ' ').trim() ?? '';
        const content = input.content.replace(/\s+/gu, ' ').trim();
        const text =
          input.sourceType === 'COMMENT' && title
            ? `${title}. Community comment: ${content}`
            : [title, content].filter(Boolean).join(' ');

        return {
          id: input.id,
          sourceKey:
            input.sourceKey?.trim().toLocaleLowerCase() ||
            input.id.split(':')[0]?.trim().toLocaleLowerCase() ||
            'unknown',
          sourceType: input.sourceType,
          ...(input.postId ? { postId: input.postId } : {}),
          title: title || null,
          // Evidence is a semantic unit, not a single sentence. Preserve enough
          // surrounding context for cross-sentence actor/workflow/pain evidence.
          text: this.boundRawEvidenceText(text, 3_600),
          isComplaintEvidence: input.isComplaintEvidence === true,
          requiresAiSemanticTriage: input.requiresAiSemanticTriage === true,
          discoveryDomainId: input.discoveryDomainId ?? null,
          discoveryDomainName: input.discoveryDomainName ?? null,
          discoveryDomainIds: input.discoveryDomainIds ?? [],
          discoveryDomainNames: input.discoveryDomainNames ?? [],
          queryIntentId: input.queryIntentId ?? null,
          queryText: input.queryText ?? null,
          problemFacetIds: input.problemFacetIds ?? [],
          collectionPhase: input.collectionPhase ?? 'INITIAL',
          sourceTier: input.sourceTier ?? 'MICRO_PROBE',
        };
      })
      .filter((item) => item.text.length >= 12);

    const seen = new Set<string>();
    const deduplicated = normalized.filter((item) => {
      const identity = `${item.sourceKey}|${item.sourceType}|${item.id}`;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });

    /*
     * Keep a bounded but source-diverse raw corpus in the generation context.
     * Direct complaint/triage candidates are prioritized, then the remaining
     * collector records are round-robin sampled by source. This prevents a
     * single high-volume source from crowding out all other evidence while
     * still letting Community AI see far more than deterministic NLP retained.
     */
    const priority = deduplicated.filter(
      (item) => item.isComplaintEvidence || item.requiresAiSemanticTriage,
    );
    const remaining = deduplicated.filter(
      (item) => !item.isComplaintEvidence && !item.requiresAiSemanticTriage,
    );
    const bySource = new Map<string, typeof remaining>();
    for (const item of remaining) {
      const bucket = bySource.get(item.sourceKey) ?? [];
      bucket.push(item);
      bySource.set(item.sourceKey, bucket);
    }

    const output = [...priority];
    let index = 0;
    while (output.length < deduplicated.length) {
      let added = false;
      for (const bucket of bySource.values()) {
        const item = bucket[index];
        if (!item) continue;
        output.push(item);
        added = true;
      }
      if (!added) break;
      index += 1;
    }

    /*
     * Persistence is already bounded by the collector limits. Do not apply a
     * second generation-layer cap here: every persisted, deduplicated raw
     * record must remain available to the semantic triage stage.
     */
    return output;
  }

  private boundRawEvidenceText(value: string, maxLength: number): string {
    const normalized = value.replace(/\s+/gu, ' ').trim();
    if (normalized.length <= maxLength) return normalized;
    const window = normalized.slice(0, maxLength);
    const floor = Math.floor(maxLength * 0.68);
    const boundaries = [...window.matchAll(/[.!?](?:\s|$)/gu)]
      .map((match) => (match.index ?? 0) + 1)
      .filter((index) => index >= floor);
    const boundary = boundaries.at(-1);
    return (boundary ? window.slice(0, boundary) : window).trim();
  }

  private buildFastEvidenceForDomain(
    inputs: readonly {
      readonly id: string;
      readonly sourceType: 'POST' | 'COMMENT';
      readonly postId?: string;
      readonly title?: string | null;
      readonly content: string;
      readonly isComplaintEvidence?: boolean;
    }[],
    domain: SelectedGenerationDomain,
    domains: readonly SelectedGenerationDomain[],
    compositeEvidenceTexts: ReadonlySet<string> = new Set<string>(),
  ): {
    readonly posts: unknown[];
    readonly comments: unknown[];
  } {
    const candidates = inputs
      .map((input) => {
        const title = input.title?.replace(/\s+/gu, ' ').trim() ?? '';
        const content = input.content.replace(/\s+/gu, ' ').trim();
        const text =
          input.sourceType === 'COMMENT' && title
            ? `${title}. Community comment: ${content}`
            : [title, content].filter(Boolean).join(' ');

        return { input, text };
      })
      .filter(({ input, text }) => {
        if (!text) return false;
        if (!this.evidenceBelongsToDomain(text, domain, domains)) {
          return false;
        }

        return (
          input.isComplaintEvidence === true ||
          this.isRepresentativeProblemEvidence(text) ||
          compositeEvidenceTexts.has(this.normalizeEvidenceIdentity(text))
        );
      });

    const posts = candidates
      .filter(({ input }) => input.sourceType === 'POST')
      .slice(0, 10)
      .map(({ input, text }) => ({
        id: input.id,
        text,
        sentiment: 'NEUTRAL',
        evidenceRole:
          input.isComplaintEvidence === true ||
          this.isRepresentativeProblemEvidence(text)
            ? 'DIRECT_OR_REPRESENTATIVE'
            : 'SUPPORTING_SIGNAL',
      }));
    const comments = candidates
      .filter(({ input }) => input.sourceType === 'COMMENT')
      .slice(0, 14)
      .map(({ input, text }) => ({
        id: input.id,
        postId: input.postId ?? input.id,
        text,
        sentiment: 'NEUTRAL',
        evidenceRole:
          input.isComplaintEvidence === true ||
          this.isRepresentativeProblemEvidence(text)
            ? 'DIRECT_OR_REPRESENTATIVE'
            : 'SUPPORTING_SIGNAL',
      }));

    return { posts, comments };
  }

  /**
   * Keeps a small request-aligned supporting corpus for Community AI when no
   * single collector item states the whole problem. The set is admitted only
   * when the retained texts collectively satisfy the same strict requester
   * workflow contract. This is deliberately computed before per-domain
   * projection so complementary evidence from two explicitly selected domains
   * can support one cross-domain requester problem without either quote being
   * promoted to direct evidence on its own.
   */
  private buildCompositeFastEvidenceTextSet(
    inputs: readonly {
      readonly id: string;
      readonly sourceType: 'POST' | 'COMMENT';
      readonly postId?: string;
      readonly title?: string | null;
      readonly content: string;
      readonly isComplaintEvidence?: boolean;
    }[],
    context: IdeaGenerationContext,
    domains: readonly SelectedGenerationDomain[],
  ): ReadonlySet<string> {
    const requestDescription = context.requestDescription?.trim() ?? '';
    if (!requestDescription || inputs.length < 2) {
      return new Set<string>();
    }

    const candidateTexts = inputs
      .map((input) => {
        const title = input.title?.replace(/\s+/gu, ' ').trim() ?? '';
        const content = input.content.replace(/\s+/gu, ' ').trim();
        return input.sourceType === 'COMMENT' && title
          ? `${title}. Community comment: ${content}`
          : [title, content].filter(Boolean).join(' ');
      })
      .filter((text) => text.length >= 24)
      .filter((text) =>
        domains.some((domain) =>
          this.evidenceBelongsToDomain(text, domain, domains),
        ),
      );

    const selected = RequestEvidenceAlignmentUtil.selectCompositeAlignedEvidence({
      requestDescription,
      evidenceTexts: candidateTexts,
      plannedQueries: context.collectionPlan?.searchQueries ?? [],
      maxSamples: 8,
    });

    return new Set(selected.map((text) => this.normalizeEvidenceIdentity(text)));
  }

  private normalizeEvidenceIdentity(value: string): string {
    return value.toLocaleLowerCase().replace(/\s+/gu, ' ').trim();
  }

  /**
   * Promotes direct evidence samples already retained by deterministic NLP into
   * the primary-domain evidence registry. Community AI and deterministic NLP
   * can retain a complaint even when the bounded representative sampler omits
   * it; ranking must still receive the exact quote so provenance verification
   * can resolve it against the persisted collection rows.
   */
  private buildCanonicalDirectNlpEvidence(
    nlp: ResolveCollectionJobResult['nlpOutput'],
    fastEvidenceInputs: readonly {
      readonly id: string;
      readonly sourceType: 'POST' | 'COMMENT';
      readonly postId?: string;
      readonly content: string;
    }[],
  ): Array<{
    readonly id: string;
    readonly postId: string;
    readonly text: string;
    readonly sentiment: string;
  }> {
    const containers: unknown[] = [
      nlp.recurringProblems,
      nlp.extractedNeeds,
      nlp.featureRequests,
      nlp.opportunities,
    ];
    const seen = new Set<string>();
    const output: Array<{
      readonly id: string;
      readonly postId: string;
      readonly text: string;
      readonly sentiment: string;
    }> = [];

    const normalizeBody = (value: string): string =>
      value
        .replace(/\s+/gu, ' ')
        .replace(/^.*?\bCommunity comment:\s*/isu, '')
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();

    const originalComments = fastEvidenceInputs.filter(
      (input) =>
        input.sourceType === 'COMMENT' &&
        Boolean(input.postId) &&
        !input.id.startsWith('nlp:'),
    );

    const findOriginal = (sample: string) => {
      const normalizedSample = normalizeBody(sample);
      if (normalizedSample.length < 8) return null;

      return (
        originalComments.find((input) => {
          const normalizedInput = normalizeBody(input.content);
          return (
            normalizedInput === normalizedSample ||
            (normalizedSample.length >= 24 &&
              (normalizedInput.includes(normalizedSample) ||
                normalizedSample.includes(normalizedInput)))
          );
        }) ?? null
      );
    };

    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (!value || typeof value !== 'object') return;
      const record = value as Record<string, unknown>;
      const samples = Array.isArray(record.evidenceSamples)
        ? record.evidenceSamples
        : [];

      for (const sample of samples) {
        if (output.length >= 12) return;
        if (typeof sample !== 'string') continue;
        const text = sample.replace(/\s+/gu, ' ').trim();
        if (text.length < 20) continue;
        const body = text.replace(/^.*?\bCommunity comment:\s*/isu, '').trim();
        const kind = classifyDirectCommunityEvidence(body, 'COMMENT');
        if (
          kind !== 'USER_COMPLAINT' &&
          kind !== 'FEATURE_REQUEST' &&
          kind !== 'OBSERVED_UNMET_NEED'
        ) continue;

        const original = findOriginal(text);
        /*
         * Never invent nlp:direct identifiers. If an NLP quote cannot be
         * mapped back to the original collector comment, it remains available
         * in NLP/Community-AI context but is not promoted as canonical
         * provenance evidence. The verifier may still resolve it from DB text.
         */
        if (!original?.postId) continue;

        const key = `${original.id}:${original.postId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        output.push({
          id: original.id,
          postId: original.postId,
          text,
          sentiment: 'NEUTRAL',
        });
      }
    };

    containers.forEach(visit);
    return output;
  }

  /**
   * Deduplicates representative evidence by real provenance whenever possible.
   *
   * NLP may surface a short sentence fragment while the fast collector corpus
   * still contains the complete original review/comment under the same
   * external id. Text-only deduplication treated those as two different pieces
   * of evidence and could bias Community AI toward the shorter fragment.
   *
   * When two values share the same provenance id, retain the richer text while
   * preserving the first-seen position. Values without provenance still fall
   * back to normalized-text deduplication.
   */
  private mergeRepresentativeEvidence(
    preferred: readonly unknown[],
    fallback: readonly unknown[],
    limit: number,
  ): unknown[] {
    const orderedKeys: string[] = [];
    const bestByKey = new Map<
      string,
      { readonly value: unknown; readonly richness: number }
    >();

    for (const value of [...preferred, ...fallback]) {
      const text = this.extractEvidenceText(value)
        .replace(/\s+/gu, ' ')
        .trim();
      if (!text) continue;

      const provenanceKey = this.extractEvidenceProvenanceKey(value);
      const key = provenanceKey ?? `text:${this.normalizeTerm(text).slice(0, 500)}`;
      const richness = this.scoreEvidenceRichness(text);
      const existing = bestByKey.get(key);

      if (!existing) {
        orderedKeys.push(key);
        bestByKey.set(key, { value, richness });
        continue;
      }

      if (richness > existing.richness) {
        bestByKey.set(key, { value, richness });
      }
    }

    return orderedKeys
      .slice(0, limit)
      .map((key) => bestByKey.get(key)?.value)
      .filter((value): value is unknown => value !== undefined);
  }

  /** Returns a stable real-source key for a representative evidence object. */
  private extractEvidenceProvenanceKey(value: unknown): string | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const record = value as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const postId =
      typeof record.postId === 'string' ? record.postId.trim() : '';

    const normalizeExternalId = (raw: string): string =>
      raw
        .toLowerCase()
        .replace(/^[a-z0-9-]+:(?:post|comment):/u, '')
        .replace(/^(?:post|comment):/u, '')
        .trim();

    if (id && !id.startsWith('nlp:')) {
      const normalizedId = normalizeExternalId(id);
      const normalizedPostId = postId ? normalizeExternalId(postId) : '';
      const looksLikeComment =
        /:comment:/iu.test(id) ||
        (normalizedPostId.length > 0 && normalizedPostId !== normalizedId);
      return `${looksLikeComment ? 'comment' : 'post'}:${normalizedId}`;
    }

    if (postId && !postId.startsWith('nlp:')) {
      return `post:${normalizeExternalId(postId)}`;
    }

    return null;
  }

  /** Prefers complete complaint/request context over extracted sentence fragments. */
  private scoreEvidenceRichness(text: string): number {
    const normalized = text.replace(/\s+/gu, ' ').trim();
    const directBody = normalized
      .replace(/^.*?\bCommunity comment:\s*/isu, '')
      .trim();
    const contextBonus = /\bCommunity comment:\s*/iu.test(normalized) ? 120 : 0;
    const directKind = classifyDirectCommunityEvidence(directBody, 'COMMENT');
    const problemBonus =
      directKind === 'USER_COMPLAINT' ||
      directKind === 'FEATURE_REQUEST' ||
      directKind === 'OBSERVED_UNMET_NEED'
        ? 80
        : 0;
    const detailBonus = Math.min(120, directBody.split(/\s+/u).length * 3);

    return normalized.length + contextBonus + problemBonus + detailBonus;
  }

  /**
   * Builds representative domain evidence directly from the authoritative
   * analyzed-text records returned by the in-memory NLP pipeline.
   *
   * The unified collection job uses merged keywords from all selected domains.
   * A text is assigned to a domain when it matches either two strong domain
   * terms or one non-generic specific domain anchor. This keeps attribution
   * honest while allowing secondary domains with sparse DB keywords to retain
   * evidence found by their own search anchors.
   */
  private buildAnalyzedEvidenceForDomain(
    analyzedTexts: readonly {
      readonly id: string;
      readonly sourceType: 'POST' | 'COMMENT';
      readonly postId?: string;
      readonly originalText: string;
      readonly cleanedText: string;
      readonly sentiment: string;
    }[],
    domain: SelectedGenerationDomain,
    domains: readonly SelectedGenerationDomain[],
  ): {
    readonly posts: Array<{
      readonly id: string;
      readonly text: string;
      readonly sentiment: string;
    }>;
    readonly comments: Array<{
      readonly id: string;
      readonly postId: string;
      readonly text: string;
      readonly sentiment: string;
    }>;
  } {
    const resolved = analyzedTexts.filter((item) =>
      this.evidenceBelongsToDomain(
        `${item.originalText} ${item.cleanedText}`,
        domain,
        domains,
      ),
    );

    const representative = resolved.filter((item) =>
      this.isRepresentativeProblemEvidence(
        `${item.originalText} ${item.cleanedText}`,
      ),
    );

    const posts = representative
      .filter((item) => item.sourceType === 'POST')
      .slice(0, 6)
      .map((item) => ({
        id: item.id,
        text: item.originalText || item.cleanedText,
        sentiment: item.sentiment,
      }));

    const comments = representative
      .filter((item) => item.sourceType === 'COMMENT')
      .slice(0, 8)
      .map((item) => ({
        id: item.id,
        postId: item.postId ?? item.id,
        text: item.originalText || item.cleanedText,
        sentiment: item.sentiment,
      }));

    return { posts, comments };
  }

  /**
   * Uses the same strong-term policy as representative evidence filtering.
   */
  /**
   * Keeps representative samples limited to concrete complaints, failures,
   * limitations, requests, or unmet needs. Generic explainers and promotions
   * may remain in NLP totals but are not shown as problem evidence.
   */
  private isRepresentativeProblemEvidence(value: string): boolean {
    const fullText = value.replace(/\s+/gu, ' ').trim();
    if (fullText.length < 35) {
      return false;
    }

    const commentMarker = /\bCommunity comment:\s*/iu;
    const match = fullText.match(commentMarker);
    const evidenceText = match
      ? fullText.slice((match.index ?? 0) + match[0].length).trim()
      : fullText;

    const kind = classifyDirectCommunityEvidence(
      evidenceText,
      match ? 'COMMENT' : 'POST',
    );
    return kind === 'USER_COMPLAINT' ||
      kind === 'FEATURE_REQUEST' ||
      kind === 'OBSERVED_UNMET_NEED';
  }

  /**
   * One-specific-term fallback used when the strict two-term matcher produced
   * no evidence for a selected domain. Generic cross-domain words are excluded
   * so secondary domains gain recall without inheriting unrelated comments.
   */
  private evidenceBelongsToDomain(
    value: string,
    domain: SelectedGenerationDomain,
    domains: readonly SelectedGenerationDomain[],
  ): boolean {
    const scores = domains.map((candidate) => ({
      domain: candidate,
      score: this.calculateEvidenceDomainScore(value, candidate),
    }));
    const targetScore =
      scores.find((item) => item.domain.id === domain.id)?.score ?? 0;
    const bestScore = Math.max(0, ...scores.map((item) => item.score));

    return (
      targetScore >= 0.28 &&
      targetScore >= bestScore - 0.12
    );
  }

  private calculateEvidenceDomainScore(
    value: string,
    domain: SelectedGenerationDomain,
  ): number {
    const marker = value.match(/\bCommunity comment:\s*/iu);
    const body = marker && marker.index !== undefined
      ? value.slice(marker.index + marker[0].length)
      : value;
    const context = marker && marker.index !== undefined
      ? value.slice(0, marker.index)
      : '';
    const bodyScore = this.calculateTextDomainSemanticScore(body, domain);
    const contextScore = this.calculateTextDomainSemanticScore(context, domain);

    if (bodyScore >= 0.28) {
      return Math.min(1, bodyScore + contextScore * 0.08);
    }

    return Math.min(1, Math.max(bodyScore, contextScore * 0.55));
  }

  private calculateTextDomainSemanticScore(
    value: string,
    domain: SelectedGenerationDomain,
  ): number {
    const text = this.normalizeTerm(value)
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
    if (!text) return 0;

    const domainName = this.normalizeTerm(domain.name)
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();

    if (
      domain.isExplicitlySelected === false &&
      !this.hasInferredDomainIdentityAnchor(text, domain)
    ) {
      return 0;
    }

    if (/^(?:environment|environmental)$/u.test(domainName)) {
      const environmentalAnchor = /\b(?:environmental monitoring|environmental compliance|pollution|air quality|water quality|waste management|recycling|emissions?|carbon footprint|sustainability|ecosystem|conservation|biodiversity|environmental impact|climate risk|climate adaptation)\b/iu.test(
        text,
      );
      if (!environmentalAnchor) {
        return 0;
      }
    }

    if (/^manufacturing$/u.test(domainName)) {
      const strongIndustrialAnchors = [
        'factory',
        'assembly line',
        'machinery',
        'production line',
        'plant floor',
        'shop floor',
        'predictive maintenance',
        'machine maintenance',
        'manufacturing supply chain',
        'warehouse operations',
        'machine downtime',
        'industrial equipment',
        'factory automation',
        'throughput',
      ];
      const supportingIndustrialAnchors = [
        'assembly',
        'equipment',
        'production planning',
        'quality control',
        'supply chain',
        'maintenance',
        'industrial',
        'production scheduling',
      ];
      const strongMatches = strongIndustrialAnchors.filter((anchor) =>
        this.containsSemanticTerm(text, anchor),
      ).length;
      const supportingMatches = supportingIndustrialAnchors.filter((anchor) =>
        this.containsSemanticTerm(text, anchor),
      ).length;
      const nonIndustrialManufacturingUse =
        /\b(?:manufactur(?:e|ed|ing)|fabricat(?:e|ed|ing))\s+(?:evidence|claim|story|result|report|proof|test|red)\b/iu.test(
          text,
        );

      if (
        strongMatches === 0 &&
        (supportingMatches < 2 || nonIndustrialManufacturingUse)
      ) {
        return 0;
      }
    }

    if (domainName.length >= 3 && this.containsSemanticTerm(text, domainName)) {
      return 1;
    }

    const terms = this.buildDomainSemanticTerms(domain);
    const matched = terms.filter((term) =>
      this.containsSemanticTerm(text, term),
    );

    if (matched.length >= 3) return 0.92;
    if (matched.length === 2) return 0.78;
    if (matched.length === 1) {
      const term = matched[0];
      return term.includes(' ') ? 0.68 : 0.5;
    }

    return 0;
  }

  private hasInferredDomainIdentityAnchor(
    text: string,
    domain: SelectedGenerationDomain,
  ): boolean {
    const broad = new Set([
      'business', 'client', 'company', 'condition', 'cost', 'customer',
      'data', 'digital', 'equipment', 'expense', 'history', 'maintenance',
      'management', 'operation', 'operations', 'platform', 'record',
      'records', 'repair', 'repairs', 'restoration', 'service', 'services',
      'software', 'system', 'tracking', 'workflow', 'workflows',
    ]);
    const tokenize = (value: string): string[] =>
      this.normalizeTerm(value)
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .split(/\s+/gu)
        .filter((token) => token.length >= 4 && !broad.has(token));

    const nameTokens = [...new Set(tokenize(domain.name))];
    if (nameTokens.some((token) => this.containsSemanticTerm(text, token))) {
      return true;
    }

    const phrases = [
      ...(domain.effectiveSearchKeywords ?? []),
      ...(domain.configuredKeywords ?? []),
      ...(domain.keywords ?? []),
    ];
    return phrases.some((phrase) => {
      const normalizedPhrase = this.normalizeTerm(phrase)
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
      const distinctive = tokenize(normalizedPhrase);
      if (distinctive.length < 1) return false;
      if (normalizedPhrase.split(/\s+/gu).length >= 2 && this.containsSemanticTerm(text, normalizedPhrase)) {
        return true;
      }
      const overlap = distinctive.filter((token) =>
        this.containsSemanticTerm(text, token),
      ).length;
      return distinctive.length >= 2 && overlap >= 2;
    });
  }

  private buildDomainSemanticTerms(
    domain: SelectedGenerationDomain,
  ): string[] {
    const normalizedName = this.normalizeTerm(domain.name)
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
    const aliases: string[] = [];

    if (/^(?:finance|financial services|fintech)$/u.test(normalizedName)) {
      aliases.push(
        'finance',
        'financial',
        'bank',
        'banking',
        'payment',
        'payments',
        'card',
        'credit',
        'debit',
        'loan',
        'cash',
        'accounting',
        'invoice',
        'expense',
        'budget',
        'payroll',
        'reconciliation',
      );
    }

    if (/^(?:e commerce|ecommerce|online retail|retail)$/u.test(normalizedName)) {
      aliases.push(
        'e commerce',
        'ecommerce',
        'marketplace',
        'buyer',
        'seller',
        'checkout',
        'shopping cart',
        'cart',
        'order',
        'orders',
        'refund',
        'storefront',
        'paypal',
      );
    }

    if (/^(?:artificial intelligence|ai|machine learning)$/u.test(normalizedName)) {
      aliases.push(
        'artificial intelligence',
        'machine learning',
        'generative ai',
        'large language model',
        'llm',
        'ai model',
        'prompt',
        'chatbot',
        'computer vision',
        'natural language processing',
      );
    }

    if (/^(?:environment|environmental)$/u.test(normalizedName)) {
      aliases.push(
        'environmental monitoring',
        'environmental compliance',
        'pollution monitoring',
        'air quality',
        'water quality',
        'waste management',
        'recycling',
        'emissions',
        'carbon footprint',
        'sustainability',
        'ecosystem monitoring',
        'conservation',
        'biodiversity',
        'environmental impact',
      );
    }

    const generic = new Set([
      'platform',
      'system',
      'application',
      'software',
      'dashboard',
      'monitoring',
      'management',
      'analytics',
      'integration',
      'automation',
      'optimization',
      'smart',
      'digital',
      'online',
    ]);

    return [...new Set([domain.name, ...domain.keywords, ...aliases])]
      .map((term) =>
        this.normalizeTerm(term)
          .replace(/[^\p{L}\p{N}]+/gu, ' ')
          .replace(/\s+/gu, ' ')
          .trim(),
      )
      .filter((term) => term.length >= 3 && !generic.has(term));
  }

  private resolveCollectionDomainAnchor(
    domain: SelectedGenerationDomain,
  ): string {
    return this.normalizeTerm(domain.name) === 'environment'
      ? 'environmental monitoring'
      : domain.name;
  }

  private containsSemanticTerm(text: string, term: string): boolean {
    if (!term) return false;
    if (term.includes(' ')) return text.includes(term);
    return new RegExp(`(?:^|\\s)${this.escapeRegExp(term)}(?:$|\\s)`, 'u').test(text);
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private filterEvidenceForDomain(
    values: unknown,
    domain: SelectedGenerationDomain,
    domains: readonly SelectedGenerationDomain[],
  ): unknown[] {
    if (!Array.isArray(values)) return [];

    return values.filter((value) => {
      const text = this.extractEvidenceText(value);
      if (!text) return false;
      return this.evidenceBelongsToDomain(text, domain, domains);
    });
  }

  private extractEvidenceText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return '';

    const record = value as Record<string, unknown>;
    return [record.text, record.title, record.content]
      .filter((item): item is string => typeof item === 'string')
      .join(' ');
  }

  private toJsonValue(value: unknown): Prisma.JsonValue | null {
    if (value === undefined) return null;
    try {
      return JSON.parse(JSON.stringify(value)) as Prisma.JsonValue;
    } catch {
      return null;
    }
  }

  private resolveDefinition(): IdeaGenerationStageDefinition {
    const definition = findIdeaGenerationStageDefinition(this.key);
    if (!definition) {
      throw new Error(
        `Missing idea-generation stage definition for "${this.key}".`,
      );
    }
    return definition;
  }
}