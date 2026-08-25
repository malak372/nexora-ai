import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CollectionJobStatus, Prisma } from '@prisma/client';

import { IDEA_OWNER_TYPES } from '../../shared/constants/ideas.constants';
import { PrismaService } from '../../../prisma/prisma.service';
import { CollectorSourceHealthService } from '../../../data-collection/collector-source-health.service';
import {
  classifyDirectCommunityEvidence,
  isLikelyPromotionalEvidence,
  scoreCommunityEvidenceQuality,
} from '../../../nlp/common/utils/community-evidence.util';
import {
  filterEvidenceByProblemFamily,
  resolvePrimaryProblemFamily,
} from '../../../nlp/common/utils/problem-family-matching.util';
import { CollectorQueryBuilderUtil } from '../../../collectors/base/collector-query-builder.util';
import { CollectorsFactory } from '../../../collectors/collectors.factory';
import { RequestEvidenceAlignmentUtil } from '../utils/request-evidence-alignment.util';
import { SelectedDomainEvidenceAlignmentUtil } from '../utils/selected-domain-evidence-alignment.util';
import { RequestWorkflowArchetypeUtil } from '../utils/request-workflow-archetype.util';
import { RequestDynamicQueryUtil } from '../utils/request-dynamic-query.util';
import { RequestWorkflowIntentProfileUtil } from '../utils/request-workflow-intent-profile.util';
import { RequestQueryProvenanceUtil } from '../utils/request-query-provenance.util';
import { RequestNicheCustomCraftUtil } from '../utils/request-niche-custom-craft.util';
import { CanonicalRequestUnderstandingUtil } from '../utils/canonical-request-understanding.util';
import { SourceSpecificEvidenceQueryUtil } from '../utils/source-specific-evidence-query.util';
import { RequestOnlinePharmacyFraudUtil } from '../utils/request-online-pharmacy-fraud.util';
import { CollectionJobResolverService } from './collection-job-resolver.service';
import { CommunityAiAnalysisService } from './community-ai-analysis.service';
import { RequestCollectionPlanningService } from './request-collection-planning.service';
import type {
  IdeaGenerationContext,
  IdeaGenerationNlpContext,
  IdeaGenerationRawEvidenceItem,
  SelectedGenerationDomain,
  SelectedIdeaDataSource,
} from '../types/idea-generation-context.type';
import type { RankedIdeaOpportunity } from '../types/idea-opportunity-ranking.type';
import type {
  CommunityAiAnalysis,
  CommunityAiOpportunity,
} from '../types/community-ai-analysis.type';

/** Supported targeted evidence families used only during recovery collection. */
export type EvidenceRecoveryFamily =
  | 'PAYWALL_ON_BASIC_CONFIGURATION'
  | 'RIGID_SUBJECT_TAXONOMY'
  | 'MOBILE_WEB_FEATURE_GAP'
  | 'IDLE_SESSION_AUTH_FAILURE'
  | 'STORAGE_AND_SYNC_FAILURE'
  | 'GENERIC_USER_FRICTION';

export type EvidenceRecoveryOutcome =
  | 'NEW_INDEPENDENT_EVIDENCE_FOUND'
  | 'RECOVERY_RETURNED_ONLY_EXISTING_EVIDENCE'
  | 'RECOVERY_RETURNED_NO_USABLE_EVIDENCE';

export type RecoveredExternalEvidence = {
  readonly text: string;
  readonly sourceKey: string;
  readonly postExternalId: string;
  readonly commentExternalId: string | null;
  readonly sourceType: 'POST' | 'COMMENT';
  readonly discoveryDomainId?: string | null;
  readonly discoveryDomainName?: string | null;
  readonly queryIntentId?: string | null;
  readonly queryText?: string | null;
  readonly problemFacetIds?: readonly string[];
  readonly collectionPhase?: 'INITIAL' | 'RECOVERY';
  readonly sourceTier?: 'PRIMARY' | 'SECONDARY' | 'MICRO_PROBE';
};

/** Result of one bounded targeted evidence-recovery attempt. */
export type IdeaEvidenceRecoveryResult = {
  readonly collectionJobId: string;
  readonly selectedDataSourceKeys: readonly string[];
  readonly recoveryKeywords: readonly string[];
  readonly evidenceFamilies: readonly EvidenceRecoveryFamily[];
  readonly totalPosts: number;
  readonly totalComments: number;
  readonly usefulCleanTextCount: number;
  readonly complaintEvidenceCount: number;
  /** Number of evidence samples that are new to the complete recovery corpus. */
  readonly newCorpusEvidenceSampleCount: number;
  /**
   * Backward-compatible alias for newCorpusEvidenceSampleCount.
   * New ranking diagnostics should prefer the explicit corpus-level field.
   */
  readonly newEvidenceSampleCount: number;
  readonly novelEvidenceSamples: readonly string[];
  /** Request-aligned external texts retained from recovery. */
  readonly supportingExternalSamples: readonly string[];
  /** Same supporting evidence with canonical persisted provenance. */
  readonly supportingExternalEvidence: readonly RecoveredExternalEvidence[];
  /** Raw records classified during this recovery wave for canonical audit/merge. */
  readonly rawEvidenceCorpus: readonly IdeaGenerationRawEvidenceItem[];
  readonly recoveryOutcome: EvidenceRecoveryOutcome;
  readonly communityAiRecoveryExecuted: boolean;
  readonly nlp: IdeaGenerationNlpContext;
  readonly communityAiAnalysis: CommunityAiAnalysis | null;
};

/**
 * Performs one targeted collection pass when the initial NLP opportunities do
 * not satisfy the strict selection gate.
 *
 * Recovery differs from the initial domain-level collection in three ways:
 * - It derives complaint-oriented queries from the selected opportunity.
 * - It selects sources according to the detected evidence family.
 * - It reports useful-text and complaint-evidence counts for diagnostics.
 *
 * The service never invokes core idea-generation AI and never weakens the strict
 * opportunity-selection thresholds. Novel recovered evidence is offered to
 * Community AI before the deterministic emergency fallback is considered.
 */

@Injectable()
export class IdeaEvidenceRecoveryService {
  private readonly logger = new Logger(IdeaEvidenceRecoveryService.name);

  private readonly reviewSourceOrder = [
    'forum',
    'news',
    'gdelt',
    'blog',
    'youtube',
    'crossref',
    'app-store',
    'google-play',
    'hacker-news',
  ] as const;

  private readonly technicalSourceOrder = [
    'stackoverflow',
    'github',
    'forum',
    'hacker-news',
    'youtube',
    'app-store',
    'google-play',
  ] as const;

  /**
   * Recovery is a rare infrastructure-rescue path. The broad AI-owned first
   * pass should do discovery; recovery stays intentionally tiny so a collector
   * outage cannot turn into a second full pipeline.
   */
  private readonly maximumRecoveryKeywords = 8;
  private readonly maximumRecoverySourcesPerWave = 2;

  constructor(
    private readonly configService: ConfigService,
    private readonly collectorsFactory: CollectorsFactory,
    private readonly collectionJobResolver: CollectionJobResolverService,
    private readonly prisma: PrismaService,
    private readonly communityAiAnalysisService: CommunityAiAnalysisService,
    private readonly requestCollectionPlanningService: RequestCollectionPlanningService,
    private readonly collectorSourceHealth: CollectorSourceHealthService,
  ) {}

  /**
   * Executes one fresh, opportunity-directed collection and NLP pass.
   *
   * @param context Current generation context.
   * @param selectedOpportunity Best currently ranked fallback opportunity.
   * @returns Supplemental evidence and collection diagnostics.
   */
  async recover(
    context: IdeaGenerationContext,
    selectedOpportunity: RankedIdeaOpportunity | null = null,
    additionalExcludedSourceKeys: readonly string[] = [],
  ): Promise<IdeaEvidenceRecoveryResult> {
    const evidenceFamilies = this.detectEvidenceFamilies(selectedOpportunity);
    const [lowYieldSourceKeys, recoveryCandidateSources] = await Promise.all([
      this.withSoftDeadline(
        this.resolveLowYieldSourceKeys(context),
        250,
        new Set<string>(),
      ),
      this.withSoftDeadline(
        this.resolveRecoveryCandidateSources(context.selectedDataSources),
        300,
        [...context.selectedDataSources],
      ),
    ]);
    const excludedSourceKeys = new Set<string>([
      ...lowYieldSourceKeys,
      ...additionalExcludedSourceKeys,
    ]);
    const selectedRecoverySources = this.selectRecoverySources(
      recoveryCandidateSources,
      evidenceFamilies,
      selectedOpportunity,
      excludedSourceKeys,
      context,
    );
    const compactDomainsOnlySecondaryRecovery =
      !context.requestDescription?.trim() &&
      context.domainResolution?.source === 'USER_SELECTED' &&
      context.selectedDomains.length > 1 &&
      context.evidenceRecoveryAttempts === 0 &&
      Boolean(selectedOpportunity) &&
      (selectedOpportunity?.verifiedSecondaryEvidenceCount ?? 0) > 0 &&
      (selectedOpportunity?.verifiedDirectUserEvidenceCount ?? 0) === 0 &&
      (selectedOpportunity?.verifiedTechnicalEvidenceCount ?? 0) === 0;
    const requestSpecificRecovery = Boolean(
      context.requestDescription?.trim(),
    );
    const qualifiedCommunityEvidenceCount =
      context.communityAiAnalysis?.evidenceClassifications?.filter(
        (item) =>
          item.classification === 'DIRECT_PROBLEM' ||
          item.classification === 'SUPPORTING_SIGNAL',
      ).length ?? 0;
    const needsExpandedRequestRecovery =
      requestSpecificRecovery && qualifiedCommunityEvidenceCount === 0;
    /*
     * Use the expensive provider-diverse recovery planner only on the first
     * request-scoped recovery wave. A second wave already has the original
     * planner vocabulary plus first-wave source outcomes, so deterministic
     * problem-family expansion is both faster and more diverse than spending
     * another 7s asking the same planner to reformulate the request.
     */
    const rawEvidenceCount = context.rawEvidenceCorpus?.length ?? 0;
    const rawEvidenceSourceCount = new Set(
      (context.rawEvidenceCorpus ?? []).map((item) => item.sourceKey),
    ).size;
    const nicheCraftRequest = Boolean(
      RequestNicheCustomCraftUtil.resolve(context.requestDescription),
    );
    const shouldUseAiRecoveryPlan =
      requestSpecificRecovery &&
      !nicheCraftRequest &&
      context.evidenceRecoveryAttempts === 0 &&
      qualifiedCommunityEvidenceCount === 0 &&
      (rawEvidenceCount < 4 || rawEvidenceSourceCount < 2);
    const aiRecoveryPlan = shouldUseAiRecoveryPlan
      ? await this.requestCollectionPlanningService.expandEvidenceSearch({
          description: context.requestDescription ?? '',
          keywords: context.keywords.slice(0, 16),
          previousQueries: context.collectionPlan?.searchQueries ?? [],
          evidenceTargets: context.collectionPlan?.evidenceTargets ?? [],
          generationType: context.generationType,
          language: context.location.language,
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

    const aiRecoverySourceKeys = new Set(
      aiRecoveryPlan?.aiUsed && !aiRecoveryPlan.fallbackUsed
        ? aiRecoveryPlan.selectedSourceKeys ?? []
        : [],
    );
    const aiSelectedRecoverySources = aiRecoverySourceKeys.size > 0
      ? recoveryCandidateSources.filter((source) => {
          const key = source.key.toLocaleLowerCase();
          if (!aiRecoverySourceKeys.has(key)) return false;
          if (excludedSourceKeys.has(key) || excludedSourceKeys.has(source.key)) return false;
          const sourcePlan = aiRecoveryPlan?.sourcePlans?.find(
            (plan) => plan.sourceKey.toLocaleLowerCase() === key,
          );
          return this.collectorsFactory.isCollectorRequestAvailable(key, {
            requestDescription: context.requestDescription,
            domainName: context.domainName,
            keywords: context.keywords,
            plannedQueries: sourcePlan?.queries ?? aiRecoveryPlan?.searchQueries ?? [],
            sourceHints: sourcePlan?.routingHints ?? [],
            collectionMode: 'TARGETED_RECOVERY',
          });
        })
      : [];
    const preferredRecoverySources = aiSelectedRecoverySources.length > 0
      ? aiSelectedRecoverySources
      : selectedRecoverySources;
    const recoverySources = (compactDomainsOnlySecondaryRecovery
      ? preferredRecoverySources.slice(0, 2)
      : requestSpecificRecovery
        /*
         * One request-scoped recovery wave may use at most two unused healthy runnable lanes
         * in parallel. This improves source diversity without adding serial
         * latency; the per-source collectors remain independently bounded.
         */
        ? preferredRecoverySources.slice(0, this.maximumRecoverySourcesPerWave)
        : preferredRecoverySources
    ).filter((source) =>
      this.collectorsFactory.isCollectorRuntimeAvailable(source.key),
    );
    const primaryQueryKeys = new Set(
      (context.collectionPlan?.searchQueries ?? []).map((query) =>
        query.replace(/\s+/gu, ' ').trim().toLocaleLowerCase(),
      ),
    );
    const aiRecoveryKeywords = (aiRecoveryPlan?.searchQueries ?? [])
      .map((query) => this.sanitizeRecoveryQuery(query))
      .filter(Boolean)
      .filter(
        (query) => !primaryQueryKeys.has(query.toLocaleLowerCase()),
      )
      .filter((query) => this.isSemanticallyUsefulRecoveryQuery(query, context))
      .slice(0, this.maximumRecoveryKeywords);
    const recoveryKeywords = (
      aiRecoveryKeywords.length >= 4
        ? aiRecoveryKeywords
        : this.buildRecoveryKeywords(
            context,
            selectedOpportunity,
            evidenceFamilies,
          )
    )
      .map((query) => this.sanitizeRecoveryQuery(query))
      .filter((query) => SourceSpecificEvidenceQueryUtil.isSafe(query))
      .slice(0, this.maximumRecoveryKeywords);
    if (recoverySources.length === 0) {
      this.logger.debug(
        'Skipping targeted recovery because every eligible recovery source is unavailable, failed, rate-limited, or already exhausted by an earlier recovery wave.',
      );
      return {
        collectionJobId: context.collection?.collectionJobId ?? 'recovery-skipped',
        selectedDataSourceKeys: [],
        recoveryKeywords,
        evidenceFamilies,
        totalPosts: 0,
        totalComments: 0,
        usefulCleanTextCount: 0,
        complaintEvidenceCount: 0,
        newCorpusEvidenceSampleCount: 0,
        newEvidenceSampleCount: 0,
        novelEvidenceSamples: [],
        supportingExternalSamples: [],
        supportingExternalEvidence: [],
        rawEvidenceCorpus: [],
        recoveryOutcome: 'RECOVERY_RETURNED_NO_USABLE_EVIDENCE',
        communityAiRecoveryExecuted: false,
        nlp: context.nlp!,
        communityAiAnalysis: null,
      };
    }

    const recoverySourceKeys = new Set(
      recoverySources.map((source) => source.key.toLocaleLowerCase()),
    );
    const usingAiRecoveryPlan =
      aiRecoveryPlan?.aiUsed === true &&
      aiRecoveryPlan.fallbackUsed !== true &&
      (aiRecoveryPlan.searchQueries?.length ?? 0) > 0;
    const authoritativeRecoveryQueries = usingAiRecoveryPlan
      ? [...(aiRecoveryPlan?.searchQueries ?? [])]
      : recoveryKeywords;
    const aiSourcePlans = usingAiRecoveryPlan
      ? aiRecoveryPlan?.sourcePlans ?? []
      : [];
    const recoveryDomainLanes = this.resolveRecoveryDomainLanes(
      context,
      Math.max(1, recoverySources.length),
    );
    const mergedRecoverySourcePlans = recoverySources.map((source, sourceIndex) => {
      const planned = aiSourcePlans.find(
        (plan) =>
          plan.sourceKey.toLocaleLowerCase() === source.key.toLocaleLowerCase(),
      );
      const recoveryDomain =
        recoveryDomainLanes[sourceIndex % Math.max(1, recoveryDomainLanes.length)] ??
        context.selectedDomains.find((domain) => domain.id === context.domainId) ??
        context.selectedDomains[0] ??
        null;
      const domainRecoveryQueries =
        !context.requestDescription?.trim() && recoveryDomain
          ? CanonicalRequestUnderstandingUtil.buildDomainDiscoveryQueries(
              [recoveryDomain.name],
              2,
            )
          : [];
      const fallbackQueries = domainRecoveryQueries.length > 0
        ? domainRecoveryQueries
        : authoritativeRecoveryQueries.length > 0
          ? [
              authoritativeRecoveryQueries[sourceIndex % authoritativeRecoveryQueries.length],
              authoritativeRecoveryQueries[(sourceIndex + 1) % authoritativeRecoveryQueries.length],
            ].filter((query): query is string => Boolean(query?.trim()))
          : [];
      const rawQueries = [...new Set(
        (planned?.queries?.length && context.requestDescription?.trim()
          ? planned.queries
          : fallbackQueries)
          .map((query) => this.sanitizeRecoveryQuery(query))
          .filter((query) => SourceSpecificEvidenceQueryUtil.isSafe(query)),
      )];
      const compiledQueries = SourceSpecificEvidenceQueryUtil.compile({
        sourceKey: source.key,
        baseQueries: rawQueries,
        requestDescription: context.requestDescription,
        problemProfile: context.collectionPlan?.problemProfile,
        discoveryDomainName: recoveryDomain?.name ?? context.domainName,
        maxQueries: 2,
        preserveBaseQueries: Boolean(context.requestDescription?.trim()),
      });
      return {
        sourceKey: source.key,
        queries: compiledQueries.length ? compiledQueries : rawQueries.slice(0, 2),
        routingHints: [...new Set(planned?.routingHints ?? [])],
        discoveryDomainId: recoveryDomain?.id ?? context.domainId,
        discoveryDomainName: recoveryDomain?.name ?? context.domainName,
        queryIntentId: `recovery:${context.evidenceRecoveryAttempts + 1}:${source.key}:${sourceIndex + 1}`,
        /*
         * Recovery is semantically deeper, not volume-broader. SECONDARY keeps
         * the source bounded while still allowing a little more depth than a
         * MICRO_PROBE.
         */
        sourceTier: 'SECONDARY' as const,
        problemFacetIds: context.canonicalProblemSpec?.facets.map((facet) => facet.id) ?? [],
      };
    }).filter(
      (plan) =>
        recoverySourceKeys.has(plan.sourceKey.toLocaleLowerCase()) &&
        plan.queries.length > 0,
    );

    const resolvedDomain =
      context.selectedDomains.find((domain) => domain.id === context.domainId) ??
      context.selectedDomains[0];
    /*
     * Do not impose a generation-level recovery deadline. Every collector has
     * its own network/request safety timeout, and CollectorQueueService still
     * isolates source failures. The recovery wave therefore completes when the
     * selected source group finishes rather than when an arbitrary short stage
     * clock expires.
     */
    let result: Awaited<ReturnType<CollectionJobResolverService['resolve']>>;
    try {
      result = await this.collectionJobResolver.resolve({
      userId:
        context.owner.type === IDEA_OWNER_TYPES.USER
          ? context.owner.userId
          : undefined,
      domainId: context.domainId,
      country: context.location.country,
      city: context.location.city ?? undefined,
      region: context.location.region ?? undefined,
      language: context.location.language,
      radiusKm: context.location.radiusKm ?? undefined,
      dataSourceKeys: recoverySources.map((source) => source.key),
      keywords: recoveryKeywords,
      plannedQueries: authoritativeRecoveryQueries,
      queriesGeneratedByAi: usingAiRecoveryPlan,
      sourcePlans:
        mergedRecoverySourcePlans.length > 0
          ? mergedRecoverySourcePlans
          : undefined,
      userDescription: requestSpecificRecovery
        ? context.requestDescription ?? undefined
        : undefined,
      forceRefresh: true,
      collectionMode: 'TARGETED_RECOVERY',
      collectorLimits: this.resolveRecoveryCollectorLimits(
        compactDomainsOnlySecondaryRecovery,
        requestSpecificRecovery,
      ),
      ...(resolvedDomain
        ? {
            resolvedDomain: {
              id: resolvedDomain.id,
              name: resolvedDomain.name,
              keywords: [
                ...(resolvedDomain.effectiveSearchKeywords ?? []),
                ...resolvedDomain.keywords,
              ],
            },
          }
        : {}),
      resolvedDataSources: recoverySources.map((source) => ({
        id: source.id,
        key: source.key,
        displayName: source.displayName,
      })),
        });
    } catch (error: unknown) {
      this.logger.warn(
        `Targeted evidence recovery failed for the current source group; the next source/query wave may continue. error=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        collectionJobId: 'recovery-collection-failed',
        selectedDataSourceKeys: recoverySources.map((source) => source.key),
        recoveryKeywords,
        evidenceFamilies,
        totalPosts: 0,
        totalComments: 0,
        usefulCleanTextCount: 0,
        complaintEvidenceCount: 0,
        newCorpusEvidenceSampleCount: 0,
        newEvidenceSampleCount: 0,
        novelEvidenceSamples: [],
        supportingExternalSamples: [],
        supportingExternalEvidence: [],
        rawEvidenceCorpus: [],
        recoveryOutcome: 'RECOVERY_RETURNED_NO_USABLE_EVIDENCE',
        communityAiRecoveryExecuted: false,
        nlp: context.nlp!,
        communityAiAnalysis: null,
      };
    }

    const nlp = this.mapNlpContext(
      result.job.nlpAnalysis?.id ?? null,
      result.nlpOutput,
    );

    /*
     * Persisted recovery evidence remains the provenance source of truth.
     *
     * Recovery intentionally gives Community AI the complete bounded persisted
     * corpus before deterministic semantic pruning. The model classifies every
     * raw item, then RequestEvidenceAlignmentUtil deterministically caps that
     * classification so broad lexical collisions can never become accepted
     * evidence. This fixes false zero-evidence outcomes caused by deleting a
     * useful partial signal before Community AI had a chance to interpret it.
     */
    const inMemoryRecoveryEvidence = this.mapRawRecoveryInputs(
      result.rawEvidenceInputs ?? [],
    );
    const persistedRecoveryEvidence = this.deduplicateRecoveredEvidence(
      inMemoryRecoveryEvidence.length > 0
        ? inMemoryRecoveryEvidence
        : await this.loadPersistedRecoveryEvidence(result.job.id),
    );
    const primaryEvidenceSamples = this.collectPrimaryEvidenceSamples(
      context,
      selectedOpportunity,
    );
    const novelRawRecoveryEvidence = persistedRecoveryEvidence.filter(
      (evidence) =>
        !primaryEvidenceSamples.some((primarySample) =>
          this.areEquivalentEvidenceSamples(evidence.text, primarySample),
        ),
    );
    const novelRawRecoverySamples = this.deduplicateEvidenceSamples(
      novelRawRecoveryEvidence.map((evidence) => evidence.text),
    );
    const rawEvidenceCorpus: IdeaGenerationRawEvidenceItem[] =
      novelRawRecoveryEvidence.map((evidence) => ({
        id: this.buildRecoveryEvidenceId(evidence),
        sourceKey: evidence.sourceKey,
        sourceType: evidence.sourceType,
        postId:
          evidence.sourceType === 'COMMENT'
            ? `${evidence.sourceKey}:post:${evidence.postExternalId}`
            : undefined,
        text: evidence.text,
        discoveryDomainId: evidence.discoveryDomainId ?? context.domainId,
        discoveryDomainName: evidence.discoveryDomainName ?? context.domainName,
        queryIntentId: evidence.queryIntentId ?? null,
        queryText: evidence.queryText ?? null,
        problemFacetIds: evidence.problemFacetIds ?? context.canonicalProblemSpec?.facets.map((facet) => facet.id) ?? [],
        collectionPhase: 'RECOVERY',
        sourceTier: evidence.sourceTier ?? 'PRIMARY',
      }));

    /*
     * Keep deterministic candidates as a non-AI emergency fallback only. When
     * the provider returns semantic classifications, those classifications are
     * authoritative subject to deterministic request/workflow verification.
     */
    const deterministicRequestAlignedEvidence = novelRawRecoveryEvidence.filter(
      (evidence) =>
        this.looksLikeUsableProblemEvidence(evidence.text) &&
        this.isEvidenceAcceptableForRecovery(
          evidence.text,
          context,
          requestSpecificRecovery,
        ),
    );
    const deterministicWorkflowAdjacentEvidence =
      novelRawRecoveryEvidence.filter(
        (evidence) =>
          this.looksLikeUsableProblemEvidence(evidence.text) &&
          !deterministicRequestAlignedEvidence.some((accepted) =>
            this.areEquivalentEvidenceSamples(accepted.text, evidence.text),
          ) &&
          this.isWorkflowAdjacentSupportingEvidence(evidence.text, context),
      );

    const rawRecoveryNlp = this.filterNlpContextToNovelEvidence(
      nlp,
      novelRawRecoverySamples,
    );
    const shouldRunCommunityAiRecovery = novelRawRecoverySamples.length > 0;
    const rawCommunityAiAnalysis = shouldRunCommunityAiRecovery
      ? await this.analyzeRecoveredEvidenceWithCommunityAi(
          context,
          rawRecoveryNlp,
          novelRawRecoveryEvidence,
          novelRawRecoverySamples,
        )
      : null;

    const classificationById = new Map(
      (rawCommunityAiAnalysis?.evidenceClassifications ?? []).map((item) => [
        item.evidenceId,
        item,
      ] as const),
    );
    const evidenceByTriageId = new Map(
      novelRawRecoveryEvidence.map((evidence) => [
        this.buildRecoveryEvidenceId(evidence),
        evidence,
      ] as const),
    );
    const aiClassifiedEvidence = [...classificationById.entries()]
      .map(([evidenceId, classification]) => ({
        classification,
        evidence: evidenceByTriageId.get(evidenceId),
      }))
      .filter(
        (
          item,
        ): item is {
          classification: NonNullable<
            CommunityAiAnalysis['evidenceClassifications']
          >[number];
          evidence: RecoveredExternalEvidence;
        } => Boolean(item.evidence),
      );
    const hasAiEvidenceClassifications = aiClassifiedEvidence.length > 0;

    const aiDirectEvidence = aiClassifiedEvidence
      .filter(
        (item) =>
          item.classification.classification === 'DIRECT_PROBLEM' &&
          item.classification.verifiedByDeterministicGuard,
      )
      .map((item) => item.evidence);
    const aiSupportingEvidence = aiClassifiedEvidence
      .filter(
        (item) =>
          item.classification.classification === 'SUPPORTING_SIGNAL' &&
          item.classification.verifiedByDeterministicGuard,
      )
      .map((item) => item.evidence);

    const selectedExternalEvidence = this.deduplicateRecoveredEvidence(
      hasAiEvidenceClassifications
        ? [...aiDirectEvidence, ...aiSupportingEvidence]
        : [
            ...deterministicRequestAlignedEvidence,
            ...deterministicWorkflowAdjacentEvidence,
          ],
    );

    const directEvidenceSamples = this.deduplicateEvidenceSamples(
      (hasAiEvidenceClassifications
        ? aiDirectEvidence
        : deterministicRequestAlignedEvidence
      ).map((evidence) => evidence.text),
    );
    const supportingEvidenceSamples = this.deduplicateEvidenceSamples(
      (hasAiEvidenceClassifications
        ? aiSupportingEvidence
        : deterministicWorkflowAdjacentEvidence
      ).map((evidence) => evidence.text),
    );

    const compositeEvidenceSamples = requestSpecificRecovery
      ? RequestEvidenceAlignmentUtil.selectCompositeAlignedEvidence({
          requestDescription: context.requestDescription,
          evidenceTexts: [
            ...directEvidenceSamples,
            ...supportingEvidenceSamples,
          ],
          plannedQueries: authoritativeRecoveryQueries,
          maxSamples: 5,
        })
      : [];

    const requestAlignedRecoverySamples = this.deduplicateEvidenceSamples([
      ...directEvidenceSamples,
      ...supportingEvidenceSamples,
      ...(compositeEvidenceSamples.length >= 2
        ? compositeEvidenceSamples
        : []),
    ]);
    const supportingExternalEvidence = selectedExternalEvidence.slice(0, 8);
    const supportingExternalSamples = this.deduplicateEvidenceSamples(
      supportingExternalEvidence.map((evidence) => evidence.text),
    ).slice(0, 8);

    const retainedRecoveryTextCount = requestAlignedRecoverySamples.length;
    const retainedDirectEvidenceCount = directEvidenceSamples.length;

    if (retainedRecoveryTextCount > 0) {
      this.logger.debug(
        `Targeted recovery retained ${retainedRecoveryTextCount} verified ${requestSpecificRecovery ? 'request-aligned' : 'selected-domain-aligned'} evidence sample(s) after ${hasAiEvidenceClassifications ? 'Community AI semantic classification + deterministic verification' : 'deterministic fallback verification'}; direct=${retainedDirectEvidenceCount}, supporting=${supportingEvidenceSamples.length}.`,
      );
    } else {
      this.logger.debug(
        `Targeted recovery retained no trusted ${requestSpecificRecovery ? 'request-aligned' : 'selected-domain-aligned'} DIRECT/SUPPORTING evidence after semantic classification. Raw candidates=${novelRawRecoverySamples.length}, supporting=${supportingEvidenceSamples.length}.`,
      );
    }

    const recoveredEvidenceSamples = this.deduplicateEvidenceSamples(
      requestAlignedRecoverySamples,
    );
    const novelEvidenceSamples = recoveredEvidenceSamples.filter(
      (sample) =>
        !primaryEvidenceSamples.some((primarySample) =>
          this.areEquivalentEvidenceSamples(sample, primarySample),
        ),
    );
    const novelSupportingExternalEvidence =
      supportingExternalEvidence.filter(
        (evidence) =>
          !primaryEvidenceSamples.some((primarySample) =>
            this.areEquivalentEvidenceSamples(evidence.text, primarySample),
          ),
      );
    const novelSupportingExternalSamples = this.deduplicateEvidenceSamples(
      novelSupportingExternalEvidence.map((evidence) => evidence.text),
    );
    const novelCorpusEvidenceSamples = this.deduplicateEvidenceSamples([
      ...novelEvidenceSamples,
      ...novelSupportingExternalSamples,
    ]);

    const novelNlp = this.filterNlpContextToNovelEvidence(
      nlp,
      novelCorpusEvidenceSamples,
    );
    const acceptedCommunityAiRecovery = rawCommunityAiAnalysis
      ? this.filterCommunityAiAnalysisToNovelEvidence(
          rawCommunityAiAnalysis,
          novelCorpusEvidenceSamples,
        )
      : null;
    const deterministicEmergencyFallback =
      this.buildDeterministicRecoveryAnalysis(
        context,
        selectedOpportunity,
        novelCorpusEvidenceSamples,
      );
    const communityAiAnalysis =
      acceptedCommunityAiRecovery ??
      this.mergeCommunityAiAttemptIntoRecoveryFallback(
        deterministicEmergencyFallback,
        rawCommunityAiAnalysis,
      );

    const recoveryOutcome = this.resolveRecoveryOutcome(
      this.deduplicateEvidenceSamples([
        ...novelRawRecoverySamples,
        ...supportingExternalSamples,
      ]).length,
      novelCorpusEvidenceSamples.length,
    );

    return {
      collectionJobId: result.job.id,
      selectedDataSourceKeys: recoverySources.map((source) => source.key),
      recoveryKeywords,
      evidenceFamilies,
      totalPosts: result.nlpOutput.totalPostsAnalyzed,
      totalComments: result.nlpOutput.totalCommentsAnalyzed,
      usefulCleanTextCount: result.nlpOutput.totalTextsAnalyzed,
      complaintEvidenceCount: this.countComplaintEvidence(nlp),
      newCorpusEvidenceSampleCount: novelCorpusEvidenceSamples.length,
      newEvidenceSampleCount: novelCorpusEvidenceSamples.length,
      novelEvidenceSamples,
      supportingExternalSamples: this.deduplicateEvidenceSamples([
        ...novelEvidenceSamples,
        ...novelSupportingExternalSamples,
      ]).slice(0, 8),
      supportingExternalEvidence: novelSupportingExternalEvidence.slice(0, 8),
      rawEvidenceCorpus,
      recoveryOutcome,
      communityAiRecoveryExecuted: shouldRunCommunityAiRecovery,
      nlp: {
        ...novelNlp,
        aiUsed:
          novelNlp.aiUsed ||
          Boolean(rawCommunityAiAnalysis?.aiAttempted) ||
          Boolean(aiRecoveryPlan?.aiUsed),
      },
      communityAiAnalysis,
    };
  }

  private mapRawRecoveryInputs(
    inputs: readonly {
      readonly id: string;
      readonly sourceType: string;
      readonly postId?: string;
      readonly title?: string | null;
      readonly content: string;
      readonly sourceKey?: string;
      readonly discoveryDomainId?: string | null;
      readonly discoveryDomainName?: string | null;
      readonly queryIntentId?: string | null;
      readonly queryText?: string | null;
      readonly problemFacetIds?: readonly string[];
      readonly collectionPhase?: 'INITIAL' | 'RECOVERY';
      readonly sourceTier?: 'PRIMARY' | 'SECONDARY' | 'MICRO_PROBE';
    }[],
  ): RecoveredExternalEvidence[] {
    return inputs.flatMap((input) => {
      const sourceKey = (input.sourceKey ?? input.id.split(':')[0] ?? '').trim();
      if (!sourceKey) return [];
      const title = input.title?.replace(/\s+/gu, ' ').trim() ?? '';
      const content = input.content.replace(/\s+/gu, ' ').trim();
      const text = title && content && !content.toLocaleLowerCase().includes(title.toLocaleLowerCase())
        ? `${title} ${content}`
        : content || title;
      if (text.length < 8) return [];
      const sourceType: 'POST' | 'COMMENT' = input.sourceType === 'COMMENT' ? 'COMMENT' : 'POST';
      const externalId = input.id.split(':').slice(2).join(':') || input.id;
      const parentExternalId = input.postId?.split(':').slice(2).join(':') || externalId;
      return [{
        text,
        sourceKey,
        postExternalId: sourceType === 'COMMENT' ? parentExternalId : externalId,
        commentExternalId: sourceType === 'COMMENT' ? externalId : null,
        sourceType,
        discoveryDomainId: input.discoveryDomainId ?? null,
        discoveryDomainName: input.discoveryDomainName ?? null,
        queryIntentId: input.queryIntentId ?? null,
        queryText: input.queryText ?? null,
        problemFacetIds: input.problemFacetIds ?? [],
        collectionPhase: input.collectionPhase ?? 'RECOVERY',
        sourceTier: input.sourceTier ?? 'PRIMARY',
      }];
    });
  }

  private async loadPersistedRecoveryEvidence(
    collectionJobId: string,
  ): Promise<RecoveredExternalEvidence[]> {
    try {
      const posts = await this.prisma.socialPost.findMany({
        where: { collectionJobId },
        select: {
          externalId: true,
          title: true,
          content: true,
          dataSource: { select: { key: true } },
          comments: {
            select: {
              externalId: true,
              content: true,
            },
          },
        },
      });

      return posts.flatMap((post) => {
        const title = post.title?.replace(/\s+/gu, ' ').trim() ?? '';
        const content = post.content?.replace(/\s+/gu, ' ').trim() ?? '';
        const postText =
          title && content && !content.toLocaleLowerCase().includes(title.toLocaleLowerCase())
            ? `${title} ${content}`
            : content || title;
        const commentPrefix = title || content.slice(0, 160);

        const evidence: RecoveredExternalEvidence[] = [];
        if (postText.length >= 20) {
          evidence.push({
            text: postText,
            sourceKey: post.dataSource.key,
            postExternalId: post.externalId,
            commentExternalId: null,
            sourceType: 'POST',
          });
        }

        for (const comment of post.comments) {
          const commentText = comment.content.replace(/\s+/gu, ' ').trim();
          if (commentText.length < 8) continue;
          evidence.push({
            text: commentPrefix
              ? `${commentPrefix}. Community comment: ${commentText}`
              : commentText,
            sourceKey: post.dataSource.key,
            postExternalId: post.externalId,
            commentExternalId: comment.externalId,
            sourceType: 'COMMENT',
          });
        }

        return evidence;
      });
    } catch (error: unknown) {
      this.logger.debug(
        `Unable to load recovery provenance for collection job ${collectionJobId}; deterministic NLP evidence remains available. error=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  private buildRecoveryEvidenceId(
    evidence: RecoveredExternalEvidence,
  ): string {
    const externalId =
      evidence.commentExternalId ?? evidence.postExternalId;
    return `${evidence.sourceKey}:${evidence.sourceType.toLocaleLowerCase()}:${externalId}`;
  }

  private deduplicateRecoveredEvidence(
    evidence: readonly RecoveredExternalEvidence[],
  ): RecoveredExternalEvidence[] {
    const output: RecoveredExternalEvidence[] = [];
    const seen = new Set<string>();

    for (const item of evidence) {
      const key = [
        item.sourceKey.trim().toLocaleLowerCase(),
        item.postExternalId.trim(),
        item.commentExternalId?.trim() ?? '',
      ].join('|');
      if (!item.text.trim() || seen.has(key)) continue;
      seen.add(key);
      output.push({
        ...item,
        text: item.text.replace(/\s+/gu, ' ').trim(),
      });
    }

    return output;
  }

  /**
   * Excludes sources that actually failed, timed out, or were rate-limited in
   * the primary job. Healthy zero-yield sources remain eligible because the
   * recovery pass uses a different, problem-focused query.
   */
  private async resolveLowYieldSourceKeys(
    context: IdeaGenerationContext,
  ): Promise<ReadonlySet<string>> {
    const collectionJobId = context.collection?.collectionJobId;
    const priorRecoveryJobIds = context.evidenceRecoveryCollectionJobIds.filter(
      (value) =>
        value &&
        !value.startsWith('recovery-') &&
        value !== 'recovery-time-budget-exhausted',
    );
    if (!collectionJobId && priorRecoveryJobIds.length === 0) {
      return new Set<string>();
    }

    try {
      const [primaryDiagnostics, priorRecoveryDiagnostics] = await Promise.all([
        collectionJobId
          ? this.prisma.collectionJobSource.findMany({
              where: { collectionJobId },
              select: {
                status: true,
                totalPosts: true,
                totalComments: true,
                failureReason: true,
                dataSource: { select: { key: true } },
              },
            })
          : Promise.resolve([]),
        priorRecoveryJobIds.length > 0
          ? this.prisma.collectionJobSource.findMany({
              where: { collectionJobId: { in: priorRecoveryJobIds } },
              select: {
                status: true,
                totalPosts: true,
                totalComments: true,
                failureReason: true,
                dataSource: { select: { key: true } },
              },
            })
          : Promise.resolve([]),
      ]);

      const excluded = new Set<string>();
      for (const entry of primaryDiagnostics) {
        const failed = entry.status === CollectionJobStatus.FAILED;
        const rateLimited = /(?:429|rate\s*limit|too many requests)/iu.test(
          entry.failureReason ?? '',
        );
        const timedOut = /(?:timeout|timed out|exceeded \d+ms)/iu.test(
          entry.failureReason ?? '',
        );
        const zeroYield =
          entry.status === CollectionJobStatus.COMPLETED &&
          entry.totalPosts + entry.totalComments === 0;
        if (failed || rateLimited || timedOut || zeroYield) {
          excluded.add(entry.dataSource.key);
        }
      }

      /*
       * DB source diagnostics are not the only truth available during the same
       * in-memory run. If a planned source produced no raw evidence at all, it
       * is a real zero-yield lane for this query family even when a collector
       * adapter did not persist a zero count exactly as expected. Recovery must
       * rotate away from that lane when alternatives exist.
       */
      const rawSourceKeys = new Set(
        (context.rawEvidenceCorpus ?? [])
          .map((item) => item.sourceKey.trim().toLocaleLowerCase())
          .filter(Boolean),
      );
      const plannedSourceKeys = new Set(
        (context.collectionPlan?.sourcePlans ?? [])
          .map((plan) => plan.sourceKey.trim().toLocaleLowerCase())
          .filter(Boolean),
      );
      for (const key of plannedSourceKeys) {
        if (!rawSourceKeys.has(key)) excluded.add(key);
      }

      if (context.evidenceRecoveryAttempts > 0) {
        for (const entry of priorRecoveryDiagnostics) {
          excluded.add(entry.dataSource.key);
        }
      }

      return excluded;
    } catch (error: unknown) {
      this.logger.debug(
        `Unable to load primary source diagnostics for recovery; continuing without exclusions. error=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return new Set<string>();
    }
  }

  private async resolveRecoveryCandidateSources(
    selectedSources: readonly SelectedIdeaDataSource[],
  ): Promise<SelectedIdeaDataSource[]> {
    try {
      const reserveSources = await this.prisma.dataSource.findMany({
        where: {
          isActive: true,
          isImplemented: true,
        },
        select: {
          id: true,
          key: true,
          displayName: true,
          supportsPosts: true,
          supportsComments: true,
          supportsRegion: true,
          supportsLanguage: true,
        },
      });
      const byKey = new Map<string, SelectedIdeaDataSource>();
      for (const source of [...selectedSources, ...reserveSources]) {
        if (!this.collectorsFactory.isCollectorRuntimeAvailable(source.key)) {
          continue;
        }
        if (!byKey.has(source.key)) {
          byKey.set(source.key, source);
        }
      }
      return [...byKey.values()];
    } catch (error: unknown) {
      this.logger.debug(
        `Unable to load reserve recovery sources; using selected sources only. error=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [...selectedSources];
    }
  }

  /**
   * Selects review-rich sources for end-user friction and technical sources for
   * developer-facing failures. GitHub and DEV are intentionally deprioritized
   * for paywall, taxonomy, mobile parity, and session complaints.
   */
  private selectRecoverySources(
    selectedSources: readonly SelectedIdeaDataSource[],
    _evidenceFamilies: readonly EvidenceRecoveryFamily[],
    selectedOpportunity: RankedIdeaOpportunity | null,
    excludedSourceKeys: ReadonlySet<string>,
    context: IdeaGenerationContext,
  ): SelectedIdeaDataSource[] {
    const originalEvidenceSources = new Set(
      (selectedOpportunity?.independentEvidence ?? [])
        .map((evidence) => evidence.sourceKey?.trim().toLocaleLowerCase())
        .filter((key): key is string => Boolean(key)),
    );
    const verifiedDirectEvidenceCount = selectedOpportunity
      ? (selectedOpportunity.verifiedComplaintEvidenceCount ?? 0) +
        (selectedOpportunity.verifiedFeatureRequestEvidenceCount ?? 0) +
        (selectedOpportunity.verifiedObservationEvidenceCount ?? 0) +
        (selectedOpportunity.verifiedDirectUserEvidenceCount ?? 0)
      : 0;
    const secondaryOnlyRecovery = Boolean(
      selectedOpportunity &&
        verifiedDirectEvidenceCount === 0 &&
        (selectedOpportunity.verifiedSecondaryEvidenceCount ?? 0) > 0,
    );
    const domainsOnlyDiscovery =
      !context.requestDescription?.trim() &&
      context.domainResolution?.source === 'USER_SELECTED' &&
      context.selectedDomains.length > 1 &&
      context.evidenceRecoveryAttempts === 0;

    const archetype = RequestWorkflowArchetypeUtil.classify({
      requestDescription: context.requestDescription,
      plannedQueries: context.collectionPlan?.searchQueries ?? [],
      intentConcepts: context.collectionPlan?.intentConcepts ?? [],
      selectedDomainNames: context.selectedDomains.map((domain) => domain.name),
    });
    const strictArchetype =
      Boolean(context.requestDescription?.trim()) && archetype.confidence >= 0.9;
    const archetypeBlocked = new Set(
      strictArchetype
        ? archetype.blockedSourceKeys.map((key) => key.toLocaleLowerCase())
        : [],
    );
    const focusedSourceKeys = this.resolveSourceFocusKeys(
      context.collectionPlan?.sourceFocus ?? [],
    );

    const noRequestReviewOrder = domainsOnlyDiscovery
      ? ([
          'forum',
          'news',
          'github',
          'app-store',
          'google-play',
          'youtube',
          'hacker-news',
          'gdelt',
          'blog',
          'crossref',
        ] as const)
      : ([
          'forum',
          'app-store',
          'google-play',
          'youtube',
          'hacker-news',
          'news',
          'gdelt',
          'blog',
          'crossref',
        ] as const);

    const craftRestorationNiche =
      this.isCraftRestorationNicheRequest(context.requestDescription ?? '') ||
      Boolean(RequestNicheCustomCraftUtil.resolve(context.requestDescription));
    const communityFirstNiche =
      archetype.archetype === 'PHYSICAL_LOCAL_SERVICE_OPERATIONS' ||
      archetype.archetype === 'RESTORATION_CONSERVATION_OPERATIONS' ||
      archetype.archetype === 'FOOD_STORAGE_CONDITION_OPERATIONS' ||
      archetype.archetype === 'RENTAL_INVENTORY_OPERATIONS' ||
      archetype.archetype === 'CUSTOM_COMMISSION_APPROVAL_OPERATIONS';
    const contextualOrder = strictArchetype
      ? [
          ...(communityFirstNiche
            ? craftRestorationNiche
              ? ['forum', 'reddit', 'blog', 'crossref', 'youtube', 'news', 'gdelt']
              : ['reddit', 'forum', 'blog', 'crossref', 'news', 'youtube', 'gdelt']
            : archetype.preferredSourceKeys),
          ...[...focusedSourceKeys],
          ...this.reviewSourceOrder,
          ...this.technicalSourceOrder,
        ]
      : [
          ...(secondaryOnlyRecovery ? [] : originalEvidenceSources),
          ...(!context.requestDescription?.trim()
            ? noRequestReviewOrder
            : this.reviewSourceOrder),
          ...this.technicalSourceOrder,
        ];
    const priority = new Map(
      contextualOrder.map((key, index) => [key, index] as const),
    );

    const requestText = context.requestDescription?.trim() ?? '';
    const technicalRequest =
      /\b(?:api|sdk|source code|repository|github|webhook|endpoint|database schema|firmware integration|docker|kubernetes|stack trace|exception)\b/iu.test(requestText) ||
      /\b(?:software|application|app|server|container|node|javascript|typescript|python|java)\s+runtime\b|\bruntime\s+(?:error|exception|environment|version|dependency|crash)\b/iu.test(requestText);
    const explicitlyRequested = new Set(
      (context.requestedDataSourceKeys ?? []).map((key) =>
        key.toLocaleLowerCase(),
      ),
    );
    const enterpriseIdentityWorkflow =
      archetype.archetype === 'ENTERPRISE_IDENTITY_ACCESS_SECURITY_OPERATIONS';
    const requestSupportInput = {
      requestDescription: requestText,
      domainName: context.domainName,
      plannedQueries: context.collectionPlan?.searchQueries ?? [],
      keywords: context.keywords ?? [],
      collectionMode: 'TARGETED_RECOVERY' as const,
    };

    const automaticallyUnsuitable = (key: string): boolean => {
      if (explicitlyRequested.has(key)) return false;
      if (
        key === 'forum' &&
        !this.collectorsFactory.isCollectorRequestAvailable(key, requestSupportInput)
      ) {
        return true;
      }
      if (!technicalRequest && ['hacker-news', 'github', 'stackoverflow', 'dev-to'].includes(key)) {
        return true;
      }
      if (
        enterpriseIdentityWorkflow &&
        ['app-store', 'google-play', 'product-hunt'].includes(key)
      ) {
        return true;
      }
      if (
        communityFirstNiche &&
        ['app-store', 'google-play', 'product-hunt'].includes(key)
      ) {
        return true;
      }
      return false;
    };

    const eligible = [...selectedSources].filter((source) => {
      const key = source.key.toLocaleLowerCase();
      return (
        this.collectorsFactory.isCollectorRequestAvailable(
          key,
          requestSupportInput,
        ) &&
        !excludedSourceKeys.has(source.key) &&
        !excludedSourceKeys.has(key) &&
        !archetypeBlocked.has(key) &&
        !this.collectorSourceHealth.isTemporarilyDegraded(key) &&
        this.collectorSourceHealth.score(key) >= 0.35 &&
        !automaticallyUnsuitable(key) &&
        !(secondaryOnlyRecovery && originalEvidenceSources.has(source.key))
      );
    });

    /*
     * For request-specific recovery, keep the first wave inside the source
     * families selected by the planner/archetype. The ranking stage passes all
     * sources used by earlier waves back as exclusions, so the next wave
     * automatically rotates to unused professional sources rather than
     * repeating the same noisy corpus. Consumer/technical requests retain the
     * existing broad behavior through their own archetype/source focus.
     */
    const focusedEligible =
      strictArchetype && focusedSourceKeys.size > 0 && !communityFirstNiche
        ? eligible.filter((source) =>
            focusedSourceKeys.has(source.key.toLocaleLowerCase()),
          )
        : [];
    const sourcePool =
      focusedEligible.length > 0 ? focusedEligible : eligible;
    /*
     * Niche repair/restoration recovery may use Crossref as a third, secondary
     * evidence source after forums. The request/object guard still verifies
     * every returned record before it can become evidence, so unrelated
     * lexical matches never gain evidentiary weight. Keeping Crossref available
     * here improves the chance of obtaining at least one independent supporting
     * record when community APIs are sparse or rate-limited.
     */
    const primarySelectedSourceKeys = new Set(
      context.selectedDataSources.map((source) =>
        source.key.toLocaleLowerCase(),
      ),
    );
    const preferUnusedReserveSources =
      Boolean(context.requestDescription?.trim()) &&
      context.evidenceRecoveryAttempts === 0;

    return sourcePool
      .sort((left, right) => {
        const leftKey = left.key.toLocaleLowerCase();
        const rightKey = right.key.toLocaleLowerCase();
        const leftPrimaryPenalty =
          preferUnusedReserveSources &&
          primarySelectedSourceKeys.has(leftKey) &&
          !(communityFirstNiche && ['forum', 'reddit'].includes(leftKey))
            ? 100
            : 0;
        const rightPrimaryPenalty =
          preferUnusedReserveSources &&
          primarySelectedSourceKeys.has(rightKey) &&
          !(communityFirstNiche && ['forum', 'reddit'].includes(rightKey))
            ? 100
            : 0;
        const leftRank = priority.get(left.key) ?? Number.MAX_SAFE_INTEGER;
        const rightRank = priority.get(right.key) ?? Number.MAX_SAFE_INTEGER;
        const leftHealth = this.collectorSourceHealth.score(leftKey);
        const rightHealth = this.collectorSourceHealth.score(rightKey);
        return (
          leftPrimaryPenalty - rightPrimaryPenalty ||
          rightHealth - leftHealth ||
          leftRank - rightRank ||
          left.key.localeCompare(right.key)
        );
      })
      .slice(
        0,
        communityFirstNiche
          ? Math.min(4, this.maximumRecoverySourcesPerWave)
          : this.maximumRecoverySourcesPerWave,
      );
  }

  private resolveRecoveryDomainLanes(
    context: IdeaGenerationContext,
    limit: number,
  ): SelectedGenerationDomain[] {
    if (context.requestDescription?.trim() || context.selectedDomains.length <= 1) {
      const primary =
        context.selectedDomains.find((domain) => domain.id === context.domainId) ??
        context.selectedDomains[0];
      return primary ? [primary] : [];
    }

    const stats = new Map<
      string,
      { score: number; sources: Set<string> }
    >();
    for (const domain of context.selectedDomains) {
      stats.set(domain.id, { score: 0, sources: new Set<string>() });
    }

    for (const item of context.rawEvidenceCorpus ?? []) {
      const domainId = item.discoveryDomainId ?? '';
      const entry = stats.get(domainId);
      if (!entry) continue;
      const problemBearing =
        /\b(?:problem|issue|error|fail(?:ed|ure|ing|s)?|cannot|unable|missing|wrong|delay|slow|blocked|unavailable|risk|friction|difficult|struggle|need|complaint|bug)\b/iu.test(
          item.text,
        );
      entry.score += problemBearing ? 3 : 1;
      entry.sources.add(item.sourceKey.toLocaleLowerCase());
    }

    return [...context.selectedDomains]
      .sort((left, right) => {
        const a = stats.get(left.id) ?? { score: 0, sources: new Set<string>() };
        const b = stats.get(right.id) ?? { score: 0, sources: new Set<string>() };
        return (
          b.score - a.score ||
          b.sources.size - a.sources.size ||
          left.name.localeCompare(right.name)
        );
      })
      .slice(0, Math.max(1, Math.min(limit, context.selectedDomains.length)));
  }

  private resolveSourceFocusKeys(
    sourceFocus: readonly string[],
  ): ReadonlySet<string> {
    const keys = new Set<string>();
    const familyKeys: Record<string, readonly string[]> = {
      REVIEWS: ['app-store', 'google-play'],
      FORUMS: ['forum', 'reddit', 'hacker-news'],
      TECHNICAL: ['github', 'stackoverflow', 'dev-to', 'hacker-news'],
      NEWS: ['news', 'gdelt', 'crossref', 'blog', 'youtube'],
      PRODUCT_DISCOVERY: ['product-hunt'],
    };

    for (const family of sourceFocus) {
      for (const key of familyKeys[family] ?? []) {
        keys.add(key);
      }
    }

    return keys;
  }

  private buildRecoveryKeywords(
    context: IdeaGenerationContext,
    selectedOpportunity: RankedIdeaOpportunity | null,
    evidenceFamilies: readonly EvidenceRecoveryFamily[],
  ): string[] {
    const canonicalProfile = context.collectionPlan?.problemProfile;
    if (context.requestDescription?.trim() && canonicalProfile) {
      const canonicalQueries = CanonicalRequestUnderstandingUtil.buildRecoveryQueries(
        canonicalProfile,
        context.collectionPlan?.searchQueries ?? [],
        Math.min(6, this.maximumRecoveryKeywords),
      );
      if (canonicalQueries.length > 0) {
        return canonicalQueries;
      }
    }

    const domain = (context.domainName ?? '').trim();
    const domainTerm = domain || context.keywords[0]?.trim() || 'software';
    const aiPlannedRecoveryQueries = context.collectionPlan?.aiUsed
      ? (context.collectionPlan.searchQueries ?? [])
          .map((value) => value.replace(/\s+/gu, ' ').trim())
          .filter(Boolean)
      : [];
    const requestIntentTerms = this.buildRequestIntentRecoveryQueries(context);
    const contextVocabularyQueries = this.buildContextVocabularyRecoveryQueries(context);
    const nicheCraftRecoveryQueries = RequestNicheCustomCraftUtil.buildSourceQueries(
      context.requestDescription,
      'forum',
    );
    const onlinePharmacyRecoveryQueries = RequestOnlinePharmacyFraudUtil.isRequest(
      context.requestDescription,
    )
      ? RequestOnlinePharmacyFraudUtil.buildSourceQueries('forum')
      : [];
    const professionalRecoveryQueries =
      RequestDynamicQueryUtil.buildProfessionalEvidenceQueries({
        requestDescription: context.requestDescription,
        intentConcepts: context.collectionPlan?.intentConcepts ?? [],
        evidenceTargets: context.collectionPlan?.evidenceTargets ?? [],
        plannedQueries: context.collectionPlan?.searchQueries ?? [],
        maxQueries: this.maximumRecoveryKeywords,
      });
    const domainAgnosticFacetQueries = RequestDynamicQueryUtil.buildEvidenceFacetQueries({
      requestDescription: context.requestDescription,
      intentConcepts: context.collectionPlan?.intentConcepts ?? [],
      evidenceTargets: context.collectionPlan?.evidenceTargets ?? [],
      maxQueries: this.maximumRecoveryKeywords,
    });
    const targetedCollectorQueries = CollectorQueryBuilderUtil.buildDomainPainQueries({
      domainName: domainTerm,
      domainKeywords:
        context.selectedDomains.find((item) => item.id === context.domainId)
          ?.effectiveSearchKeywords ??
        context.selectedDomains.find((item) => item.id === context.domainId)
          ?.keywords ??
        [],
      userKeywords: context.keywords,
      maxQueries: this.maximumRecoveryKeywords * 3,
    });
    const opportunityTerms = this.buildOpportunityTerms(
      domainTerm,
      selectedOpportunity,
    );
    const familyTerms = evidenceFamilies.flatMap((family) =>
      this.buildFamilyQueries(domainTerm, family),
    );
    const genericComplaintTerms = this.buildNaturalComplaintQueries(
      domainTerm,
      context.keywords,
    );
    const boundedBaseTerms = [domain, ...context.keywords]
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 2);

    const selectedDomainQueries =
      this.buildSelectedDomainRecoveryQueries(context);

    const requestScopedRecovery = Boolean(
      context.requestDescription?.trim(),
    );
    const primaryQueryKeys = new Set(
      (context.collectionPlan?.searchQueries ?? []).map((value) =>
        value
          .replace(/\s+/gu, ' ')
          .trim()
          .toLocaleLowerCase(),
      ),
    );
    const freshRequestRecoveryCandidates = [
      ...new Set([
        ...(requestScopedRecovery ? onlinePharmacyRecoveryQueries : []),
        ...(requestScopedRecovery ? nicheCraftRecoveryQueries : []),
        ...(requestScopedRecovery ? professionalRecoveryQueries : []),
        ...(requestScopedRecovery ? requestIntentTerms : []),
        ...(requestScopedRecovery ? domainAgnosticFacetQueries : []),
        ...(requestScopedRecovery ? contextVocabularyQueries : []),
        ...selectedDomainQueries,
        ...opportunityTerms,
        ...familyTerms,
        ...targetedCollectorQueries,
        ...genericComplaintTerms,
        ...boundedBaseTerms,
      ]),
    ]
      .map((value) => this.sanitizeRecoveryQuery(value))
      .filter(Boolean)
      .filter((value) => this.isSemanticallyUsefulRecoveryQuery(value, context))
      .filter(
        (value) =>
          !requestScopedRecovery ||
          !primaryQueryKeys.has(value.toLocaleLowerCase()),
      );
    const fallbackRepeatedPlannerQueries = aiPlannedRecoveryQueries.filter(
      (value) =>
        !freshRequestRecoveryCandidates.some(
          (candidate) =>
            candidate.toLocaleLowerCase() === value.toLocaleLowerCase(),
        ),
    );
    const candidates = requestScopedRecovery
      ? [
          ...freshRequestRecoveryCandidates,
          ...fallbackRepeatedPlannerQueries,
        ]
      : [
          ...aiPlannedRecoveryQueries,
          ...freshRequestRecoveryCandidates,
        ];

    const qualifiedCommunityEvidenceCount =
      context.communityAiAnalysis?.evidenceClassifications?.filter(
        (item) =>
          item.classification === 'DIRECT_PROBLEM' ||
          item.classification === 'SUPPORTING_SIGNAL',
      ).length ?? 0;
    const requestKeywordLimit = requestScopedRecovery
      ? Math.min(
          qualifiedCommunityEvidenceCount === 0 ? 8 : 6,
          this.maximumRecoveryKeywords,
        )
      : this.maximumRecoveryKeywords;
    const recoveryPage = Math.max(0, context.evidenceRecoveryAttempts);
    const offset = recoveryPage * requestKeywordLimit;
    const attemptSpecific = candidates.slice(
      offset,
      offset + requestKeywordLimit,
    );

    return attemptSpecific.length > 0
      ? attemptSpecific
      : candidates.slice(0, requestKeywordLimit);
  }

  /**
   * Uses the application-built request-intent keywords before generic recovery
   * phrases. These terms already encode the user's concrete workflow (for
   * example workforce turnover, security-alert triage, or expense anomalies),
   * so they are much more precise than searching for "the requester wants...".
   */
  private buildContextVocabularyRecoveryQueries(
    context: IdeaGenerationContext,
  ): string[] {
    const contextOnlyIds = new Set(
      (context.communityAiAnalysis?.evidenceClassifications ?? [])
        .filter((item) => item.classification === 'CONTEXT_ONLY')
        .map((item) => item.evidenceId),
    );
    if (contextOnlyIds.size === 0) return [];

    const contextTexts = (context.rawEvidenceCorpus ?? [])
      .filter((item) => contextOnlyIds.has(item.id))
      .map((item) => item.text)
      .slice(0, 4);
    if (contextTexts.length === 0) return [];

    const request = context.requestDescription?.trim() ?? '';
    const candidatePhrases = [
      ...RequestDynamicQueryUtil.buildProfessionalEvidenceQueries({
        requestDescription: request,
        intentConcepts: contextTexts,
        evidenceTargets: context.collectionPlan?.evidenceTargets ?? [],
        plannedQueries: context.collectionPlan?.searchQueries ?? [],
        maxQueries: 6,
      }),
      ...contextTexts.flatMap((text) => {
        const normalized = text.toLocaleLowerCase();
        const phrases: string[] = [];
        if (/\bcondition reports?\b/u.test(normalized)) phrases.push('condition report conservation workflow problems');
        if (/\btreatment reports?|treatment history\b/u.test(normalized)) phrases.push('conservation treatment history documentation problems');
        if (/\bannotated (?:pictures|photos)|damage(?:s)? types?\b/u.test(normalized)) phrases.push('conservator damage documentation photo annotation workflow');
        if (/\barchive|archiving|subsequent reports?\b/u.test(normalized)) phrases.push('conservation record archive repeated treatment history');
        return phrases;
      }),
    ];

    return [...new Set(candidatePhrases)]
      .map((value) => this.sanitizeRecoveryQuery(value))
      .filter(Boolean)
      .slice(0, 6);
  }

  private buildSelectedDomainRecoveryQueries(
    context: IdeaGenerationContext,
  ): string[] {
    const queries: string[] = [];
    const request = context.requestDescription?.toLocaleLowerCase() ?? '';

    if (
      /\b(?:pottery|ceramic|ceramics|earthenware|stoneware|porcelain)\b/u.test(request) &&
      /\b(?:restoration|conservation|repair|restorer|conservator)\b/u.test(request)
    ) {
      return [
        'ceramic conservator condition report treatment documentation problems',
        'ceramics conservation previous repairs treatment history records',
        'pottery restoration color matching glaze repair material selection',
        'ceramic conservation missing fragments damage documentation workflow',
        'object conservation treatment record photographs handwritten notes',
        'museum ceramics conservation condition reporting repair history',
        'ceramic restorer glaze matching previous treatment documentation',
        'conservation treatment record material choices client approval artifact',
      ];
    }

    if (
      /\b(?:public grant programs?|government grant programs?|public funding programs?|grant-making agencies?|grantmaking agencies?|public agencies?)\b/u.test(request) &&
      /\b(?:grant applications?|funding applications?|eligibility checks?|previous funding|funding history|project outcomes?|financial records?|duplicate(?:d)? requests?|duplicate funding|unrealistic budgets?|underperformance risk|funding allocation|program impact)\b/u.test(request)
    ) {
      return [
        'public grant administrator duplicate funding request eligibility budget review',
        'government grant application scoring inconsistent decisions approval delays',
        'public grant unrealistic budget underperformance risk project outcomes review',
        'grant funding history duplicate award program impact evaluation public agency',
        'public grant application financial records fragmented review workflow',
        'government grant allocation audit duplicate funding budget anomaly',
      ];
    }

    if (
      /\b(?:typewriter restoration specialists?|typewriter restorers?|typewriter repair specialists?|typewriter repairers?|typewriter restoration workshops?|typewriter repair shops?)\b/u.test(request) &&
      /\b(?:mechanical condition|missing keys?|ribbon mechanism|damaged components?|previous repairs?|repair history|cosmetic details?|replacement parts?|spare[- ]part records?|customer restoration preferences?|repeated diagnostics?|overlooked defects?)\b/u.test(request)
    ) {
      return [
        'typewriter repair restoration missing keys ribbon mechanism repair history',
        'typewriter restorer wrong replacement parts repeated diagnostics notes',
        'vintage typewriter restoration machine condition previous repairs workshop',
        'typewriter repair damaged components spare parts customer preferences',
        'typewriter restoration service history overlooked defects delayed project',
        'antique typewriter repair condition report parts compatibility records',
      ];
    }

    if (
      /\b(?:online subscription businesses?|subscription businesses?|subscription companies?|subscription services?|subscription platforms?|saas businesses?|saas companies?)\b/u.test(request) &&
      /\b(?:customers? cancel|customer cancellation|churn|renewal history|retention|recurring revenue|discount usage|pricing plans?|product usage|support interactions?|refund activity|financial forecasts?)\b/u.test(request)
    ) {
      return [
        'subscription business churn renewal retention recurring revenue problem',
        'subscription customer cancellation product usage renewal history signals',
        'saas churn customer support product usage payment behavior',
        'subscription pricing plan profitability discount usage churn',
        'subscription retention offer effectiveness customer churn risk',
        'recurring revenue forecast churn cancellations renewal behavior',
        'subscription customer churn payment support usage data silos',
        'subscription plan profitability refunds discounts retention revenue',
        'subscription renewal behavior churn prediction customer usage',
        'subscription business retention analytics fragmented customer data',
      ];
    }

    if (
      /\b(?:agricultural exporters?|fresh produce exporters?|produce exporters?|fruit exporters?|vegetable exporters?|agricultural export(?:ers?| companies?| businesses?))\b/u.test(request) &&
      /\b(?:transportation delays?|delivery delays?|storage costs?|warehouse expenses?|market prices?|product spoilage|produce spoilage|shipment profitability|profit margins?|profit estimates?|supplier payments?|sales revenues?|financial losses?)\b/u.test(request)
    ) {
      return [
        'fresh produce exporter transport delay spoilage profit margin problem',
        'agricultural exporter storage cost market price shipment profitability',
        'fresh produce cold chain postharvest loss economic impact',
        'produce export warehouse expense supplier payment sales revenue reconciliation',
        'agricultural export route profitability logistics cost spoilage',
        'produce exporter inaccurate profit estimate distribution stage loss',
        'fresh produce export price volatility transport storage cost',
        'postharvest loss fresh produce exporter revenue margin',
      ];
    }

    if (
      /\b(?:eyeglass frame repair specialists?|eyeglass repair specialists?|eyewear repair specialists?|optical frame repair specialists?|spectacle frame repair specialists?|glasses repair specialists?)\b/u.test(request) &&
      /\b(?:frame damage|previous repairs?|repair history|replacement hinges?|replacement parts?|color matching|colour matching|fit preferences?|adjustment notes?|pickup dates?|repeated adjustments?)\b/u.test(request)
    ) {
      return [
        'eyeglass frame repair wrong hinge repeated adjustment repair history',
        'glasses repair shop lost repair notes pickup delay',
        'eyewear repair replacement parts fit preference history',
        'optical frame repair color matching customer adjustment notes',
        'eyeglass repair incorrect replacement part repeated adjustment',
        'spectacle frame repair previous repairs hinge replacement',
        'optical repair shop promised pickup date repair records',
      ];
    }

    if (
      /\b(?:restaurants?|restaurant chains?|commercial kitchens?)\b/u.test(request) &&
      /\b(?:refrigeration|cooking equipment|food storage|equipment readings?|ingredient usage|daily sales|maintenance records?|utility expenses?|food waste|operating costs?|profit margins?)\b/u.test(request)
    ) {
      return [
        'restaurant manager rising energy costs refrigeration maintenance',
        'commercial kitchen utility costs equipment failure food waste',
        'restaurant refrigeration breakdown food spoilage operating cost',
        'restaurant equipment energy efficiency maintenance financial cost',
        'restaurant sales activity ingredient waste utility cost tracking',
        'commercial kitchen HVAC refrigeration cost maintenance problem',
      ];
    }

    if (
      /\b(?:sneaker(?: and shoe)? cleaning specialists?|shoe cleaning specialists?|sneaker cleaners?|shoe cleaners?|sneaker restoration|shoe restoration)\b/u.test(request) &&
      /\b(?:material types?|stain conditions?|cleaning preferences?|previous treatments?|repair notes?|pickup deadlines?|service history|handwritten tags?|misplaced items?|forgotten requests?)\b/u.test(request)
    ) {
      return [
        'sneaker cleaning shop lost customer shoes paper tags',
        'shoe cleaner forgotten customer instructions pickup delay',
        'sneaker restoration wrong treatment material stain notes',
        'shoe cleaning business repeated treatment missing service history',
        'sneaker cleaner misplaced pair customer request delayed pickup',
        'shoe restoration shop handwritten tags receipts customer messages',
      ];
    }

    if (
      /\b(?:streaming and digital entertainment companies?|streaming companies?|streaming services?|streaming platforms?|digital entertainment companies?|media and entertainment companies?|media companies?)\b/u.test(request) &&
      /\b(?:content profitability|sustainable revenue|subscription activity|subscription revenue|advertising income|ad revenue|production costs?|viewing behavior|cancellations?|churn|promotional campaigns?|financial return|revenue forecasts?|content investment)\b/u.test(request)
    ) {
      return [
        'streaming service content profitability production cost subscriber revenue',
        'video streaming content roi production spending subscriber retention',
        'streaming platform show profitability advertising subscription revenue',
        'digital entertainment content investment return viewing engagement churn',
        'media company content profitability production cost attribution',
        'streaming originals production budget subscriber retention financial return',
        'streaming catalog title performance revenue attribution viewing data',
        'streaming content investment underperforming shows production spend',
        'media entertainment revenue forecast content performance subscription advertising',
        'streaming service promotional campaign roi title performance churn',
        'content portfolio profitability creator performance production cost media',
        'streaming analytics siloed viewing subscription revenue production cost',
      ];
    }

    if (
      /\b(?:alteration specialists?|bridal alteration specialists?|clothing alteration specialists?|seamstresses?|bridal seamstresses?|dressmakers?|bridal dressmakers?|tailors?|tailoring|alteration shops?|wedding dress alterations?|bridal alterations?)\b/u.test(request) &&
      /\b(?:dress measurements?|fitting notes?|requested modifications?|alteration requests?|fabric details?|accessory requirements?|customer approvals?|approved alterations?|pickup deadlines?|repeated fittings?|incorrect adjustments?|fabric damage|forgotten requests?|delayed completion)\b/u.test(request)
    ) {
      return [
        'bridal alteration specialist fitting notes customer approval changes',
        'wedding dress alteration seamstress measurements revision tracking',
        'bridal seamstress lost fitting notes alteration request rework',
        'dressmaker wedding gown measurements customer changes approval',
        'alteration shop wedding dress fitting pickup deadline customer notes',
        'bridal alterations wrong measurement repeated fitting delayed pickup',
        'wedding gown alterations fabric detail accessory request approval',
        'seamstress alteration order handwritten measurements customer messages',
        'bridal tailor fitting history approved alterations final pickup',
        'dress alteration specialist revision request fabric damage rework',
        'wedding dress fitting alteration change tracking customer approval',
        'bridal dressmaker measurement fitting notes completion deadline',
      ];
    }

    if (
      /\b(?:city transport(?:ation)? departments?|municipal transport(?:ation)? departments?|urban transportation agencies?|transit agencies?|public transport(?:ation)? authorities?)\b/u.test(request) &&
      /\b(?:intersections?|bus corridors?|traffic sensors?|vehicle locations?|signal timing|passenger volumes?|road incident reports?|traffic congestion|recurring delays?)\b/u.test(request)
    ) {
      return [
        'city intersection recurring congestion signal timing root cause',
        'bus corridor congestion passenger volume travel time delay',
        'traffic sensor vehicle location signal timing data silo municipal transport',
        'road incident traffic congestion public transit corridor delay',
        'municipal traffic signal timing passenger volume recurring bottleneck',
        'city transport fragmented traffic sensor incident data root cause',
        'public transit overcrowding corridor congestion peak time passenger demand',
        'intersection congestion traffic signal adjustment recurring delay city',
      ];
    }

    if (
      /\b(?:transportation companies?|transport companies?|transport operators?|transportation operators?|fleet operators?|fleet managers?|transit operators?|passenger transport companies?|bus companies?|delivery fleets?|commercial fleets?)\b/u.test(request) &&
      /\b(?:operating costs?|fuel expenses?|fuel costs?|maintenance costs?|route performance|route profitability|driver schedules?|ticket revenue|fare revenue|delivery revenue|vehicle utilization|fleet utilization|pricing decisions?|financial forecasts?|profitability|cost variance)\b/u.test(request)
    ) {
      return [
        'transport operator rising fuel maintenance costs stable passenger volume',
        'fleet manager route profitability vehicle utilization operating cost',
        'transit operator route margin ticket revenue maintenance expense',
        'delivery fleet operating cost route performance revenue profitability',
        'transportation driver scheduling fuel cost margin erosion',
        'fleet vehicle utilization maintenance cost financial forecast',
        'transport operator cost variance pricing route performance',
        'transportation operating expense route revenue profitability',
        'fleet cost per route fuel maintenance vehicle downtime',
        'transit financial performance route cost fare revenue utilization',
        'delivery operator stable volume rising operating cost route margin',
        'transportation profitability siloed fuel maintenance revenue data',
      ];
    }

    if (
      /\b(?:private healthcare providers?|healthcare providers?|medical practices?|clinics?|hospitals?|patient billing systems?|medical billing systems?)\b/u.test(request) &&
      /\b(?:fraudulent claims?|billing fraud|payment fraud|suspicious payment activity|unauthorized account access|unauthorised account access|compromised patient accounts?|coordinated abuse)\b/u.test(request)
    ) {
      return [
        'healthcare fraudulent claims siloed billing security systems',
        'medical billing fraud suspicious payment investigation delay',
        'patient portal account takeover unauthorized payment incident',
        'healthcare claim fraud login history payment transaction correlation',
        'patient billing fraud false positive legitimate account restriction',
        'insurance claim fraud security alert investigation healthcare provider',
        'compromised patient account unauthorized transaction medical billing',
        'healthcare payment anomaly fraudulent claim coordinated abuse',
        'medical invoice fraud separate billing login security records',
        'healthcare fraud investigation delayed reimbursement suspicious claim',
      ];
    }

    if (
      /\b(?:antique books?|rare books?|historic books?|historical books?|book restoration specialists?|book restorers?|book conservators?|paper conservators?|book conservation workshops?|book restoration workshops?)\b/u.test(request) &&
      /\b(?:damaged bindings?|missing pages?|paper condition|previous repairs?|original materials?|customer preservation preferences?|restoration progress|restoration history|replacement materials?)\b/u.test(request)
    ) {
      return [
        'antique book conservator lost treatment notes restoration history',
        'rare book restoration wrong replacement material previous repair records',
        'book conservation damaged binding missing pages condition documentation',
        'book restorer scattered workshop notes photographs treatment record',
        'rare book conservation original materials lost details repeated restoration',
        'book restoration customer preservation instructions missed rework',
        'paper conservator previous repair history treatment documentation problem',
        'antique book restoration condition report material mismatch delayed project',
        'book conservator restoration progress records customer approval notes',
        'rare book binding conservation incorrect material repeated work',
      ];
    }

    if (
      !/\b(?:book restoration|book conservation|antique book|rare book|paper conservation|previous repairs?|restoration progress|restoration history|damaged bindings?|missing pages?)\b/u.test(request) &&
      /\b(?:book cover craftsmen?|book cover makers?|bookbinders?|custom bookbinders?|bookbinding craftsmen?|bookbinding artisans?|binderies?|bindery workshops?|bookbinding workshops?|book edge gilding specialists?|book edge gilders?|fore[- ]edge gilding specialists?|book gilding specialists?)\b/u.test(request) &&
      /\b(?:client artwork|book dimensions?|cover dimensions?|material selections?|embossing details?|foil|gold[- ]leaf|gold leaf|decorative patterns?|surface preparation|finish|revision requests?|revision details?|approved specifications?|approved finish|customer approvals?|completion deadlines?|incorrect materials?|damaged books?|incorrect dimensions?|wasted materials?|repeated work|delayed orders?)\b/u.test(request)
    ) {
      const bookEdgeGilding = /\b(?:book edge gilding|edge gilding|fore[- ]edge gilding|book gilding|gold[- ]leaf|gold leaf)\b/u.test(request);
      if (bookEdgeGilding) {
        return [
          'book edge gilding gold leaf material selection mistake rework',
          'fore-edge gilding surface preparation damaged book',
          'bookbinding gilding finish specification customer revision approval',
          'gold leaf book edges inconsistent finish wrong material',
          'custom bookbinding handwritten client notes gilding rework',
          'book edge decorative pattern revision approval delayed order',
          'book restoration gilding surface preparation material mismatch',
          'bookbinder gold leaf finishing workflow specification errors',
          'fore-edge decoration customer changes repeated work',
          'book edge gilding completion deadline custom order delay',
        ];
      }
      return [
        'bookbinder client dimensions material embossing revision approval problem',
        'custom bookbinding lost client specifications artwork measurements rework',
        'book cover craftsman wrong dimensions missed design details customer approval',
        'bindery revision request final approved specification delayed order',
        'bookbinder material selection foil stamping customer changes wasted material',
        'custom bookbinding scattered sketches messages specification mistake',
        'book cover commission wrong approved version remake delayed order',
        'bookbinder client artwork cover dimension approval workflow problem',
        'bindery customer revision missed embossing material detail',
        'bespoke bookbinding specification version control material waste',
        'book cover craftsman final approval revision completion deadline',
        'custom bookbinder wrong specification repeated work client message',
      ];
    }

    if (
      /\b(?:public healthcare agencies?|public health agencies?|health departments?|health authorities?|healthcare agencies?|hospitals?|clinics?)\b/u.test(request) &&
      /\b(?:rising demand|service demand|healthcare demand|medical service demand|appointment volumes?|emergency visits?|regional health reports?|community healthcare needs?|community health needs?|hospitals? become overloaded|clinics? become overloaded|capacity pressure|waiting times?|resource availability|resource distribution|staff shortages?|demand forecasting|surge detection)\b/u.test(request)
    ) {
      return [
        'public healthcare rising service demand hospital capacity pressure',
        'appointment volume surge clinic staffing resource availability',
        'emergency visit trends hospital overload community demand',
        'regional health reports demand waiting times resource distribution',
        'health agency community medical service demand forecasting',
        'hospital clinic capacity pressure appointment emergency visit trends',
        'public health demand early warning staff shortage waiting time',
        'community healthcare demand forecast resource allocation hospital capacity',
        'health authority service demand surge hospital staffing shortage',
        'emergency department crowding demand forecasting regional health data',
        'clinic appointment backlog community demand resource allocation',
        'public health capacity planning waiting time demand pressure',
      ];
    }

    if (
      /\b(?:urban transportation agencies?|transportation agencies?|transit agencies?|city transport(?:ation)? departments?|municipal transport(?:ation)?|public transport(?:ation)? authorities?|urban mobility agencies?)\b/u.test(request) &&
      /\b(?:traffic flow|traffic congestion|public transit demand|transit demand|road incidents?|travel times?|route performance|peak hours?|time periods?|bottlenecks?)\b/u.test(request) &&
      /\b(?:vehicle emissions?|fuel consumption|air quality|environmental measurements?|longer journeys?|travel time reliability|transportation improvements?)\b/u.test(request)
    ) {
      return [
        'urban traffic congestion emissions peak hour travel time',
        'public transit demand road incidents congestion city',
        'traffic bottleneck fuel consumption vehicle emissions city',
        'transport agency integrated traffic transit air quality data',
        'route congestion travel time reliability emissions',
        'urban mobility corridor delay public transit demand emissions',
        'road incident traffic flow fuel consumption transport emissions',
        'transportation improvement priority congestion travel time air quality',
        'city traffic bottleneck corridor travel time reliability report',
        'public transport demand peak period road network congestion',
        'urban transport emissions idling fuel consumption route delay',
        'mobility planning traffic incident environmental measurement integration',
      ];
    }

    if (
      /\b(?:manufacturing plants?|manufacturers?|factories|factory|industrial plants?|production lines?|plant operators?|plant engineers?)\b/u.test(request) &&
      /\b(?:machines?|equipment|equipment sensors?|machine sensors?|electricity usage|electricity consumption|energy consumption|power draw|power consumption|operating hours?|maintenance records?|maintenance history|production schedules?|equipment condition|machine condition|telemetry)\b/u.test(request) &&
      /\b(?:unusually high|abnormal|anomal(?:y|ies)|energy spike|power spike|losing efficiency|efficiency loss|efficiency decline|degradation|predictive maintenance|before (?:a )?failure|impending failure|breakdowns?|downtime|production interruptions?|unnecessary maintenance|electricity costs?|energy costs?)\b/u.test(request)
    ) {
      return [
        'factory machine abnormal electricity consumption equipment condition',
        'industrial equipment energy anomaly predictive maintenance breakdown',
        'machine power draw maintenance history production schedule correlation',
        'factory equipment efficiency loss operating hours energy consumption',
        'plant maintenance electricity spike before equipment failure',
        'industrial machine energy efficiency condition monitoring downtime',
        'equipment sensors energy consumption maintenance records failure prediction',
        'factory machine energy anomaly unnecessary maintenance production interruption',
        'electric motor energy consumption condition monitoring failure',
        'industrial equipment power anomaly maintenance history breakdown',
        'factory electricity cost machine efficiency degradation maintenance',
        'plant equipment energy profile operating hours failure detection',
      ];
    }

    if (
      /\b(?:manufacturing plants?|manufacturers?|factories|factory|industrial plants?|production lines?)\b/u.test(request) &&
      /\b(?:material waste|scrap|scrap records?|raw material consumption|material losses?|yield loss|quality defects?|production defects?|rework|emissions?|environmental impact|waste reduction|material efficiency|circularity|production waste)\b/u.test(request)
    ) {
      return [
        'manufacturing material scrap waste production stage root cause',
        'factory scrap records machine output quality defects material loss',
        'manufacturing raw material consumption yield loss scrap reduction',
        'production line defects rework scrap material waste',
        'manufacturing process stage waste loss quality issue',
        'industrial plant scrap rate machine output defect correlation',
        'manufacturing sustainability material efficiency production waste',
        'factory repeated defects scrap rework material cost',
        'manufacturing waste generated production stage quality data',
        'manufacturing scrap root cause machine output raw material usage',
      ];
    }

    if (
      /\b(?:government agencies?|government departments?|public sector agencies?|public authorities?|regulatory agencies?|licensing authorities?)\b/u.test(request) &&
      /\b(?:legal records?|licensing documents?|citizen applications?|regulatory files?|official records?|public records?|permit records?|case files?)\b/u.test(request) &&
      /\b(?:unauthorized access|unauthorised access|manipulation|tamper(?:ing|ed)?|access logs?|document histor(?:y|ies)|employee activity|security alerts?|suspicious changes?|who accessed|incident investigation|audit trail)\b/u.test(request)
    ) {
      return [
        'government sensitive records unauthorized access audit log investigation',
        'public sector legal record tampering document history security alert',
        'government licensing document unauthorized change access log incident',
        'citizen application record suspicious modification employee activity',
        'regulatory file integrity who accessed changed record investigation',
        'government document version history access anomaly compliance incident',
        'public records compromised credentials suspicious change audit trail',
        'government records security incident access reconstruction legal compliance',
        'public sector document integrity permission change incident investigation',
        'government records unauthorized employee access compliance breach',
      ];
    }

    if (
      /\b(?:engraving businesses?|engraving shops?|engraving studios?|engravers?|custom engraving|laser engraving)\b/u.test(request) &&
      /\b(?:customer artwork|text details?|material types?|object dimensions?|font preferences?|placement instructions?|revision requests?|approved design|approved version|spelling mistakes?|incorrect placement|wasted materials?)\b/u.test(request)
    ) {
      return [
        'engraving shop wrong spelling placement customer order',
        'custom engraver artwork revision approved design version',
        'engraving business customer text font placement mistake',
        'engraving shop material dimensions order specification error',
        'laser engraving customer approval revision rework wasted material',
        'custom engraving scattered messages artwork instructions',
        'engraver wrong design version repeated work delayed order',
        'engraving order material type object dimensions font preference',
        'engraving shop customer proof approval version control',
        'laser engraving wrong text placement remake wasted blank',
        'custom engraving revision request missed production mistake',
        'engraver customer artwork final approval tracking problem',
      ];
    }

    if (
      /\b(?:independent|small|custom|local)?\s*[\p{L}\p{N}'’-]+(?:\s+[\p{L}\p{N}'’-]+){0,4}\s+(?:studios?|workshops?|shops?|makers?|artisans?|artists?|businesses?)\b/iu.test(request) &&
      /\b(?:design references?|reference images?|color choices?|colour choices?|item sizes?|dimensions?|measurements?|personalization details?|painting instructions?|placement instructions?|revision requests?|approved design|approved version|final approved|customer approval|pickup dates?|delivery dates?)\b/iu.test(request) &&
      /\b(?:incorrect colors?|wrong colors?|misspelled names?|spelling mistakes?|wrong placement|incorrect placement|wasted materials?|repeated work|rework|lost details?|delayed customer orders?|delayed orders?|wrong version|outdated version)\b/iu.test(request)
    ) {
      const actor =
        RequestDynamicQueryUtil.extractActor(context.requestDescription ?? '') ||
        'custom studio';
      const headwearWorkflow =
        /\b(?:hat makers?|milliners?|millinery|custom hats?|bespoke hats?|custom headwear)\b/iu.test(
          request,
        );
      if (headwearWorkflow) {
        return [
          'milliner custom hat head measurements brim dimensions fitting revision',
          'millinery bespoke hat material choice sizing customer approval rework',
          'custom hat maker wrong size brim measurement repeated adjustment',
          'bespoke headwear final approved specification material color decoration',
          'custom hat fitting notes revision customer order delayed delivery',
          'milliner customer measurements sketches physical samples wrong version',
          'custom headwear material mismatch brim dimension fitting problem',
          'hat maker final approved design revision wasted supplies delay',
          'millinery order specification sizing decoration customer change',
          'bespoke hat measurement fitting notes material mismatch rework',
        ];
      }
      return [
        `${actor} final approved design revision wrong version rework`,
        `${actor} design reference color size personalization approval`,
        `${actor} misspelled name wrong color custom order problem`,
        `${actor} revision request customer message lost detail repeated work`,
        `${actor} custom commission material waste approval change`,
        `${actor} pickup date delayed order revision workflow`,
        `${actor} sketches photos customer messages final design approval`,
        `${actor} painting instructions personalization proof customer approval`,
        `${actor} custom order wrong specification remake`,
        `${actor} design revision approval record scattered notes`,
        `${actor} color choice item size personalization error`,
        `${actor} final approved version production lock customer change`,
      ];
    }

    if (
      /\b(?:energy providers?|electric utilities?|power utilities?|utility companies?|grid operators?|electricity distributors?|power distribution|electricity distribution|power grid)\b/iu.test(request) &&
      /\b(?:connected meters?|smart meters?|remote monitoring devices?|automated control systems?|device failures?|unusual consumption|consumption anomalies?|network disruptions?|unauthorized access|malicious interference|telemetry|consumption data integrity|incident response)\b/iu.test(request)
    ) {
      return [
        'smart meter anomaly cyberattack or device failure utility operator',
        'electric utility smart meter tampering unauthorized access incident',
        'power distribution iot device failure network disruption',
        'smart meter inaccurate readings cybersecurity incident',
        'energy utility technical fault versus cyber attack root cause',
        'connected meter consumption data integrity security anomaly',
        'smart grid telemetry device health network health incident correlation',
        'utility malicious interference smart meter abnormal consumption investigation',
      ];
    }

    if (
      /\b(?:independent doll restoration specialists?|doll restoration specialists?|doll restorers?|doll restoration studios?|doll restoration workshops?|antique doll restorers?|doll repair specialists?)\b/iu.test(request) &&
      /\b(?:damage photographs?|damage photos?|fabric selections?|replacement parts?|paint matching|restoration notes?|approved restoration|material samples?|completion dates?|incorrect replacements?|mismatched materials?|repeated work|lost details|delayed customer orders?)\b/iu.test(request)
    ) {
      return [
        'doll restoration customer approved repair scope revision mistake',
        'antique doll restoration damage photos replacement parts records',
        'doll restorer fabric selection paint matching customer approval',
        'doll restoration wrong replacement mismatched material rework',
        'doll restoration scattered notes photos material samples lost details',
        'doll repair specialist final approved restoration version customer changes',
        'antique doll restoration parts paint fabric documentation workflow',
        'doll restoration delayed order revision completion date problem',
      ];
    }

    if (
      /\b(?:independent mosaic artists?|mosaic artists?|mosaic makers?|mosaic studios?|mosaic workshops?|custom mosaic|mosaic commissions?)\b/u.test(request) &&
      /\b(?:design references?|tile materials?|color combinations?|dimensions?|installation requirements?|revision requests?|approved version|final approved version|customer approval|incorrect patterns?|wasted materials?|repeated work|customization details?|delayed installations?)\b/u.test(request)
    ) {
      return [
        'mosaic artist client revision wrong pattern rework',
        'custom mosaic customer changed design tile color approval',
        'mosaic commission wrong dimensions installation rework',
        'mosaic maker latest approved design version customer message',
        'mosaic project wasted tile material revision mistake',
        'custom mosaic design reference tile material dimension approval',
        'mosaic installation customer revision missed customization detail',
        'mosaic artist final approved version repeated work delayed installation',
        'mosaic commission color combination dimension client approval problem',
        'custom mosaic sketches photos samples customer messages revision history',
        'mosaic installation design change material waste customer dispute',
        'mosaic project specification version approval completion deadline',
      ];
    }

    if (
      /\b(?:miniature model makers?|model makers?|scale model makers?|miniature makers?|custom miniature commissions?)\b/u.test(request) &&
      /\b(?:scale requirements?|reference images?|material choices?|paint details?|dimensions?|revision requests?|approved version|customer finally approved|incorrect proportions|missed visual details|repeated work|delayed commissions?)\b/u.test(request)
    ) {
      return [
        'miniature model commission customer approved version revision',
        'custom miniature scale specification dimensions mistake rework',
        'model maker reference images paint details missed customer commission',
        'miniature commission material choice revision tracking approval',
        'scale model wrong proportions customer specification remake',
        'miniature maker wrong approved version repeated work wasted material',
        'custom model commission revision request completion deadline delay',
        'miniature painting commission reference image approval paint specification',
        'scale model commission client change wrong version rework',
        'miniature model maker customer approval photos sketches revision history',
        'custom miniature commission materials paint specification deadline problem',
        'model maker incorrect proportions revision customer complaint',
      ];
    }

    if (
      /\b(?:online retailers?|online stores?|e-?commerce|ecommerce merchants?|online merchants?|shopify merchants?|digital retailers?)\b/u.test(request) &&
      /\b(?:profit margins?|margin change|margin erosion|contribution margin|net profit|gross revenue|profitability|campaign profitability|profitable products?|profitable campaigns?)\b/u.test(request) &&
      /\b(?:product discounts?|advertising costs?|ad spend|returns?|refunds?|payment fees?|gateway fees?|shipping expenses?|shipping costs?|fulfillment costs?|customer purchasing behavior|pricing decisions?)\b/u.test(request)
    ) {
      return [
        'ecommerce merchant profit margin hidden advertising shipping fees',
        'online retailer contribution margin discount return payment fee problem',
        'shopify merchant strong sales low profit shipping ad spend returns',
        'ecommerce campaign profitability overspending promotion margin decline',
        'online store net profit gross revenue hidden costs seller discussion',
        'merchant product profitability sku fees fulfillment refund costs',
        'ecommerce pricing decision margin erosion ad spend return rate',
        'retail operator separate systems campaign product profitability problem',
        'seller profit margin payment gateway fees shipping costs discussion',
        'ecommerce contribution margin attribution product campaign cohort',
        'online merchant declining margins despite strong sales',
        'retailer misleading revenue report low performing promotion profit',
      ];
    }

    if (
      /\b(?:logistics companies?|logistics providers?|logistics operators?|third[- ]party logistics|3pl providers?|freight companies?|freight operators?|delivery operators?|parcel carriers?|distribution operators?|supply chain operators?)\b/u.test(request) &&
      /\b(?:operating costs?|operating expenses?|fuel expenses?|fuel costs?|warehouse costs?|warehousing costs?|failed deliveries?|delivery failures?|vehicle maintenance|maintenance costs?|route performance|route profitability|customer penalties?|delivery penalties?|profit margins?|margin erosion|profitability|route planning|pricing decisions?|financial forecasts?|shipment volumes?|delivery volumes?|cost per shipment|cost per delivery)\b/u.test(request) &&
      /\b(?:profit margins?|profitability|margin erosion|operating costs?|operating expenses?|financial forecasts?|pricing decisions?|cost increase|costs increase|become more expensive|reducing profit)\b/u.test(request)
    ) {
      return [
        'logistics company rising delivery costs stable shipment volume fuel warehouse penalties',
        'freight operator profit margin failed deliveries fuel maintenance route performance',
        '3pl operating cost warehouse expense delivery penalty margin erosion',
        'delivery operator cost per shipment route profitability customer penalties',
        'logistics route planning pricing decisions financial forecast operating expenses',
        'freight company stable shipment volume rising fuel maintenance costs',
        'logistics failed delivery penalties warehouse costs reduce profit margin',
        'supply chain operator route vehicle profitability cost attribution',
        'logistics customer penalties failed delivery operating margin problem',
        'warehouse fuel maintenance route cost siloed logistics profitability',
        'delivery pricing decision inaccurate financial forecast logistics operator',
        'cost per shipment route margin warehouse transport expense 3pl',
      ];
    }

    if (
      /\b(?:restaurant delivery platforms?|food delivery platforms?|food delivery apps?|restaurant delivery apps?|online food ordering services?|meal delivery platforms?|restaurant courier platforms?)\b/u.test(request) &&
      /\b(?:suspicious orders?|account takeovers?|account takeover|refund abuse|fraudulent refunds?|promotional abuse|promo(?:tional)? fraud|promo code abuse|payment behavior|device information|device signals?|customer complaints?|security alerts?|false positives?|blocked legitimate (?:users?|customers?)|coordinated abuse)\b/u.test(request)
    ) {
      return [
        'food delivery platform refund abuse account takeover complaints',
        'restaurant delivery suspicious orders promotional abuse fraud',
        'food delivery false positive blocked legitimate customer fraud',
        'restaurant delivery device signals payment behavior risk investigation',
        'food delivery coordinated refund abuse multiple accounts devices',
        'delivery app promo code abuse fraudulent refund account takeover',
        'restaurant delivery security alerts customer complaints fraud review',
        'online food ordering fraud detection false positives refund abuse',
        'food delivery suspicious account device refund pattern',
        'restaurant courier platform promotional abuse legitimate customers',
      ];
    }

    if (
      /\b(?:online retailers?|online stores?|e-?commerce|customer orders?|orders?|shipments?|shipping|deliver(?:y|ies))\b/u.test(request) &&
      /\b(?:fraudulent delivery claims?|false delivery claims?|account misuse|account abuse|account takeover|unauthorized (?:shipping|delivery) (?:information|address) changes?|shipping address changes?|carrier scans?|delivery confirmations?|proof of delivery|refund abuse|lost merchandise|order disputes?|delivery disputes?)\b/u.test(request)
    ) {
      return [
        'ecommerce fraudulent delivery claim proof of delivery dispute',
        'online retailer unauthorized shipping address change account misuse order',
        'order dispute carrier scan warehouse update delivery confirmation mismatch',
        'refund abuse lost merchandise delivery claim ecommerce investigation',
        'account takeover shipping information changed after order placed',
        'carrier scan proof of delivery customer dispute order fraud',
        'warehouse carrier delivery timeline reconstruct disputed ecommerce order',
        'legitimate customer falsely flagged delivery fraud refund dispute',
        'order mutation account access carrier scan dispute investigation',
        'shipping address change after checkout unauthorized account ecommerce',
        'delivery confirmation mismatch warehouse carrier customer claim',
        'online retail refund abuse proof of delivery false positive customer',
      ];
    }

    if (
      /\b(?:shipment|shipments|cargo|supply chain|carriers?|warehouses?|customs)\b/u.test(request) &&
      /\b(?:handover|chain of custody|custody transfer|tampered records?|altered tracking|trusted history|fraudulent delivery claims?|record tampering|shipment provenance|ownership records?)\b/u.test(request)
    ) {
      return [
        'shipment handover tampered tracking record chain of custody dispute',
        'cargo custody transfer carrier warehouse customs record discrepancy',
        'supply chain altered shipment tracking history fraudulent delivery claim',
        'shipment handover verification ownership document provenance problem',
        'carrier warehouse customs conflicting shipment records custody timeline',
        'supply chain record tampering shipment incident traceability',
        'shipment chain of custody missing handover event lost goods dispute',
        'cargo tracking audit trail altered location update responsibility dispute',
        'shipment delivery claim custody record discrepancy investigation',
        'supply chain document tampering carrier handoff audit trail',
        'cargo handover proof missing warehouse customs carrier dispute',
        'shipment provenance location update altered record security incident',
      ];
    }

    if (this.isAcademicStaffingWorkloadRequest(request)) {
      return [
        'faculty workload course assignment overload university',
        'teaching assistant workload scheduling conflict department',
        'university course staffing instructor availability enrollment',
        'academic teaching load allocation faculty inequity',
        'department chair staffing student demand support',
        'higher education fragmented staffing enrollment schedule data',
        'university faculty workload expertise course assignment',
        'teaching assistant staffing shortage delayed student support',
        'academic staff availability scheduling course demand',
        'faculty workload policy course release teaching assignments',
        'university department overloaded instructors course enrollment',
        'academic workload management staff allocation scheduling conflict',
      ];
    }

    if (this.isPetTrainerBehaviorTrackingRequest(request)) {
      return [
        'dog trainer client notes behavior progress sessions',
        'pet trainer owner feedback training history tracking',
        'animal behavior trainer triggers exercises session records',
        'dog training repeated exercises missing session history',
        'pet trainer scattered notes videos messages client progress',
        'dog trainer inconsistent owner instructions behavior plan',
        'animal training progress records forgotten behavioral patterns',
        'pet behavior consultant session notes owner follow up',
        'dog trainer training plan history client communication',
        'pet trainer behavioral triggers routine progress tracking',
        'animal behavior sessions owner feedback record keeping',
        'dog training client records repeated diagnosis exercises',
      ];
    }

    if (this.isDeliveryFuelEmissionsRequest(request)) {
      return [
        'delivery fleet fuel consumption route inefficiency emissions',
        'last mile delivery unnecessary mileage fuel costs traffic',
        'courier fleet route planning emissions failed delivery attempts',
        'delivery companies fuel usage traffic delays carbon emissions',
        'parcel delivery failed attempts extra mileage fuel consumption',
        'last mile route optimization fuel efficiency environmental impact',
        'delivery fleet telematics fuel waste delayed deliveries',
        'fast delivery environmental impact pollution vehicle mileage',
        'delivery company carbon footprint route planning failed deliveries',
        'courier unnecessary mileage diesel fuel emissions traffic',
        'last mile failed delivery attempts fuel waste environmental impact',
        'fleet routing delivery volume fuel consumption emissions study',
      ];
    }

    if (this.isWigMakerSpecificationRequest(request)) {
      return [
        'wig maker client measurements fitting notes revision history',
        'custom wig wrong cap size measurement order adjustment',
        'wig maker hair texture color specification client notes',
        'custom wig approved specification revision chat messages',
        'wig fitting incorrect sizing repeated adjustments material waste',
        'wig maker client order photos handwritten measurements lost',
        'custom wig color mismatch fitting revision delayed order',
        'hairpiece maker customer specifications cap construction fitting history',
        'wig maker outdated client measurements wrong size rework',
        'custom wig revision history approved color texture specification',
        'wig artisan scattered client notes fitting measurements order delay',
        'wig maker material waste repeated fitting adjustment client specification',
      ];
    }

    if (this.isHomeRemoteMedicalDeviceTrustRequest(request)) {
      return [
        'remote patient monitoring medical device false alert malfunction security',
        'home healthcare connected device patient reading device fault unauthorized access',
        'remote monitoring medical device cybersecurity anomaly patient readings',
        'home health IoT telemetry access logs security alert clinical response',
        'remote patient monitoring abnormal reading sensor malfunction false alarm',
        'connected medical device unauthorized access patient data remote monitoring',
        'remote monitoring device security incident clinical alarm correlation',
        'home healthcare clinicians device fault patient deterioration cybersecurity',
        'remote patient monitoring medical device reliability security alert problem',
        'medical IoT remote monitoring device status patient reading access log',
      ];
    }

    if (this.isPianoServiceHistoryRequest(request)) {
      return [
        'piano technician tuning history recurring mechanical problem records',
        'piano tuner handwritten notes service history repeated diagnostics',
        'piano maintenance replaced parts customer preferences follow up records',
        'piano service room humidity condition tuning history maintenance',
        'piano technician forgotten maintenance recommendation repeat visit',
        'piano repair service history unnecessary replacement part problem',
        'piano tuning paper invoice notes service record tracking',
        'piano technician recurring issue previous service notes missing',
        'piano service visit history mechanical diagnosis records',
        'piano tuner customer preference maintenance follow up tracking',
      ];
    }

    if (this.isRestaurantProfitabilityRequest(request)) {
      return [
        'restaurant franchise food cost labor cost margin complaint',
        'multi unit restaurant operators rising supplier prices profit margin',
        'restaurant location profitability waste labor variance problem',
        'restaurant chain prime cost food labor margin pressure',
        'restaurant purchasing waste promotions profit margin problem',
        'restaurant store performance cost drivers margin decline',
        'restaurant operators disconnected sales labor inventory data profitability',
        'restaurant group supplier price increase food waste margin erosion',
        'restaurant location P&L delayed reporting cost problem',
        'restaurant chain financial performance food cost staffing waste',
      ];
    }

    if (this.isPetBoardingCareRequest(request)) {
      return [
        'boarding kennel missed medication staff handoff complaint',
        'pet boarding feeding instructions paper notes mistake',
        'kennel care schedule room assignment pickup confusion',
        'pet hotel owner instructions behavioral notes staff communication',
        'dog boarding feeding medication shift change error',
        'pet boarding facility care task tracking missed instruction',
        'kennel staff verbal instructions medication feeding mistake',
        'boarding facility owner update care notes scheduling problem',
        'pet boarding room assignment pickup time mix up',
        'kennel management paper forms care coordination problem',
      ];
    }
    const publicFiscalOversight =
      /\b(?:public institutions?|government|government agencies?|government departments?|public sector|public administration|ministr(?:y|ies)|municipal|municipality)\b/u.test(request) &&
      /\b(?:public budgets?|public funds?|government spending|public spending|procurement|invoices?|project expenses?|approval histor(?:y|ies)|duplicate payments?|overspending|overpayments?|expenditure|financial management|budget planning|spending patterns?)\b/u.test(request);
    for (const domain of context.selectedDomains.slice(0, 4)) {
      const normalized = domain.name.toLocaleLowerCase();

      if (/\btransportation\b|\bpublic transport\b|\btransit\b/u.test(normalized)) {
        queries.push(
          'public transit ticketing security incident service disruption',
          'transit fare payment anomaly account compromise investigation',
          'bus rail passenger app login anomaly cyberattack incident response',
        );
        continue;
      }
      if (/\benvironment\b|\bsustainability\b/u.test(normalized)) {
        queries.push(
          'waste management collection failure environmental complaint',
          'environmental compliance reporting audit documentation problem',
          'recycling contamination missed collection operational problem',
        );
        continue;
      }
      if (/\blegaltech\b|\blegal technology\b|\blegal\b/u.test(normalized)) {
        queries.push(
          'legal document version control contract management problem',
          'case management missing document deadline legal workflow complaint',
          'compliance workflow manual review delay legal operations',
        );
        continue;
      }
      if (/\bfood\b|\brestaurant/u.test(normalized)) {
        queries.push(
          'restaurant inventory stockout supplier delay food waste problem',
          'restaurant order mistake kitchen workflow customer complaint',
          'food service compliance record audit operational problem',
        );
        continue;
      }
      if (RequestWorkflowIntentProfileUtil.resolve(context.requestDescription ?? '').family === 'CUSTOM_COMMISSION' && /(?:\bglass art\b|\bglass commission\b|\bstained glass\b|\bglass artist\b)/u.test(normalized)) {
        queries.push(
          'glass artist custom commission wrong dimensions revision rework',
          'stained glass commission approved design version mistake',
          'art commission client revision material specification error',
        );
        continue;
      }
      if (/\bmanufactur(?:ing|er|ers)\b|\bfactor(?:y|ies)\b/u.test(normalized)) {
        queries.push(
          'manufacturing scrap material waste quality defect production problem',
          'factory raw material consumption rework scrap production efficiency',
          'manufacturing production loss machine output quality issue',
        );
        continue;
      }
      if (/\bcandle\b/u.test(normalized)) {
        queries.push(
          'candle maker custom order wrong fragrance label problem',
          'candle business custom order personalization mistake rework',
          'candle making customer order notes label scent error',
        );
        continue;
      }
      if (/\bengraving\b|\bengraver\b/u.test(normalized)) {
        queries.push(
          'engraving shop customer artwork revision wrong approved version',
          'custom engraving spelling font placement material mistake',
          'engraver order specification approval rework wasted material',
        );
        continue;
      }
      if (/\bleather\b|\bembroidery\b|\bcraft\b|\bartisan\b/u.test(normalized)) {
        queries.push(
          'custom craft order customer specification mistake rework',
          'handmade business custom order revision wrong material problem',
        );
        continue;
      }
      if (/\bblockchain\b/u.test(normalized)) {
        queries.push(
          'blockchain transaction reverted smart contract provider error',
          'smart contract transaction failed revert reason hardhat',
          'web3 transaction execution reverted alchemy provider error',
          'gas estimation failed smart contract transaction',
        );
        continue;
      }
      if (/\benergy\b/u.test(normalized)) {
        queries.push('electricity power grid outage problem');
        continue;
      }
      if (/\bfinance\b|fintech|accounting/u.test(normalized)) {
        if (publicFiscalOversight) {
          queries.push(
            'public finance duplicate payment procurement invoice reconciliation problem',
            'government expenditure overspending irregular payment audit problem',
            'public budget waste overpayment approval controls problem',
          );
        } else {
          queries.push('finance payment reconciliation cash flow operational problem');
        }
        continue;
      }
      if (/\bgovernment\b/u.test(normalized)) {
        if (publicFiscalOversight) {
          queries.push(
            'government procurement duplicate payment public spending audit finding',
            'public sector budget overspending waste irregular expenditure',
            'government invoice overpayment procurement fraud public funds',
          );
        } else {
          queries.push('government online service delay citizen complaint');
        }
        continue;
      }
      if (/\bagriculture\b/u.test(normalized)) {
        queries.push('farm harvest storage delivery problem');
        continue;
      }
      if (/\blogistics\b/u.test(normalized)) {
        queries.push('shipment tracking delivery delay problem');
        continue;
      }
      if (/\binternet of things\b|\biot\b/u.test(normalized)) {
        queries.push('iot sensor tracking reliability problem');
        continue;
      }
      if (/\breal estate\b|\bproperty\b/u.test(normalized)) {
        queries.push(
          'real estate developer title transfer delay buyer complaint',
          'property management tenant maintenance request delay complaint',
          'landlord tenant lease document approval tracking problem',
        );
        continue;
      }
      if (/\bhr\b|\brecruit/u.test(normalized)) {
        queries.push(
          'recruitment applicant tracking candidate status delay complaint',
          'hiring interview scheduling candidate communication problem',
          'employee onboarding missing documents task handoff problem',
        );
        continue;
      }
      if (/\btourism\b|\btravel\b/u.test(normalized)) {
        queries.push(
          'tourism travel booking itinerary change customer complaint',
          'tour operator booking cancellation refund communication problem',
          'destination management visitor information coordination problem',
        );
        continue;
      }
      if (/\bartificial intelligence\b|^ai$/u.test(normalized)) {
        queries.push('ai anomaly detection false positive operational user complaint', 'ai risk scoring incorrect alert human review problem');
        continue;
      }
      if (/\bcybersecurity\b|\bsecurity\b/u.test(normalized)) {
        queries.push('account access authentication security false positive user problem');
        continue;
      }
      if (/\be-?commerce\b|\bonline marketplace\b/u.test(normalized)) {
        queries.push('online marketplace seller buyer checkout fraud complaint');
        continue;
      }
      if (/\bhealthcare\b|\bhealth care\b/u.test(normalized)) {
        queries.push('healthcare patient scheduling access workflow user complaint');
        continue;
      }
      if (/\bsports?\b|\bfitness\b/u.test(normalized)) {
        queries.push('sports fitness training tracking recovery user complaint');
        continue;
      }

      const compact = domain.name
        .replace(/\s+/gu, ' ')
        .trim()
        .split(/\s+/u)
        .slice(0, 4)
        .join(' ');
      if (compact) {
        queries.push(`${compact} user problem`);
      }
    }

    return [...new Set(queries)].slice(0, this.maximumRecoveryKeywords * 2);
  }

  private buildRequestIntentRecoveryQueries(
    context: IdeaGenerationContext,
  ): string[] {
    const request = context.requestDescription?.trim() ?? '';

    if (this.isAcademicStaffingWorkloadRequest(request)) {
      return [
        'faculty workload course assignment overload university',
        'teaching assistant workload scheduling conflict department',
        'university course staffing instructor availability enrollment',
        'academic teaching load allocation faculty inequity',
        'department chair staffing student demand support',
        'higher education fragmented staffing enrollment schedule data',
        'university faculty workload expertise course assignment',
        'teaching assistant staffing shortage delayed student support',
        'academic staff availability scheduling course demand',
        'faculty workload policy course release teaching assignments',
        'university department overloaded instructors course enrollment',
        'academic workload management staff allocation scheduling conflict',
      ];
    }

    if (this.isPetTrainerBehaviorTrackingRequest(request)) {
      return [
        'dog trainer client notes behavior progress sessions',
        'pet trainer owner feedback training history tracking',
        'animal behavior trainer triggers exercises session records',
        'dog training repeated exercises missing session history',
        'pet trainer scattered notes videos messages client progress',
        'dog trainer inconsistent owner instructions behavior plan',
        'animal training progress records forgotten behavioral patterns',
        'pet behavior consultant session notes owner follow up',
        'dog trainer training plan history client communication',
        'pet trainer behavioral triggers routine progress tracking',
        'animal behavior sessions owner feedback record keeping',
        'dog training client records repeated diagnosis exercises',
      ];
    }

    if (this.isDeliveryFuelEmissionsRequest(request)) {
      return [
        'delivery fleet fuel consumption route inefficiency emissions',
        'last mile delivery unnecessary mileage fuel costs traffic',
        'courier fleet route planning emissions failed delivery attempts',
        'delivery companies fuel usage traffic delays carbon emissions',
        'parcel delivery failed attempts extra mileage fuel consumption',
        'last mile route optimization fuel efficiency environmental impact',
        'delivery fleet telematics fuel waste delayed deliveries',
        'fast delivery environmental impact pollution vehicle mileage',
        'delivery company carbon footprint route planning failed deliveries',
        'courier unnecessary mileage diesel fuel emissions traffic',
        'last mile failed delivery attempts fuel waste environmental impact',
        'fleet routing delivery volume fuel consumption emissions study',
      ];
    }

    if (this.isWigMakerSpecificationRequest(request)) {
      return [
        'wig maker client measurements fitting notes revision history',
        'custom wig wrong cap size measurement order adjustment',
        'wig maker hair texture color specification client notes',
        'custom wig approved specification revision chat messages',
        'wig fitting incorrect sizing repeated adjustments material waste',
        'wig maker client order photos handwritten measurements lost',
        'custom wig color mismatch fitting revision delayed order',
        'hairpiece maker customer specifications cap construction fitting history',
        'wig maker outdated client measurements wrong size rework',
        'custom wig revision history approved color texture specification',
        'wig artisan scattered client notes fitting measurements order delay',
        'wig maker material waste repeated fitting adjustment client specification',
      ];
    }

    if (this.isHomeRemoteMedicalDeviceTrustRequest(request)) {
      return [
        'remote patient monitoring medical device false alert malfunction security',
        'home healthcare connected device patient reading device fault unauthorized access',
        'remote monitoring medical device cybersecurity anomaly patient readings',
        'home health IoT telemetry access logs security alert clinical response',
        'remote patient monitoring abnormal reading sensor malfunction false alarm',
        'connected medical device unauthorized access patient data remote monitoring',
        'remote monitoring device security incident clinical alarm correlation',
        'home healthcare clinicians device fault patient deterioration cybersecurity',
        'remote patient monitoring medical device reliability security alert problem',
        'medical IoT remote monitoring device status patient reading access log',
      ];
    }

    if (this.isPianoServiceHistoryRequest(request)) {
      return [
        'piano technician tuning history recurring mechanical problem records',
        'piano tuner handwritten notes service history repeated diagnostics',
        'piano maintenance replaced parts customer preferences follow up records',
        'piano service room humidity condition tuning history maintenance',
        'piano technician forgotten maintenance recommendation repeat visit',
        'piano repair service history unnecessary replacement part problem',
        'piano tuning paper invoice notes service record tracking',
        'piano technician recurring issue previous service notes missing',
        'piano service visit history mechanical diagnosis records',
        'piano tuner customer preference maintenance follow up tracking',
      ];
    }

    if (this.isRestaurantProfitabilityRequest(request)) {
      return [
        'restaurant chain food labor costs profit margin location performance',
        'multi unit restaurant margin erosion food cost labor waste',
        'restaurant franchise location profitability supplier prices waste',
        'restaurant operators rising ingredient labor costs profit margins',
        'restaurant chain promotion discount impact profit margin',
        'restaurant location P&L food cost labor variance',
        'restaurant waste inventory supplier price margin pressure',
        'multi location restaurant data silos profitability costs',
        'restaurant prime cost food labor profitability comparison locations',
        'restaurant chain purchasing supplier price increases margin decline',
        'restaurant store level profitability food waste staffing costs',
        'restaurant operations financial reporting delayed cost drivers',
      ];
    }

    if (this.isPetBoardingCareRequest(request)) {
      return [
        'pet boarding missed medication feeding instructions staff',
        'boarding kennel shift handoff care instructions mistakes',
        'pet boarding paper records medication feeding scheduling',
        'kennel owner instructions missed feeding medication',
        'pet hotel room assignment pickup scheduling confusion',
        'dog boarding staff communication care notes errors',
        'boarding facility behavioral notes owner update problem',
        'kennel management missed care tasks shift change',
        'pet boarding facility medication error feeding mistake',
        'boarding kennel paper forms verbal instructions care coordination',
        'pet boarding owner request routine tracking staff handoff',
        'kennel room assignment pickup schedule care task confusion',
      ];
    }

    if (
      /\b(?:cities|city governments?|municipalities|municipal governments?|smart cities|urban infrastructure operators?|city infrastructure teams?)\b/iu.test(request) &&
      /\b(?:public buildings?|municipal buildings?|street lighting|streetlights?|charging stations?|ev charging|electric vehicle charging|urban infrastructure)\b/iu.test(request) &&
      /\b(?:electricity demand|energy demand|energy consumption|power demand|peak demand|peak load|high usage|consumption patterns?|energy efficiency)\b/iu.test(request)
    ) {
      return [
        'city electricity demand public buildings street lighting peak load',
        'smart city energy consumption charging stations demand forecast',
        'municipal buildings streetlights weather energy demand',
        'urban infrastructure electricity demand equipment status',
        'city charging station public building peak demand energy efficiency',
        'municipal energy consumption service demand weather correlation',
        'urban energy inefficient consumption overloaded infrastructure',
        'smart city electricity service interruption energy costs',
        'public building energy demand peak load city operations',
        'street lighting charging station electricity demand forecasting',
        'city infrastructure energy use weather service demand',
        'urban energy efficiency public assets demand prediction',
      ];
    }

    if (
      /\b(?:shoemakers?|shoe makers?|shoemaking|shoe making|bespoke shoemakers?|custom shoe makers?|custom footwear|bespoke footwear|handmade shoes?|made[- ]to[- ]measure shoes?|cordwainers?)\b/iu.test(request) &&
      /\b(?:foot measurements?|leather selections?|sole types?|stitching preferences?|fitting notes?|design revisions?|approved specifications?|completion deadlines?|sizing errors?|repeated fittings?|wasted materials?)\b/iu.test(request)
    ) {
      return [
        'bespoke shoemaker customer foot measurements fitting errors',
        'custom shoemaking leather selection sole type specification revision',
        'made to measure shoes wrong sizing repeated fitting client notes',
        'cordwainer custom footwear measurement leather sole approval',
        'handmade shoes stitching preference design revision customer approval',
        'bespoke footwear latest approved specification material mistake rework',
        'custom shoe fitting notes revision history delayed order',
        'shoemaker scattered sketches samples messages final specification',
        'custom footwear sizing error leather mismatch repeated fitting',
        'bespoke shoe order wrong sole stitching revision customer',
        'cordwainer measurement notes material selection delayed completion',
        'handmade shoe maker approved version rework wasted leather',
      ];
    }

    if (
      /\b(?:public transportation|public transport|transit operators?|transit agencies?|digital ticketing|fare systems?|connected vehicles?|passenger applications?)\b/iu.test(request) &&
      /\b(?:unusual login|payment anomal|device behavior|service disruption|cyberattack|cyber attack|cybersecurity|security incident|technical failure|misuse)\w*\b/iu.test(request)
    ) {
      return [
        'public transit ticketing cyber incident unusual login investigation',
        'transit fare payment anomaly passenger account security incident',
        'connected vehicle telemetry security event technical failure correlation',
        'public transport service disruption cyberattack root cause investigation',
        'transit passenger app account takeover login anomaly',
        'bus rail ticketing device anomaly cybersecurity incident response',
        'transportation cyberattack ticketing outage passenger accounts',
        'transit payment fraud security alert false positive investigation',
      ];
    }

    if (
      RequestWorkflowIntentProfileUtil.resolve(request).family === 'CUSTOM_COMMISSION' &&
      /\b(?:glass artists?|glass artisans?|stained glass artists?|glassblowers?|glass studios?|glass art)\b/iu.test(request) &&
      /\b(?:custom commissions?|dimensions?|glass colors?|patterns?|engraving|material choices?|design revisions?|approved versions?|completion deadlines?|customer messages?|sketches?|physical samples?)\b/iu.test(request)
    ) {
      return [
        'glass artist custom commission wrong dimensions client revision',
        'stained glass commission approved design version mistake rework',
        'glass art custom order engraving color specification missed',
        'glass studio client revisions sketches messages material waste',
        'art commission client revision wrong version repeated work',
        'custom artisan commission dimensions material choices approval problem',
        'commission artist client sign off latest design version mistake',
        'handmade custom commission revision tracking material waste',
      ];
    }

    if (
      /\b(?:costume rental shops?|costume rentals?|costume shops?|costume hire|wardrobe rentals?)\b/iu.test(request) &&
      /\b(?:customer measurements?|reserved outfits?|accessories|alteration requests?|return dates?|garment condition|special event requirements?|double reservations?|delayed pickups?)\b/iu.test(request)
    ) {
      return [
        'costume rental double booking wrong size customer',
        'costume shop missing accessories reservation problem',
        'costume rental customer measurements alteration request mistake',
        'costume rental return date damaged garment tracking',
        'formalwear rental measurement fitting wrong size',
        'tuxedo rental alteration reservation pickup delay',
        'dress rental double booking return condition problem',
        'clothing rental missing accessories wrong reservation',
        'theatrical costume inventory missing accessories tracking',
        'theater wardrobe costume alteration fitting tracking',
        'wardrobe rental damaged item return date problem',
        'formalwear rental reserved outfit unavailable customer',
        'costume hire booking size mismatch delayed pickup',
        'theatrical wardrobe garment condition damage tracking',
        'dress rental measurement alteration double reservation',
      ];
    }

    if (
      /\b(?:public institutions?|government|government agencies?|government departments?|public sector|public administration|ministr(?:y|ies)|municipal|municipality)\b/iu.test(request) &&
      /\b(?:public budgets?|public funds?|government spending|public spending|procurement|procurement records?|invoices?|project expenses?|approval histor(?:y|ies)|duplicate payments?|overspending|overpayments?|expenditure|financial management|budget planning|spending patterns?)\b/iu.test(request)
    ) {
      return [
        'government procurement duplicate payments public funds audit',
        'public sector duplicate invoice overpayment audit findings',
        'government overspending irregular expenditure budget waste',
        'public procurement fraud suspicious payments approval history',
        'government project expenses cost overruns public budget audit',
        'public spending anomaly duplicate vendor payment detection',
        'government invoice reconciliation duplicate payment problem',
        'public funds waste procurement overpayment investigation',
        'audit identifies duplicate payments government departments',
        'public sector financial controls irregular spending departments',
        'government procurement invoice approval fraud detection',
        'AI public expenditure anomaly detection duplicate payments',
        'machine learning government spending fraud risk scoring',
        'public budget overspending early warning analytics',
      ];
    }

    if (
      /\b(?:municipal governments?|municipalities|city governments?|city councils?|public works|local authorities?)\b/iu.test(request) &&
      /\b(?:roads?|streetlights?|street lights?|public spaces?|city infrastructure|public infrastructure|maintenance requests?|citizen complaints?|inspection reports?|repair histories?|maintenance spending|asset prioritization)\b/iu.test(request)
    ) {
      return [
        'city road repair delays maintenance costs complaints',
        'municipal public works maintenance backlog citizen complaints',
        'streetlight repair requests delayed city maintenance',
        'city infrastructure repair prioritization maintenance backlog',
        'municipal road maintenance complaints repair spending',
        'public works road repairs delayed costs city budget',
        'city maintenance requests inspections repair history prioritization',
        'municipal infrastructure urgent repairs lower priority spending',
        'citizen complaints road streetlight repairs delayed',
        'city council road repair backlog maintenance budget',
        'public infrastructure maintenance prioritization complaints inspections',
        'municipal asset maintenance road delays repeated complaints',
        'smart city infrastructure predictive maintenance prioritization',
        'AI municipal maintenance request prioritization public works',
        'machine learning city infrastructure repair priority complaints',
      ];
    }

    if (
      /\b(?:tourist destinations?|tourism destinations?|tourism authorities?|tourism boards?|visitors?|tourists?|attractions?|transportation hubs?|public spaces?)\b/iu.test(request) &&
      /\b(?:crowding|overcrowd|congestion|visitor movement|event schedules?|transportation updates?|local service capacity|waiting times?|visitor experience|city resources?)\w*\b/iu.test(request)
    ) {
      return [
        'tourism overcrowding attractions long waiting times visitor experience',
        'tourist destination crowding transport hub congestion service capacity',
        'tourism surge overcrowding public spaces destination management',
        'visitor congestion attraction crowd management transport updates',
        'overtourism overcrowded attractions city resource pressure',
        'tourist hub crowding queues public transport capacity problem',
        'destination overcrowding service quality visitor complaints',
        'tourism crowd prediction event schedule transport capacity',
        'smart city tourism visitor flow congestion management',
        'AI tourism congestion prediction visitor movement public spaces',
        'machine learning tourist crowd forecasting transport hubs',
        'tourism peak demand overcrowding local services resource allocation',
      ];
    }

    if (
      (/\b(?:leather craft workshops?|leather workshops?|leatherworkers?|leather artisans?|embroidery businesses?|embroidery shops?|embroidery workshops?|embroiderers?|custom embroidery|screen printing shops?|woodworking shops?|woodworking workshops?|woodworkers?|craft workshops?|craft studios?|artisan workshops?|maker studios?)\b/iu.test(request) ||
        (/\b(?:independent|small|custom|local)?\s*[\p{L}\p{N}'’-]+(?:\s+[\p{L}\p{N}'’-]+){0,3}\s+(?:craft\s+)?(?:workshops?|shops?|studios?|businesses?)\b/iu.test(request) &&
          /\b(?:custom orders?|commissions?|materials?|design revisions?|approved specifications?|artwork|engraving|stitching|thread colors?|placement instructions?|hardware selections?)\b/iu.test(request))) &&
      /\b(?:custom orders?|product dimensions?|customer artwork|leather types?|thread colors?|garment sizes?|stitching styles?|hardware selections?|engraving details?|placement instructions?|design revisions?|approved specifications?|order quantities?|completion deadlines?)\b/iu.test(request)
    ) {
      const actor = RequestDynamicQueryUtil.extractActor(request) || 'custom craft workshop';
      return [
        `${actor} custom order wrong specification revision`,
        `${actor} final approved design version mistake`,
        `${actor} customer artwork revision scattered messages`,
        `${actor} wrong material missed customization rework`,
        `${actor} dimensions measurement order mistake`,
        `${actor} hardware stitching engraving instructions missed`,
        `${actor} handwritten notes customer changes delayed order`,
        `${actor} approved specification version control problem`,
        `${actor} custom commission order tracking material waste`,
        `${actor} customer messages sketches samples order mismatch`,
        `${actor} design revision missed deadline repeated work`,
        `${actor} customization details wrong material wasted supplies`,
      ];
    }
    if (/\b(?:cake decorators?|cake decorating|custom cake decorators?|home bakers?|independent bakers?|cake artists?|custom cake businesses?|bakery decorators?)\b/iu.test(request) && /\b(?:custom orders?|design references?|flavors?|flavours?|allergy notes?|allergies|dietary requirements?|cake dimensions?|decoration details?|pickup times?|last[- ]minute revisions?)\b/iu.test(request)) {
      return [
        'cake decorator missed customer revision wrong design',
        'custom cake allergy note forgotten order mistake',
        'home baker customer details scattered messages rework',
        'wedding cake last minute design change pickup delay',
        'cake decorator wrong flavor dimensions wasted ingredients',
        'custom cake approved design version mistake remake',
        'bakery custom order dietary requirement communication error',
        'cake artist customer photo reference revision lost',
        'custom baker order notes chat messages missed change',
        'cake decorating customer specification mistake delayed order',
        'wedding cake allergy dietary requirement order error',
        'cake decorator repeated work outdated customer request',
        'custom cake design approval revision tracking problem',
        'home baker pickup time revision customer miscommunication',
        'cake order wasted ingredients missed design change',
      ];
    }

    if (/\b(?:property managers?|building managers?|maintenance teams?|residential complexes?|apartment complexes?|housing complexes?|residential buildings?|apartment buildings?)\b/iu.test(request) && /\b(?:temperature|humidity|water usage|water consumption|air quality|equipment readings?|sensor readings?|environmental performance|environmental monitoring|abnormal conditions?|water waste|iot|internet of things|telemetry)\b/iu.test(request)) {
      return [
        'property manager building temperature humidity sensor monitoring problem',
        'residential complex water usage leak detection maintenance delay',
        'apartment building indoor air quality monitoring maintenance team',
        'property management scattered environmental sensor readings abnormal conditions',
        'building manager water waste humidity air quality equipment readings',
        'residential building IoT environmental monitoring delayed maintenance',
        'multi family property environmental performance sensor data',
        'apartment complex abnormal temperature humidity water use maintenance',
      ];
    }

    if (/\b(?:property investment companies?|property investors?|property management companies?|property managers?|asset managers?|rental properties?|real estate portfolios?|landlords?)\b/iu.test(request) && /\b(?:rental income|maintenance expenses?|operating expenses?|vacancy trends?|vacancy rates?|financing costs?|mortgage|interest rates?|local market changes?|financial performance|profitability|return estimates?|cash flow|net operating income|\bnoi\b)\b/iu.test(request)) {
      return [
        'property investor rental income maintenance vacancy financing profitability',
        'rental property cash flow mortgage interest maintenance vacancy problem',
        'real estate portfolio NOI expenses vacancy declining returns',
        'property manager unexpected expenses lower cash flow return',
        'rental property financing costs vacancy inaccurate return estimate',
        'property investment local market rent change profitability risk',
        'landlord operating expenses maintenance vacancy lower profit',
        'real estate asset financial performance rent expenses vacancy data silos',
        'property investor cash flow maintenance financing cost decision',
        'rental portfolio declining performance unexpected expense vacancy',
        'property management separate rent expense vacancy records performance',
        'real estate investment return forecast mortgage maintenance vacancy',
        'property profitability analysis local market rent financing',
        'rental asset NOI decline maintenance vacancy financing',
        'property investor delayed response declining property performance',
      ];
    }

    if (/\b(?:commercial buildings?|office buildings?|office complexes?|facility teams?|facility managers?|building operators?|building managers?)\b/iu.test(request) && /\b(?:electricity|energy consumption|utility bills?|smart meters?|heating|hvac|elevators?|lighting|office equipment|consumption spikes?|abnormal usage|energy waste|equipment downtime)\b/iu.test(request)) {
      return [
        'commercial building electricity spike high utility bill facility manager',
        'smart meter abnormal building energy usage equipment fault',
        'hvac heating electricity consumption anomaly commercial facility',
        'elevator lighting office equipment energy waste building',
        'building energy readings separate systems delayed diagnosis',
        'facility equipment power anomaly downtime early warning',
        'building energy management abnormal consumption operator complaint',
        'commercial property energy monitoring equipment inefficiency case',
        'building submeter anomaly utility cost equipment failure',
        'facility manager unexpected electricity consumption technical problem',
        'building automation energy anomaly detection operational issue',
        'office building energy waste equipment runtime problem',
      ];
    }

    if (/\b(?:calligraphy artists?|calligraphers?|lettering artists?|custom stationery artists?)\b/iu.test(request) && /\b(?:custom orders?|commissions?|wording|lettering styles?|paper selections?|ink preferences?|revision requests?|approved versions?|delivery deadlines?)\b/iu.test(request)) {
      return [
        'calligraphy commission wrong wording missed revision client complaint',
        'calligrapher custom order approved version tracking mistake',
        'custom stationery artist client revision scattered messages',
        'commissioned artwork latest approved design version rework',
        'freelance artist commission client instructions lost dm notes',
        'custom lettering paper ink waste outdated revision',
        'art commission revisions approval version control client',
        'illustrator commission missed client change repeated work',
        'commissioned artist scattered client messages deadline delay',
        'custom design order wrong version material waste',
        'stationery designer revision approval mistake client order',
        'freelance creative commission project revisions lost notes',
      ];
    }

    if (!context.requestDescription?.trim()) {
      return [];
    }

    const domainNames = new Set(
      context.selectedDomains.map((domain) =>
        domain.name.toLocaleLowerCase().replace(/\s+/gu, ' ').trim(),
      ),
    );
    const issueSignal =
      /\b(?:access|alerts?|alteration\w*|anomal\w*|approval\w*|appointment\w*|assignment\w*|bill\w*|breach\w*|burnout|conflict\w*|cost\w*|delay\w*|delivery\w*|dispute\w*|electricity|energy|expense\w*|fabric\w*|fail\w*|fitting\w*|forgotten|fraud\w*|friction|gas|hiring|incident\w*|inefficien\w*|instruction\w*|inventory\w*|license\w*|measurement\w*|missing|order\w*|outage\w*|permit\w*|preference\w*|record\w*|recruit\w*|refrigeration|risk\w*|schedule\w*|security|spike\w*|suspicious|task\w*|threat\w*|turnover|utility|ventilation|verification\w*|waste\w*|workload|errors?|unable|cannot|sync\w*|device\w*|equipment\w*|asset\w*|firmware|unauthorized|outdated|technician\w*|parts?|pickup|notes?|repair\w*|status|maintenance|location|availability|booking\w*|reservation\w*|deposit\w*|accessor(?:y|ies)|return dates?|double booking\w*|utilization|tracking|treatment|condition|restoration|rehabilitation|recovery|injury|reinjury|pain|mobility|return[- ]to[- ]play|water quality|feeding|filter replacement|visit history)\b/iu;
    const genericPhrase =
      /\b(?:coherent cross-domain workflow|management decision support|platform|system|software|application|workflow)\b/iu;

    const descriptionPhrases = context.requestDescription
      .split(/[.!?;,]/u)
      .map((value) => value.replace(/\s+/gu, ' ').trim())
      .filter((value) => value.length >= 8)
      .flatMap((value) => {
        const words = value.split(/\s+/u);
        if (words.length <= 7) return [value];
        const phrases: string[] = [];
        for (let index = 0; index < words.length; index += 4) {
          const phrase = words.slice(index, index + 7).join(' ');
          if (phrase.split(/\s+/u).length >= 3) phrases.push(phrase);
        }
        return phrases;
      });

    const normalizedDescription = context.requestDescription
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/\s+/gu, ' ')
      .trim();
    const contextualQueries: string[] = [];
    const workflowArchetype = RequestWorkflowArchetypeUtil.classify({
      requestDescription: context.requestDescription,
      plannedQueries: context.collectionPlan?.searchQueries ?? [],
      intentConcepts: context.collectionPlan?.intentConcepts ?? [],
      selectedDomainNames: context.selectedDomains.map((domain) => domain.name),
    });
    const workflowIntentProfile = RequestWorkflowIntentProfileUtil.resolve(
      context.requestDescription ?? '',
    );

    if (workflowArchetype.archetype === 'FOOD_STORAGE_CONDITION_OPERATIONS') {
      const actor =
        RequestDynamicQueryUtil.extractActor(context.requestDescription ?? '') ||
        'commercial kitchen';
      contextualQueries.push(
        `${actor} refrigerator temperature food spoilage incident`,
        `${actor} freezer failure ingredient inventory loss`,
        `${actor} ingredient expiration food waste tracking problem`,
        `${actor} cold storage temperature excursion food waste`,
        `${actor} refrigeration maintenance delayed spoilage detection`,
        `${actor} storage condition records fragmented food spoilage`,
      );
    }

    if (workflowArchetype.archetype === 'RESTORATION_CONSERVATION_OPERATIONS') {
      const subject = workflowIntentProfile.restorationSubject ||
        this.extractPhysicalCraftAnchor(context.requestDescription ?? '') ||
        'restoration';
      contextualQueries.push(
        `${subject} conservation condition assessment specifications`,
        `${subject} conservation treatment documentation previous intervention`,
        `${subject} restoration condition previous repairs documentation problem`,
        `${subject} restoration original design details lost records`,
        `${subject} restoration replacement material matching rework`,
        `${subject} conservation condition report missing damage history`,
        `${subject} restoration photographs handwritten notes treatment history`,
        `${subject} restoration material sample mismatch delayed project`,
      );
    }

    if (workflowArchetype.archetype === 'RENTAL_INVENTORY_OPERATIONS') {
      const actor =
        RequestDynamicQueryUtil.extractActor(context.requestDescription ?? '') ||
        'rental shop';
      contextualQueries.push(
        `${actor} double booking availability conflict`,
        `${actor} missing accessories return condition`,
        `${actor} damage inspection maintenance history`,
        `${actor} deposit incorrect charge rental record`,
        `${actor} expected return date overdue servicing`,
        `${actor} rental inventory unavailable maintenance`,
      );
    }

    if (
      workflowArchetype.archetype === 'PHYSICAL_LOCAL_SERVICE_OPERATIONS'
    ) {
      const craftAnchor = this.extractPhysicalCraftAnchor(
        context.requestDescription ?? '',
      );
      if (workflowIntentProfile.family === 'CUSTOM_COMMISSION') {
        contextualQueries.push(
          ...(craftAnchor
            ? [
                `${craftAnchor} custom order customer details mistake`,
                `${craftAnchor} wrong material specification rework`,
                `${craftAnchor} customer revision approved version rework`,
              ]
            : []),
          'custom craft order specification revision material rework',
          'craft business approved customer specification deadline delay',
        );
      } else if (craftAnchor) {
        contextualQueries.push(
          `${craftAnchor} previous service records missing rework`,
          `${craftAnchor} condition notes material mismatch delayed work`,
          `${craftAnchor} customer instructions scattered records mistake`,
          `${craftAnchor} service history repeated inspection wrong material`,
        );
      }
    }

    if (
      workflowArchetype.archetype === 'CONNECTED_ASSET_SECURITY_OPERATIONS'
    ) {
      const manufacturingAssetWorkflow =
        /\b(?:manufacturing|manufacturers?|factory|factories|industrial plants?|production lines?|plant floor|operational technology|\bot\b|industrial control systems?|\bics\b)\b/iu.test(
          normalizedDescription,
        );
      const agriculturalAssetWorkflow =
        /\b(?:farm|farms|agriculture|agricultural|irrigation|greenhouse|livestock)\b/iu.test(
          normalizedDescription,
        );

      contextualQueries.push(
        ...(manufacturingAssetWorkflow
          ? [
              'factory cybersecurity incident production downtime equipment failure',
              'industrial control system security alert production anomaly',
              'operational technology cyberattack machine failure root cause',
              'manufacturing ransomware plant downtime incident response',
              'factory user access logs machine behavior security investigation',
              'plant floor anomaly cyber incident equipment fault correlation',
            ]
          : agriculturalAssetWorkflow
            ? [
                'smart farm sensor connectivity failure monitoring',
                'agricultural iot unauthorized device access incident',
                'irrigation controller network outage equipment failure',
                'farm telemetry security alert device health correlation',
                'connected farm equipment malicious activity network disruption',
                'remote monitoring sensor failure farm operations',
              ]
            : [
                'connected equipment security alert operational failure',
                'iot device anomaly unauthorized access incident response',
                'telemetry device behavior equipment failure security investigation',
                'connected asset network disruption malicious activity problem',
              ]),
      );
    }

    if (
      workflowArchetype.archetype === 'PROFESSIONAL_EVIDENCE_RECORDS_OPERATIONS'
    ) {
      contextualQueries.push(
        'appraiser provenance records scattered documentation problem',
        'ownership history authenticity evidence gaps appraisal',
        'valuation history restoration records inconsistency',
        'chain of custody documentation antique appraisal',
        'provenance research duplicated work conflicting records',
        'professional research source citations scattered archives',
      );
    }

    if (
      workflowArchetype.archetype === 'RESTAURANT_ENERGY_OPERATIONS'
    ) {
      contextualQueries.push(
        'restaurant high utility bill equipment energy use',
        'commercial kitchen refrigeration energy waste problem',
        'restaurant ventilation cooking equipment energy cost',
        'commercial kitchen equipment consumption spike',
        'restaurant energy monitoring operating hours waste',
        'kitchen energy efficiency utility cost equipment',
      );
    }

    if (
      workflowArchetype.archetype === 'RESIDENTIAL_CLEANING_OPERATIONS'
    ) {
      contextualQueries.push(
        'house cleaning business missed client instructions',
        'residential cleaning recurring appointments scheduling conflict',
        'cleaners room specific instructions forgotten requests',
        'cleaning business employee assignments supplies schedule changes',
        'house cleaning messaging notes missed tasks',
        'residential cleaning inconsistent service customer preferences',
      );
    }

    if (this.isHomeRemoteMedicalDeviceTrustRequest(normalizedDescription)) {
      contextualQueries.push(
        'remote patient monitoring medical device malfunction abnormal reading',
        'home healthcare connected device unauthorized access security alert',
        'medical IoT patient telemetry device status cybersecurity correlation',
        'remote monitoring false alarm sensor fault patient condition',
        'connected medical device access logs patient data breach remote care',
        'remote patient monitoring device reliability security incident clinical response',
      );
    }

    if (
      !this.isHomeRemoteMedicalDeviceTrustRequest(normalizedDescription) &&
      /\b(?:hospital|hospitals|healthcare|biomedical engineering|clinical engineering|medical)\b/iu.test(normalizedDescription) &&
      /\b(?:medical equipment|equipment tracking|device tracking|asset tracking|equipment location|maintenance status|equipment availability|device availability|utilization|departmental movement|storage rooms?|operating rooms?)\b/iu.test(normalizedDescription)
    ) {
      contextualQueries.push(
        'hospital staff searching for medical equipment',
        'medical equipment unavailable operating room delay',
        'hospital equipment location tracking departments',
        'hospital medical device maintenance status availability',
        'medical equipment utilization hospital inventory',
        'hospital asset tracking unnecessary equipment purchases',
      );
    }

    if (
      /\b(?:art restoration workshops?|art restoration|art conservation|conservation workshops?|conservation studios?|art conservators?|painting restoration|artifact conservation)\b/iu.test(normalizedDescription)
    ) {
      contextualQueries.push(
        'art conservator condition report documentation problem',
        'art restoration treatment records scattered notes photographs',
        'conservation workshop previous repairs treatment history missing',
        'art conservator materials used treatment documentation',
        'art restoration client instructions deadline tracking',
        'conservation studio restoration stages record keeping',
      );
    }

    if (
      workflowArchetype.archetype ===
      'ENTERPRISE_POLICY_COMPLIANCE_OPERATIONS'
    ) {
      contextualQueries.push(
        'hr outdated employee handbook policy version control problem',
        'employment leave rules conflicting departments compliance risk',
        'hr repeated employee policy questions manual document review',
        'corporate policy regulatory changes not updated across departments',
        'hr legal contract policy comparison inconsistent decisions',
        'enterprise policy document synchronization compliance workflow problem',
      );
    }

    const genericFacetRecoveryQueries = RequestDynamicQueryUtil.build({
      requestDescription: context.requestDescription,
      intentConcepts: context.collectionPlan?.intentConcepts ?? [],
      evidenceTargets: context.collectionPlan?.evidenceTargets ?? [],
      maxQueries: this.maximumRecoveryKeywords * 2,
    });

    const paymentFraudWorkflow =
      /\b(?:marketplace|marketplaces|e[- ]?commerce|checkout|purchase|purchases|transaction|transactions|payment|payments)\b/iu.test(
        normalizedDescription,
      ) &&
      /\b(?:fraud|fraudulent|chargeback|chargebacks|account takeover|account takeovers|payment dispute|payment disputes|suspicious|risk signals?|false decline|blocked legitimate|legitimate customers?)\b/iu.test(
        normalizedDescription,
      );
    if (paymentFraudWorkflow) {
      contextualQueries.push(
        'payment fraud legitimate customer falsely blocked',
        'chargeback account takeover marketplace checkout risk',
        'suspicious transaction fraud signals reviewed separately',
      );
    }

    const photographyStudioWorkflow =
      /\b(?:photography studio|photography studios|photo studio|photo studios|professional photographer|commercial photographer|portrait studio|photography|photo shoot|photoshoot)\b/iu.test(
        normalizedDescription,
      ) &&
      /\b(?:client bookings?|shot lists?|editing requests?|equipment preparation|camera gear|image selections?|photo selections?|delivery deadlines?|location details?|shoot schedule|session schedule)\b/iu.test(
        normalizedDescription,
      );
    if (photographyStudioWorkflow) {
      contextualQueries.push(
        'photography studio booking shot list client request',
        'photographer equipment checklist forgotten gear',
        'editing requests image selection delivery deadline',
      );
    }

    const crossBorderAgreementWorkflow =
      /\b(?:cross[- ]border|international payments?|business agreements?|contract terms?|contractual conditions?|settlements?)\b/iu.test(
        normalizedDescription,
      ) &&
      /\b(?:payments?|settlements?|contracts?|agreements?|approvals?|verification documents?|reconciliation|disputes?|transaction records?)\b/iu.test(
        normalizedDescription,
      );
    if (crossBorderAgreementWorkflow) {
      contextualQueries.push(
        'cross border payment settlement contract dispute',
        'contract conditions approval payment reconciliation',
        'agreement verification documents transaction mismatch',
      );
    }

    const laundryOperationsWorkflow =
      /\b(?:laundry shop|laundry shops|laundromat|laundromats|dry cleaning|dry-cleaning|dry cleaner|dry cleaners|garment cleaning|wash and fold)\b/iu.test(
        normalizedDescription,
      ) &&
      /\b(?:garments?|stains?|cleaning instructions?|pickup|deadlines?|additional treatment|paper tags?|lost garments?|incorrect cleaning|delayed orders?|customer disputes?)\b/iu.test(
        normalizedDescription,
      );
    if (laundryOperationsWorkflow) {
      contextualQueries.push(
        'laundry lost garment tracking problem',
        'dry cleaning special instructions stain treatment missed',
        'laundry pickup deadline delayed order customer dispute',
      );
    }

    const legalDocumentWorkflow =
      /\b(?:regulations?|contracts?|applications?|case[- ]related documents?|legal documents?|rules?|requirements?|compliance)\b/iu.test(
        normalizedDescription,
      ) &&
      /\b(?:search|compare|check|missing|inconsisten|delay|stored across|multiple systems|follow the correct rules)\w*\b/iu.test(
        normalizedDescription,
      );
    if (legalDocumentWorkflow) {
      contextualQueries.push(
        'legal document compliance missing requirements review',
        'regulation contract application requirements hard to compare',
        'case documents inconsistencies discovered late',
      );
    }

    const customFootwearWorkflow =
      /\b(?:shoemakers?|shoe makers?|shoemaking|shoe making|bespoke shoemakers?|custom shoe makers?|custom footwear|bespoke footwear|handmade shoes?|made[- ]to[- ]measure shoes?|cordwainers?)\b/iu.test(
        normalizedDescription,
      ) &&
      /\b(?:foot measurements?|leather selections?|sole types?|stitching preferences?|fitting notes?|design revisions?|approved specifications?|completion deadlines?|sizing errors?|repeated fittings?|wasted materials?)\b/iu.test(
        normalizedDescription,
      );
    const wardrobeWorkflow =
      !customFootwearWorkflow &&
      /\b(?:wardrobe|closet|clothes|clothing|shoes|accessories|outfits?)\b/iu.test(
        normalizedDescription,
      ) &&
      /\b(?:remember|inventory|fit|cleaning|repair|photos?|receipts?|duplicate purchases?|unused items?|weather|occasion)\b/iu.test(
        normalizedDescription,
      );
    if (customFootwearWorkflow) {
      contextualQueries.push(
        'bespoke shoemaker foot measurements fitting errors',
        'custom footwear leather sole stitching specification revision',
        'made to measure shoes repeated fittings wrong sizing',
        'cordwainer client measurements approved specification delay',
        'handmade shoe maker material mismatch revision rework',
        'custom shoe fitting notes customer approval order tracking',
      );
    }

    if (wardrobeWorkflow) {
      contextualQueries.push(
        'wardrobe inventory forget clothes duplicate purchases',
        'closet cleaning repair status hard to track',
        'outfit planning weather occasion wardrobe problem',
      );
    }

    const buildingEnvironmentalMonitoringWorkflow =
      /\b(?:property managers?|building managers?|maintenance teams?|residential complexes?|apartment complexes?|housing complexes?|residential buildings?|apartment buildings?)\b/iu.test(normalizedDescription) &&
      /\b(?:temperature|humidity|water usage|water consumption|air quality|equipment readings?|sensor readings?|environmental performance|environmental monitoring|abnormal conditions?|water waste|iot|internet of things|telemetry)\b/iu.test(normalizedDescription);
    if (buildingEnvironmentalMonitoringWorkflow) {
      contextualQueries.push(
        'property manager building temperature humidity sensor monitoring problem',
        'residential complex water usage leak detection maintenance delay',
        'apartment building indoor air quality monitoring maintenance team',
        'property management environmental sensor readings abnormal conditions',
        'building manager water waste humidity air quality equipment readings',
        'residential building IoT environmental monitoring delayed maintenance',
      );
    }

    const tailoringOperationsWorkflow =
      /\b(?:tailor|tailors|tailoring|alteration shop|alteration shops|clothing alteration|custom apparel|bespoke clothing|bespoke tailoring)\b/iu.test(normalizedDescription) &&
      /\b(?:customer measurements?|requested changes?|alteration requests?|fitting dates?|fitting appointments?|fabric details?|payment status|collection times?|promised collection|paper receipts?|lost garments?|incorrect alterations?|repeated fittings?|delayed orders?)\b/iu.test(normalizedDescription);
    if (tailoringOperationsWorkflow) {
      contextualQueries.push(
        'tailor shop lost measurements alteration order tracking',
        'alteration shop paper receipt fitting collection delay',
        'tailor wrong alteration request fabric notes missing',
      );
    }

    const restaurantSupplyChainWorkflow =
      /\b(?:restaurant|restaurants|food delivery|food service|commercial kitchen|kitchen managers?|procurement)\b/iu.test(normalizedDescription) &&
      /\b(?:ingredient shortages?|inventory|supplier deliveries?|demand forecast|demand estimates?|food waste|stockouts?|emergency purchases?|menu items?)\b/iu.test(normalizedDescription);
    if (restaurantSupplyChainWorkflow) {
      contextualQueries.push(
        'restaurant ingredient stockout supplier delivery delay',
        'restaurant inventory demand forecast food waste problem',
        'restaurant emergency ingredient purchase inventory mismatch',
      );
    }

    const manufacturingSupplyChainWorkflow =
      /\b(?:manufacturing|manufacturer|manufacturers|factory|factories|production line|production lines|production planner|production planners|industrial plant|industrial plants)\b/iu.test(normalizedDescription) &&
      /\b(?:raw materials?|supplier deliveries?|supplier updates?|supply chain|inventory|warehouse|warehouses|shipment|shipments|production schedules?|demand changes?|demand forecast|bottlenecks?|order prioritization|stock)\b/iu.test(normalizedDescription);
    if (manufacturingSupplyChainWorkflow) {
      contextualQueries.push(
        'manufacturing raw material delay production shutdown bottleneck',
        'factory inventory mismatch production schedule supplier delay',
        'manufacturing demand change excess inventory order prioritization',
      );
    }

    const locksmithDispatchWorkflow =
      /\b(?:locksmith|locksmiths|lock service|lock services|field service|mobile service)\b/iu.test(normalizedDescription) &&
      /\b(?:dispatch|technician|technicians|service requests?|emergency calls?|locations?|tools?|replacement parts?|parts inventory|job assignment|availability|repeated trips?|payment status)\b/iu.test(normalizedDescription);
    if (locksmithDispatchWorkflow) {
      contextualQueries.push(
        'locksmith delayed dispatch technician availability emergency calls',
        'locksmith repeated trips missing tools wrong replacement parts',
        'locksmith phone dispatch job details mobile inventory problem',
      );
    }

    const urbanEnergyDemandWorkflow =
      /\b(?:cities|city governments?|municipalities|municipal governments?|smart cities|urban infrastructure operators?|city infrastructure teams?)\b/iu.test(
        normalizedDescription,
      ) &&
      /\b(?:public buildings?|municipal buildings?|street lighting|streetlights?|charging stations?|ev charging|electric vehicle charging|urban infrastructure)\b/iu.test(
        normalizedDescription,
      ) &&
      /\b(?:electricity demand|energy demand|energy consumption|power demand|peak demand|peak load|high usage|consumption patterns?|energy efficiency)\b/iu.test(
        normalizedDescription,
      );
    if (urbanEnergyDemandWorkflow) {
      contextualQueries.push(
        'city electricity demand public buildings street lighting peak load',
        'smart city charging stations energy demand forecast weather',
        'municipal building energy consumption equipment status',
        'urban infrastructure overloaded electricity demand service interruption',
        'city energy efficiency public assets consumption patterns',
        'street lighting ev charging peak demand municipal energy',
      );
    }

    const municipalDeviceSecurityWorkflow =
      /\b(?:smart cit(?:y|ies)|municipal|city technology|traffic lights?|parking sensors?|public cameras?|environmental monitors?)\b/iu.test(
        normalizedDescription,
      ) &&
      /\b(?:security|unauthorized|outdated|compromised|device behavior|firmware|connected devices?|iot|security standards?)\b/iu.test(
        normalizedDescription,
      );
    if (municipalDeviceSecurityWorkflow) {
      contextualQueries.push(
        'municipal iot unauthorized devices security visibility',
        'smart city sensors outdated firmware security problem',
        'city connected devices unusual behavior incident',
      );
    }

    const musicalInstrumentRepairWorkflow =
      /\b(?:musical instruments?|instrument repair|repair shop|luthier|guitar|violin|piano)\b/iu.test(
        normalizedDescription,
      ) &&
      /\b(?:repair|technician|replacement parts?|paper tags?|pickup|repair progress|repair status|notes?)\b/iu.test(
        normalizedDescription,
      );
    if (musicalInstrumentRepairWorkflow) {
      contextualQueries.push(
        'piano technician tuning history recurring mechanical problem records',
        'piano tuner service history replaced parts maintenance recommendation',
        'piano service handwritten notes repeated diagnostics follow up',
        'musical instrument technician prior service notes unnecessary replacement parts',
        'piano room humidity condition tuning maintenance history',
        'instrument service customer preferences follow up visit records',
      );
    }

    const shoeRepairWorkflow =
      /\b(?:shoe repair shop|shoe repair shops|cobbler|cobblers|cobbler shop|cobbler shops)\b/iu.test(normalizedDescription);
    if (shoeRepairWorkflow) {
      contextualQueries.push(
        'shoe repair shop lost paper ticket misplaced shoes',
        'cobbler wrong repair instructions technician notes complaint',
        'shoe repair delayed pickup collection date order tracking',
      );
    }

    const academicSecurityWorkflow =
      /\b(?:school|schools|university|universities|learning platform|learning platforms|lms|online assessment|online assessments|online exam|online exams)\b/iu.test(normalizedDescription) &&
      /\b(?:security|suspicious|login records?|account takeover|academic misuse|academic integrity|anomal|false positive|security alerts?)\w*\b/iu.test(normalizedDescription);
    if (academicSecurityWorkflow) {
      const academicActor =
        RequestDynamicQueryUtil.extractActor(context.requestDescription ?? '')
          .replace(/\s+/gu, ' ')
          .trim() || 'education institution';
      contextualQueries.push(
        `${academicActor} learning platform suspicious login account takeover incident`,
        `${academicActor} unauthorized administrative account student record access investigation`,
        `${academicActor} examination platform account compromise security alert investigation`,
        `${academicActor} legitimate staff account false positive access restriction`,
      );
    }

    const candidates: string[] = [
      ...(context.collectionPlan?.searchQueries ?? []),
      ...genericFacetRecoveryQueries,
      ...descriptionPhrases,
      ...contextualQueries,
      ...context.keywords,
    ]
      .filter((value): value is string => typeof value === 'string')
      .map((value) => this.sanitizeRecoveryQuery(value))
      .filter((value) => this.isSemanticallyUsefulRecoveryQuery(value, context))
      .filter((value) => value.length >= 5 && value.length <= 80)
      .filter((value) => value.split(/\s+/u).length >= 2)
      .filter((value) => !domainNames.has(value.toLocaleLowerCase()))
      .filter((value) => !genericPhrase.test(value))
      .map((value, index) => ({
        value,
        index,
        score:
          (issueSignal.test(value) ? 4 : 0) +
          (value.split(/\s+/u).length <= 5 ? 2 : 0) +
          (/[&+/]/u.test(value) ? -1 : 0),
      }))
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .map((entry) => entry.value);

    return Array.from(new Set<string>(candidates)).slice(
      0,
      this.maximumRecoveryKeywords * 3,
    );
  }


  /**
   * Removes sentence-fragment artifacts before a recovery query is sent to an
   * external source. Sliding windows over requester prose used to emit queries
   * such as "and delayed investigations" or "to detect suspicious activity".
   * Recovery queries now have to start with a material actor/object/problem
   * token and contain at least two semantic terms.
   */
  private isSemanticallyUsefulRecoveryQuery(
    value: string,
    context: IdeaGenerationContext,
  ): boolean {
    const query = value.toLocaleLowerCase().replace(/\s+/gu, ' ').trim();
    if (!query) return false;

    const request = context.requestDescription?.trim() ?? '';
    if (!request) return true;
    if (RequestNicheCustomCraftUtil.isSafeExpandedRetrievalQuery(request, query)) {
      return true;
    }
    if (!RequestWorkflowIntentProfileUtil.isTemplateQueryCompatible(request, query)) {
      return false;
    }
    if (!RequestQueryProvenanceUtil.isQueryGrounded({ requestDescription: request, query })) {
      return false;
    }

    const tokens = query.split(/\s+/u).filter(Boolean);
    const genericOnly = new Set([
      'delay', 'delayed', 'delays', 'project', 'projects', 'problem', 'problems',
      'issue', 'issues', 'work', 'rework', 'repeated', 'lost', 'details', 'failure',
      'failures', 'workflow', 'user', 'users', 'independent', 'document',
    ]);
    if (tokens.length <= 3 && tokens.every((token) => genericOnly.has(token))) {
      return false;
    }

    // "specialists ... document" is commonly a parser artifact from the verb
    // phrase "specialists struggle to document", not a professional search noun.
    if (
      /\b(?:specialists?|providers?|businesses?|workshops?|independent)\b.*\bdocument\b/u.test(query) &&
      !/\b(?:documentation|documented|records?|history|notes?|condition|treatment|repair)\b/u.test(query)
    ) {
      return false;
    }

    const identityTerms = RequestDynamicQueryUtil.extractEvidenceIdentityTerms(request)
      .map((term) => term.toLocaleLowerCase());
    const workflowTerms = RequestDynamicQueryUtil.extractWorkflowTerms(request)
      .map((term) => term.toLocaleLowerCase());
    const painTerms = RequestDynamicQueryUtil.extractPainTerms(request)
      .map((term) => term.toLocaleLowerCase());
    const queryTokenSet = new Set(tokens);
    const overlaps = (term: string): boolean =>
      term.split(/\s+/u).filter(Boolean).some((token) => queryTokenSet.has(token));
    const identityOverlap = identityTerms.filter(overlaps).length;
    const workflowOverlap = workflowTerms.filter(overlaps).length;
    const painOverlap = painTerms.filter(overlaps).length;

    const strictWorkflowIdentity =
      RequestEvidenceAlignmentUtil.requiresStrictWorkflowIdentity({
        requestDescription: request,
        plannedQueries: context.collectionPlan?.searchQueries ?? [],
      });
    if (strictWorkflowIdentity) {
      const semanticAxisCount = [
        identityOverlap >= 1,
        workflowOverlap >= 1,
        painOverlap >= 1,
      ].filter(Boolean).length;

      /*
       * Strict text-derived workflows must not spend recovery calls on fragments
       * such as "login activity", "delayed projects", or "trace suspicious
       * changes quickly". Require a real actor/object identity plus a workflow
       * or pain axis, or an unusually strong workflow+pain combination.
       */
      if (tokens.length < 4) return false;
      if (semanticAxisCount < 2) return false;
      if (identityOverlap === 0 && !(workflowOverlap >= 2 && painOverlap >= 1)) {
        return false;
      }
    }

    return identityOverlap >= 1 || workflowOverlap + painOverlap >= 2;
  }

  private sanitizeRecoveryQuery(value: string): string {
    let cleaned = value
      .normalize('NFKC')
      .replace(/\s+/gu, ' ')
      .trim()
      .replace(
        /^(?:(?:and|or|but|to|of|for|from|with|without|into|across|between|while|when|where|which|that|this|these|those|because|so)\s+)+/iu,
        '',
      )
      .replace(/\bwhile\b[\s\S]*$/iu, ' ')
      .replace(/^(?:protect|protecting|maintain|maintaining|allow|allowing)\s+/iu, '')
      .replace(
        /^(?:can\s+)?(?:lead|leads|leading)(?:\s+to)?\s+|^(?:can cause|cause|causes|causing|result in|results in|making it difficult to|difficult to)\s+/iu,
        '',
      )
      .replace(/^(?:it|they|them|their|its)\s+/iu, '')
      .replace(
        /\s+(?:and|or|but|while|with|without|to|for|of|from|by|because)$/iu,
        '',
      )
      .replace(/\s+/gu, ' ')
      .trim();

    if (!cleaned) return '';

    // Collapse an immediately repeated 2-5 word phrase emitted when domain and
    // requester prefixes are composed twice (e.g. "private healthcare providers
    // private healthcare providers protect ...").
    for (let width = 5; width >= 2; width -= 1) {
      const tokens = cleaned.split(/\s+/u);
      if (tokens.length < width * 2) continue;
      for (let start = 0; start + width * 2 <= tokens.length; start += 1) {
        const left = tokens.slice(start, start + width).join(' ').toLocaleLowerCase();
        const right = tokens.slice(start + width, start + width * 2).join(' ').toLocaleLowerCase();
        if (left !== right) continue;
        tokens.splice(start + width, width);
        cleaned = tokens.join(' ');
        break;
      }
    }
    const compactTokens = cleaned.split(/\s+/u).filter(Boolean);
    const normalizedIdentity = (token: string): string => {
      const normalized = token
        .toLocaleLowerCase()
        .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      if (normalized.length <= 4) return normalized;
      if (/ies$/u.test(normalized) && normalized.length > 5) {
        return `${normalized.slice(0, -3)}y`;
      }
      if (/s$/u.test(normalized) && !/ss$/u.test(normalized) && normalized.length > 5) {
        return normalized.slice(0, -1);
      }
      return normalized;
    };
    const compacted: string[] = [];
    let previousIdentity = '';
    for (const token of compactTokens) {
      const identity = normalizedIdentity(token);
      if (identity && identity === previousIdentity) continue;
      compacted.push(token);
      previousIdentity = identity;
    }
    cleaned = compacted.join(' ').trim();

    const semanticTokens = cleaned
      .toLocaleLowerCase()
      .split(/\s+/u)
      .filter(Boolean)
      .filter(
        (token) =>
          !new Set([
            'and', 'or', 'but', 'to', 'of', 'for', 'from', 'with', 'without',
            'the', 'a', 'an', 'in', 'on', 'at', 'by', 'this', 'that', 'these',
            'those', 'it', 'its', 'they', 'their', 'them',
          ]).has(token),
      );
    return semanticTokens.length >= 2 ? cleaned : '';
  }

  /**
   * Produces phrases that resemble how users actually describe failures.
   *
   * These are intentionally short and concrete. Search engines and community
   * APIs match "bus arrival data not updating" more reliably than synthetic
   * combinations such as "transportation inaccurate".
   */
  private buildNaturalComplaintQueries(
    domainTerm: string,
    domainKeywords: readonly string[],
  ): string[] {
    const normalizedDomain = domainTerm.toLowerCase();
    const smartCityQueries = [
      'parking status is wrong',
      'bus arrival data not updating',
      'street light outage not showing',
      'cannot submit municipal complaint',
      'public service request stuck',
      'traffic data is inaccurate',
      'city app missing service',
      'parking app not working',
    ];
    const transportationQueries = [
      'bus arrival time is wrong',
      'route planner gives wrong route',
      'trip tracking not updating',
      'fare payment failed',
      'vehicle profile missing',
      'public transport app not working',
    ];
    const logisticsQueries = [
      'delivery status not updating',
      'driver cannot complete delivery',
      'route assignment is wrong',
      'proof of delivery missing',
      'shipment tracking inaccurate',
      'warehouse picking error',
    ];

    const tailoringQueries = [
      'tailor shop lost customer measurements',
      'custom clothing order details missing',
      'alteration request history hard to find',
      'fitting appointment scheduling problem',
      'fabric selection order tracking',
      'returning customer measurements missing',
    ];
    const salonQueries = [
      'salon double booking appointment problem',
      'stylist availability scheduling conflict',
      'salon client preferences lost between employees',
      'salon product inventory waste',
      'salon loyalty history missing',
      'salon special requests not shared',
    ];
    const paymentFraudQueries = [
      'payment fraud detection false positive',
      'suspicious transaction legitimate customer blocked',
      'transaction fraud alert triage',
      'account behavior transaction risk scoring',
      'fraud detection false decline payment',
      'payment security alerts analyzed separately',
    ];
    const petCareQueries = [
      'family missed pet vaccination appointment',
      'pet grooming appointment forgotten',
      'pet feeding routine inconsistent family',
      'pet care history hard to share veterinarian',
      'pet sitter missing care instructions',
      'shared pet care records scattered messages',
    ];
    const eventPlanningQueries = [
      'wedding vendor booking conflict',
      'event venue photographer schedule conflict',
      'wedding guest list catering changes lost',
      'event budget unexpected vendor expenses',
      'last minute wedding vendor changes confusion',
      'event planning information scattered messages spreadsheets',
    ];
    const hospitalEquipmentQueries = [
      'hospital staff cannot find medical equipment',
      'medical equipment unavailable when needed hospital',
      'hospital equipment location tracking problem',
      'medical device maintenance status not visible',
      'hospital equipment underused duplicate purchases',
      'operating room delayed waiting for equipment',
    ];
    const artRestorationQueries = [
      'art conservator condition records scattered notes photos',
      'art restoration treatment history missing',
      'conservation workshop materials documentation problem',
      'restoration client instructions missed',
      'art restoration deadline tracking problem',
      'conservator previous repair records hard to find',
    ];
    const remotePatientMonitoringQueries = [
      'remote patient monitoring after discharge missed deterioration',
      'home care vital signs multiple devices monitoring',
      'post discharge patient alerts delayed intervention',
      'remote patient monitoring readmission risk',
      'clinical staff alert overload remote monitoring',
      'home health patient telemetry review problem',
    ];
    const sportsPerformanceQueries = [
      'athlete overtraining detection wearable data',
      'training load monitoring recovery injury risk',
      'coach combine wearable fitness equipment data',
      'athlete recovery metrics multiple devices',
      'sports performance dashboard training intensity alerts',
      'wearable workout data integration coaching problem',
    ];
    const funeralMemorialQueries = [
      'funeral service scheduling coordination problem',
      'memorial planning family requests missed',
      'funeral home guest communication coordination',
      'burial preferences documents service providers scattered',
      'funeral floral transportation scheduling conflict',
      'memorial arrangements duplicated family coordination',
    ];
    const governmentRecordQueries = [
      'permit approval status hard to trace',
      'license processing delay departments',
      'official record versions conflict departments',
      'cross department document verification problem',
      'ownership record verification dispute',
    ];
    const cybersecurityQueries = [
      'account login authentication failed user review',
      'two factor authentication unavailable login problem',
      'security alert false positive legitimate user blocked',
      'password reset account recovery not working',
      'identity access locked out account support problem',
      'cybersecurity app missing security feature request',
    ];

    const blockchainTransactionQueries = [
      'transaction reverted without reason smart contract hardhat',
      'provider error transaction reverted web3 alchemy',
      'smart contract transaction status failed debug revert reason',
      'execution reverted solidity transaction failed logs',
      'gas estimation failed cannot estimate gas smart contract',
      'blockchain transaction failed hardhat goerli provider error',
    ];

    const intentText = domainKeywords.join(' ').toLowerCase();
    const hasPaymentFraudIntent =
      /\b(?:fraud|fraudulent|suspicious transaction|transaction risk|false positive|false-positive|legitimate (?:customer|user|transaction)|payment fraud|account behavior|fraud alert)\b/iu.test(
        intentText,
      );
    const hasHospitalEquipmentIntent =
      /\b(?:medical equipment|medical device|equipment tracking|device tracking|asset tracking|equipment location|maintenance status|equipment availability|device availability|biomedical|clinical engineering|hospital equipment|utilization)\b/iu.test(intentText);
    const hasArtRestorationIntent =
      /\b(?:art restoration|art conservation|conservator|condition documentation|treatment history|previous repair|restoration stage|client instructions|materials used)\b/iu.test(intentText);

    const knownQueries =
      hasHospitalEquipmentIntent &&
      /(?:healthcare|logistic|internet of things|medical|hospital)/u.test(normalizedDomain)
        ? hospitalEquipmentQueries
        : hasArtRestorationIntent ||
            /(?:art restoration|art conservation|conservation)/u.test(normalizedDomain)
          ? artRestorationQueries
          : hasPaymentFraudIntent &&
      /(?:finance|cybersecurity|artificial intelligence)/u.test(normalizedDomain)
        ? paymentFraudQueries
        : normalizedDomain.includes('beauty') || normalizedDomain.includes('salon')
          ? salonQueries
        : normalizedDomain.includes('smart cit')
        ? smartCityQueries
        : normalizedDomain.includes('transport')
          ? transportationQueries
          : normalizedDomain.includes('logistic')
            ? logisticsQueries
            : normalizedDomain.includes('tailor') ||
                normalizedDomain.includes('custom apparel')
              ? tailoringQueries
              : normalizedDomain.includes('pet care') ||
                  normalizedDomain.includes('animal care')
                ? petCareQueries
                : normalizedDomain.includes('event planning') ||
                    normalizedDomain.includes('wedding')
                  ? eventPlanningQueries
                  : normalizedDomain.includes('funeral') ||
                      normalizedDomain.includes('memorial')
                    ? funeralMemorialQueries
                    : normalizedDomain.includes('sports') ||
                        normalizedDomain.includes('fitness')
                      ? sportsPerformanceQueries
                      : normalizedDomain.includes('healthcare') ||
                          normalizedDomain.includes('home care')
                        ? remotePatientMonitoringQueries
                        : normalizedDomain.includes('cybersecurity') ||
                          normalizedDomain.includes('cyber security')
                          ? cybersecurityQueries
                        : normalizedDomain.includes('blockchain') ||
                            normalizedDomain.includes('web3')
                          ? blockchainTransactionQueries
                        : normalizedDomain.includes('government') ||
                          normalizedDomain.includes('legaltech')
                      ? governmentRecordQueries
                      : [];

    const usefulDomainTerms = domainKeywords
      .map((value) => value.toLowerCase().replace(/\s+/gu, ' ').trim())
      .filter((value) => value.length >= 4)
      .filter(
        (value) =>
          !/\b(?:platform|system|software|application|dashboard|analytics|management|optimization|integration)\b/iu.test(
            value,
          ),
      )
      .slice(0, 2);

    return [
      ...knownQueries,
      ...usefulDomainTerms.flatMap((term) => [
        `${term} not working`,
        `${term} data is wrong`,
        `cannot use ${term}`,
      ]),
      `${domainTerm} user complaint`,
    ];
  }

  /** Derives safe descriptor queries from the currently selected opportunity. */
  private buildOpportunityTerms(
    domainTerm: string,
    selectedOpportunity: RankedIdeaOpportunity | null,
  ): string[] {
    if (!selectedOpportunity) {
      return [];
    }

    const descriptors = [
      selectedOpportunity.title,
      selectedOpportunity.problem,
      selectedOpportunity.need,
      selectedOpportunity.solutionArea,
    ]
      .filter((value): value is string => Boolean(value?.trim()))
      .map((value) =>
        value
          .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
          .replace(/\s+/gu, ' ')
          .trim(),
      )
      .filter((value) => value.length >= 5)
      .map((value) => value.split(' ').slice(0, 8).join(' '))
      .slice(0, 2);

    return descriptors.flatMap((descriptor) => [
      `${descriptor} complaint`,
      `${descriptor} review`,
      `${descriptor} not working`,
      `${domainTerm} ${descriptor}`,
    ]);
  }

  /** Collects primary evidence so recovered paraphrases cannot be recounted. */
  private collectPrimaryEvidenceSamples(
    context: IdeaGenerationContext,
    selectedOpportunity: RankedIdeaOpportunity | null,
  ): string[] {
    const samples = [
      ...this.readTextEntries(context.nlp?.samplePosts ?? null),
      ...this.readTextEntries(context.nlp?.sampleComments ?? null),
      ...(context.communityAiAnalysis?.opportunities.flatMap(
        (opportunity) => opportunity.evidenceSamples,
      ) ?? []),
      ...(selectedOpportunity?.evidenceSamples ?? []),
    ];

    return this.deduplicateEvidenceSamples(samples);
  }

  /** Collects evidence references produced by the supplemental recovery pass. */
  private collectRecoveredEvidenceSamples(
    nlp: IdeaGenerationNlpContext,
    analysis: CommunityAiAnalysis | null,
  ): string[] {
    return this.deduplicateEvidenceSamples([
      ...this.readTextEntries(nlp.samplePosts),
      ...this.readTextEntries(nlp.sampleComments),
      ...(analysis?.opportunities.flatMap(
        (opportunity) => opportunity.evidenceSamples,
      ) ?? []),
    ]).filter((sample) => this.looksLikeUsableProblemEvidence(sample));
  }

  /** Gives Community AI the novel recovered corpus before emergency fallback. */
  private async analyzeRecoveredEvidenceWithCommunityAi(
    context: IdeaGenerationContext,
    nlp: IdeaGenerationNlpContext,
    provenanceEvidence: readonly RecoveredExternalEvidence[],
    novelEvidenceSamples: readonly string[],
  ): Promise<CommunityAiAnalysis | null> {
    if (novelEvidenceSamples.length === 0) return null;

    const evidenceEntries = novelEvidenceSamples.map((text, index) => {
      const provenance = provenanceEvidence.find((item) =>
        this.areEquivalentEvidenceSamples(item.text, text),
      );
      const sourceType = provenance?.sourceType ?? 'POST';
      const sourceKey = provenance?.sourceKey ?? 'recovery';
      const fallbackExternalId =
        provenance?.commentExternalId ??
        provenance?.postExternalId ??
        `${index + 1}`;
      const evidenceId = provenance
        ? this.buildRecoveryEvidenceId(provenance)
        : `${sourceKey}:${sourceType.toLocaleLowerCase()}:${fallbackExternalId}`;

      return {
        text,
        sourceType,
        sourceKey,
        evidenceId,
        provenance,
        sample: {
          id: evidenceId,
          text,
          sentiment: 'NEUTRAL',
        },
      };
    });

    const samplePosts = evidenceEntries
      .filter((entry) => entry.sourceType === 'POST')
      .map((entry) => entry.sample);
    const sampleComments = evidenceEntries
      .filter((entry) => entry.sourceType === 'COMMENT')
      .map((entry) => entry.sample);
    const recoveryContext: IdeaGenerationContext = {
      ...context,
      nlp: {
        ...nlp,
        totalTextsAnalyzed: novelEvidenceSamples.length,
        totalPostsAnalyzed: samplePosts.length,
        totalCommentsAnalyzed: sampleComments.length,
        /*
         * Raw recovery records must not become grounding evidence merely
         * because they were persisted. They are supplied only through
         * rawEvidenceCorpus until Community AI classifies them and the
         * deterministic request/workflow guard verifies that classification.
         */
        recurringProblems: [],
        extractedNeeds: [],
        featureRequests: [],
        opportunities: [],
        samplePosts: [],
        sampleComments: [],
      },
      domainEvidence: [],
      rawEvidenceCorpus: evidenceEntries.map((entry) => ({
        id: entry.evidenceId,
        sourceKey: entry.sourceKey,
        sourceType: entry.sourceType,
        text: entry.text,
        discoveryDomainId: entry.provenance?.discoveryDomainId ?? context.domainId,
        discoveryDomainName: entry.provenance?.discoveryDomainName ?? context.domainName,
        queryIntentId: entry.provenance?.queryIntentId ?? null,
        queryText: entry.provenance?.queryText ?? null,
        problemFacetIds: entry.provenance?.problemFacetIds ?? context.canonicalProblemSpec?.facets.map((facet) => facet.id) ?? [],
        collectionPhase: 'RECOVERY',
        sourceTier: entry.provenance?.sourceTier ?? 'PRIMARY',
      })),
      communityAiAnalysis: null,
    };

    try {
      return await this.communityAiAnalysisService.analyze(recoveryContext, {
        classificationOnly: true,
        maxAttempts: 1,
        requestTimeoutMs: 5_200,
        totalTimeoutMs: 6_200,
      });
    } catch (error: unknown) {
      this.logger.warn(
        `Community AI recovery analysis failed; deterministic emergency recovery remains available. error=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private mergeCommunityAiAttemptIntoRecoveryFallback(
    deterministicFallback: CommunityAiAnalysis | null,
    attemptedAnalysis: CommunityAiAnalysis | null,
  ): CommunityAiAnalysis | null {
    if (!deterministicFallback) return attemptedAnalysis;
    if (!attemptedAnalysis) return deterministicFallback;

    const warning = attemptedAnalysis.aiSucceeded
      ? 'Community AI analyzed the recovered corpus, but no opportunity survived exact recovered-evidence validation; the deterministic emergency fallback was retained.'
      : 'Community AI was attempted on the recovered corpus but did not return an accepted grounded opportunity; the deterministic emergency fallback was retained.';

    return {
      ...deterministicFallback,
      aiAttempted:
        attemptedAnalysis.aiAttempted || attemptedAnalysis.aiSucceeded,
      aiSucceeded: false,
      attemptCount: attemptedAnalysis.attemptCount,
      onlineAttemptCount: attemptedAnalysis.onlineAttemptCount,
      executionFailureCount: attemptedAnalysis.executionFailureCount,
      validationRejectedCount: attemptedAnalysis.validationRejectedCount,
      attemptDiagnostics: attemptedAnalysis.attemptDiagnostics,
      evidenceClassifications: attemptedAnalysis.evidenceClassifications,
      qualityWarnings: [
        ...new Set([
          ...attemptedAnalysis.qualityWarnings,
          ...deterministicFallback.qualityWarnings,
          warning,
        ]),
      ],
      fallbackReason:
        attemptedAnalysis.fallbackReason?.trim() || warning,
    };
  }

  /** Keeps only Community AI opportunities grounded in genuinely new evidence. */
  private filterCommunityAiAnalysisToNovelEvidence(
    analysis: CommunityAiAnalysis | null,
    novelEvidenceSamples: readonly string[],
  ): CommunityAiAnalysis | null {
    if (!analysis || novelEvidenceSamples.length === 0) {
      return null;
    }

    const opportunities = analysis.opportunities
      .map((opportunity) =>
        this.filterCommunityOpportunityEvidence(
          opportunity,
          novelEvidenceSamples,
        ),
      )
      .filter(
        (opportunity): opportunity is CommunityAiOpportunity =>
          opportunity !== null,
      );

    const hasRelevantClassification =
      (analysis.evidenceClassifications ?? []).some(
        (item) =>
          (item.classification === 'DIRECT_PROBLEM' ||
            item.classification === 'SUPPORTING_SIGNAL') &&
          item.verifiedByDeterministicGuard,
      );
    if (opportunities.length === 0 && !hasRelevantClassification) {
      return null;
    }

    return {
      ...analysis,
      opportunities,
      qualityWarnings: [
        ...analysis.qualityWarnings,
        `Targeted recovery contributed ${novelEvidenceSamples.length} new semantically accepted evidence sample(s) pending independent provenance verification.`,
      ],
    };
  }

  private filterCommunityOpportunityEvidence(
    opportunity: CommunityAiOpportunity,
    novelEvidenceSamples: readonly string[],
  ): CommunityAiOpportunity | null {
    const evidenceSamples = opportunity.evidenceSamples.filter((sample) =>
      novelEvidenceSamples.some((novelSample) =>
        this.areEquivalentEvidenceSamples(sample, novelSample),
      ),
    );

    if (evidenceSamples.length === 0) {
      return null;
    }

    const localEvidenceSamples = opportunity.localEvidenceSamples.filter(
      (sample) =>
        evidenceSamples.some((evidenceSample) =>
          this.areEquivalentEvidenceSamples(sample, evidenceSample),
        ),
    );

    return {
      ...opportunity,
      evidenceSamples,
      frequency: evidenceSamples.length,
      localEvidenceSamples,
      localEvidenceAvailable: localEvidenceSamples.length > 0,
    };
  }


  /**
   * Builds an auditable emergency recovery opportunity only after Community AI
   * has been attempted on the novel recovery corpus and no accepted grounded
   * opportunity survives. This is not synthetic market research: every claim is
   * inherited from the previously ranked problem family and every supporting
   * sample is copied from the newly collected corpus. The deterministic
   * ranking and independent-source verifier still decide whether the result is
   * eligible.
   */
  private buildDeterministicRecoveryAnalysis(
    context: IdeaGenerationContext,
    selectedOpportunity: RankedIdeaOpportunity | null,
    novelEvidenceSamples: readonly string[],
  ): CommunityAiAnalysis | null {
    if (!selectedOpportunity || novelEvidenceSamples.length === 0) {
      return null;
    }

    const rawSource =
      selectedOpportunity.raw &&
      typeof selectedOpportunity.raw === 'object' &&
      !Array.isArray(selectedOpportunity.raw) &&
      typeof (selectedOpportunity.raw as Prisma.JsonObject).source === 'string'
        ? String((selectedOpportunity.raw as Prisma.JsonObject).source)
        : null;
    const validationHypothesis =
      rawSource === 'PRIMARY_DOMAIN_VALIDATION_HYPOTHESIS';
    const requestDescription = context.requestDescription?.trim() ?? '';

    const problemDescriptor = [
      selectedOpportunity.problem ?? '',
      selectedOpportunity.need ?? '',
      selectedOpportunity.title,
      selectedOpportunity.solutionArea ?? '',
    ]
      .filter(Boolean)
      .join(' ');

    const verifiedProblemEvidenceCount =
      selectedOpportunity.verifiedProblemMatchedEvidenceCount ?? 0;
    const selectedFamilyKey =
      selectedOpportunity.raw &&
      typeof selectedOpportunity.raw === 'object' &&
      !Array.isArray(selectedOpportunity.raw) &&
      typeof (selectedOpportunity.raw as Prisma.JsonObject).familyKey === 'string'
        ? String((selectedOpportunity.raw as Prisma.JsonObject).familyKey)
        : null;
    const lockRecoveryToSelectedFamily =
      !validationHypothesis &&
      selectedOpportunity.selectionEligible &&
      verifiedProblemEvidenceCount > 0 &&
      Boolean(selectedFamilyKey);

    /*
     * A weak/unverified fallback must never constrain newly collected evidence
     * to its provisional family. Recovery is specifically the point where a
     * stronger family is allowed to replace the weak hypothesis.
     */
    const familyMatchedNovelEvidence = lockRecoveryToSelectedFamily
      ? filterEvidenceByProblemFamily(problemDescriptor, novelEvidenceSamples)
      : [...novelEvidenceSamples];
    const candidateEvidenceSamples = this.deduplicateEvidenceSamples(
      familyMatchedNovelEvidence.filter((sample) =>
        !isLikelyPromotionalEvidence(sample) &&
        (requestDescription
          ? this.isEvidenceAlignedToRequest(sample, context)
          : this.isStrictDomainOnlyRecoveryEvidence(sample, context)),
      ),
    )
      .sort(
        (first, second) =>
          this.scoreRecoveryProblemEvidence(second) -
          this.scoreRecoveryProblemEvidence(first),
      )
      .slice(0, 12);
    if (candidateEvidenceSamples.length === 0) {
      this.logger.debug(
        'Targeted recovery found external text, but no non-promotional problem evidence survived alignment checks.',
      );
      return null;
    }

    /*
     * Recovery candidates must be one coherent problem family. Previously a
     * high-scoring sample could label the opportunity as data loss while the
     * retained evidence array also contained billing guides, generic software
     * marketing, and unrelated access articles. That inflated confidence and
     * forced the verifier to spend time rejecting a semantically mixed bundle.
     * Cluster first, then build the deterministic opportunity from only the
     * strongest coherent family.
     */
    const evidenceSamples = this.selectCoherentRecoveryEvidenceSamples(
      candidateEvidenceSamples,
    );
    if (evidenceSamples.length === 0) {
      return null;
    }

    const rawDomainName = this.readRecoveredDomainName(
      selectedOpportunity,
    );
    const evidenceDerivedProblem = evidenceSamples[0]
      .replace(/^.*?\bCommunity comment:\s*/isu, '')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, 520);
    const selectedDomainDescriptors = context.selectedDomains.map((domain) => ({
      name: domain.name,
      keywords: domain.keywords,
      effectiveSearchKeywords: domain.effectiveSearchKeywords,
    }));
    const primaryEvidenceDomains = SelectedDomainEvidenceAlignmentUtil.matchStrictDomainNames(
      evidenceDerivedProblem,
      selectedDomainDescriptors,
    );
    const aggregateRecoveryDomains = SelectedDomainEvidenceAlignmentUtil.matchStrictDomainNames(
      evidenceSamples.join(' '),
      selectedDomainDescriptors,
    );
    const recoveredFamily = resolvePrimaryProblemFamily(evidenceDerivedProblem);
    const primaryEvidenceDomain = primaryEvidenceDomains.find((name) =>
      this.isRecoveredFamilyCompatibleWithDomain(
        recoveredFamily?.key ?? null,
        name,
      ),
    );
    const aggregateEvidenceDomain = aggregateRecoveryDomains.find((name) =>
      this.isRecoveredFamilyCompatibleWithDomain(
        recoveredFamily?.key ?? null,
        name,
      ),
    );
    const familyCompatibleDomain = this.resolveRecoveredFamilyAffinityDomain(
      recoveredFamily?.key ?? null,
      context.selectedDomains.map((domain) => domain.name),
    );
    const evidenceMatchedDomain =
      primaryEvidenceDomain ?? aggregateEvidenceDomain ?? null;

    if (!requestDescription && !evidenceMatchedDomain) {
      return null;
    }

    const domainName =
      evidenceMatchedDomain ||
      familyCompatibleDomain ||
      context.domainName?.trim() ||
      rawDomainName ||
      'General';
    const recoveredFamilySemantics = recoveredFamily
      ? this.resolveRecoveredFamilySemantics(recoveredFamily.key, recoveredFamily.label, domainName)
      : null;
    const title = validationHypothesis
      ? requestDescription
        ? `${context.collectionPlan?.suggestedDomainName?.trim() || domainName} Evidence-Backed Pilot Opportunity`
        : recoveredFamilySemantics?.title ?? `${domainName} Evidence-Backed Problem Opportunity`
      : recoveredFamilySemantics?.title ?? `${selectedOpportunity.title} — recovered evidence`;
    const problem = validationHypothesis
      ? requestDescription
        ? requestDescription.replace(/\s+/gu, ' ').trim()
        : recoveredFamilySemantics?.problem ?? evidenceDerivedProblem
      : recoveredFamilySemantics?.problem ??
        (selectedOpportunity.problem ||
          selectedOpportunity.need ||
          evidenceDerivedProblem ||
          `Users in ${domainName} encounter a repeated workflow problem.`);
    const unmetNeed =
      recoveredFamilySemantics?.unmetNeed ??
      (selectedOpportunity.need ||
        `A focused workflow that addresses the recovered ${domainName} complaints.`);
    const solutionArea =
      recoveredFamilySemantics?.solutionArea ??
      (selectedOpportunity.solutionArea ||
        'Evidence-led workflow improvement and operational decision support');
    const confidence = Math.min(78, 45 + evidenceSamples.length * 7);

    const opportunity: CommunityAiOpportunity & { readonly familyKey?: string } = {
      ...(recoveredFamily ? { familyKey: recoveredFamily.key } : {}),
      domainName,
      title,
      problem,
      unmetNeed,
      solutionArea,
      affectedUsers: this.resolveRecoveredAffectedUsers(selectedOpportunity),
      evidenceSamples,
      frequency: evidenceSamples.length,
      severity: this.resolveRecoveredSeverity(selectedOpportunity.severity),
      confidence,
      problemImportance: Math.min(82, 55 + evidenceSamples.length * 5),
      localEvidenceAvailable: false,
      localEvidenceSamples: [],
      localRelevance: 20,
      groundingScore: evidenceSamples.some((sample) => {
        const sourceType = /\bCommunity comment:\s*/iu.test(sample)
          ? 'COMMENT'
          : 'POST';
        const kind = classifyDirectCommunityEvidence(sample, sourceType);
        return (
          kind === 'USER_COMPLAINT' ||
          kind === 'FEATURE_REQUEST' ||
          kind === 'OBSERVED_UNMET_NEED'
        );
      })
        ? 88
        : 74,
      technicalFeasibility: 72,
      marketPotential: Math.min(75, 48 + evidenceSamples.length * 4),
      innovationPotential: 58,
      risks: [
        'The recovered evidence must still pass independent-source verification.',
        'The selected location is a deployment target unless explicitly named by the evidence.',
      ],
    };

    const recoveryAlignmentLabel = requestDescription
      ? 'pre-verification request-aligned'
      : 'pre-verification selected-domain-aligned';

    return {
      summary:
        `Targeted recovery retained ${evidenceSamples.length} ${recoveryAlignmentLabel} external evidence sample(s). ` +
        'These samples still require independent provenance and problem-family verification before they can outrank a validation-only hypothesis.',
      dominantProblems: [problem],
      unmetNeeds: [unmetNeed],
      opportunities: [opportunity],
      overallConfidence: confidence,
      qualityWarnings: [
        'Community AI did not yield an accepted grounded opportunity for the recovered corpus; this emergency opportunity was constructed deterministically from newly retained evidence.',
        'Retention is not verification: final eligibility is controlled by independent provenance, semantic-domain alignment, and problem-family verification in ranking.',
      ],
      modelId: null,
      apiModelId: null,
      attemptCount: 0,
      aiAttempted: false,
      aiSucceeded: false,
      fallbackUsed: true,
      onlineAttemptCount: 0,
      executionFailureCount: 0,
      validationRejectedCount: 0,
      fallbackReason:
        'Targeted evidence recovery used a deterministic emergency fallback after the Community AI recovery analysis did not yield an accepted grounded opportunity.',
      attemptDiagnostics: [],
      unvalidatedDomainHypotheses: [],
    };
  }

  private selectCoherentRecoveryEvidenceSamples(
    samples: readonly string[],
  ): string[] {
    const clusters = new Map<
      string,
      Array<{ readonly sample: string; readonly score: number }>
    >();

    for (const sample of samples) {
      const body = sample
        .replace(/^.*?\bCommunity comment:\s*/isu, '')
        .replace(/\s+/gu, ' ')
        .trim();
      if (!body || isLikelyPromotionalEvidence(body)) continue;

      const family = resolvePrimaryProblemFamily(body);
      const key = family?.key ?? `unclassified:${body.slice(0, 96).toLocaleLowerCase()}`;
      const current = clusters.get(key) ?? [];
      current.push({
        sample,
        score: this.scoreRecoveryProblemEvidence(sample),
      });
      clusters.set(key, current);
    }

    const strongest = [...clusters.entries()]
      .map(([familyKey, entries]) => ({
        familyKey,
        entries: [...entries].sort((a, b) => b.score - a.score),
        score:
          entries.reduce((total, entry) => total + entry.score, 0) +
          Math.max(0, entries.length - 1) * 4 +
          (familyKey.startsWith('unclassified:') ? 0 : 3),
      }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.entries.length - a.entries.length,
      )[0];

    if (!strongest) return [];

    return strongest.entries
      .map((entry) => entry.sample)
      .slice(0, 6);
  }

  private isRecoveredFamilyCompatibleWithDomain(
    familyKey: string | null,
    domainName: string,
  ): boolean {
    if (!familyKey) return true;
    const domain = domainName.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

    if (
      familyKey === 'healthcare-preventive-care-reminders' ||
      familyKey === 'medication-adherence-coordination' ||
      familyKey === 'healthcare-treatment-access' ||
      familyKey === 'clinical-sparse-measurements'
    ) {
      return /^(?:healthcare|health care|medical|medicine)$/u.test(domain);
    }
    if (familyKey === 'mental-health-care' || familyKey === 'mental-health-time-access') {
      return /^(?:mental health|behavioral health|behavioural health)$/u.test(domain);
    }
    if (
      familyKey === 'energy-grid-stability-inverter-trip' ||
      familyKey === 'energy-monitor-installation'
    ) {
      return /^(?:energy|utilities|utility|power|electricity)$/u.test(domain);
    }
    return true;
  }

  private resolveRecoveredFamilyAffinityDomain(
    familyKey: string | null,
    domainNames: readonly string[],
  ): string | null {
    if (!familyKey) return null;

    const explicitlyScopedFamily = new Set([
      'healthcare-preventive-care-reminders',
      'medication-adherence-coordination',
      'healthcare-treatment-access',
      'clinical-sparse-measurements',
      'mental-health-care',
      'mental-health-time-access',
      'energy-grid-stability-inverter-trip',
      'energy-monitor-installation',
    ]).has(familyKey);
    if (!explicitlyScopedFamily) return null;

    return (
      domainNames.find((domainName) =>
        this.isRecoveredFamilyCompatibleWithDomain(familyKey, domainName),
      ) ?? null
    );
  }

  private scoreRecoveryProblemEvidence(value: string): number {
    const normalized = value.replace(/\s+/gu, ' ').trim();
    if (!normalized) return -100;

    const sourceType = /\bCommunity comment:\s*/iu.test(normalized)
      ? 'COMMENT'
      : 'POST';
    const body = normalized
      .replace(/^.*?\bCommunity comment:\s*/isu, '')
      .trim();
    const kind = classifyDirectCommunityEvidence(body, sourceType);
    const family = resolvePrimaryProblemFamily(body);

    let score = scoreCommunityEvidenceQuality(body) * 10;
    if (kind === 'USER_COMPLAINT') score += 16;
    if (kind === 'FEATURE_REQUEST') score += 13;
    if (kind === 'OBSERVED_UNMET_NEED') score += 11;
    if (family && !family.key.startsWith('lexical:')) score += 10;
    if (
      kind === 'NONE' &&
      !family &&
      !/\b(?:problem|failure|failed|missing|missed|skipped|overdue|unstable|trip|tripped|understaffed|no support|without support)\b/iu.test(body)
    ) {
      score -= 14;
    }
    if (/\b(?:cannot|can['’]?t|unable|failed|failure|error|missing|missed|delayed|stuck|lost|blocked|not updating|refreshing|copying|jump between|switch between)\b/iu.test(body)) {
      score += 5;
    }
    if (isLikelyPromotionalEvidence(body)) score -= 12;

    return score;
  }

  private resolveRecoveredFamilySemantics(
    familyKey: string,
    familyLabel: string,
    domainName: string,
  ): {
    readonly title: string;
    readonly problem: string;
    readonly unmetNeed: string;
    readonly solutionArea: string;
  } | null {
    if (familyKey === 'delivery-tracking') {
      return {
        title: 'Delivery Tracking and Shipment Visibility Friction',
        problem: 'Delivery Tracking and Shipment Visibility Friction',
        unmetNeed: `Users in ${domainName} need one reliable shipment-visibility workflow that consolidates carrier tracking, status changes, delays, missed deliveries, and exception follow-up without repeated manual checking across disconnected channels.`,
        solutionArea: 'Multi-carrier shipment visibility, tracking-status reconciliation, delivery exception alerts, and human-reviewed resolution',
      };
    }

    if (familyKey === 'energy-grid-stability-inverter-trip') {
      return {
        title: 'Energy Grid Instability and Inverter Trip Resilience Gaps',
        problem: 'Energy Grid Instability and Inverter Trip Resilience Gaps',
        unmetNeed: `Energy operators and distributed-generation teams need a traceable way to detect grid-instability conditions, correlate inverter trip events, preserve outage context, and coordinate human-reviewed restoration without autonomous grid switching.`,
        solutionArea: 'Grid instability monitoring, inverter-trip diagnostics, outage context, and human-reviewed resilience coordination',
      };
    }

    if (familyKey === 'healthcare-preventive-care-reminders') {
      return {
        title: 'Preventive Care Follow-Up and Screening Reminder Gaps',
        problem: 'Preventive Care Follow-Up and Screening Reminder Gaps',
        unmetNeed: `Patients and care teams need a reliable preventive-care follow-up workflow that tracks due screenings and routine checkups, issues traceable reminders, records completion, and escalates overdue items for human review.`,
        solutionArea: 'Preventive-care schedule tracking, screening reminders, overdue follow-up, and completion verification',
      };
    }

    if (familyKey === 'medication-adherence-coordination') {
      return {
        title: 'Medication Adherence and Caregiver Coordination Gaps',
        problem: 'Medication Adherence and Caregiver Coordination Gaps',
        unmetNeed: `Patients and caregivers need a shared medication-adherence workflow that prevents missed or duplicated doses, preserves dose history, coordinates handoffs, and routes uncertainty to human review.`,
        solutionArea: 'Medication schedule coordination, dose-history tracking, missed/duplicate-dose prevention, and caregiver handoff review',
      };
    }

    if (familyKey === 'outage-reliability') {
      return {
        title: familyLabel,
        problem: familyLabel,
        unmetNeed: `Users in ${domainName} need reliable service-status visibility, outage diagnosis, recovery ownership, and verified restoration before interrupted workflows are treated as resolved.`,
        solutionArea: 'Service reliability monitoring, outage triage, recovery coordination, and verified restoration',
      };
    }

    return {
      title: familyLabel,
      problem: familyLabel,
      unmetNeed: `A focused ${domainName} workflow that addresses the recovered ${familyLabel.toLocaleLowerCase()} with traceable evidence and human-reviewed resolution.`,
      solutionArea: `${familyLabel} diagnosis, guided resolution, and pilot validation`,
    };
  }

  /**
   * Reads the domain name from the raw ranked opportunity safely.
   *
   * The raw ranking payload is Prisma JSON and may not contain a usable
   * domainName field.
   */
  private readRecoveredDomainName(
    selectedOpportunity: RankedIdeaOpportunity,
  ): string | null {
    const raw = selectedOpportunity.raw;

    if (
      !raw ||
      typeof raw !== 'object' ||
      Array.isArray(raw)
    ) {
      return null;
    }

    const domainName =
      (raw as Prisma.JsonObject).domainName;

    if (typeof domainName !== 'string') {
      return null;
    }

    const normalizedDomainName = domainName.trim();

    return normalizedDomainName.length > 0
      ? normalizedDomainName
      : null;
  }

  /** Maps ranking severity strings into the strict Community AI contract. */
  private resolveRecoveredSeverity(
    value: string | null,
  ): CommunityAiOpportunity['severity'] {
    const normalized = value?.toUpperCase();
    return normalized === 'LOW' ||
      normalized === 'HIGH' ||
      normalized === 'CRITICAL'
      ? normalized
      : 'MEDIUM';
  }

  /** Preserves known affected-user labels without inventing new personas. */
  private resolveRecoveredAffectedUsers(
    selectedOpportunity: RankedIdeaOpportunity,
  ): string[] {
    const raw = selectedOpportunity.raw;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const value = (raw as Prisma.JsonObject).affectedUsers;
      if (Array.isArray(value)) {
        const users = value
          .filter((entry): entry is string => typeof entry === 'string')
          .map((entry) => entry.replace(/\s+/gu, ' ').trim())
          .filter(Boolean);
        if (users.length > 0) {
          return users.slice(0, 6);
        }
      }
    }

    return [`Users participating in ${selectedOpportunity.title} workflows`];
  }

  /** Prevents old or irrelevant recovery records from entering merged NLP data. */
  private filterNlpContextToNovelEvidence(
    nlp: IdeaGenerationNlpContext,
    novelEvidenceSamples: readonly string[],
  ): IdeaGenerationNlpContext {
    return {
      ...nlp,
      samplePosts: this.filterJsonSamplesToNovelEvidence(
        nlp.samplePosts,
        novelEvidenceSamples,
      ),
      sampleComments: this.filterJsonSamplesToNovelEvidence(
        nlp.sampleComments,
        novelEvidenceSamples,
      ),
      recurringProblems: this.filterJsonCandidatesToNovelEvidence(
        nlp.recurringProblems,
        novelEvidenceSamples,
      ),
      extractedNeeds: this.filterJsonCandidatesToNovelEvidence(
        nlp.extractedNeeds,
        novelEvidenceSamples,
      ),
      featureRequests: this.filterJsonCandidatesToNovelEvidence(
        nlp.featureRequests,
        novelEvidenceSamples,
      ),
      opportunities: this.filterJsonCandidatesToNovelEvidence(
        nlp.opportunities,
        novelEvidenceSamples,
      ),
    };
  }

  private filterJsonSamplesToNovelEvidence(
    value: Prisma.JsonValue | null,
    novelEvidenceSamples: readonly string[],
  ): Prisma.JsonValue | null {
    if (!Array.isArray(value)) {
      return null;
    }

    return value.filter((entry) => {
      const text = this.readTextFromJsonEntry(entry);
      return (
        text.length > 0 &&
        novelEvidenceSamples.some((sample) =>
          this.areEquivalentEvidenceSamples(text, sample),
        )
      );
    });
  }

  private filterJsonCandidatesToNovelEvidence(
    value: Prisma.JsonValue | null,
    novelEvidenceSamples: readonly string[],
  ): Prisma.JsonValue | null {
    if (!Array.isArray(value)) {
      return null;
    }

    return value.filter((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return false;
      }

      const evidenceSamples = Array.isArray(entry.evidenceSamples)
        ? entry.evidenceSamples.filter(
            (sample): sample is string => typeof sample === 'string',
          )
        : [];

      return evidenceSamples.some((sample) =>
        novelEvidenceSamples.some((novelSample) =>
          this.areEquivalentEvidenceSamples(sample, novelSample),
        ),
      );
    });
  }

  private readTextFromJsonEntry(entry: Prisma.JsonValue): string {
    if (typeof entry === 'string') {
      return entry.replace(/\s+/gu, ' ').trim();
    }

    if (
      entry &&
      typeof entry === 'object' &&
      !Array.isArray(entry) &&
      typeof entry.text === 'string'
    ) {
      return entry.text.replace(/\s+/gu, ' ').trim();
    }

    return '';
  }

  private resolveRecoveryOutcome(
    recoveredEvidenceCount: number,
    novelEvidenceCount: number,
  ): EvidenceRecoveryOutcome {
    if (novelEvidenceCount > 0) {
      return 'NEW_INDEPENDENT_EVIDENCE_FOUND';
    }

    return recoveredEvidenceCount > 0
      ? 'RECOVERY_RETURNED_ONLY_EXISTING_EVIDENCE'
      : 'RECOVERY_RETURNED_NO_USABLE_EVIDENCE';
  }

  private deduplicateEvidenceSamples(samples: readonly string[]): string[] {
    const output: string[] = [];

    for (const sample of samples) {
      const normalized = sample.replace(/\s+/gu, ' ').trim();
      if (!normalized) {
        continue;
      }

      if (
        output.some((existing) =>
          this.areEquivalentEvidenceSamples(existing, normalized),
        )
      ) {
        continue;
      }

      output.push(normalized);
    }

    return output;
  }

  /** Exact, containment, and high-overlap checks block paraphrased duplicates. */
  private areEquivalentEvidenceSamples(left: string, right: string): boolean {
    const normalizedLeft = this.normalizeEvidenceSample(left);
    const normalizedRight = this.normalizeEvidenceSample(right);

    if (!normalizedLeft || !normalizedRight) {
      return false;
    }

    if (normalizedLeft === normalizedRight) {
      return true;
    }

    const shorter =
      normalizedLeft.length <= normalizedRight.length
        ? normalizedLeft
        : normalizedRight;
    const longer =
      normalizedLeft.length > normalizedRight.length
        ? normalizedLeft
        : normalizedRight;

    if (shorter.length >= 80 && longer.includes(shorter)) {
      return true;
    }

    const leftTokens = new Set(normalizedLeft.split(' '));
    const rightTokens = new Set(normalizedRight.split(' '));
    const intersection = [...leftTokens].filter((token) =>
      rightTokens.has(token),
    ).length;
    const union = new Set([...leftTokens, ...rightTokens]).size;
    const jaccard = union > 0 ? intersection / union : 0;
    const containment =
      Math.min(leftTokens.size, rightTokens.size) > 0
        ? intersection / Math.min(leftTokens.size, rightTokens.size)
        : 0;

    return jaccard >= 0.82 || containment >= 0.9;
  }

  private normalizeEvidenceSample(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private looksLikeUsableProblemEvidence(value: string): boolean {
    const normalized = value.replace(/\s+/gu, ' ').trim();
    const commentMatch = normalized.match(/\bCommunity comment:\s*(.+)$/iu);
    const evidenceText = commentMatch?.[1]?.trim() ?? normalized;
    const kind = classifyDirectCommunityEvidence(
      evidenceText,
      commentMatch ? 'COMMENT' : 'POST',
    );
    if (
      kind === 'USER_COMPLAINT' ||
      kind === 'FEATURE_REQUEST' ||
      kind === 'OBSERVED_UNMET_NEED'
    ) {
      return true;
    }

    return /\b(?:challenge|problem|issue|failure|failed|delay|delayed|lost|misplaced|forgotten|incorrect|wrong|outdated|unauthorized|unmanaged|compromised|vulnerab|security gap|visibility gap|limited visibility|difficult to identify|hard to identify|cannot identify|unable to identify|fragmented|separate systems?|paper tags?|manual tracking|waiting longer|maintenance complaint|service disruption|anomaly|anomalous|fraud|duplicate|overpayment|overspending|waste|wasted|rework|repeated work|revision mistake|wrong version|missed customization|material error)\w*\b/iu.test(
      evidenceText,
    );
  }

  private isEvidenceAcceptableForRecovery(
    sample: string,
    context: IdeaGenerationContext,
    requestSpecificRecovery: boolean,
  ): boolean {
    if (requestSpecificRecovery) {
      return this.isEvidenceAlignedToRequest(sample, context);
    }

    if (!context.requestDescription?.trim() && context.selectedDomains.length === 0) {
      return true;
    }

    /*
     * Public-finance oversight requests are unusually collision-prone because
     * generic Finance and Government sources contain words such as payment,
     * complaint, delay, budget, or department. For this request family, the
     * relaxed selected-domain recovery lane must still preserve the fiscal
     * workflow (public spending/procurement/duplicate payments/overspending)
     * instead of admitting an unrelated healthcare-finance or citizen-service
     * article merely because it belongs to one selected domain.
     */
    if (this.isPublicFiscalOversightRequest(context.requestDescription)) {
      return this.isEvidenceAlignedToRequest(sample, context);
    }

    if (this.isRestaurantProfitabilityRequest(context.requestDescription)) {
      return (
        this.isEvidenceAlignedToRequest(sample, context) ||
        this.isRestaurantProfitabilityAdjacentEvidence(sample)
      );
    }

    if (this.isPetBoardingCareRequest(context.requestDescription)) {
      return (
        this.isEvidenceAlignedToRequest(sample, context) ||
        this.isPetBoardingAdjacentEvidence(sample)
      );
    }

    if (this.isTransitCyberIncidentRequest(context.requestDescription)) {
      return (
        this.isEvidenceAlignedToRequest(sample, context) ||
        this.isWorkflowAdjacentEvidence(sample, context, 3)
      );
    }

    if (context.requestDescription?.trim()) {
      const selectedDomainAligned = SelectedDomainEvidenceAlignmentUtil.isAligned(
        sample,
        context.selectedDomains.map((domain) => ({
          name: domain.name,
          keywords: domain.keywords,
          effectiveSearchKeywords: domain.effectiveSearchKeywords,
        })),
      );
      if (selectedDomainAligned && this.isWorkflowAdjacentEvidence(sample, context, 2)) {
        return true;
      }
    }

    return this.isStrictDomainOnlyRecoveryEvidence(sample, context);
  }

  private isWorkflowAdjacentSupportingEvidence(
    sample: string,
    context: IdeaGenerationContext,
  ): boolean {
    const requestDescription = context.requestDescription?.trim() ?? '';
    if (!requestDescription) {
      return this.isStrictDomainOnlyRecoveryEvidence(sample, context);
    }

    if (this.isPublicFiscalOversightRequest(requestDescription)) {
      return false;
    }

    if (this.isRestaurantProfitabilityRequest(requestDescription)) {
      return this.isRestaurantProfitabilityAdjacentEvidence(sample);
    }

    if (this.isPetBoardingCareRequest(requestDescription)) {
      return this.isPetBoardingAdjacentEvidence(sample);
    }

    return (
      RequestEvidenceAlignmentUtil.classifyForRequestFallback({
        requestDescription,
        evidenceText: sample,
        plannedQueries: context.collectionPlan?.searchQueries ?? [],
      }) === 'SUPPORTING_SIGNAL'
    );
  }

  private isRestaurantProfitabilityRequest(
    description: string | null | undefined,
  ): boolean {
    const value = description?.trim() ?? '';
    return (
      /\b(?:restaurant chains?|multi[- ]unit restaurants?|restaurant groups?|restaurant franchises?|restaurant locations?)\b/iu.test(value) &&
      /\b(?:profitability|profit margins?|margin erosion|financial performance|ingredient expenses?|ingredient costs?|food costs?|staffing costs?|labor costs?|daily sales|waste records?|supplier prices?|promotions?)\b/iu.test(value)
    );
  }

  private isRestaurantProfitabilityAdjacentEvidence(sample: string): boolean {
    const value = sample.replace(/\s+/gu, ' ').trim();
    if (!value || this.looksDeveloperTechnicalOnly(value)) return false;

    const actor = /\b(?:restaurant chains?|multi[- ]unit restaurants?|restaurant groups?|restaurant franchises?|restaurant operators?|restaurant locations?|food service operators?|franchise operators?|restaurants?)\b/iu.test(value);
    const costOrMargin = /\b(?:profitability|profit margins?|operating margins?|margin compression|margin erosion|food costs?|ingredient costs?|labor costs?|labour costs?|staffing costs?|prime cost|supplier prices?|vendor prices?|food waste|inventory waste|purchasing costs?|cost pressure|rising costs?)\b/iu.test(value);
    const friction = /\b(?:rising|increase|increasing|declining|lower|erosion|variance|spike|waste|inefficient|overspend|overspending|pressure|difficult|hard to identify|unable to identify|fragmented|siloed|separate data|delayed response|profit decline|margin decline)\w*\b/iu.test(value);
    return actor && costOrMargin && friction;
  }

  private isAcademicStaffingWorkloadRequest(
    value: string | null | undefined,
  ): boolean {
    if (!value) return false;
    return /\b(?:universities|university departments?|academic departments?|department chairs?|faculty planners?|academic planners?|higher education)\b/iu.test(value) &&
      /\b(?:instructors?|teaching assistants?|academic support staff|faculty workload|teaching workload|course staffing|course assignments?|student demand|course enrollment|staff availability|scheduling conflicts?|overloaded staff|expertise matching)\b/iu.test(value);
  }

  private isPetTrainerBehaviorTrackingRequest(
    value: string | null | undefined,
  ): boolean {
    if (!value) return false;
    return /\b(?:independent pet trainers?|pet trainers?|dog trainers?|animal trainers?|behavior trainers?|behaviour trainers?|pet behavior consultants?|pet behaviour consultants?)\b/iu.test(value) &&
      /\b(?:behavioral problems?|behavioural problems?|training exercises?|progress between sessions?|owner feedback|triggers?|recommended routines?|training sessions?|behavior history|behaviour history|home practice)\b/iu.test(value);
  }

  private isDeliveryFuelEmissionsRequest(
    description: string | null | undefined,
  ): boolean {
    const value = description?.trim() ?? '';
    return /\b(?:delivery companies?|delivery fleets?|delivery operators?|courier companies?|couriers?|last[- ]mile delivery|parcel delivery|shipping companies?)\b/iu.test(value) &&
      /\b(?:fuel consumption|fuel usage|fuel costs?|emissions?|carbon emissions?|environmental impact|unnecessary mileage|vehicle routes?|traffic conditions?|failed delivery attempts?)\b/iu.test(value);
  }

  private isWigMakerSpecificationRequest(
    description: string | null | undefined,
  ): boolean {
    const value = description?.trim() ?? '';
    return /\b(?:independent wig makers?|wig makers?|custom wig makers?|wig artisans?|wig studios?|hairpiece makers?)\b/iu.test(value) &&
      /\b(?:customer measurements?|hair texture preferences?|color choices?|colour choices?|cap specifications?|styling requests?|fitting notes?|revision history|approved specifications?)\b/iu.test(value);
  }

  private isHomeRemoteMedicalDeviceTrustRequest(
    description: string | null | undefined,
  ): boolean {
    const value = description?.trim() ?? '';
    return /\b(?:home healthcare|home health care|remote patient monitoring|patients? outside hospitals?|home patient monitoring|patient monitoring at home|home monitoring)\b/iu.test(value) &&
      /\b(?:connected medical devices?|medical devices?|wearable devices?|patient readings?|device status|telemetry|access logs?|security alerts?|unauthorized access|device malfunction|sensor malfunction)\b/iu.test(value);
  }

  private isPianoServiceHistoryRequest(
    description: string | null | undefined,
  ): boolean {
    const value = description?.trim() ?? '';
    return /\b(?:piano technicians?|piano tuners?|piano tuning|piano service technicians?|piano repair technicians?)\b/iu.test(value) &&
      /\b(?:tuning history|service history|mechanical problems?|replaced parts?|replacement parts?|customer preferences?|room conditions?|follow[- ]up visits?|maintenance recommendations?|paper invoices?|handwritten notes?|service visits?)\b/iu.test(value);
  }

  private isPetBoardingCareRequest(
    description: string | null | undefined,
  ): boolean {
    const value = description?.trim() ?? '';
    return (
      /\b(?:pet boarding facilities?|boarding kennels?|kennels?|pet hotels?|dog boarding|animal boarding)\b/iu.test(value) &&
      /\b(?:feeding instructions?|medication schedules?|behavioral notes?|behavioural notes?|owner requests?|room assignments?|pickup times?|care routines?|shift handoffs?)\b/iu.test(value)
    );
  }

  private isPetBoardingAdjacentEvidence(sample: string): boolean {
    const value = sample.replace(/\s+/gu, ' ').trim();
    if (!value || this.looksDeveloperTechnicalOnly(value)) return false;

    const actor = /\b(?:pet boarding facilities?|boarding kennels?|kennels?|pet hotels?|dog boarding|animal boarding|pet daycare|dog daycare|veterinary boarding|boarding facility|boarding staff|kennel staff)\b/iu.test(value);
    const workflow = /\b(?:feeding|feeding instructions?|dietary instructions?|medication|medication schedules?|behavioral notes?|behavioural notes?|care notes?|care instructions?|owner instructions?|owner requests?|room assignments?|kennel assignments?|pickup times?|shift handoff|staff handoff|boarding schedule|care tasks?|pet records?)\b/iu.test(value);
    const friction = /\b(?:missed|missing|forgotten|wrong|incorrect|mistake|mix[- ]up|confusion|inconsistent|not updated|handoff failure|scattered|paper forms?|paper notes?|verbal instructions?|miscommunication|delayed|medication error|feeding error|feeding mistake|missed medication|missed feeding|room assignment error)\w*\b/iu.test(value);
    return actor && workflow && friction;
  }

  private isStrictDomainOnlyRecoveryEvidence(
    sample: string,
    context: IdeaGenerationContext,
  ): boolean {
    if (!this.isDomainOnlyRecoveryEvidenceUsable(sample, context)) {
      return false;
    }

    return SelectedDomainEvidenceAlignmentUtil.isStrictlyAlignedForRecovery(
      sample,
      context.selectedDomains.map((domain) => ({
        name: domain.name,
        keywords: domain.keywords,
        effectiveSearchKeywords: domain.effectiveSearchKeywords,
      })),
    );
  }

  private isDomainOnlyRecoveryEvidenceUsable(
    sample: string,
    context: IdeaGenerationContext,
  ): boolean {
    const value = sample.replace(/\s+/gu, ' ').trim();
    if (!value) return false;

    const selectedDomainText = (context.selectedDomains ?? [])
      .map((domain) => domain.name)
      .join(' ')
      .toLocaleLowerCase();
    const explicitlyTechnicalDomain =
      /\b(?:software development|software engineering|developer tools?|programming|devops|cloud computing|web development|mobile development|database|cybersecurity(?: engineering)?)\b/iu.test(selectedDomainText);

    if (this.looksDeveloperTechnicalOnly(value) && !explicitlyTechnicalDomain) {
      return false;
    }

    const metaphorHeavyDeveloperArticle =
      /\b(?:dependency passing|prop drilling|generator runtime|javascript generators?|source code|codebase|repository|github|function layers?|constructor injection|global object|runtime context)\b/iu.test(value) &&
      /\b(?:restaurant analogy|manager|head chef|line cook|prep cook|quartermaster|supply chain)\b/iu.test(value);
    if (metaphorHeavyDeveloperArticle && !explicitlyTechnicalDomain) {
      return false;
    }

    return true;
  }

  private looksDeveloperTechnicalOnly(value: string): boolean {
    const developer = /\b(?:typescript|javascript|node\.js|react|source code|code review|repository|\brepo\b|github|pull request|unit tests?|integration tests?|pytest|bash|shell script|pipestatus|\bgh api\b|\bgh pr\b|sdk|api endpoint|api calls?|command[- ]line|\bcli\b|readme|ansi|fetchwithtimeout|webpack|browser extension|chrome extension|runtime|stack trace|polyfill|global variable|json output flag|composer ux|prompt chips?|mode selector|seo|meta description|title tag|structured data|rich results test|serp|click[- ]through rate|impressions?)\b/iu.test(value);
    const realOperations = /\b(?:restaurant operators?|restaurant locations?|profit margin|food cost|labor cost|supplier price|pet boarding|boarding kennel|kennel staff|feeding instruction|medication schedule|owner instruction|room assignment|shift handoff)\b/iu.test(value);
    return developer && !realOperations;
  }

  private isTransitCyberIncidentRequest(
    description: string | null | undefined,
  ): boolean {
    const value = description?.trim() ?? '';
    return (
      /\b(?:public transportation|public transport|transit operators?|transit agencies?|digital ticketing|fare systems?|connected vehicles?|passenger applications?)\b/iu.test(value) &&
      /\b(?:unusual login|payment anomal|device behavior|service disruption|cyberattack|cyber attack|cybersecurity|security incident|technical failure|misuse)\w*\b/iu.test(value)
    );
  }

  private isWorkflowAdjacentEvidence(
    sample: string,
    context: IdeaGenerationContext,
    minimumSharedSignals: number,
  ): boolean {
    const request = context.requestDescription?.trim() ?? '';
    if (!request) return false;

    const normalizeTokens = (value: string): Set<string> => new Set(
      value
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .split(/\s+/u)
        .map((token) => token.trim())
        .filter((token) => token.length >= 4)
        .filter((token) => !new Set([
          'about', 'after', 'before', 'because', 'different', 'information',
          'digital', 'system', 'systems', 'platform', 'platforms', 'application',
          'applications', 'workflow', 'workflows', 'users', 'often', 'difficult',
          'making', 'which', 'their', 'across', 'separate', 'independent',
        ]).has(token)),
    );

    const requestTokens = normalizeTokens([
      request,
      ...(context.collectionPlan?.intentConcepts ?? []),
    ].join(' '));
    const evidenceTokens = normalizeTokens(sample);
    const shared = [...requestTokens].filter((token) => evidenceTokens.has(token));
    if (shared.length < minimumSharedSignals) return false;

    const workflowSignals = new Set([
      'ticketing', 'transit', 'transportation', 'login', 'payment', 'anomaly',
      'device', 'telemetry', 'disruption', 'cyberattack', 'security', 'incident',
      'commission', 'dimensions', 'dimension', 'scale', 'reference', 'images',
      'paint', 'colors', 'patterns', 'engraving', 'material', 'revision', 'revisions',
      'approved', 'version', 'deadline', 'sketches', 'messages', 'rework', 'waste',
      'shipment', 'cargo', 'handover', 'custody', 'carrier', 'warehouse', 'customs',
      'tampered', 'altered', 'provenance', 'tracking', 'delivery', 'dispute',
      'duplicate', 'overspending', 'procurement', 'invoice', 'budget', 'compliance',
      'inventory', 'supplier', 'contract', 'document', 'audit',
    ]);
    return shared.some((token) => workflowSignals.has(token));
  }

  private isPublicFiscalOversightRequest(
    description: string | null | undefined,
  ): boolean {
    const value = description?.trim() ?? '';
    return (
      /\b(?:public institutions?|government|government agencies?|government departments?|public sector|public administration|ministr(?:y|ies)|municipal|municipality)\b/iu.test(value) &&
      /\b(?:public budgets?|public funds?|government spending|public spending|procurement|procurement records?|invoices?|project expenses?|approval histor(?:y|ies)|duplicate payments?|duplicate invoices?|overspending|overpayments?|expenditure|financial management|budget planning|spending patterns?)\b/iu.test(value)
    );
  }

  private extractPhysicalCraftAnchor(description: string): string | null {
    const normalized = description
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}\s&/'’-]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
    const match = normalized.match(
      /\b(?:independent|small|custom|local)?\s*([\p{L}\p{N}'’-]+(?:\s+[\p{L}\p{N}'’-]+){0,2})\s+(?:makers?|artisans?|artists?|workshops?|shops?|studios?|businesses?)\b/u,
    );
    const value = match?.[1]?.trim();
    if (!value || /^(?:custom|local|small|independent)$/u.test(value)) return null;
    return value.split(/\s+/u).slice(-2).join(' ');
  }

  private isEvidenceAlignedToRequest(
    sample: string,
    context: IdeaGenerationContext,
  ): boolean {
    const description = context.requestDescription?.trim();
    if (!description) return true;

    return RequestEvidenceAlignmentUtil.isAligned({
      requestDescription: description,
      evidenceText: sample,
      plannedQueries: context.collectionPlan?.searchQueries ?? [],
    });
  }

  /** Returns controlled English and Arabic complaint variants per family. */
  private buildFamilyQueries(
    domainTerm: string,
    family: EvidenceRecoveryFamily,
  ): string[] {
    const queries: Record<EvidenceRecoveryFamily, readonly string[]> = {
      PAYWALL_ON_BASIC_CONFIGURATION: [
        `${domainTerm} paywall complaint`,
        `${domainTerm} basic features require subscription`,
        `${domainTerm} premium blocks settings`,
        `${domainTerm} cannot use without paying`,
        `${domainTerm} free tier limitations review`,
        `${domainTerm} subscription blocks country selection`,
        'تطبيق تعليمي يمنع الميزات الأساسية بدون اشتراك',
        'شكوى اشتراك تطبيق تعليمي',
      ],
      RIGID_SUBJECT_TAXONOMY: [
        `${domainTerm} cannot add subject`,
        `${domainTerm} missing university subject`,
        `${domainTerm} subject categories too limited`,
        `${domainTerm} custom subject unavailable`,
        `${domainTerm} psychology subject missing`,
        `${domainTerm} curriculum categories complaint`,
        'تطبيق تعليمي لا يدعم المادة',
        'تصنيف المواد محدود في تطبيق تعليمي',
      ],
      MOBILE_WEB_FEATURE_GAP: [
        `${domainTerm} mobile app missing features`,
        `${domainTerm} app forces website`,
        `${domainTerm} website feature unavailable in app`,
        `${domainTerm} mobile web feature mismatch`,
        `${domainTerm} app feature request review`,
        'تطبيق التعليم لا يحتوي ميزات الموقع',
      ],
      IDLE_SESSION_AUTH_FAILURE: [
        `${domainTerm} login every time complaint`,
        `${domainTerm} session expires repeatedly`,
        `${domainTerm} cannot log back in`,
        `${domainTerm} Face ID missing review`,
        `${domainTerm} Google sign in unavailable`,
        `${domainTerm} authentication failure review`,
        'مشكلة تسجيل الدخول المتكرر تطبيق تعليمي',
      ],
      STORAGE_AND_SYNC_FAILURE: [
        `${domainTerm} data transfer storage complaint`,
        `${domainTerm} SD card phone storage problem`,
        `${domainTerm} sync failure review`,
        `${domainTerm} offline sync not working`,
        `${domainTerm} data lost after sync`,
        `${domainTerm} storage location missing`,
        'مشكلة مزامنة بيانات تطبيق تعليمي',
      ],
      GENERIC_USER_FRICTION: [
        `${domainTerm} app negative reviews`,
        `${domainTerm} app user complaints`,
        `${domainTerm} app not working`,
        `${domainTerm} missing feature review`,
        `${domainTerm} frustrating app experience`,
        `${domainTerm} feature request`,
      ],
    };

    return [...queries[family]];
  }

  /**
   * Detects one or more concrete evidence families from normalized opportunity
   * descriptors. Multiple families are retained when one review contains two
   * distinct dimensions, such as paywall access and subject taxonomy rigidity.
   */
  private detectEvidenceFamilies(
    opportunity: RankedIdeaOpportunity | null,
  ): EvidenceRecoveryFamily[] {
    if (!opportunity) {
      return ['GENERIC_USER_FRICTION'];
    }

    const text = [
      opportunity.title,
      opportunity.problem ?? '',
      opportunity.need ?? '',
      opportunity.solutionArea ?? '',
      ...opportunity.evidenceSamples,
    ]
      .join(' ')
      .toLowerCase();
    const families: EvidenceRecoveryFamily[] = [];

    if (
      /\b(?:paywall|subscription|premium|paid feature|country selection)\b/iu.test(
        text,
      )
    ) {
      families.push('PAYWALL_ON_BASIC_CONFIGURATION');
    }

    if (
      /\b(?:subject categor|taxonomy|curriculum categor|psychology|regional language|discipline)\b/iu.test(
        text,
      )
    ) {
      families.push('RIGID_SUBJECT_TAXONOMY');
    }

    if (
      /\b(?:mobile|website|web portal|transcript|feature parity)\b/iu.test(text)
    ) {
      families.push('MOBILE_WEB_FEATURE_GAP');
    }

    if (
      /\b(?:idle|inactivity|session expired|log back in|authentication error)\b/iu.test(
        text,
      )
    ) {
      families.push('IDLE_SESSION_AUTH_FAILURE');
    }

    if (
      /\b(?:storage|sd card|sync conflict|data transfer|offline sync)\b/iu.test(
        text,
      )
    ) {
      families.push('STORAGE_AND_SYNC_FAILURE');
    }

    return families.length > 0
      ? [...new Set(families)]
      : ['GENERIC_USER_FRICTION'];
  }

  /**
   * Resolves small bounded limits only for targeted recovery. Normal collection
   * limits remain untouched, keeping the supplemental pass inside its latency
   * budget.
   */
  private async withSoftDeadline<T>(
    operation: Promise<T>,
    deadlineMs: number,
    fallback: T,
  ): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<T>((resolve) => {
      timeoutHandle = setTimeout(() => resolve(fallback), deadlineMs);
    });

    try {
      return await Promise.race([operation, timeoutPromise]);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      void operation.catch(() => undefined);
    }
  }

  private isCraftRestorationNicheRequest(requestDescription: string): boolean {
    const text = requestDescription.normalize('NFKC');
    return (
      /\b(?:restoration|restorer|restorers|repair specialist|repair specialists|conservator|conservators|artisan|artisans|maker|makers|atelier|bespoke|custom commission|custom order)\b/iu.test(
        text,
      ) &&
      /\b(?:photographs?|handwritten|physical samples?|material samples?|measurements?|engraving|engravings|finish|finishes|stitching|buckle|decorative details?|previous repairs?|previous modifications?|restoration histor(?:y|ies)|service histor(?:y|ies)|approved choices?|approved specifications?|design revisions?)\b/iu.test(
        text,
      )
    );
  }

  private resolveRecoveryCollectorLimits(
    compact = false,
    requestSpecific = false,
  ): {
    readonly maxFetchedPosts: number;
    readonly maxSavedPosts: number;
    readonly maxFetchedComments: number;
    readonly maxSavedComments: number;
  } {
    if (compact) {
      return {
        maxFetchedPosts: Math.min(
          this.readPositiveConfig('RECOVERY_COMPACT_MAX_FETCHED_POSTS', 6),
          8,
        ),
        maxSavedPosts: Math.min(
          this.readPositiveConfig('RECOVERY_COMPACT_MAX_SAVED_POSTS', 4),
          6,
        ),
        maxFetchedComments: Math.min(
          this.readPositiveConfig('RECOVERY_COMPACT_MAX_FETCHED_COMMENTS', 8),
          12,
        ),
        maxSavedComments: Math.min(
          this.readPositiveConfig('RECOVERY_COMPACT_MAX_SAVED_COMMENTS', 4),
          6,
        ),
      };
    }

    if (requestSpecific) {
      return {
        maxFetchedPosts: Math.min(
          this.readPositiveConfig('RECOVERY_REQUEST_MAX_FETCHED_POSTS', 5),
          7,
        ),
        maxSavedPosts: Math.min(
          this.readPositiveConfig('RECOVERY_REQUEST_MAX_SAVED_POSTS', 3),
          4,
        ),
        maxFetchedComments: Math.min(
          this.readPositiveConfig('RECOVERY_REQUEST_MAX_FETCHED_COMMENTS', 6),
          8,
        ),
        maxSavedComments: Math.min(
          this.readPositiveConfig('RECOVERY_REQUEST_MAX_SAVED_COMMENTS', 3),
          4,
        ),
      };
    }

    return {
      maxFetchedPosts: Math.min(
        this.readPositiveConfig('RECOVERY_MAX_FETCHED_POSTS', 7),
        10,
      ),
      maxSavedPosts: Math.min(
        this.readPositiveConfig('RECOVERY_MAX_SAVED_POSTS', 4),
        6,
      ),
      maxFetchedComments: Math.min(
        this.readPositiveConfig('RECOVERY_MAX_FETCHED_COMMENTS', 8),
        12,
      ),
      maxSavedComments: Math.min(
        this.readPositiveConfig('RECOVERY_MAX_SAVED_COMMENTS', 4),
        6,
      ),
    };
  }

  private readPositiveConfig(key: string, fallback: number): number {
    const value = Number(this.configService.get<unknown>(key));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  }

  /** Counts retained complaint or request entries for monitoring diagnostics. */
  private countComplaintEvidence(nlp: IdeaGenerationNlpContext): number {
    const texts = [
      ...this.readTextEntries(nlp.samplePosts),
      ...this.readTextEntries(nlp.sampleComments),
    ];

    return texts.filter((text) =>
      /\b(?:cannot|can't|unable|blocked|missing|error|failed|failure|problem|issue|doesn't|does not|should|need|request|unavailable|inaccessible|paywall|subscription)\b/iu.test(
        text,
      ),
    ).length;
  }

  /** Extracts text fields from persisted JSON sample arrays safely. */
  private readTextEntries(value: Prisma.JsonValue | null): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => {
        if (typeof entry === 'string') {
          return entry;
        }

        if (
          entry &&
          typeof entry === 'object' &&
          !Array.isArray(entry) &&
          typeof entry.text === 'string'
        ) {
          return entry.text;
        }

        return '';
      })
      .map((text) => text.replace(/\s+/gu, ' ').trim())
      .filter(Boolean);
  }

  private mapNlpContext(
    persistedAnalysisId: string | null,
    output: {
      collectionJobId: string;
      totalTextsAnalyzed: number;
      totalPostsAnalyzed: number;
      totalCommentsAnalyzed: number;
      sentimentStats: unknown;
      keywords: unknown;
      topics: unknown;
      recurringProblems: unknown;
      extractedNeeds: unknown;
      featureRequests: unknown;
      opportunities: unknown;
      insights: unknown;
      dataQuality: unknown;
      samplePosts: unknown;
      sampleComments: unknown;
      aiUsed: boolean;
      confidence: number;
    },
  ): IdeaGenerationNlpContext {
    return {
      nlpAnalysisId: persistedAnalysisId ?? output.collectionJobId,
      totalTextsAnalyzed: output.totalTextsAnalyzed,
      totalPostsAnalyzed: output.totalPostsAnalyzed,
      totalCommentsAnalyzed: output.totalCommentsAnalyzed,
      sentimentStats: this.toJsonValue(output.sentimentStats),
      keywords: this.toJsonValue(output.keywords),
      topics: this.toJsonValue(output.topics),
      recurringProblems: this.toJsonValue(output.recurringProblems),
      extractedNeeds: this.toJsonValue(output.extractedNeeds),
      featureRequests: this.toJsonValue(output.featureRequests),
      opportunities: this.toJsonValue(output.opportunities),
      insights: this.toJsonValue(output.insights),
      dataQuality: this.toJsonValue(output.dataQuality),
      samplePosts: this.toJsonValue(output.samplePosts),
      sampleComments: this.toJsonValue(output.sampleComments),
      aiUsed: output.aiUsed,
      confidence: Number.isFinite(output.confidence) ? output.confidence : null,
    };
  }

  private toJsonValue(value: unknown): Prisma.JsonValue | null {
    if (value === undefined || value === null) {
      return null;
    }

    return value;
  }
}