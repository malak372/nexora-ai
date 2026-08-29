import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CollectionJobStatus, Prisma } from '@prisma/client';

import { IDEA_OWNER_TYPES } from '../../shared/constants/ideas.constants';
import { MAX_EVIDENCE_RECOVERY_ATTEMPTS } from '../constants/idea-generation.constants';
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
import { CollectorsFactory } from '../../../collectors/collectors.factory';
import { RequestEvidenceAlignmentUtil } from '../utils/request-evidence-alignment.util';
import { SelectedDomainEvidenceAlignmentUtil } from '../utils/selected-domain-evidence-alignment.util';
import { RequestDynamicQueryUtil } from '../utils/request-dynamic-query.util';
import { RequestQueryProvenanceUtil } from '../utils/request-query-provenance.util';
import { SourceSpecificEvidenceQueryUtil } from '../utils/source-specific-evidence-query.util';
import { EvidenceSourceIdentityUtil } from '../utils/evidence-source-identity.util';
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
import type { RequestCollectionPlan } from '../types/request-collection-plan.type';
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





  /**
   * Recovery is a bounded infrastructure/recall rescue path. The broad AI-owned
   * first pass should do discovery; each wave stays intentionally tiny. Text
   * requests may invoke a second rotated wave from OpportunityRankingStage,
   * while discovery-only paths remain single-wave.
   */
  private readonly maximumRecoveryKeywords = 8;
  /*
   * Keep each recovery wave bounded to three healthy lanes in parallel.  Very
   * sparse workflows frequently lose a preferred source to rate limiting and
   * have no dedicated forum result; a third professional/secondary lane gives
   * the same bounded wave a realistic chance to find supporting evidence
   * without adding a second serial recovery cycle.
   */
  private readonly maximumRecoverySourcesPerWave = 3;

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
    parentSignal?: AbortSignal,
  ): Promise<IdeaEvidenceRecoveryResult> {
    const recoveryStartedAt = Date.now();
    const preflightSelectedFamilyIds = new Set(
      (context.communityAiAnalysis?.selectedProblemFamilyEvidenceIds ?? [])
        .map((id) => id.trim())
        .filter(Boolean),
    );
    const preflightSelectedTrusted = (context.canonicalEvidenceLedger ?? []).filter(
      (item) =>
        item.verified &&
        preflightSelectedFamilyIds.has(item.id) &&
        (item.classification === 'DIRECT_PROBLEM' ||
          item.classification === 'SUPPORTING_SIGNAL'),
    );
    const preflightSelectedSourceCount = EvidenceSourceIdentityUtil.count(
      preflightSelectedTrusted,
    );
    const corroborationOnlyRecovery = Boolean(
      preflightSelectedTrusted.length > 0 &&
        preflightSelectedSourceCount < 2,
    );
    /*
     * Recovery previously used one 5.8s wall-clock for source-health reads,
     * AI re-planning, collection, persistence, and recovery triage. A healthy
     * planner could consume ~2.2-2.6s by itself, leaving too little time for a
     * collector to finish and causing "Collector operation cancelled" exactly
     * when recovery was most needed. Keep planning/collection bounded here;
     * once new raw rows have actually returned, semantic admission receives a
     * separate small bounded grace window below so useful evidence is never
     * discarded merely because collection consumed the envelope.
     */
    const configuredRecoveryBudgetMs = this.readPositiveConfig(
      'IDEA_EVIDENCE_RECOVERY_TIMEOUT_MS',
      8_000,
    );
    const recoveryBudgetMs = corroborationOnlyRecovery
      ? Math.max(4_800, Math.min(6_000, configuredRecoveryBudgetMs))
      : Math.max(6_000, Math.min(8_000, configuredRecoveryBudgetMs));
    const recoveryDeadlineAt = recoveryStartedAt + recoveryBudgetMs;
    const recoveryController = new AbortController();
    const abortRecovery = () => {
      if (!recoveryController.signal.aborted) recoveryController.abort();
    };
    const recoveryDeadlineHandle = setTimeout(abortRecovery, recoveryBudgetMs);
    recoveryDeadlineHandle.unref?.();
    if (parentSignal) {
      if (parentSignal.aborted) abortRecovery();
      else parentSignal.addEventListener('abort', abortRecovery, { once: true });
    }
    try {
    if (context.evidenceRecoveryAttempts >= MAX_EVIDENCE_RECOVERY_ATTEMPTS) {
      return {
        collectionJobId: context.collection?.collectionJobId ?? 'recovery-skipped',
        selectedDataSourceKeys: [],
        recoveryKeywords: [],
        evidenceFamilies: [],
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
    const evidenceFamilies: EvidenceRecoveryFamily[] = [];
    const runLocalLowYieldSourceKeys = this.resolveRunLocalLowYieldSourceKeys(context);
    const [lowYieldSourceKeys, recoveryCandidateSources] = await Promise.all([
      this.withSoftDeadline(
        this.resolveLowYieldSourceKeys(context, runLocalLowYieldSourceKeys),
        700,
        runLocalLowYieldSourceKeys,
      ),
      this.withSoftDeadline(
        this.resolveRecoveryCandidateSources(context.selectedDataSources),
        900,
        [...context.selectedDataSources],
      ),
    ]);
    const excludedSourceKeys = new Set<string>([
      ...lowYieldSourceKeys,
      ...additionalExcludedSourceKeys,
    ]);

    /*
     * Source routing must follow the concrete requester/canonical family, not
     * only the broad selected domain. This prevents a healthy but structurally
     * irrelevant developer corpus (for example GitHub for moving-company
     * scheduling, or Stack Overflow for municipal permit delays) from winning
     * a recovery slot just because an AI planner named it.
     */
    const recoveryRoutingDescription =
      context.requestDescription?.trim() ||
      context.communityAiAnalysis?.canonicalProblemFamilyLabel?.trim() ||
      context.communityAiAnalysis?.selectedProblemFamily?.trim() ||
      selectedOpportunity?.problem?.trim() ||
      selectedOpportunity?.title?.trim() ||
      '';
    const lockedProblemFamily =
      context.communityAiAnalysis?.canonicalProblemFamilyLabel?.trim() ||
      context.communityAiAnalysis?.selectedProblemFamily?.trim() ||
      selectedOpportunity?.problem?.trim() ||
      selectedOpportunity?.title?.trim() ||
      '';

    const selectedRecoverySources = recoveryCandidateSources
      .filter((source) => {
        const key = source.key.trim().toLocaleLowerCase();
        if (excludedSourceKeys.has(key) || excludedSourceKeys.has(source.key)) {
          return false;
        }
        if (!this.collectorsFactory.isCollectorRuntimeAvailable(source.key)) {
          return false;
        }
        if (!this.collectorSourceHealth.isHealthy(source.key)) {
          return false;
        }

        const capabilityInput = {
          requestDescription:
            recoveryRoutingDescription || context.requestDescription,
          domainName: context.domainName,
          keywords: context.keywords,
          plannedQueries: context.collectionPlan?.searchQueries ?? [],
          collectionMode: 'TARGETED_RECOVERY' as const,
        };
        if (
          recoveryRoutingDescription &&
          this.collectorsFactory.getCollectorRequestFitScore(
            key,
            capabilityInput,
          ) < 0.42
        ) {
          return false;
        }

        return this.collectorsFactory.isCollectorRouteExecutable(
          source.key,
          capabilityInput,
        );
      })
      .sort(
        (left, right) =>
          this.scoreRecoverySource(context, right, null, recoveryRoutingDescription) -
            this.scoreRecoverySource(context, left, null, recoveryRoutingDescription) ||
          left.key.localeCompare(right.key),
      )
      .slice(0, this.maximumRecoverySourcesPerWave);

    /*
     * Source health/executability is a hard precondition for AI recovery
     * planning. Do this BEFORE spending 2-3 seconds on a provider race. The
     * previous order planned first and only later discovered that every lane
     * was rate-limited, unavailable, or exhausted, which created pure latency
     * on sparse Text Only runs. A later generation can retry when the health
     * registry exposes an executable lane again.
     */
    if (selectedRecoverySources.length === 0) {
      const preflightRecoveryKeywords = [
        lockedProblemFamily,
        context.requestDescription?.trim() ?? '',
        ...(context.collectionPlan?.retrievalVocabulary ?? []),
        ...(context.collectionPlan?.searchQueries ?? []),
      ]
        .map((query) => this.sanitizeRecoveryQuery(query))
        .filter(Boolean)
        .filter((query) => SourceSpecificEvidenceQueryUtil.isSafe(query))
        .filter(
          (query, index, values) =>
            values.findIndex(
              (candidate) => candidate.toLocaleLowerCase() === query.toLocaleLowerCase(),
            ) === index,
        )
        .slice(0, this.maximumRecoveryKeywords);
      this.logger.debug(
        'Skipping targeted recovery before AI re-planning because no healthy, unexhausted, request-compatible source lane is executable.',
      );
      return {
        collectionJobId: context.collection?.collectionJobId ?? 'recovery-skipped',
        selectedDataSourceKeys: [],
        recoveryKeywords: preflightRecoveryKeywords,
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

    const primaryAttemptedSourceKeys = new Set(
      [
        ...(context.selectedDataSources ?? []).map((source) => source.key),
        ...(context.collectionPlan?.sourcePlans ?? []).map((plan) => plan.sourceKey),
      ]
        .map((key) => key.trim().toLocaleLowerCase())
        .filter(Boolean),
    );
    const primaryClassifications =
      context.communityAiAnalysis?.evidenceClassifications ?? [];
    const primaryClassificationById = new Map(
      primaryClassifications.map((item) => [item.evidenceId, item] as const),
    );
    const primaryCorpusFullyAdjudicated = Boolean(
      (context.rawEvidenceCorpus?.length ?? 0) > 0 &&
        (context.rawEvidenceCorpus ?? []).every((row) => {
          const classification = primaryClassificationById.get(row.id);
          return Boolean(
            classification &&
              classification.adjudicationStatus === 'ADJUDICATED' &&
              classification.classification !== 'UNADJUDICATED',
          );
        }),
    );
    const primaryTrustedCount = (context.canonicalEvidenceLedger ?? []).filter(
      (item) =>
        item.verified &&
        (item.classification === 'DIRECT_PROBLEM' ||
          item.classification === 'SUPPORTING_SIGNAL'),
    ).length;
    const hasNovelRecoverySource = selectedRecoverySources.some(
      (source) =>
        !primaryAttemptedSourceKeys.has(source.key.trim().toLocaleLowerCase()),
    );
    const primaryPlanWasAiOwned = Boolean(
      context.collectionPlan?.aiUsed && !context.collectionPlan?.fallbackUsed,
    );
    const sourceOutcomeByKey = new Map(
      this.buildRecoverySourceOutcomes(context).map(
        (outcome) => [outcome.sourceKey, outcome.status] as const,
      ),
    );
    const remainingSourcesWereAlreadyNonProductive =
      selectedRecoverySources.length > 0 &&
      selectedRecoverySources.every((source) => {
        const status = sourceOutcomeByKey.get(
          source.key.trim().toLocaleLowerCase(),
        );
        return status === 'EMPTY' || status === 'DEGRADED';
      });

    /*
     * Stop BEFORE the first serial recovery wave when a successful AI-owned
     * text plan already produced a fully adjudicated, non-trivial corpus, no
     * trusted evidence survived, and recovery has no genuinely new source lane.
     * Re-querying only empty/degraded sources has very low marginal value and
     * was responsible for the 10-15 second zero-yield tail on sparse niche
     * requests. A healthy source that returned only CONTEXT/UNRELATED material
     * is not considered exhausted: a fresh AI-owned recovery query can still
     * improve recall without changing semantic truth. Thin corpora,
     * fallback-planned requests, or runs with a new healthy source remain
     * eligible for recovery.
     * No semantic meaning is inferred here; this is execution/yield accounting.
     */
    const lowMarginalValueTextRecovery = Boolean(
      context.requestDescription?.trim() &&
        primaryPlanWasAiOwned &&
        primaryCorpusFullyAdjudicated &&
        (context.rawEvidenceCorpus?.length ?? 0) >= 8 &&
        primaryTrustedCount === 0 &&
        !hasNovelRecoverySource &&
        remainingSourcesWereAlreadyNonProductive,
    );
    if (lowMarginalValueTextRecovery) {
      this.logger.debug(
        `Skipping first targeted text recovery wave because the AI-owned primary corpus was fully adjudicated and no novel productive source lane remains: raw=${context.rawEvidenceCorpus?.length ?? 0}, candidateSources=${selectedRecoverySources.length}.`,
      );
      return {
        collectionJobId: context.collection?.collectionJobId ?? 'recovery-skipped',
        selectedDataSourceKeys: [],
        recoveryKeywords: [],
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
    const corroborationSelectedFamilyIds = new Set(
      (context.communityAiAnalysis?.selectedProblemFamilyEvidenceIds ?? [])
        .map((id) => id.trim())
        .filter(Boolean),
    );
    const selectedCanonicalFamilyLabel =
      context.communityAiAnalysis?.canonicalProblemFamilyLabel?.trim() ||
      context.communityAiAnalysis?.selectedProblemFamily?.trim() ||
      '';
    const hasSelectedCanonicalFamily = Boolean(
      selectedCanonicalFamilyLabel && corroborationSelectedFamilyIds.size > 0,
    );

    /*
     * For an explicit requester problem, only the currently accepted canonical
     * family counts as existing semantic coverage. A broad single-source row
     * that was released by the request-intent gate must not suppress fresh AI
     * recovery planning merely because its old classification is still kept in
     * the audit ledger. Discovery paths can still use the global trusted pool.
     */
    const qualifiedCommunityEvidenceCount = requestSpecificRecovery
      ? hasSelectedCanonicalFamily
        ? context.communityAiAnalysis?.selectedProblemFamilyTrustedEvidenceCount ??
          corroborationSelectedFamilyIds.size
        : 0
      : context.communityAiAnalysis?.evidenceClassifications?.filter(
          (item) =>
            item.classification === 'DIRECT_PROBLEM' ||
            item.classification === 'SUPPORTING_SIGNAL',
        ).length ?? 0;
    const needsExpandedRequestRecovery =
      requestSpecificRecovery && qualifiedCommunityEvidenceCount === 0;

    const canonicalTrustedForCorroboration = hasSelectedCanonicalFamily
      ? (context.canonicalEvidenceLedger ?? []).filter(
          (item) =>
            item.verified &&
            (item.classification === 'DIRECT_PROBLEM' ||
              item.classification === 'SUPPORTING_SIGNAL') &&
            corroborationSelectedFamilyIds.has(item.id),
        )
      : [];
    const trustedCorroborationSourceKeys = new Set(
      canonicalTrustedForCorroboration.map((item) =>
        EvidenceSourceIdentityUtil.resolve(item),
      ),
    );
    const singleSourceFamilyCorroboration =
      canonicalTrustedForCorroboration.length > 0 &&
      trustedCorroborationSourceKeys.size < 2;
    /*
     * Use provider-diverse AI re-planning only while the run still needs a new
     * semantic evidence direction. Once a canonical family already exists and
     * recovery is merely seeking an independent corroborating source, another
     * AI planning call adds latency without changing the semantic target. In
     * that case we reuse the existing AI-owned vocabulary/family and rotate it
     * through new healthy source-specific lanes below. Zero-evidence recovery
     * still receives fresh AI semantic re-planning.
     */
    const rawEvidenceCount = context.rawEvidenceCorpus?.length ?? 0;
    const rawEvidenceSourceCount = new Set(
      (context.rawEvidenceCorpus ?? []).map((item) => item.sourceKey),
    ).size;
    const shouldUseAiRecoveryPlan =
      context.evidenceRecoveryAttempts < MAX_EVIDENCE_RECOVERY_ATTEMPTS &&
      !singleSourceFamilyCorroboration &&
      (needsExpandedRequestRecovery ||
        (!requestSpecificRecovery && context.selectedDomains.length > 0));
    if (singleSourceFamilyCorroboration) {
      this.logger.debug(
        `Recovery corroboration reuses the canonical AI-owned family/vocabulary and skips redundant AI re-planning. family="${lockedProblemFamily || 'unknown'}" existingSources=${trustedCorroborationSourceKeys.size}.`,
      );
    }

    const recoveryPlannerRemainingMs = Math.max(
      0,
      recoveryDeadlineAt - Date.now() - 6_000,
    );
    const recoveryPlannerBudgetMs = Math.min(3_200, recoveryPlannerRemainingMs);
    let recoveryQueryPlan: RequestCollectionPlan | null = null;
    if (shouldUseAiRecoveryPlan && recoveryPlannerBudgetMs >= 900) {
      const corroborationDescription = lockedProblemFamily;
      const planned = (
        requestSpecificRecovery ||
        (singleSourceFamilyCorroboration && Boolean(corroborationDescription))
      )
        ? await this.requestCollectionPlanningService.expandEvidenceSearch({
            description: requestSpecificRecovery
              ? context.requestDescription ?? ''
              : corroborationDescription,
            keywords: [
              ...(lockedProblemFamily ? [lockedProblemFamily] : []),
              ...(context.collectionPlan?.inferredSecondaryScopes ?? []),
              ...context.keywords,
            ].slice(0, 16),
            previousQueries: context.collectionPlan?.searchQueries ?? [],
            evidenceTargets: [
              ...(lockedProblemFamily ? [lockedProblemFamily] : []),
              ...(selectedOpportunity?.problem
                ? [selectedOpportunity.problem]
                : []),
              ...(selectedOpportunity?.title
                ? [selectedOpportunity.title]
                : []),
              ...(singleSourceFamilyCorroboration
                ? []
                : context.collectionPlan?.evidenceTargets ?? []),
            ].slice(0, 10),
            sourceOutcomes: this.buildRecoverySourceOutcomes(context),
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
            signal: recoveryController.signal,
            deadlineMs: recoveryPlannerBudgetMs,
          })
        : await this.withSoftDeadline<RequestCollectionPlan | null>(
            this.requestCollectionPlanningService.buildDomainDiscoveryPlan({
              domainNames: context.selectedDomains.map((domain) => domain.name),
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
            }),
            recoveryPlannerBudgetMs,
            null,
          );

      /*
       * A successful online re-plan is preferred, but a planner timeout no
       * longer throws away recovery-specific deterministic queries.  The
       * deterministic branch is now canonical-facet derived and explicitly
       * rotated away from previous queries, so it is safe and materially more
       * useful than replaying the first-pass vocabulary.
       */
      if (planned?.searchQueries?.length) {
        recoveryQueryPlan = planned;
      }
    }

    /*
     * Once a canonical family exists, recovery is a corroboration operation,
     * not a second domain-discovery pass. Feed that immutable family back into
     * source capability checks and query compilation even on DOMAINS_ONLY /
     * NO_INPUT paths where requestDescription is empty. This prevents a locked
     * family such as "LLM context drift" from drifting back to generic AI
     * hallucination/debugging queries during recovery.
     */
    const recoverySemanticDescription =
      requestSpecificRecovery
        ? context.requestDescription?.trim() ?? ''
        : singleSourceFamilyCorroboration
          ? lockedProblemFamily
          : '';

    /*
     * Corroboration queries must come from the CURRENT canonical family and
     * its accepted observed-problem rows. Never replay an older discovery
     * vocabulary merely because it is still present in collectionPlan. This
     * keeps a family such as "AI System Failure Modes" from drifting back to
     * a stale training-data/compliance query after the canonical winner has
     * already changed.
     */
    const canonicalFamilyRecoveryQueries = singleSourceFamilyCorroboration
      ? [
          selectedCanonicalFamilyLabel,
          ...canonicalTrustedForCorroboration.flatMap((item) => [
            item.problemFamily ?? '',
            item.observedProblem ?? '',
          ]),
        ]
          .map((query) => this.sanitizeRecoveryQuery(query))
          .filter(Boolean)
          .filter((query) => SourceSpecificEvidenceQueryUtil.isSafe(query))
          .filter(
            (query, index, values) =>
              values.findIndex(
                (candidate) =>
                  candidate.trim().toLocaleLowerCase() ===
                  query.trim().toLocaleLowerCase(),
              ) === index,
          )
          .slice(0, this.maximumRecoveryKeywords)
      : [];

    const aiRecoverySourceKeys = new Set(
      recoveryQueryPlan?.aiUsed && !recoveryQueryPlan.fallbackUsed
        ? (recoveryQueryPlan.selectedSourceKeys ?? []).map((key) =>
            key.trim().toLocaleLowerCase(),
          )
        : [],
    );
    const aiSelectedRecoverySources = aiRecoverySourceKeys.size > 0
      ? recoveryCandidateSources.filter((source) => {
          const key = source.key.toLocaleLowerCase();
          if (!aiRecoverySourceKeys.has(key)) return false;
          if (excludedSourceKeys.has(key) || excludedSourceKeys.has(source.key)) return false;
          if (!this.collectorSourceHealth.isHealthy(key)) return false;
          const sourcePlan = recoveryQueryPlan?.sourcePlans?.find(
            (plan) => plan.sourceKey.toLocaleLowerCase() === key,
          );
          const capabilityInput = {
            requestDescription: recoverySemanticDescription || context.requestDescription,
            domainName: context.domainName,
            keywords: context.keywords,
            plannedQueries:
              sourcePlan?.queries ?? recoveryQueryPlan?.searchQueries ?? [],
            sourceHints: sourcePlan?.routingHints ?? [],
            collectionMode: 'TARGETED_RECOVERY' as const,
          };

          /*
           * AI owns the semantic recovery plan, but an accidental source choice
           * must not route a physical/professional workflow into a clearly
           * incompatible developer-only corpus. The generic capability score is
           * domain-agnostic and therefore acts only as a route-quality floor,
           * not as a semantic evidence verdict. Technical requests still score
           * GitHub/StackOverflow highly and remain eligible.
           */
          if (
            (requestSpecificRecovery || Boolean(recoverySemanticDescription)) &&
            this.collectorsFactory.getCollectorRequestFitScore(
              key,
              capabilityInput,
            ) < 0.42
          ) {
            return false;
          }

          return this.collectorsFactory.isCollectorRouteExecutable(
            key,
            capabilityInput,
          );
        })
          .sort((left, right) => {
            const leftPlan = recoveryQueryPlan?.sourcePlans?.find(
              (plan) => plan.sourceKey.toLocaleLowerCase() === left.key.toLocaleLowerCase(),
            );
            const rightPlan = recoveryQueryPlan?.sourcePlans?.find(
              (plan) => plan.sourceKey.toLocaleLowerCase() === right.key.toLocaleLowerCase(),
            );
            return (
              this.scoreRecoverySource(
                context,
                right,
                rightPlan,
                recoverySemanticDescription || recoveryRoutingDescription,
              ) -
                this.scoreRecoverySource(
                  context,
                  left,
                  leftPlan,
                  recoverySemanticDescription || recoveryRoutingDescription,
                ) ||
              left.key.localeCompare(right.key)
            );
          })
      : [];
    /*
     * AI-selected sources keep first priority, but one surviving AI lane must
     * not collapse the whole recovery wave to a single source after capability
     * filtering. Fill the remaining bounded slots from the same generic
     * request-fit/health ranking. This is especially important when the planner
     * proposes one incompatible developer/app source plus one valid source: the
     * invalid lane is removed, while community/documentary/research coverage is
     * still completed without launching another serial recovery wave.
     */
    const preferredRecoverySources = [
      ...aiSelectedRecoverySources,
      ...selectedRecoverySources,
    ].filter(
      (source, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.key.trim().toLocaleLowerCase() ===
            source.key.trim().toLocaleLowerCase(),
        ) === index,
    );
    const requesterRecoverySourceLimit =
      requestSpecificRecovery && rawEvidenceSourceCount >= 2
        ? 2
        : this.maximumRecoverySourcesPerWave;
    const corroborationPreferredSources = singleSourceFamilyCorroboration
      ? preferredRecoverySources.filter(
          (source) =>
            !trustedCorroborationSourceKeys.has(
              source.key.trim().toLocaleLowerCase(),
            ),
        )
      : preferredRecoverySources;
    const recoverySources = (compactDomainsOnlySecondaryRecovery
      ? corroborationPreferredSources.slice(0, 2)
      : requestSpecificRecovery
        /*
         * A broad text first pass already covered multiple source families.
         * Its single recovery wave therefore uses two rotated lanes instead of
         * three; sparse text niches retain the third lane for recall. This cuts
         * the slowest recovery tail without weakening verification.
         */
        ? corroborationPreferredSources.slice(0, requesterRecoverySourceLimit)
        : singleSourceFamilyCorroboration
          ? corroborationPreferredSources.slice(0, 1)
          : corroborationPreferredSources.slice(0, this.maximumRecoverySourcesPerWave)
    ).filter((source) =>
      this.collectorsFactory.isCollectorRuntimeAvailable(source.key),
    );
    const primaryQueryKeys = new Set(
      [
        ...(context.collectionPlan?.searchQueries ?? []),
        ...(context.collectionPlan?.sourcePlans ?? []).flatMap(
          (plan) => plan.queries ?? [],
        ),
      ].map((query) =>
        query.replace(/\s+/gu, ' ').trim().toLocaleLowerCase(),
      ),
    );
    const primaryQueriesBySource = new Map<string, Set<string>>();
    for (const plan of context.collectionPlan?.sourcePlans ?? []) {
      const sourceKey = plan.sourceKey.trim().toLocaleLowerCase();
      const sourceQueries = primaryQueriesBySource.get(sourceKey) ?? new Set<string>();
      for (const query of plan.queries ?? []) {
        const normalized = query.replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
        if (normalized) sourceQueries.add(normalized);
      }
      primaryQueriesBySource.set(sourceKey, sourceQueries);
    }
    const plannedRecoveryKeywords = (recoveryQueryPlan?.searchQueries ?? [])
      .map((query) => this.sanitizeRecoveryQuery(query))
      .filter(Boolean)
      .filter(
        (query) => !primaryQueryKeys.has(query.toLocaleLowerCase()),
      )
      .filter((query) => this.isSemanticallyUsefulRecoveryQuery(query, context))
      .slice(0, this.maximumRecoveryKeywords);
    const aiOwnedFallbackQueries = [
      ...(context.collectionPlan?.sourcePlans ?? []).flatMap(
        (plan) => plan.queries ?? [],
      ),
      ...(context.collectionPlan?.retrievalVocabulary ?? []),
      ...(context.collectionPlan?.searchQueries ?? []),
    ]
      .map((query) => this.sanitizeRecoveryQuery(query))
      .filter(Boolean)
      .filter((query) => SourceSpecificEvidenceQueryUtil.isSafe(query))
      .slice(0, this.maximumRecoveryKeywords);
    const recoveryKeywords = (
      plannedRecoveryKeywords.length > 0
        ? plannedRecoveryKeywords
        : canonicalFamilyRecoveryQueries.length > 0
          ? canonicalFamilyRecoveryQueries
          : aiOwnedFallbackQueries
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
      recoveryQueryPlan?.aiUsed === true &&
      recoveryQueryPlan.fallbackUsed !== true &&
      (recoveryQueryPlan.searchQueries?.length ?? 0) > 0;
    const authoritativeRecoveryQueries =
      canonicalFamilyRecoveryQueries.length > 0
        ? canonicalFamilyRecoveryQueries
        : (recoveryQueryPlan?.searchQueries?.length ?? 0) > 0
          ? [...(recoveryQueryPlan?.searchQueries ?? [])]
          : recoveryKeywords;
    const aiSourcePlans = usingAiRecoveryPlan
      ? recoveryQueryPlan?.sourcePlans ?? []
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
      const domainRecoveryQueries = recoveryDomain && !singleSourceFamilyCorroboration
        ? (context.collectionPlan?.sourcePlans ?? [])
            .filter((plan) =>
              (plan.discoveryDomainIds ?? []).includes(recoveryDomain.id) ||
              (plan.discoveryDomainNames ?? []).some(
                (name) =>
                  name.trim().toLocaleLowerCase() ===
                  recoveryDomain.name.trim().toLocaleLowerCase(),
              ) ||
              plan.discoveryDomainId === recoveryDomain.id,
            )
            .flatMap((plan) => plan.queries ?? [])
            .map((query) => this.sanitizeRecoveryQuery(query))
            .filter((query) => SourceSpecificEvidenceQueryUtil.isSafe(query))
            .slice(0, 4)
        : [];
      const fallbackQueries = domainRecoveryQueries.length > 0
        ? domainRecoveryQueries
        : authoritativeRecoveryQueries.length > 0
          ? [
              authoritativeRecoveryQueries[sourceIndex % authoritativeRecoveryQueries.length],
              authoritativeRecoveryQueries[(sourceIndex + 1) % authoritativeRecoveryQueries.length],
            ].filter((query): query is string => Boolean(query?.trim()))
          : [];
      const rawQueries: string[] = [...new Set<string>(
        (planned?.queries?.length &&
          (requestSpecificRecovery || singleSourceFamilyCorroboration)
          ? planned.queries
          : fallbackQueries)
          .map((query) => this.sanitizeRecoveryQuery(query))
          .filter((query) => SourceSpecificEvidenceQueryUtil.isSafe(query)),
      )];
      const compiledQueries = SourceSpecificEvidenceQueryUtil.compile({
        sourceKey: source.key,
        baseQueries: rawQueries,
        requestDescription:
          recoverySemanticDescription || context.requestDescription,
        problemProfile: context.collectionPlan?.problemProfile,
        discoveryDomainName: recoveryDomain?.name ?? context.domainName,
        maxQueries: 2,
        preserveBaseQueries: Boolean(
          recoverySemanticDescription || context.requestDescription?.trim(),
        ),
      });
      const previouslyUsedBySource =
        primaryQueriesBySource.get(source.key.trim().toLocaleLowerCase()) ??
        new Set<string>();
      const sourceNovelQueries = (compiledQueries.length
        ? compiledQueries
        : rawQueries.slice(0, 2)
      ).filter((query) => {
        const normalized = query.replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
        return Boolean(normalized) && !previouslyUsedBySource.has(normalized);
      });
      return {
        sourceKey: source.key,
        queries: sourceNovelQueries,
        routingHints: [
          ...new Set([
            ...(planned?.routingHints ?? []),
            ...(source.key.toLocaleLowerCase() === 'forum'
              ? ['discover specialist practitioner forums from planned queries']
              : []),
          ]),
        ],
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
    const plannedRecoverySourceKeys = new Set(
      mergedRecoverySourcePlans.map((plan) =>
        plan.sourceKey.trim().toLocaleLowerCase(),
      ),
    );
    const plannedRecoverySources = recoverySources.filter((source) =>
      plannedRecoverySourceKeys.has(source.key.trim().toLocaleLowerCase()),
    );
    if (plannedRecoverySources.length === 0) {
      this.logger.debug(
        'Skipping targeted recovery because every healthy candidate source would replay an already-used source/query pair; no novel executable provenance lane remains.',
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

    const resolvedDomain =
      context.selectedDomains.find((domain) => domain.id === context.domainId) ??
      context.selectedDomains[0];
    /*
     * Recovery has one strict run-level deadline in addition to collector
     * timeouts. The AbortSignal reaches the collection resolver so a slow
     * source cannot turn a single recall rescue into another full pipeline
     * wave.
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
      dataSourceKeys: plannedRecoverySources.map((source) => source.key),
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
      signal: recoveryController.signal,
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
      resolvedDataSources: plannedRecoverySources.map((source) => ({
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
        selectedDataSourceKeys: plannedRecoverySources.map((source) => source.key),
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
    const rawRecoveryInputCount = result.rawEvidenceInputs?.length ?? 0;
    const mappedRecoveryEvidenceCount = inMemoryRecoveryEvidence.length;
    const provenanceDeduplicatedCount = persistedRecoveryEvidence.length;
    const duplicateAgainstPrimaryCount = Math.max(
      0,
      persistedRecoveryEvidence.length - novelRawRecoveryEvidence.length,
    );
    const textEquivalentCollapseCount = Math.max(
      0,
      novelRawRecoveryEvidence.length - novelRawRecoverySamples.length,
    );
    const existingCanonicalIds = new Set(
      (context.canonicalEvidenceLedger ?? []).map((item) => item.id),
    );

    const rawEvidenceCorpusAll: IdeaGenerationRawEvidenceItem[] =
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

    const rawEvidenceById = new Map<string, IdeaGenerationRawEvidenceItem>();
    for (const item of rawEvidenceCorpusAll) {
      if (!rawEvidenceById.has(item.id)) {
        rawEvidenceById.set(item.id, item);
      }
    }
    const recoveryCanonicalIds = new Set(rawEvidenceById.keys());
    const duplicateCanonicalIdCount = [...recoveryCanonicalIds].filter((id) =>
      existingCanonicalIds.has(id),
    ).length;

    /*
     * A recovery row that resolves to an already-canonical provenance id is not
     * new evidence and must not be allowed to overwrite the original verdict.
     * More importantly, semantic triage must receive every genuinely NEW
     * canonical provenance row, even when two rows have equivalent text. The
     * previous text-level collapse classified only one representative and left
     * the other new provenance row as AI_UNAVAILABLE during final reconciliation.
     */
    const rawEvidenceCorpus = [...rawEvidenceById.values()].filter(
      (item) => !existingCanonicalIds.has(item.id),
    );
    const canonicalNewIdCount = rawEvidenceCorpus.length;

    this.logger.debug(
      `Targeted recovery retention accounting | rawInputs=${rawRecoveryInputCount} | mapped=${mappedRecoveryEvidenceCount} | provenanceDeduplicated=${provenanceDeduplicatedCount} | duplicateAgainstPrimary=${duplicateAgainstPrimaryCount} | uniqueProvenance=${novelRawRecoveryEvidence.length} | uniqueTextForDiagnostics=${novelRawRecoverySamples.length} | textEquivalentCollapsed=${textEquivalentCollapseCount} | duplicateCanonicalId=${duplicateCanonicalIdCount} | canonicalNewIds=${canonicalNewIdCount} | semanticRows=${rawEvidenceCorpus.length}.`,
    );

    const canonicalNewRecoveryIds = new Set(
      rawEvidenceCorpus.map((item) => item.id),
    );
    const canonicalNovelRawRecoveryEvidence = novelRawRecoveryEvidence.filter(
      (evidence) =>
        canonicalNewRecoveryIds.has(this.buildRecoveryEvidenceId(evidence)),
    );
    const canonicalNovelRecoverySamples = this.deduplicateEvidenceSamples(
      rawEvidenceCorpus.map((item) => item.text),
    );

    /*
     * Keep deterministic candidates as a non-AI emergency fallback only. When
     * the provider returns semantic classifications, those classifications are
     * authoritative subject to deterministic request/workflow verification.
     */
    const deterministicRequestAlignedEvidence = canonicalNovelRawRecoveryEvidence.filter(
      (evidence) =>
        this.looksLikeUsableProblemEvidence(evidence.text) &&
        this.isEvidenceAcceptableForRecovery(
          evidence.text,
          context,
          requestSpecificRecovery,
        ),
    );
    const deterministicWorkflowAdjacentEvidence =
      canonicalNovelRawRecoveryEvidence.filter(
        (evidence) =>
          this.looksLikeUsableProblemEvidence(evidence.text) &&
          !deterministicRequestAlignedEvidence.some((accepted) =>
            this.areEquivalentEvidenceSamples(accepted.text, evidence.text),
          ) &&
          this.isWorkflowAdjacentSupportingEvidence(evidence.text, context),
      );

    const rawRecoveryNlp = this.filterNlpContextToNovelEvidence(
      nlp,
      canonicalNovelRecoverySamples,
    );
    const shouldRunCommunityAiRecovery = rawEvidenceCorpus.length > 0;
    /*
     * Once a recovery collector has already returned new provenance rows, do
     * not let the collection/planning wall-clock abort semantic admission of
     * those rows. That was the exact failure mode where recovery had useful
     * raw evidence but the run ended as EVIDENCE_ADJUDICATION_UNAVAILABLE.
     *
     * Give Community AI one separate bounded post-collection adjudication
     * grace window. It is still linked to the pipeline/user cancellation
     * signal, so an explicit cancel remains immediate. The SAME complete
     * recovered corpus is raced; no semantic mini-batches are introduced.
     */
    /*
     * This is a SAFETY ceiling, not a fixed wait. The race still returns as
     * soon as the first complete valid full-corpus verdict arrives. Small
     * recovery corpora usually finish in ~5-7s, but the ceiling scales enough
     * to avoid turning a transient 8-12s provider slowdown into false
     * AI_UNAVAILABLE / EVIDENCE_ADJUDICATION_UNAVAILABLE.
     */
    const recoveryAdjudicationBudgetMs = corroborationOnlyRecovery
      ? Math.min(
          7_000,
          Math.max(5_500, 5_500 + rawEvidenceCorpus.length * 220),
        )
      : Math.min(
          8_500,
          Math.max(6_500, 6_500 + rawEvidenceCorpus.length * 260),
        );
    const recoveryAdjudicationDeadlineAt =
      Date.now() + recoveryAdjudicationBudgetMs;
    const rawCommunityAiAnalysis = shouldRunCommunityAiRecovery
      ? await this.analyzeRecoveredEvidenceWithCommunityAi(
          context,
          rawRecoveryNlp,
          rawEvidenceCorpus,
          parentSignal,
          recoveryAdjudicationDeadlineAt,
        )
      : null;

    const classificationById = new Map(
      (rawCommunityAiAnalysis?.evidenceClassifications ?? []).map((item) => [
        item.evidenceId,
        item,
      ] as const),
    );
    const evidenceByTriageId = new Map(
      canonicalNovelRawRecoveryEvidence.map((evidence) => [
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
          requestDescription:
            recoverySemanticDescription || context.requestDescription,
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
        `Targeted recovery produced ${retainedRecoveryTextCount} provisional ${requestSpecificRecovery ? 'request-aligned' : 'selected-domain-aligned'} DIRECT/SUPPORTING candidate sample(s); direct=${retainedDirectEvidenceCount}, supporting=${supportingEvidenceSamples.length}. These candidates are not authoritative until they are merged and re-verified in the run-level canonical evidence ledger.`,
      );
    } else {
      this.logger.debug(
        `Targeted recovery produced no provisional ${requestSpecificRecovery ? 'request-aligned' : 'selected-domain-aligned'} DIRECT/SUPPORTING candidate after semantic classification. New canonical provenance rows=${rawEvidenceCorpus.length}, diagnostic unique texts=${canonicalNovelRecoverySamples.length}. The run-level canonical ledger remains authoritative.`,
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

    /*
     * Do not run a second deterministic semantic admission path after Community
     * AI has already returned a usable DIRECT/SUPPORTING verdict for the new
     * corpus. The canonical ledger still performs provenance/structural
     * verification below; this simply removes the redundant heuristic fallback
     * that could emit a misleading "nothing survived alignment" diagnostic
     * even while the accepted AI verdict was being retained.
     */
    const deterministicEmergencyFallback = acceptedCommunityAiRecovery
      ? null
      : this.buildDeterministicRecoveryAnalysis(
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
      selectedDataSourceKeys: plannedRecoverySources.map((source) => source.key),
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
          Boolean(recoveryQueryPlan?.aiUsed),
      },
      communityAiAnalysis,
    };
    } finally {
      clearTimeout(recoveryDeadlineHandle);
      parentSignal?.removeEventListener('abort', abortRecovery);
    }
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

  private buildRecoverySourceOutcomes(
    context: IdeaGenerationContext,
  ): Array<{
    readonly sourceKey: string;
    readonly rawCount: number;
    readonly trustedCount: number;
    readonly contextCount: number;
    readonly unrelatedCount: number;
    readonly status: 'USEFUL' | 'CONTEXT_ONLY' | 'UNRELATED_ONLY' | 'EMPTY' | 'DEGRADED';
  }> {
    const sourceKeys = new Set<string>([
      ...(context.selectedDataSources ?? []).map((source) => source.key),
      ...(context.collectionPlan?.sourcePlans ?? []).map((plan) => plan.sourceKey),
      ...(context.rawEvidenceCorpus ?? []).map((item) => item.sourceKey),
      ...(context.canonicalEvidenceLedger ?? []).map((item) => item.sourceKey),
    ].map((key) => key.trim().toLocaleLowerCase()).filter(Boolean));

    return [...sourceKeys].map((sourceKey) => {
      const rawCount = (context.rawEvidenceCorpus ?? []).filter(
        (item) => item.sourceKey.trim().toLocaleLowerCase() === sourceKey,
      ).length;
      const canonical = (context.canonicalEvidenceLedger ?? []).filter(
        (item) => item.sourceKey.trim().toLocaleLowerCase() === sourceKey,
      );
      const trustedCount = canonical.filter(
        (item) =>
          item.verified &&
          (item.classification === 'DIRECT_PROBLEM' ||
            item.classification === 'SUPPORTING_SIGNAL'),
      ).length;
      const contextCount = canonical.filter(
        (item) => item.classification === 'CONTEXT_ONLY',
      ).length;
      const unrelatedCount = canonical.filter(
        (item) => item.classification === 'UNRELATED',
      ).length;
      const degraded = this.collectorSourceHealth.isTemporarilyDegraded(sourceKey);
      const status = degraded
        ? 'DEGRADED' as const
        : trustedCount > 0
          ? 'USEFUL' as const
          : rawCount === 0
            ? 'EMPTY' as const
            : unrelatedCount > 0 && contextCount === 0
              ? 'UNRELATED_ONLY' as const
              : 'CONTEXT_ONLY' as const;
      return {
        sourceKey,
        rawCount,
        trustedCount,
        contextCount,
        unrelatedCount,
        status,
      };
    });
  }

  /**
   * Excludes sources that actually failed, timed out, or were rate-limited in
   * the primary job. Healthy zero-yield sources remain eligible because the
   * recovery pass uses a different, problem-focused query.
   */
  private async resolveLowYieldSourceKeys(
    context: IdeaGenerationContext,
    runLocalExcluded: ReadonlySet<string> = new Set<string>(),
  ): Promise<ReadonlySet<string>> {
    const collectionJobId = context.collection?.collectionJobId;
    const priorRecoveryJobIds = context.evidenceRecoveryCollectionJobIds.filter(
      (value) =>
        value &&
        !value.startsWith('recovery-') &&
        value !== 'recovery-time-budget-exhausted',
    );
    if (!collectionJobId && priorRecoveryJobIds.length === 0) {
      return new Set(runLocalExcluded);
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

      const excluded = new Set<string>(runLocalExcluded);
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
      return new Set(runLocalExcluded);
    }
  }

  /**
   * Immediate in-memory source outcome view for the current generation run.
   * This executes without a database round-trip, so recovery cannot lose its
   * zero-yield exclusions just because Supabase diagnostics exceed a soft
   * deadline.
   */
  private resolveRunLocalLowYieldSourceKeys(
    context: IdeaGenerationContext,
  ): ReadonlySet<string> {
    const excluded = new Set<string>();
    const rawSourceKeys = new Set(
      (context.rawEvidenceCorpus ?? [])
        .map((item) => item.sourceKey.trim().toLocaleLowerCase())
        .filter(Boolean),
    );
    const attemptedSourceKeys = new Set([
      ...(context.selectedDataSources ?? [])
        .map((source) => source.key.trim().toLocaleLowerCase())
        .filter(Boolean),
      ...(context.collectionPlan?.sourcePlans ?? [])
        .map((plan) => plan.sourceKey.trim().toLocaleLowerCase())
        .filter(Boolean),
    ]);
    const canonicalBySource = new Map<
      string,
      IdeaGenerationContext['canonicalEvidenceLedger']
    >();
    for (const item of context.canonicalEvidenceLedger ?? []) {
      const key = item.sourceKey.trim().toLocaleLowerCase();
      const entries = canonicalBySource.get(key) ?? [];
      canonicalBySource.set(key, [...entries, item]);
    }
    const rawCountsBySource = new Map<string, number>();
    for (const item of context.rawEvidenceCorpus ?? []) {
      const key = item.sourceKey.trim().toLocaleLowerCase();
      rawCountsBySource.set(key, (rawCountsBySource.get(key) ?? 0) + 1);
    }
    for (const key of attemptedSourceKeys) {
      /*
       * A healthy source that returned raw/context material is not exhausted.
       * Recovery uses a novel, problem-focused query and may legitimately turn
       * the same source into a useful direct/supporting lane. Exclude only
       * sources that returned no raw material at all or are currently degraded.
       * Database diagnostics below still exclude failed/rate-limited/timeouts.
       */
      if (!rawSourceKeys.has(key)) {
        excluded.add(key);
      }
      const canonicalRows = canonicalBySource.get(key) ?? [];
      const rawCount = rawCountsBySource.get(key) ?? 0;
      const everyReviewedRowWasUnrelated =
        rawCount >= 2 &&
        canonicalRows.length > 0 &&
        canonicalRows.every((item) => item.classification === 'UNRELATED');
      if (everyReviewedRowWasUnrelated) {
        /*
         * A single bounded recovery wave should rotate away from a source that
         * already returned multiple items and Community AI + deterministic
         * verification agreed they were all unrelated. This is request-local,
         * not a global source ban; the same source remains eligible for other
         * users/domains/runs.
         */
        excluded.add(key);
      }
      if (this.collectorSourceHealth.isTemporarilyDegraded(key)) {
        excluded.add(key);
      }
    }
    return excluded;
  }

  /**
   * Ranks recovery sources by semantic request fit first and runtime health
   * second. Health is an eligibility/reliability signal, not a substitute for
   * corpus relevance. This prevents healthy developer sources from outranking
   * community/research sources for physical or operational workflows.
   */
  private scoreRecoverySource(
    context: IdeaGenerationContext,
    source: SelectedIdeaDataSource,
    sourcePlan?: {
      readonly queries?: readonly string[];
      readonly routingHints?: readonly string[];
    } | null,
    semanticDescription?: string,
  ): number {
    const semanticFit = this.collectorsFactory.getCollectorRequestFitScore(
      source.key,
      {
        requestDescription:
          semanticDescription?.trim() || context.requestDescription,
        domainName: context.domainName,
        keywords: context.keywords,
        plannedQueries:
          sourcePlan?.queries ?? context.collectionPlan?.searchQueries ?? [],
        sourceHints: sourcePlan?.routingHints ?? [],
        collectionMode: 'TARGETED_RECOVERY',
      },
    );
    const health = Math.max(
      0,
      Math.min(1, this.collectorSourceHealth.score(source.key) / 1.25),
    );
    /*
     * Recovery ranking is driven by the collector's generic request-fit score,
     * runtime health, and whether the adaptive AI explicitly selected the lane.
     * Do not add another domain/workflow keyword table here: each new test must
     * be handled by the planner + observed source outcomes, not by another
     * hand-authored source preference branch.
     */
    const directDiscussionBonus = source.supportsComments ? 0.03 : 0;
    const plannerBonus = sourcePlan ? 0.10 : 0;
    const priorOutcome = this.buildRecoverySourceOutcomes(context).find(
      (outcome) =>
        outcome.sourceKey === source.key.trim().toLocaleLowerCase(),
    )?.status;
    /*
     * Adapt from the actual run instead of hard-coding a domain -> source map.
     * A lane that returned only unrelated material should lose priority; a lane
     * with some useful signal may still be revisited for corroboration with a
     * materially different query. AI planner selection remains a positive
     * signal and can overcome a mild CONTEXT_ONLY penalty when it has a new
     * retrieval strategy.
     */
    const observedYieldAdjustment =
      priorOutcome === 'USEFUL'
        ? 0.04
        : priorOutcome === 'CONTEXT_ONLY'
          ? -0.14
          : priorOutcome === 'UNRELATED_ONLY'
            ? -0.28
            : priorOutcome === 'EMPTY'
              ? -0.18
              : priorOutcome === 'DEGRADED'
                ? -0.45
                : 0;
    const attemptedSourceKeys = new Set([
      ...(context.selectedDataSources ?? []).map((item) => item.key),
      ...(context.collectionPlan?.sourcePlans ?? []).map((plan) => plan.sourceKey),
    ].map((key) => key.trim().toLocaleLowerCase()).filter(Boolean));
    const sourceKey = source.key.trim().toLocaleLowerCase();
    const provenanceNoveltyAdjustment = attemptedSourceKeys.has(sourceKey)
      ? -0.08
      : 0.14;
    return (
      semanticFit * 0.68 +
      health * 0.20 +
      directDiscussionBonus +
      plannerBonus +
      observedYieldAdjustment +
      provenanceNoveltyAdjustment
    );
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
  }  private resolveRecoveryDomainLanes(
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
  }  /**
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
  }  /** Collects primary evidence so recovered paraphrases cannot be recounted. */
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
  }  /** Gives Community AI the novel recovered corpus before emergency fallback. */
  private async analyzeRecoveredEvidenceWithCommunityAi(
    context: IdeaGenerationContext,
    nlp: IdeaGenerationNlpContext,
    recoveryRawCorpus: readonly IdeaGenerationRawEvidenceItem[],
    signal?: AbortSignal,
    deadlineAt?: number,
  ): Promise<CommunityAiAnalysis | null> {
    if (recoveryRawCorpus.length === 0) return null;

    const samplePosts = recoveryRawCorpus
      .filter((entry) => entry.sourceType === 'POST')
      .map((entry) => ({
        id: entry.id,
        text: entry.text,
        sentiment: 'NEUTRAL',
      }));
    const sampleComments = recoveryRawCorpus
      .filter((entry) => entry.sourceType === 'COMMENT')
      .map((entry) => ({
        id: entry.id,
        text: entry.text,
        sentiment: 'NEUTRAL',
      }));
    const recoveryContext: IdeaGenerationContext = {
      ...context,
      nlp: {
        ...nlp,
        totalTextsAnalyzed: recoveryRawCorpus.length,
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
      rawEvidenceCorpus: recoveryRawCorpus.map((entry) => ({
        ...entry,
        collectionPhase: 'RECOVERY',
      })),
      communityAiAnalysis: null,
    };

    try {
      if (signal?.aborted) return null;
      const remainingMs = deadlineAt
        ? Math.max(0, deadlineAt - Date.now())
        : Math.min(10_000, Math.max(7_000, 7_000 + recoveryRawCorpus.length * 300));
      if (remainingMs < 1_000) return null;

      /*
       * Recovery triage is independent from the collection wall-clock once raw
       * provenance rows exist. Keep the SAME complete recovery corpus as one
       * semantic unit, and use an adaptive safety ceiling. This ceiling is not
       * latency paid on every run: the parallel race still early-stops on the
       * first complete valid answer.
       */
      const adaptiveTotalMs = Math.min(
        10_000,
        Math.max(7_000, 7_000 + recoveryRawCorpus.length * 300),
      );
      const boundedTotalMs = Math.max(1_000, Math.min(adaptiveTotalMs, remainingMs));
      const requestTimeoutMs = Math.max(
        850,
        Math.min(boundedTotalMs - 350, 15_000),
      );
      return await this.communityAiAnalysisService.analyze(recoveryContext, {
        classificationOnly: true,
        maxAttempts: 2,
        requestTimeoutMs,
        totalTimeoutMs: boundedTotalMs,
        signal,
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
    if (!this.looksLikeUsableProblemEvidence(sample)) return false;

    if (requestSpecificRecovery && context.requestDescription?.trim()) {
      return (
        RequestEvidenceAlignmentUtil.classifyForRequestFallback({
          requestDescription: context.requestDescription,
          evidenceText: sample,
          plannedQueries: context.collectionPlan?.searchQueries ?? [],
        }) === 'SUPPORTING_SIGNAL'
      );
    }

    if (!context.requestDescription?.trim()) {
      return this.isStrictDomainOnlyRecoveryEvidence(sample, context);
    }

    return this.isEvidenceAlignedToRequest(sample, context);
  }

  private isWorkflowAdjacentSupportingEvidence(
    sample: string,
    context: IdeaGenerationContext,
  ): boolean {
    const requestDescription = context.requestDescription?.trim() ?? '';
    if (!requestDescription) {
      return this.isStrictDomainOnlyRecoveryEvidence(sample, context);
    }

    return (
      RequestEvidenceAlignmentUtil.classifyForRequestFallback({
        requestDescription,
        evidenceText: sample,
        plannedQueries: context.collectionPlan?.searchQueries ?? [],
      }) === 'SUPPORTING_SIGNAL'
    );
  }  private isStrictDomainOnlyRecoveryEvidence(
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
    void context;
    const value = sample.replace(/\s+/gu, ' ').trim();
    if (!value) return false;
    return this.looksLikeUsableProblemEvidence(value) &&
      !isLikelyPromotionalEvidence(value);
  }  private isEvidenceAlignedToRequest(
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
  }  /**
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
  }  private resolveRecoveryCollectorLimits(
    _compact = false,
    _requestSpecific = false,
  ): {
    readonly maxFetchedPosts: number;
    readonly maxSavedPosts: number;
    readonly maxFetchedComments: number;
    readonly maxSavedComments: number;
  } {
    // Recovery is an exceptional sparse-first-pass rescue only. The main
    // collection wave already performs broad source-diverse retrieval, so a
    // recovery wave must stay tiny and cannot become a second broad crawl.
    return {
      maxFetchedPosts: Math.min(
        this.readPositiveConfig('RECOVERY_MAX_FETCHED_POSTS', 3),
        3,
      ),
      maxSavedPosts: Math.min(
        this.readPositiveConfig('RECOVERY_MAX_SAVED_POSTS', 2),
        2,
      ),
      maxFetchedComments: Math.min(
        this.readPositiveConfig('RECOVERY_MAX_FETCHED_COMMENTS', 4),
        4,
      ),
      maxSavedComments: Math.min(
        this.readPositiveConfig('RECOVERY_MAX_SAVED_COMMENTS', 2),
        2,
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