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
import { CollectorRequestCapabilityUtil } from '../../../collectors/base/collector-request-capability.util';
import { RequestEvidenceAlignmentUtil } from '../utils/request-evidence-alignment.util';
import { SelectedDomainEvidenceAlignmentUtil } from '../utils/selected-domain-evidence-alignment.util';
import { RequestDynamicQueryUtil } from '../utils/request-dynamic-query.util';
import { RequestQueryProvenanceUtil } from '../utils/request-query-provenance.util';
import { SourceSpecificEvidenceQueryUtil } from '../utils/source-specific-evidence-query.util';
import { RequestWorkflowSourcePolicyUtil } from '../utils/request-workflow-source-policy.util';
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
import type {
  RequestCollectionPlan,
  RequestCausalSearchProbe,
} from '../types/request-collection-plan.type';
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
  /** Non-null only when this wave corroborated an already evidence-selected canonical family. */
  readonly corroborationTargetFamily?: string | null;
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
  private readonly maximumRecoveryKeywords = 20;
  /*
   * Keep each zero-trusted text recovery wave bounded to four healthy lanes in parallel.  Very
   * sparse workflows frequently lose a preferred source to rate limiting and
   * have no dedicated forum result; a third professional/secondary lane gives
   * the same bounded wave a realistic chance to find supporting evidence
   * without adding a second serial recovery cycle.
   */
  private readonly maximumRecoverySourcesPerWave = 4;

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
    const preflightSelectedSourceIdentities = new Set(
      preflightSelectedTrusted.map((item) => EvidenceSourceIdentityUtil.resolve(item)),
    );
    const independentlyReviewedAlternativeSources = new Set(
      (context.canonicalEvidenceLedger ?? [])
        .filter(
          (item) =>
            item.adjudicationStatus === 'ADJUDICATED' &&
            item.classification !== 'UNADJUDICATED' &&
            !preflightSelectedFamilyIds.has(item.id),
        )
        .map((item) => EvidenceSourceIdentityUtil.resolve(item))
        .filter((identity) => !preflightSelectedSourceIdentities.has(identity)),
    );
    const preflightGlobalTrustedCount = (context.canonicalEvidenceLedger ?? []).filter(
      (item) =>
        item.verified &&
        (item.classification === 'DIRECT_PROBLEM' ||
          item.classification === 'SUPPORTING_SIGNAL'),
    ).length;
    const requesterScopedRecovery = Boolean(context.requestDescription?.trim());
    const zeroTrustedDiscoveryRecovery = Boolean(
      !requesterScopedRecovery && preflightGlobalTrustedCount === 0,
    );
    const evidenceGuaranteeRecovery = preflightGlobalTrustedCount === 0;
    const lowExpectedYieldCorroboration = Boolean(
      corroborationOnlyRecovery &&
        context.evidenceRecoveryAttempts === 0 &&
        preflightSelectedTrusted.length >= 3 &&
        (context.rawEvidenceCorpus?.length ?? 0) >= 12 &&
        independentlyReviewedAlternativeSources.size >= 2,
    );
    const broadDiscoverySingleSourceCorroboration = Boolean(
      corroborationOnlyRecovery &&
        !context.requestDescription?.trim() &&
        context.evidenceRecoveryAttempts === 0 &&
        (context.rawEvidenceCorpus?.length ?? 0) >= 8 &&
        preflightGlobalTrustedCount >= 1 &&
        independentlyReviewedAlternativeSources.size >= 1 &&
        preflightSelectedTrusted.length === 1 &&
        preflightSelectedTrusted.every(
          (item) => item.classification === 'SUPPORTING_SIGNAL',
        ),
    );
    const broadDiscoveryRepeatedFamilySupport = Boolean(
      corroborationOnlyRecovery &&
        !context.requestDescription?.trim() &&
        context.evidenceRecoveryAttempts === 0 &&
        preflightSelectedTrusted.length >= 2 &&
        (context.rawEvidenceCorpus?.length ?? 0) >= 10 &&
        independentlyReviewedAlternativeSources.size >= 2,
    );
    if (
      lowExpectedYieldCorroboration ||
      broadDiscoverySingleSourceCorroboration ||
      broadDiscoveryRepeatedFamilySupport
    ) {
      this.logger.debug(
        broadDiscoveryRepeatedFamilySupport
          ? `Skipping single-source corroboration micro-wave because the selected discovery family already has ${preflightSelectedTrusted.length} trusted row(s) and the broad primary corpus reviewed ${independentlyReviewedAlternativeSources.size} alternative source(s). The family remains explicitly single-source/preliminary without paying another serial recovery tail.`
          : broadDiscoverySingleSourceCorroboration
            ? `Skipping single-source corroboration micro-wave because discovery already reviewed a broad ${context.rawEvidenceCorpus?.length ?? 0}-row corpus with ${preflightGlobalTrustedCount} trusted signal(s) and at least ${independentlyReviewedAlternativeSources.size} independently reviewed alternative source(s). The selected family has preliminary supporting evidence but no DIRECT_PROBLEM signal, so another serial source chase has low expected marginal value.`
            : `Skipping targeted corroboration recovery because the broad primary pass already reviewed ${independentlyReviewedAlternativeSources.size} independent alternative source(s) without adding family-matched evidence, while the selected family already has ${preflightSelectedTrusted.length} trusted signal(s) from ${preflightSelectedSourceCount} source(s). Expected marginal yield is too low for another serial wave.`,
      );
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
      10_500,
    );
    const recoveryBudgetMs = corroborationOnlyRecovery
      ? Math.max(3_000, Math.min(3_600, configuredRecoveryBudgetMs))
      : zeroTrustedDiscoveryRecovery
        ? Math.max(8_500, Math.min(10_500, configuredRecoveryBudgetMs))
        : requesterScopedRecovery && evidenceGuaranteeRecovery
          ? Math.max(9_500, Math.min(10_500, configuredRecoveryBudgetMs))
          : requesterScopedRecovery
            ? Math.max(6_800, Math.min(8_500, configuredRecoveryBudgetMs))
            : Math.max(4_800, Math.min(5_800, configuredRecoveryBudgetMs));
    const recoveryTotalDeadlineAt = recoveryStartedAt +
      (zeroTrustedDiscoveryRecovery
        ? 15_000
        : requesterScopedRecovery
          ? 12_500
          : 9_000);
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
    const recoveryIntentMode = context.collectionPlan?.requestIntent?.mode;
    const internalProblemLockedRecovery = recoveryIntentMode === 'EXPLICIT_PROBLEM';
    const discoveryRoutingDescription = [
      ...context.selectedDomains.map((domain) => domain.name.trim()),
      context.domainName?.trim() ?? '',
      context.collectionPlan?.domainIdentity?.actor ?? '',
      context.collectionPlan?.domainIdentity?.object ?? '',
      context.collectionPlan?.domainIdentity?.workflow ?? '',
      ...(context.collectionPlan?.retrievalVocabulary ?? []).slice(0, 6),
    ]
      .filter(Boolean)
      .join(' ');
    const canonicalRoutingFamily =
      context.communityAiAnalysis?.canonicalProblemFamilyLabel?.trim() ||
      context.communityAiAnalysis?.selectedProblemFamily?.trim() ||
      selectedOpportunity?.problem?.trim() ||
      selectedOpportunity?.title?.trim() ||
      '';
    const recoveryRoutingDescription = internalProblemLockedRecovery
      ? context.requestDescription?.trim() || canonicalRoutingFamily
      : corroborationOnlyRecovery && canonicalRoutingFamily
        ? canonicalRoutingFamily
        : discoveryRoutingDescription || canonicalRoutingFamily;
    const lockedProblemFamily =
      context.communityAiAnalysis?.canonicalProblemFamilyLabel?.trim() ||
      context.communityAiAnalysis?.selectedProblemFamily?.trim() ||
      selectedOpportunity?.problem?.trim() ||
      selectedOpportunity?.title?.trim() ||
      '';
    const primaryReturnedNoRawEvidence =
      (context.rawEvidenceCorpus?.length ?? 0) === 0;
    /*
     * A literal zero-row first pass means request-fit ranking never got a chance
     * to be validated by evidence yield. Keep runtime executability/health hard,
     * but lower only the generic fit floor so a healthy UNUSED reserve corpus can
     * be tried. This is source-routing resilience, not semantic classification.
     */
    const recoveryRequestFitFloor = primaryReturnedNoRawEvidence ? 0.24 : 0.42;
    const preflightRecoveryOutcomeBySource = new Map(
      this.buildRecoverySourceOutcomes(context).map(
        (outcome) => [outcome.sourceKey, outcome.status] as const,
      ),
    );
    const primaryAttemptedSourceKeys = new Set(
      [
        ...(context.selectedDataSources ?? []).map((source) => source.key),
        ...(context.rawEvidenceCorpus ?? []).map((item) => item.sourceKey),
      ]
        .map((key) => key.trim().toLocaleLowerCase())
        .filter(Boolean),
    );

    const resolveEligibleRecoverySources = (
      fitFloor: number,
      maximumSources = this.maximumRecoverySourcesPerWave,
      allowZeroTrustedPrimaryReplay = false,
    ): SelectedIdeaDataSource[] =>
      recoveryCandidateSources
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
          const priorOutcome = preflightRecoveryOutcomeBySource.get(key);
          if (
            requesterScopedRecovery &&
            evidenceGuaranteeRecovery &&
            !allowZeroTrustedPrimaryReplay &&
            primaryAttemptedSourceKeys.has(key) &&
            (priorOutcome === 'EMPTY' || priorOutcome === 'UNRELATED_ONLY')
          ) {
            return false;
          }
          if (
            RequestWorkflowSourcePolicyUtil.shouldSuppressAppReviewLanes({
              requestDescription: context.requestDescription,
              problemProfile: context.collectionPlan?.problemProfile,
            }) &&
            RequestWorkflowSourcePolicyUtil.isAppReviewSource(key)
          ) {
            return false;
          }
          if (
            RequestWorkflowSourcePolicyUtil.shouldSuppressDeveloperCommunityLanes({
              requestDescription: context.requestDescription,
              problemProfile: context.collectionPlan?.problemProfile,
            }) &&
            RequestWorkflowSourcePolicyUtil.isDeveloperCommunitySource(key)
          ) {
            return false;
          }

          const capabilityInput = {
            requestDescription:
              recoveryRoutingDescription || context.requestDescription,
            domainName: context.requestDescription?.trim()
              ? undefined
              : context.domainName,
            keywords: context.collectionPlan?.problemProfile
              ? [
                  context.collectionPlan.problemProfile.actor,
                  context.collectionPlan.problemProfile.object,
                  context.collectionPlan.problemProfile.workflow,
                  context.collectionPlan.problemProfile.friction ?? '',
                  ...context.collectionPlan.problemProfile.failureModes,
                  ...context.collectionPlan.problemProfile.consequences,
                ]
              : context.collectionPlan?.intentConcepts ?? [],
            plannedQueries: context.collectionPlan?.searchQueries ?? [],
            collectionMode: 'TARGETED_RECOVERY' as const,
          };
          if (
            recoveryRoutingDescription &&
            this.collectorsFactory.getCollectorRequestFitScore(
              key,
              capabilityInput,
            ) < fitFloor
          ) {
            return false;
          }

          return this.collectorsFactory.isCollectorRouteExecutable(
            source.key,
            capabilityInput,
          );
        })
        .sort((left, right) => {
          const guaranteePriority = (source: SelectedIdeaDataSource): number => {
            if (!evidenceGuaranteeRecovery) return 0;
            const key = source.key.trim().toLocaleLowerCase();
            const status = preflightRecoveryOutcomeBySource.get(key);
            /*
             * Zero-trusted text recovery should expose at least one new
             * evidence surface when available. Unseen executable sources rank
             * first here, then the balanced-wave selector below reserves room
             * for productive/context-bearing primary sources with exact-new
             * atomic probes. Semantic gates stay unchanged.
             */
            if (
              requesterScopedRecovery &&
              !primaryAttemptedSourceKeys.has(key)
            ) {
              return 8;
            }
            if (!status) return 4;
            if (status === 'USEFUL') return 3;
            if (status === 'CONTEXT_ONLY') return 2;
            if (status === 'EMPTY') return 0;
            if (status === 'UNRELATED_ONLY') return -1;
            return -2;
          };
          return (
            guaranteePriority(right) - guaranteePriority(left) ||
            this.scoreRecoverySource(context, right, null, recoveryRoutingDescription) -
              this.scoreRecoverySource(context, left, null, recoveryRoutingDescription) ||
            left.key.localeCompare(right.key)
          );
        })
        .slice(0, Math.max(1, maximumSources));

    let selectedRecoverySources = resolveEligibleRecoverySources(
      recoveryRequestFitFloor,
      zeroTrustedDiscoveryRecovery ? 3 : this.maximumRecoverySourcesPerWave,
    );

    /*
     * Niche text requests can legitimately have no route above the normal
     * request-fit floor even though a healthy reserve source is executable.
     * When the run still has zero canonical trusted evidence, relax only source
     * ROUTING (never evidence verification) and try at most two healthy reserve
     * lanes. Failed, timed-out, rate-limited and run-locally unrelated sources
     * remain excluded. The AI recovery plan still has to provide materially
     * novel problem-focused queries before either lane executes.
     */
    const preflightExactRequesterTrustedCount =
      (context.canonicalEvidenceLedger ?? []).filter(
        (item) =>
          item.verified &&
          item.problemAlignment === 'MATCH' &&
          (item.classification === 'DIRECT_PROBLEM' ||
            item.classification === 'SUPPORTING_SIGNAL'),
      ).length;
    if (
      selectedRecoverySources.length === 0 &&
      Boolean(context.requestDescription?.trim()) &&
      preflightExactRequesterTrustedCount === 0 &&
      !primaryReturnedNoRawEvidence
    ) {
      selectedRecoverySources = resolveEligibleRecoverySources(0.30, 3);
      if (selectedRecoverySources.length > 0) {
        this.logger.debug(
          `Targeted text recovery activated ${selectedRecoverySources.length} healthy reserve source lane(s) below the normal fit floor because no exact requester-matched canonical trusted evidence survived the primary pass. Semantic trust thresholds remain unchanged.`,
        );
      }
    }
    if (selectedRecoverySources.length === 0 && evidenceGuaranteeRecovery) {
      selectedRecoverySources = resolveEligibleRecoverySources(
        0.22,
        zeroTrustedDiscoveryRecovery ? 3 : 3,
      );
      if (selectedRecoverySources.length > 0) {
        this.logger.debug(
          `Evidence-guarantee recovery activated ${selectedRecoverySources.length} healthy reserve source lane(s) after the normal novelty/fit surface retained zero trusted evidence. This relaxes source routing only; canonical evidence verification remains unchanged.`,
        );
      }
    }

    /*
     * For a zero-trusted TEXT run, one entirely new source is useful, but it
     * must not crowd out primary sources that already returned productive or
     * context-bearing rows. The single bounded wave therefore mixes provenance
     * novelty with exact-new atomic re-queries on productive sources. This keeps
     * recovery from collapsing to two unseen but empty lanes while preserving
     * strict canonical evidence admission.
     */
    if (requesterScopedRecovery && evidenceGuaranteeRecovery) {
      const replayPriority = (source: SelectedIdeaDataSource): number => {
        const status = preflightRecoveryOutcomeBySource.get(
          source.key.trim().toLocaleLowerCase(),
        );
        if (status === 'USEFUL') return 6;
        if (status === 'CONTEXT_ONLY') return 5;
        if (status === 'EMPTY') return 2;
        if (status === 'UNRELATED_ONLY') return 1;
        return 0;
      };
      const allEligibleRecoverySources = resolveEligibleRecoverySources(
        0.18,
        Math.max(
          this.maximumRecoverySourcesPerWave,
          recoveryCandidateSources.length,
        ),
        true,
      );
      const novelRecoverySources = allEligibleRecoverySources.filter(
        (source) =>
          !primaryAttemptedSourceKeys.has(
            source.key.trim().toLocaleLowerCase(),
          ),
      );
      const productiveReplaySources = allEligibleRecoverySources
        .filter((source) => {
          const key = source.key.trim().toLocaleLowerCase();
          return (
            primaryAttemptedSourceKeys.has(key) &&
            replayPriority(source) >= 5
          );
        })
        .sort(
          (left, right) =>
            replayPriority(right) - replayPriority(left) ||
            this.scoreRecoverySource(
              context,
              right,
              null,
              recoveryRoutingDescription,
            ) -
              this.scoreRecoverySource(
                context,
                left,
                null,
                recoveryRoutingDescription,
              ),
        );
      const reserveReplaySources = allEligibleRecoverySources
        .filter((source) => {
          const key = source.key.trim().toLocaleLowerCase();
          return (
            primaryAttemptedSourceKeys.has(key) &&
            !productiveReplaySources.some(
              (candidate) =>
                candidate.key.trim().toLocaleLowerCase() === key,
            ) &&
            replayPriority(source) > 0
          );
        })
        .sort(
          (left, right) =>
            replayPriority(right) - replayPriority(left) ||
            this.scoreRecoverySource(
              context,
              right,
              null,
              recoveryRoutingDescription,
            ) -
              this.scoreRecoverySource(
                context,
                left,
                null,
                recoveryRoutingDescription,
              ),
        );

      const diverseNovelRecoverySources: SelectedIdeaDataSource[] = [];
      const usedNovelArchetypes = new Set<string>();
      for (const source of novelRecoverySources) {
        if (diverseNovelRecoverySources.length >= 2) break;
        const archetype = CollectorRequestCapabilityUtil.sourceArchetype(
          source.key,
        );
        if (usedNovelArchetypes.has(archetype)) continue;
        usedNovelArchetypes.add(archetype);
        diverseNovelRecoverySources.push(source);
      }
      for (const source of novelRecoverySources) {
        if (diverseNovelRecoverySources.length >= 2) break;
        if (
          diverseNovelRecoverySources.some(
            (candidate) =>
              candidate.key.trim().toLocaleLowerCase() ===
              source.key.trim().toLocaleLowerCase(),
          )
        ) {
          continue;
        }
        diverseNovelRecoverySources.push(source);
      }

      const balancedRecoverySources = [
        ...diverseNovelRecoverySources.slice(0, 2),
        ...productiveReplaySources.slice(0, 1),
        ...novelRecoverySources,
        ...productiveReplaySources.slice(1),
        ...reserveReplaySources,
        ...selectedRecoverySources,
      ].filter(
        (source, index, all) =>
          all.findIndex(
            (candidate) =>
              candidate.key.trim().toLocaleLowerCase() ===
              source.key.trim().toLocaleLowerCase(),
          ) === index,
      );

      selectedRecoverySources = balancedRecoverySources.slice(
        0,
        this.maximumRecoverySourcesPerWave,
      );
      if (selectedRecoverySources.length > 0) {
        this.logger.debug(
          `Zero-trusted text recovery selected a balanced ${selectedRecoverySources.length}-source wave: novel=${selectedRecoverySources.filter((source) => !primaryAttemptedSourceKeys.has(source.key.trim().toLocaleLowerCase())).length}, productiveReplay=${selectedRecoverySources.filter((source) => productiveReplaySources.some((candidate) => candidate.key.trim().toLocaleLowerCase() === source.key.trim().toLocaleLowerCase())).length}, archetypes=${[...new Set(selectedRecoverySources.map((source) => CollectorRequestCapabilityUtil.sourceArchetype(source.key)))].join(',')}. The bounded wave prefers two provenance-new evidence archetypes plus one productive replay when available; semantic evidence thresholds remain unchanged.`,
        );
      }
    }

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
    const remainingSourcesAreHardDegraded =
      selectedRecoverySources.length > 0 &&
      selectedRecoverySources.every((source) => {
        const status = sourceOutcomeByKey.get(
          source.key.trim().toLocaleLowerCase(),
        );
        return status === 'DEGRADED';
      });

    /*
     * Stop BEFORE the first serial recovery wave when a successful AI-owned
     * text plan already produced a fully adjudicated, non-trivial corpus, no
     * trusted evidence survived, and recovery has no genuinely new source lane.
     * Re-querying hard-degraded sources has very low marginal value and was
     * responsible for zero-yield tails on sparse niche requests. A healthy
     * source that returned EMPTY or CONTEXT material is not exhausted: a fresh
     * materially novel AI-owned recovery query can still improve recall without
     * changing semantic truth. Thin corpora,
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
        remainingSourcesAreHardDegraded,
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
    const lockedRequesterProblemRecovery =
      context.collectionPlan?.requestIntent?.mode === 'EXPLICIT_PROBLEM';
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
     * For a text-bearing discovery run, once evidence has selected a canonical
     * family, only that family counts as existing semantic coverage for
     * corroboration. Before a family exists, requester text remains retrieval
     * context and cannot suppress discovery merely because an adjacent row is
     * present in the audit ledger.
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
     * through new healthy source-specific lanes below. A zero-trusted text run
     * always receives one semantic/query rotation, but a successful AI-owned
     * primary plan reuses its accepted semantics instead of paying for another
     * redundant planner call.
     */
    const rawEvidenceCount = context.rawEvidenceCorpus?.length ?? 0;
    const rawEvidenceSourceCount = new Set(
      (context.rawEvidenceCorpus ?? []).map((item) => item.sourceKey),
    ).size;
    const adjudicatedPrimaryClassifications =
      context.communityAiAnalysis?.evidenceClassifications?.filter(
        (item) => item.adjudicationStatus === 'ADJUDICATED',
      ) ?? [];
    const primaryContextOnlyCount = adjudicatedPrimaryClassifications.filter(
      (item) => item.classification === 'CONTEXT_ONLY',
    ).length;
    const primaryContextOnlyRatio =
      primaryContextOnlyCount / Math.max(1, adjudicatedPrimaryClassifications.length);
    const exactRequesterTrustedCount = adjudicatedPrimaryClassifications.filter(
      (item) =>
        item.verifiedByDeterministicGuard === true &&
        item.problemAlignment === 'MATCH' &&
        (item.classification === 'DIRECT_PROBLEM' ||
          item.classification === 'SUPPORTING_SIGNAL'),
    ).length;
    const firstPassNeedsSemanticRotation = Boolean(
      requestSpecificRecovery &&
        context.evidenceRecoveryAttempts === 0 &&
        (
          primaryTrustedCount === 0 ||
          needsExpandedRequestRecovery ||
          exactRequesterTrustedCount === 0
        ),
    );
    /*
     * A broad first pass that was already AI-planned does not need to pay for a
     * second 2.5-3.5s planning call just to paraphrase the same problem. Reuse
     * its AI-owned causal probes and rotate them through exact-new source/facet
     * combinations below. Fresh AI re-planning is reserved for genuinely thin
     * corpora or requests whose primary plan was deterministic/fallback-owned.
     */
    const firstPassNeedsFreshAiSemanticPlan = Boolean(
      firstPassNeedsSemanticRotation && !primaryPlanWasAiOwned,
    );
    const shouldUseAiRecoveryPlan =
      context.evidenceRecoveryAttempts < MAX_EVIDENCE_RECOVERY_ATTEMPTS &&
      !singleSourceFamilyCorroboration &&
      (firstPassNeedsFreshAiSemanticPlan ||
        (!primaryPlanWasAiOwned && needsExpandedRequestRecovery) ||
        (!requestSpecificRecovery &&
          context.selectedDomains.length > 0 &&
          (!primaryPlanWasAiOwned || rawEvidenceCount < 8)));
    if (singleSourceFamilyCorroboration) {
      this.logger.debug(
        `Recovery corroboration reuses the canonical AI-owned family/vocabulary and skips redundant AI re-planning. family="${lockedProblemFamily || 'unknown'}" existingSources=${trustedCorroborationSourceKeys.size}.`,
      );
    }
    if (firstPassNeedsSemanticRotation) {
      const recoveryReason = primaryTrustedCount === 0
        ? 'zero-trusted'
        : exactRequesterTrustedCount === 0
          ? 'partial-only-without-exact-match'
          : 'insufficient-request-match';
      this.logger.debug(
        `Text recovery is requesting one bounded semantic rotation (${recoveryReason}) because the primary evidence surface was ${rawEvidenceCount < 8 ? 'thin' : 'mostly context-only'}: raw=${rawEvidenceCount}, trusted=${primaryTrustedCount}, exactMatch=${exactRequesterTrustedCount}, adjudicated=${adjudicatedPrimaryClassifications.length}, contextOnlyRatio=${primaryContextOnlyRatio.toFixed(2)}, freshAiReplan=${firstPassNeedsFreshAiSemanticPlan}. AI-owned first passes always reuse their accepted domain identity, causal probes, and retrieval vocabulary; fresh AI planning is reserved only for a deterministic/fallback-owned primary plan.`,
      );
    }

    /*
     * A first-pass semantic rotation needs slightly more provider time than a
     * routine corroboration plan. Live Gemini responses commonly land around
     * 2.6-3.1s; capping that lane at ~2.8-3.0s caused valid niche rotations to
     * fall back deterministically just before the provider returned. Rebalance
     * the SAME recovery envelope instead of extending it: semantic rotation may
     * use up to 3.6s while still reserving 3.5s for bounded collectors. Other
     * recovery modes keep the more conservative 4.4s collector reservation.
     */
    const collectorReserveMs = firstPassNeedsFreshAiSemanticPlan ? 3_500 : 4_400;
    const recoveryPlannerRemainingMs = Math.max(
      0,
      recoveryDeadlineAt - Date.now() - collectorReserveMs,
    );
    const recoveryPlannerBudgetMs = Math.min(
      firstPassNeedsFreshAiSemanticPlan ? 3_600 : 3_000,
      recoveryPlannerRemainingMs,
    );
    const minimumAiPlannerBudgetMs = firstPassNeedsFreshAiSemanticPlan ? 2_300 : 900;
    let recoveryQueryPlan: RequestCollectionPlan | null = null;
    if (shouldUseAiRecoveryPlan && recoveryPlannerBudgetMs >= minimumAiPlannerBudgetMs) {
      const corroborationDescription = lockedProblemFamily;
      const planned = (
        lockedRequesterProblemRecovery ||
        (singleSourceFamilyCorroboration && Boolean(corroborationDescription))
      )
        ? await this.requestCollectionPlanningService.expandEvidenceSearch({
            description: lockedRequesterProblemRecovery
              ? context.requestDescription ?? ''
              : corroborationDescription,
            keywords: [
              ...(lockedProblemFamily ? [lockedProblemFamily] : []),
              ...(context.collectionPlan?.inferredSecondaryScopes ?? []),
              ...context.keywords,
            ].slice(0, 16),
            previousQueries: [
              ...(context.collectionPlan?.searchQueries ?? []),
              ...((context.collectionPlan?.causalSearchProbes ?? []).map(
                (probe: RequestCausalSearchProbe) => probe.query,
              )),
            ],
            evidenceTargets: [
              ...(lockedProblemFamily ? [lockedProblemFamily] : []),
              ...(selectedOpportunity?.problem
                ? [selectedOpportunity.problem]
                : []),
              ...(selectedOpportunity?.title
                ? [selectedOpportunity.title]
                : []),
              ...(lockedRequesterProblemRecovery && !singleSourceFamilyCorroboration
                ? context.collectionPlan?.evidenceTargets ?? []
                : []),
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
              domainNames: [
                ...context.selectedDomains.map((domain) => domain.name),
                ...(context.selectedDomains.length === 0 && context.domainName
                  ? [context.domainName]
                  : []),
              ],
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
      lockedRequesterProblemRecovery
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
    const requestWorkflowIdentity = context.collectionPlan?.domainIdentity;
    const primaryRecoveryQueryKeys = new Set(
      [
        ...(context.collectionPlan?.searchQueries ?? []),
        ...(context.collectionPlan?.sourcePlans ?? []).flatMap(
          (plan) => plan.queries ?? [],
        ),
      ]
        .map((query) => this.sanitizeRecoveryQuery(query).toLocaleLowerCase())
        .filter(Boolean),
    );
    const recoveryDomainNames = [
      ...context.selectedDomains.map((domain) => domain.name.trim()),
      ...(context.domainName?.trim() ? [context.domainName.trim()] : []),
    ]
      .filter(Boolean)
      .filter(
        (name, index, values) =>
          values.findIndex(
            (candidate) =>
              candidate.toLocaleLowerCase() === name.toLocaleLowerCase(),
          ) === index,
      )
      .slice(0, 3);
    const domainProblemDiscoveryRecoveryQueries = recoveryDomainNames
      .flatMap((domainName) => [
        `${domainName} common operational problems complaints`,
        `${domainName} workflow bottlenecks delays failures`,
        `${domainName} practitioner challenges recurring problems`,
        `${domainName} staffing capacity service quality issues`,
        `${domainName} scheduling coordination workload problems`,
        `${domainName} delayed service missed follow ups`,
        `${domainName} resource shortages operational disruption`,
        `${domainName} communication handoff missed updates`,
        `${domainName} recurring service complaints pain points`,
        `${domainName} daily operations failure case`,
      ])
      .map((query) => this.sanitizeRecoveryQuery(query))
      .filter(Boolean)
      .filter((query) => SourceSpecificEvidenceQueryUtil.isSafe(query))
      .filter(
        (query, index, values) =>
          !primaryRecoveryQueryKeys.has(query.toLocaleLowerCase()) &&
          values.findIndex(
            (candidate) =>
              candidate.toLocaleLowerCase() === query.toLocaleLowerCase(),
          ) === index,
      )
      .slice(0, 20);

    const professionalDomainContextRecoveryQueries =
      requestSpecificRecovery && !singleSourceFamilyCorroboration
        ? RequestDynamicQueryUtil.buildProfessionalTerminologyQueries({
            requestDescription: context.requestDescription,
            intentConcepts: context.collectionPlan?.intentConcepts ?? [],
            evidenceTargets: context.collectionPlan?.evidenceTargets ?? [],
            plannedQueries: context.collectionPlan?.searchQueries ?? [],
            maxQueries: 6,
          })
            .map((query) => this.sanitizeRecoveryQuery(query))
            .filter(Boolean)
            .filter((query) => SourceSpecificEvidenceQueryUtil.isSafe(query))
            .filter(
              (query, index, values) =>
                !primaryRecoveryQueryKeys.has(query.toLocaleLowerCase()) &&
                values.findIndex(
                  (candidate) =>
                    candidate.toLocaleLowerCase() === query.toLocaleLowerCase(),
                ) === index,
            )
            .slice(0, 6)
        : [];
    const relaxedDomainContextRecoveryQueries =
      requestSpecificRecovery && !singleSourceFamilyCorroboration
        ? RequestDynamicQueryUtil.buildRelaxedRetrievalQueries({
            requestDescription: context.requestDescription,
            intentConcepts: context.collectionPlan?.intentConcepts ?? [],
            evidenceTargets: context.collectionPlan?.evidenceTargets ?? [],
            plannedQueries: [
              ...(context.collectionPlan?.searchQueries ?? []),
              ...domainProblemDiscoveryRecoveryQueries,
            ],
            maxQueries: 6,
          })
            .map((query) => this.sanitizeRecoveryQuery(query))
            .filter(Boolean)
            .filter((query) => SourceSpecificEvidenceQueryUtil.isSafe(query))
            .filter(
              (query, index, values) =>
                !primaryRecoveryQueryKeys.has(query.toLocaleLowerCase()) &&
                values.findIndex(
                  (candidate) =>
                    candidate.toLocaleLowerCase() === query.toLocaleLowerCase(),
                ) === index,
            )
            .slice(0, 6)
        : [];

    const atomicRequesterRecoveryQueries =
      requestSpecificRecovery && !singleSourceFamilyCorroboration
        ? RequestDynamicQueryUtil.buildEvidenceFacetQueries({
            requestDescription: context.requestDescription,
            intentConcepts: [
              ...(context.collectionPlan?.intentConcepts ?? []),
              ...(requestWorkflowIdentity
                ? [
                    requestWorkflowIdentity.actor,
                    requestWorkflowIdentity.object,
                    requestWorkflowIdentity.workflow,
                  ]
                : []),
            ],
            evidenceTargets: [
              ...(context.collectionPlan?.evidenceTargets ?? []),
              ...(requestWorkflowIdentity?.failure
                ? [requestWorkflowIdentity.failure]
                : []),
            ],
            plannedQueries: context.collectionPlan?.searchQueries ?? [],
            maxQueries: 16,
          })
            .map((query) => this.sanitizeRecoveryQuery(query))
            .filter(Boolean)
            .filter((query) => SourceSpecificEvidenceQueryUtil.isSafe(query))
            .filter(
              (query, index, values) =>
                !primaryRecoveryQueryKeys.has(query.toLocaleLowerCase()) &&
                values.findIndex(
                  (candidate) =>
                    candidate.toLocaleLowerCase() === query.toLocaleLowerCase(),
                ) === index,
            )
            .slice(0, 12)
        : [];
    if (requestSpecificRecovery) {
      this.logger.debug(
        `Targeted text recovery prepared ${domainProblemDiscoveryRecoveryQueries.length} exact-new domain problem-discovery probe(s), ${professionalDomainContextRecoveryQueries.length} profession-native context probe(s), ${relaxedDomainContextRecoveryQueries.length} relaxed lexical probe(s), plus ${atomicRequesterRecoveryQueries.length} optional requester-context probe(s). Domain problem discovery is authoritative; text-derived probes are soft retrieval context and no query is treated as evidence itself.`,
      );
    }
    const highConfidenceNearMissRows = adjudicatedPrimaryClassifications
      .filter((item) => {
        if (
          item.classification !== 'CONTEXT_ONLY' ||
          item.confidence < 62 ||
          (context.requestMode !== 'TEXT_ONLY' && item.domainAlignment === 'NONE')
        ) {
          return false;
        }
        const facetAlignments = [
          item.actorAlignment,
          item.objectAlignment,
          item.workflowAlignment,
          item.failureAlignment,
        ];
        const exactFacetCount = facetAlignments.filter(
          (alignment) => alignment === 'MATCH',
        ).length;
        return (
          item.problemAlignment === 'PARTIAL' ||
          item.problemAlignment === 'MATCH' ||
          exactFacetCount >= 1
        );
      })
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, 4);
    const nearMissFacetQueries = context.requestDescription?.trim() && requestWorkflowIdentity
      ? this.deduplicateRecoveryQueries(
          highConfidenceNearMissRows.flatMap((item) => {
            const actor = this.sanitizeRecoveryQuery(requestWorkflowIdentity.actor);
            const object = this.sanitizeRecoveryQuery(requestWorkflowIdentity.object);
            const workflow = this.sanitizeRecoveryQuery(requestWorkflowIdentity.workflow);
            const failure = this.sanitizeRecoveryQuery(requestWorkflowIdentity.failure);
            const observed = this.sanitizeRecoveryQuery(item.observedProblem ?? '');
            const candidates = [
              observed ? `${observed} reported problem` : '',
              `${actor} ${failure}`,
              `${object} ${failure}`,
              `${workflow} ${failure}`,
              `${actor} ${workflow}`,
              `${object} ${workflow}`,
            ];
            if (item.failureAlignment !== 'MATCH') {
              candidates.unshift(
                `${failure} reported incident`,
                `${failure} operator complaint`,
              );
            }
            if (item.workflowAlignment !== 'MATCH') {
              candidates.unshift(
                `${workflow} operational problems`,
                `${workflow} workflow failures`,
              );
            }
            if (item.objectAlignment !== 'MATCH') {
              candidates.unshift(`${object} operational problem`);
            }
            return candidates;
          }),
        )
          .map((query) => this.sanitizeRecoveryQuery(query))
          .filter(Boolean)
          .filter((query) => SourceSpecificEvidenceQueryUtil.isSafe(query))
          .filter(
            (query, index, values) =>
              !primaryRecoveryQueryKeys.has(query.toLocaleLowerCase()) &&
              values.findIndex(
                (candidate) =>
                  candidate.toLocaleLowerCase() === query.toLocaleLowerCase(),
              ) === index,
          )
          .slice(0, 6)
      : [];
    if (nearMissFacetQueries.length > 0) {
      this.logger.debug(
        `Targeted text recovery prioritized ${nearMissFacetQueries.length} missing-facet query lane(s) from ${highConfidenceNearMissRows.length} high-confidence requester-facet near-miss row(s). Existing rows remain non-trusted; these queries search atomic workflow/failure/object facets without reclassifying the current corpus.`,
      );
    }
    const requesterWorkflowAnchors = context.requestDescription?.trim() && requestWorkflowIdentity
      ? [
          `${requestWorkflowIdentity.actor} ${requestWorkflowIdentity.workflow}`,
          `${requestWorkflowIdentity.actor} ${requestWorkflowIdentity.object}`,
          `${requestWorkflowIdentity.actor} ${requestWorkflowIdentity.failure}`,
          `${requestWorkflowIdentity.object} ${requestWorkflowIdentity.workflow}`,
          `${requestWorkflowIdentity.object} ${requestWorkflowIdentity.failure}`,
          `${requestWorkflowIdentity.workflow} ${requestWorkflowIdentity.failure}`,
        ]
          .map((value) => this.sanitizeRecoveryQuery(value))
          .filter(Boolean)
          .filter((value, index, values) =>
            values.findIndex(
              (candidate) => candidate.toLocaleLowerCase() === value.toLocaleLowerCase(),
            ) === index,
          )
          .slice(0, 6)
      : [];

    const canonicalFamilyRecoveryQueries = singleSourceFamilyCorroboration
      ? (requesterWorkflowAnchors.length > 0
          ? requesterWorkflowAnchors.flatMap((anchor) => [
              `${anchor} ${selectedCanonicalFamilyLabel}`,
              `${anchor} ${selectedCanonicalFamilyLabel} reported problem`,
            ])
          : [
              ...canonicalTrustedForCorroboration.flatMap((item) => [
                item.observedProblem ?? '',
                item.causalExplanation ?? '',
              ]),
              `${selectedCanonicalFamilyLabel} operational burden`,
              `${selectedCanonicalFamilyLabel} recurring incident`,
              `${selectedCanonicalFamilyLabel} affected operators`,
              `${selectedCanonicalFamilyLabel} complaint`,
              selectedCanonicalFamilyLabel,
              ...canonicalTrustedForCorroboration.map(
                (item) => item.problemFamily ?? '',
              ),
            ])
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
          .filter((query) =>
            RequestQueryProvenanceUtil.isMateriallyNovelQuery({
              query,
              previousQueries: context.collectionPlan?.searchQueries ?? [],
            }),
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
    const recoveryOutcomeBySource = preflightRecoveryOutcomeBySource;
    const aiSelectedRecoverySources = aiRecoverySourceKeys.size > 0
      ? recoveryCandidateSources.filter((source) => {
          const key = source.key.toLocaleLowerCase();
          if (!aiRecoverySourceKeys.has(key)) return false;
          if (excludedSourceKeys.has(key) || excludedSourceKeys.has(source.key)) return false;
          if (!this.collectorSourceHealth.isHealthy(key)) return false;
          if (
            evidenceGuaranteeRecovery &&
            ['EMPTY', 'UNRELATED_ONLY', 'DEGRADED'].includes(
              recoveryOutcomeBySource.get(key) ?? '',
            )
          ) {
            return false;
          }
          if (
            RequestWorkflowSourcePolicyUtil.shouldSuppressAppReviewLanes({
              requestDescription: context.requestDescription,
              problemProfile: context.collectionPlan?.problemProfile,
            }) &&
            RequestWorkflowSourcePolicyUtil.isAppReviewSource(key)
          ) {
            return false;
          }
          if (
            RequestWorkflowSourcePolicyUtil.shouldSuppressDeveloperCommunityLanes({
              requestDescription: context.requestDescription,
              problemProfile: context.collectionPlan?.problemProfile,
            }) &&
            RequestWorkflowSourcePolicyUtil.isDeveloperCommunitySource(key)
          ) {
            return false;
          }
          const sourcePlan = recoveryQueryPlan?.sourcePlans?.find(
            (plan) => plan.sourceKey.toLocaleLowerCase() === key,
          );
          const problemOwnedKeywords = context.collectionPlan?.problemProfile
            ? [
                context.collectionPlan.problemProfile.actor,
                context.collectionPlan.problemProfile.object,
                context.collectionPlan.problemProfile.workflow,
                context.collectionPlan.problemProfile.friction ?? '',
                ...context.collectionPlan.problemProfile.failureModes,
                ...context.collectionPlan.problemProfile.consequences,
              ]
            : context.collectionPlan?.intentConcepts ?? [];
          const capabilityInput = {
            requestDescription: recoverySemanticDescription || context.requestDescription,
            domainName: context.requestDescription?.trim()
              ? undefined
              : context.domainName,
            keywords: problemOwnedKeywords,
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
            ) < recoveryRequestFitFloor
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
      requestSpecificRecovery && evidenceGuaranteeRecovery
        ? this.maximumRecoverySourcesPerWave
        : requestSpecificRecovery && rawEvidenceSourceCount >= 2
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
    const recoverySources = (singleSourceFamilyCorroboration
      ? corroborationPreferredSources.slice(0, 1)
      : compactDomainsOnlySecondaryRecovery
        ? corroborationPreferredSources.slice(0, 2)
        : requestSpecificRecovery
          /*
           * A broad text first pass already covered multiple source families.
           * Its single recovery wave therefore uses two rotated lanes instead of
           * three; sparse text niches retain the third lane for recall. Once a
           * verified family already exists from one source, the dedicated
           * corroboration branch above takes precedence and uses exactly one
           * new independent lane.
           */
          ? corroborationPreferredSources.slice(0, requesterRecoverySourceLimit)
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
    const plannedRecoveryKeywords = [
      ...((recoveryQueryPlan?.causalSearchProbes ?? []).map(
        (probe: RequestCausalSearchProbe) => probe.query,
      )),
      ...(recoveryQueryPlan?.searchQueries ?? []),
    ]
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
      ...((context.collectionPlan?.causalSearchProbes ?? []).map(
        (probe: RequestCausalSearchProbe) => probe.query,
      )),
      ...(context.collectionPlan?.searchQueries ?? []),
    ]
      .map((query) => this.sanitizeRecoveryQuery(query))
      .filter(Boolean)
      .filter((query) => SourceSpecificEvidenceQueryUtil.isSafe(query))
      .slice(0, this.maximumRecoveryKeywords);
    const recoveryKeywords = (
      singleSourceFamilyCorroboration
        ? [
            ...canonicalFamilyRecoveryQueries,
            ...plannedRecoveryKeywords,
            ...aiOwnedFallbackQueries,
          ]
        : [
            ...domainProblemDiscoveryRecoveryQueries,
            ...nearMissFacetQueries,
            ...atomicRequesterRecoveryQueries,
            ...requesterWorkflowAnchors,
            ...plannedRecoveryKeywords,
            ...canonicalFamilyRecoveryQueries,
            ...aiOwnedFallbackQueries,
          ]
    )
      .map((query) => this.sanitizeRecoveryQuery(query))
      .filter((query) => SourceSpecificEvidenceQueryUtil.isSafe(query))
      .filter(
        (query, index, values) =>
          values.findIndex(
            (candidate) =>
              candidate.trim().toLocaleLowerCase() ===
              query.trim().toLocaleLowerCase(),
          ) === index,
      )
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
    const interleavedDomainContextRecoveryQueries =
      requestSpecificRecovery && !singleSourceFamilyCorroboration
        ? this.deduplicateRecoveryQueries(
            domainProblemDiscoveryRecoveryQueries.flatMap((query, index) => [
              query,
              professionalDomainContextRecoveryQueries[index] ?? '',
              relaxedDomainContextRecoveryQueries[index] ?? '',
            ]),
          )
        : domainProblemDiscoveryRecoveryQueries;
    const requesterAtomicAuthoritativeQueries = [
      ...interleavedDomainContextRecoveryQueries,
      ...nearMissFacetQueries,
      ...atomicRequesterRecoveryQueries,
      ...requesterWorkflowAnchors,
    ]
      .map((query) => this.sanitizeRecoveryQuery(query))
      .filter(Boolean)
      .filter((query) => SourceSpecificEvidenceQueryUtil.isSafe(query))
      .filter(
        (query, index, values) =>
          values.findIndex(
            (candidate) =>
              candidate.toLocaleLowerCase() === query.toLocaleLowerCase(),
          ) === index,
      );
    const authoritativeRecoveryQueries =
      singleSourceFamilyCorroboration && canonicalFamilyRecoveryQueries.length > 0
        ? canonicalFamilyRecoveryQueries
        : requestSpecificRecovery && requesterAtomicAuthoritativeQueries.length > 0
          ? requesterAtomicAuthoritativeQueries
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
    const assignedRecoveryQueriesAcrossSources: string[] = [];
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
      const rotatedAuthoritativeQueries = authoritativeRecoveryQueries.length > 0
        ? (singleSourceFamilyCorroboration
            ? [0, 1, 2, 3]
                .map(
                  (offset) =>
                    authoritativeRecoveryQueries[
                      (sourceIndex + offset) % authoritativeRecoveryQueries.length
                    ],
                )
                .filter((query): query is string => Boolean(query?.trim()))
            : [
                authoritativeRecoveryQueries[sourceIndex % authoritativeRecoveryQueries.length],
                authoritativeRecoveryQueries[(sourceIndex + 1) % authoritativeRecoveryQueries.length],
                authoritativeRecoveryQueries[(sourceIndex + 2) % authoritativeRecoveryQueries.length],
              ].filter((query): query is string => Boolean(query?.trim())))
        : [];
      const fallbackQueries = requestSpecificRecovery && rotatedAuthoritativeQueries.length > 0
        ? [...rotatedAuthoritativeQueries, ...domainRecoveryQueries]
        : domainRecoveryQueries.length > 0
          ? domainRecoveryQueries
          : rotatedAuthoritativeQueries;
      const rawQueryCandidates = singleSourceFamilyCorroboration
        ? (planned?.queries?.length ? planned.queries : fallbackQueries)
        : requestSpecificRecovery
          ? [
              ...rotatedAuthoritativeQueries,
              ...(planned?.queries ?? []),
              ...fallbackQueries,
            ]
          : (planned?.queries?.length ? planned.queries : fallbackQueries);
      const rawQueries: string[] = [...new Set<string>(
        rawQueryCandidates
          .map((query) => this.sanitizeRecoveryQuery(query))
          .filter((query) => SourceSpecificEvidenceQueryUtil.isSafe(query)),
      )].slice(0, 6);
      const compiledQueries = SourceSpecificEvidenceQueryUtil.compile({
        sourceKey: source.key,
        baseQueries: rawQueries,
        requestDescription: recoverySemanticDescription || undefined,
        problemProfile: lockedRequesterProblemRecovery
          ? context.collectionPlan?.problemProfile
          : undefined,
        discoveryDomainName: recoveryDomain?.name ?? context.domainName,
        discoveryIntent: !lockedRequesterProblemRecovery,
        maxQueries: singleSourceFamilyCorroboration
          ? 3
          : firstPassNeedsSemanticRotation
            ? 3
            : 2,
        preserveBaseQueries: Boolean(
          recoverySemanticDescription || requestSpecificRecovery,
        ),
      });
      const previouslyUsedBySource =
        primaryQueriesBySource.get(source.key.trim().toLocaleLowerCase()) ??
        new Set<string>();
      const previousSourceQueries = [...previouslyUsedBySource];
      let sourceNovelQueries = (compiledQueries.length
        ? compiledQueries
        : rawQueries.slice(0, 2)
      ).filter((query) => {
        const normalized = query.replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
        if (!normalized || previouslyUsedBySource.has(normalized)) {
          return false;
        }

        return RequestQueryProvenanceUtil.isMateriallyNovelQuery({
          query,
          previousQueries: previousSourceQueries,
        });
      });

      /*
       * A provider-owned semantic rotation may intentionally keep most of the
       * immutable requester vocabulary while changing the causal/failure facet.
       * The generic novelty guard is conservative enough that these useful
       * rotations can look "semantically equivalent" and collapse the entire
       * recovery wave to zero collectors. For the FIRST bounded text rotation
       * only, allow one exact-new grounded query per healthy source even when
       * token similarity is high. Exact replay remains forbidden and the
       * canonical evidence verifier is unchanged.
       */
      if (
        sourceNovelQueries.length === 0 &&
        (firstPassNeedsSemanticRotation || evidenceGuaranteeRecovery)
      ) {
        const profile = context.collectionPlan?.problemProfile;
        const deterministicFacetSeeds =
          requestSpecificRecovery && !lockedRequesterProblemRecovery
            ? domainProblemDiscoveryRecoveryQueries
            : profile
              ? [
              `${profile.actor} ${profile.failureModes[0] ?? profile.friction ?? profile.coreProblem}`,
              `${profile.object} ${profile.failureModes[1] ?? profile.failureModes[0] ?? profile.coreProblem}`,
              `${profile.workflow} ${profile.failureModes[0] ?? profile.friction ?? profile.coreProblem}`,
              `${profile.actor} ${profile.workflow}`,
                  ...(profile.evidenceFacets ?? []).slice(0, 2).map(
                    (facet) => `${profile.object} ${facet}`,
                  ),
                ]
              : [];
        const normalizedSourceKey = source.key.trim().toLocaleLowerCase();
        const sourceEvidenceTail =
          normalizedSourceKey === 'crossref'
            ? 'operational study evidence'
            : ['news', 'gdelt', 'blog'].includes(normalizedSourceKey)
              ? 'reported incident case'
              : ['reddit', 'forum', 'youtube', 'hacker-news'].includes(normalizedSourceKey)
                ? 'practitioner experience complaint'
                : ['github', 'stackoverflow', 'dev-to'].includes(normalizedSourceKey)
                  ? 'implementation failure issue'
                  : 'operator problem report';
        const guaranteeSeeds = evidenceGuaranteeRecovery
          ? requestSpecificRecovery && !lockedRequesterProblemRecovery
            ? recoveryDomainNames.flatMap((domainName) => [
                `${domainName} operational problem ${sourceEvidenceTail}`,
                `${domainName} workflow bottleneck ${sourceEvidenceTail}`,
              ])
            : profile
              ? [
                  `${profile.actor} ${profile.failureModes[0] ?? profile.friction ?? profile.coreProblem} ${sourceEvidenceTail}`,
                  `${profile.object} ${profile.failureModes[1] ?? profile.failureModes[0] ?? profile.coreProblem} ${sourceEvidenceTail}`,
                  `${profile.workflow} ${profile.failureModes[0] ?? profile.friction ?? profile.coreProblem} ${sourceEvidenceTail}`,
                  `${profile.actor} ${profile.workflow} ${sourceEvidenceTail}`,
                ]
              : []
          : [];
        const relaxedRotationCandidates = [
          ...guaranteeSeeds,
          ...(planned?.queries ?? []),
          ...((recoveryQueryPlan?.causalSearchProbes ?? []).map(
            (probe: RequestCausalSearchProbe) => probe.query,
          )),
          ...plannedRecoveryKeywords,
          ...compiledQueries,
          ...deterministicFacetSeeds,
          ...authoritativeRecoveryQueries,
        ]
          .map((query) => this.sanitizeRecoveryQuery(query))
          .filter((query) => SourceSpecificEvidenceQueryUtil.isSafe(query))
          .filter((query) =>
            !lockedRequesterProblemRecovery ||
            !context.requestDescription?.trim() ||
            RequestQueryProvenanceUtil.isQueryGrounded({
              requestDescription: context.requestDescription,
              query,
            }),
          )
          .filter((query, index, values) => {
            const normalized = query
              .replace(/\s+/gu, ' ')
              .trim()
              .toLocaleLowerCase();
            if (!normalized || previouslyUsedBySource.has(normalized)) {
              return false;
            }
            if (!evidenceGuaranteeRecovery && primaryQueryKeys.has(normalized)) {
              return false;
            }
            return (
              values.findIndex(
                (candidate) =>
                  candidate
                    .replace(/\s+/gu, ' ')
                    .trim()
                    .toLocaleLowerCase() === normalized,
              ) === index
            );
          })
          .slice(0, evidenceGuaranteeRecovery ? 2 : 1);

        if (relaxedRotationCandidates.length > 0) {
          sourceNovelQueries = relaxedRotationCandidates;
          this.logger.debug(
            evidenceGuaranteeRecovery
              ? `Evidence-guarantee recovery admitted ${relaxedRotationCandidates.length} source/facet/provenance-new query lane(s) for source=${source.key}. Global lexical similarity no longer blocks the final zero-trusted rescue, while exact per-source replay and canonical evidence admission remain strict.`
              : `Recovery novelty guard admitted one exact-new AI/facet rotation for source=${source.key}; semantic similarity to the primary vocabulary is allowed only for this first bounded rotation and does not change evidence admission.`,
          );
        }
      }

      /*
       * Recovery uses a tiny source budget, so spending two or three collectors
       * on near-identical facet wording wastes the whole wave. Keep per-source
       * provenance novelty above, then also prefer queries materially novel from
       * the lanes already assigned to earlier recovery sources. This is generic
       * query-shape diversification only; it never changes evidence semantics or
       * admission thresholds.
       */
      const crossSourceNovelQueries = sourceNovelQueries.filter((query) =>
        RequestQueryProvenanceUtil.isMateriallyNovelQuery({
          query,
          previousQueries: assignedRecoveryQueriesAcrossSources,
        }),
      );
      if (assignedRecoveryQueriesAcrossSources.length > 0) {
        const desiredQueryCount = singleSourceFamilyCorroboration
          ? 3
          : firstPassNeedsSemanticRotation
            ? 3
            : 2;
        const alternativePool = [
          ...compiledQueries,
          ...rawQueries,
          ...plannedRecoveryKeywords,
          ...recoveryKeywords,
        ]
          .map((query) => this.sanitizeRecoveryQuery(query))
          .filter((query) => SourceSpecificEvidenceQueryUtil.isSafe(query))
          .filter((query) => {
            const normalized = query.replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
            return Boolean(normalized) && !previouslyUsedBySource.has(normalized);
          })
          .filter((query) =>
            RequestQueryProvenanceUtil.isMateriallyNovelQuery({
              query,
              previousQueries: assignedRecoveryQueriesAcrossSources,
            }),
          );
        sourceNovelQueries = [...new Set([
          ...crossSourceNovelQueries,
          ...alternativePool,
        ])].slice(0, desiredQueryCount);
      }
      if (sourceNovelQueries.length > 0) {
        assignedRecoveryQueriesAcrossSources.push(...sourceNovelQueries);
      }

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
         * Recovery is semantically deeper, not volume-broader. A pure
         * second-source corroboration request is a MICRO_PROBE; broader
         * zero-evidence recovery retains the bounded SECONDARY tier.
         */
        sourceTier: singleSourceFamilyCorroboration
          ? ('MICRO_PROBE' as const)
          : ('SECONDARY' as const),
        problemFacetIds: context.canonicalProblemSpec?.facets.map((facet) => facet.id) ?? [],
      };
    }).filter(
      (plan) =>
        recoverySourceKeys.has(plan.sourceKey.toLocaleLowerCase()) &&
        plan.queries.length > 0,
    );
    if (singleSourceFamilyCorroboration && mergedRecoverySourcePlans.length > 0) {
      this.logger.debug(
        `Canonical family corroboration probes | family="${selectedCanonicalFamilyLabel}" | ${mergedRecoverySourcePlans
          .map((plan) => `${plan.sourceKey}=[${plan.queries.join(' || ')}]`)
          .join(' | ')}.`,
      );
    }

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
        'Skipping targeted recovery because every healthy candidate source would replay an exact or semantically equivalent source/query lane; no materially novel executable provenance lane remains.',
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
    let executedRecoverySources = [...plannedRecoverySources];
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
        corroborationOnlyRecovery,
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
        selectedDataSourceKeys: executedRecoverySources.map((source) => source.key),
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

    /*
     * Zero-row requester recovery must not terminate merely because the first
     * bounded source wave was empty. Within the SAME bounded recovery deadline,
     * rotate once to at most two healthy documentary/research lanes that were
     * not used in this recovery wave. No second AI plan is requested and no
     * evidence threshold is relaxed.
     */
    if (
      requestSpecificRecovery &&
      evidenceGuaranteeRecovery &&
      (result.rawEvidenceInputs?.length ?? 0) === 0 &&
      !recoveryController.signal.aborted &&
      recoveryDeadlineAt - Date.now() >= 900
    ) {
      const alreadyExecutedKeys = new Set(
        plannedRecoverySources.map((source) =>
          source.key.trim().toLocaleLowerCase(),
        ),
      );
      const documentaryPriority = (source: SelectedIdeaDataSource): number => {
        const key = source.key.trim().toLocaleLowerCase();
        if (key === 'crossref') return 8;
        if (key === 'news') return 7;
        if (key === 'blog') return 6;
        if (key === 'gdelt') return 5;
        if (key === 'reddit') return 4;
        if (key === 'forum') return 3;
        if (key === 'youtube') return 2;
        return 1;
      };
      const fallbackSources = resolveEligibleRecoverySources(
        0.18,
        Math.max(
          this.maximumRecoverySourcesPerWave,
          recoveryCandidateSources.length,
        ),
        true,
      )
        .filter(
          (source) =>
            !alreadyExecutedKeys.has(
              source.key.trim().toLocaleLowerCase(),
            ),
        )
        .sort(
          (left, right) =>
            documentaryPriority(right) - documentaryPriority(left) ||
            this.scoreRecoverySource(
              context,
              right,
              recoveryQueryPlan?.sourcePlans?.find(
                (plan) =>
                  plan.sourceKey.trim().toLocaleLowerCase() ===
                  right.key.trim().toLocaleLowerCase(),
              ) ?? null,
              recoverySemanticDescription || recoveryRoutingDescription,
            ) -
              this.scoreRecoverySource(
                context,
                left,
                recoveryQueryPlan?.sourcePlans?.find(
                  (plan) =>
                    plan.sourceKey.trim().toLocaleLowerCase() ===
                    left.key.trim().toLocaleLowerCase(),
                ) ?? null,
                recoverySemanticDescription || recoveryRoutingDescription,
              ),
        )
        .slice(0, 2);

      const fallbackSourcePlans = fallbackSources
        .map((source, sourceIndex) => {
          const sourceKey = source.key.trim().toLocaleLowerCase();
          const previouslyUsedBySource =
            primaryQueriesBySource.get(sourceKey) ?? new Set<string>();
          const atomicBase = [
            ...domainProblemDiscoveryRecoveryQueries,
            ...atomicRequesterRecoveryQueries,
            ...plannedRecoveryKeywords,
            ...authoritativeRecoveryQueries,
            ...recoveryKeywords,
          ]
            .map((query) => this.sanitizeRecoveryQuery(query))
            .filter(Boolean)
            .filter((query) => SourceSpecificEvidenceQueryUtil.isSafe(query))
            .filter((query, index, all) => {
              const normalized = query
                .replace(/\s+/gu, ' ')
                .trim()
                .toLocaleLowerCase();
              return (
                Boolean(normalized) &&
                !previouslyUsedBySource.has(normalized) &&
                all.findIndex(
                  (candidate) =>
                    candidate
                      .replace(/\s+/gu, ' ')
                      .trim()
                      .toLocaleLowerCase() === normalized,
                ) === index
              );
            })
            .slice(0, 8);

          const compiledQueries = SourceSpecificEvidenceQueryUtil.compile({
            sourceKey: source.key,
            baseQueries: atomicBase,
            causalQueries:
              recoveryQueryPlan?.causalSearchProbes?.map(
                (probe: RequestCausalSearchProbe) => probe.query,
              ) ?? [],
            requestDescription: lockedRequesterProblemRecovery
              ? context.requestDescription
              : undefined,
            problemProfile: lockedRequesterProblemRecovery
              ? context.collectionPlan?.problemProfile ?? null
              : null,
            discoveryDomainName:
              resolvedDomain?.name ?? context.domainName ?? null,
            maxQueries: 5,
            preserveBaseQueries: true,
            discoveryIntent: true,
          })
            .map((query) => this.sanitizeRecoveryQuery(query))
            .filter((query) => {
              const normalized = query
                .replace(/\s+/gu, ' ')
                .trim()
                .toLocaleLowerCase();
              return Boolean(normalized) && !previouslyUsedBySource.has(normalized);
            })
            .slice(0, 5);

          return {
            sourceKey: source.key,
            queries: compiledQueries,
            routingHints:
              sourceKey === 'forum'
                ? ['discover specialist practitioner forums from planned queries']
                : [],
            discoveryDomainId: resolvedDomain?.id ?? context.domainId,
            discoveryDomainName: resolvedDomain?.name ?? context.domainName,
            queryIntentId: `recovery:${context.evidenceRecoveryAttempts + 1}:fallback:${source.key}:${sourceIndex + 1}`,
            sourceTier: 'SECONDARY' as const,
            problemFacetIds:
              context.canonicalProblemSpec?.facets.map((facet) => facet.id) ?? [],
          };
        })
        .filter((plan) => plan.queries.length > 0);

      const fallbackPlanKeys = new Set(
        fallbackSourcePlans.map((plan) =>
          plan.sourceKey.trim().toLocaleLowerCase(),
        ),
      );
      const executableFallbackSources = fallbackSources.filter((source) =>
        fallbackPlanKeys.has(source.key.trim().toLocaleLowerCase()),
      );

      if (
        executableFallbackSources.length > 0 &&
        recoveryDeadlineAt - Date.now() >= 700
      ) {
        this.logger.debug(
          `Zero-row text recovery rotating within the same bounded attempt to ${executableFallbackSources.length} documentary/research fallback source lane(s): ${executableFallbackSources.map((source) => source.key).join(', ')}. No AI re-plan or evidence-threshold relaxation is applied.`,
        );
        try {
          const fallbackResult = await this.collectionJobResolver.resolve({
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
            dataSourceKeys: executableFallbackSources.map(
              (source) => source.key,
            ),
            keywords: recoveryKeywords,
            plannedQueries: domainProblemDiscoveryRecoveryQueries.length > 0
              ? domainProblemDiscoveryRecoveryQueries
              : atomicRequesterRecoveryQueries.length > 0
                ? atomicRequesterRecoveryQueries
                : authoritativeRecoveryQueries,
            queriesGeneratedByAi: usingAiRecoveryPlan,
            sourcePlans: fallbackSourcePlans,
            userDescription: requestSpecificRecovery
              ? context.requestDescription ?? undefined
              : undefined,
            forceRefresh: true,
            collectionMode: 'TARGETED_RECOVERY',
            collectorLimits: this.resolveRecoveryCollectorLimits(
              compactDomainsOnlySecondaryRecovery,
              requestSpecificRecovery,
              corroborationOnlyRecovery,
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
            resolvedDataSources: executableFallbackSources.map((source) => ({
              id: source.id,
              key: source.key,
              displayName: source.displayName,
            })),
          });
          if ((fallbackResult.rawEvidenceInputs?.length ?? 0) > 0) {
            result = fallbackResult;
            executedRecoverySources = [
              ...plannedRecoverySources,
              ...executableFallbackSources,
            ].filter(
              (source, index, all) =>
                all.findIndex(
                  (candidate) =>
                    candidate.key.trim().toLocaleLowerCase() ===
                    source.key.trim().toLocaleLowerCase(),
                ) === index,
            );
          }
        } catch (fallbackError: unknown) {
          this.logger.debug(
            `Zero-row documentary/research fallback produced no usable collector result inside the shared deadline: ${
              fallbackError instanceof Error
                ? fallbackError.message
                : String(fallbackError)
            }`,
          );
        }
      }
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
     * Deterministic request-fit helpers are intentionally not used as semantic
     * evidence fallback. Community AI remains the authority for DIRECT /
     * SUPPORTING admission; unadjudicated recovery rows stay unknown.
     */
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
    const requestedRecoveryAdjudicationBudgetMs = corroborationOnlyRecovery
      ? Math.min(
          6_200,
          Math.max(5_200, 5_200 + rawEvidenceCorpus.length * 180),
        )
      : evidenceGuaranteeRecovery
        ? Math.min(
            8_400,
            Math.max(7_400, 7_400 + rawEvidenceCorpus.length * 220),
          )
        : Math.min(
            8_200,
            Math.max(6_800, 6_800 + rawEvidenceCorpus.length * 220),
          );
    const remainingRecoveryWallClockMs = Math.max(
      0,
      recoveryTotalDeadlineAt - Date.now(),
    );

    /*
     * Once collection has returned genuinely new provenance, semantic
     * adjudication gets its own bounded grace window. Clamping this phase to the
     * collection deadline was leaving exactly the useful recovery rows as
     * UNADJUDICATED when persistence consumed the last 2-3 seconds.
     */
    const recoveryAdjudicationBudgetMs = shouldRunCommunityAiRecovery
      ? requestedRecoveryAdjudicationBudgetMs
      : 0;
    const recoveryAdjudicationGraceExtensionMs = Math.max(
      0,
      recoveryAdjudicationBudgetMs - remainingRecoveryWallClockMs,
    );
    const canRunBoundedRecoveryAdjudication = Boolean(
      shouldRunCommunityAiRecovery && recoveryAdjudicationBudgetMs >= 2_400,
    );
    if (recoveryAdjudicationGraceExtensionMs > 0) {
      this.logger.debug(
        `Recovery Community AI adjudication reserved a post-collection grace window: remainingCollectionEnvelope=${remainingRecoveryWallClockMs}ms, adjudicationBudget=${recoveryAdjudicationBudgetMs}ms, graceExtension=${recoveryAdjudicationGraceExtensionMs}ms, canonicalNewRows=${rawEvidenceCorpus.length}.`,
      );
    }
    const recoveryAdjudicationDeadlineAt =
      Date.now() + recoveryAdjudicationBudgetMs;
    const rawCommunityAiAnalysis = canRunBoundedRecoveryAdjudication
      ? await this.analyzeRecoveredEvidenceWithCommunityAi(
          context,
          rawRecoveryNlp,
          rawEvidenceCorpus,
          parentSignal,
          recoveryAdjudicationDeadlineAt,
          corroborationOnlyRecovery ? selectedCanonicalFamilyLabel : null,
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

    /*
     * Recovery semantic trust remains AI-owned. Deterministic request-fit
     * diagnostics may help routing/logging, but they never promote a row when
     * Community AI produced no usable verdict. Those rows remain raw/unknown
     * and can be retried later without being fabricated into evidence.
     */
    const selectedExternalEvidence = this.deduplicateRecoveredEvidence(
      hasAiEvidenceClassifications
        ? [...aiDirectEvidence, ...aiSupportingEvidence]
        : [],
    );

    const directEvidenceSamples = this.deduplicateEvidenceSamples(
      (hasAiEvidenceClassifications ? aiDirectEvidence : []).map(
        (evidence) => evidence.text,
      ),
    );
    const supportingEvidenceSamples = this.deduplicateEvidenceSamples(
      (hasAiEvidenceClassifications ? aiSupportingEvidence : []).map(
        (evidence) => evidence.text,
      ),
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
      selectedDataSourceKeys: executedRecoverySources.map((source) => source.key),
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
      corroborationTargetFamily:
        corroborationOnlyRecovery && selectedCanonicalFamilyLabel
          ? selectedCanonicalFamilyLabel
          : null,
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
          const contextualEmojiReaction = Boolean(
            commentPrefix &&
              commentText.length >= 1 &&
              /\p{Extended_Pictographic}/u.test(commentText),
          );
          if (commentText.length < 8 && !contextualEmojiReaction) continue;
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
        if (failed || rateLimited || timedOut) {
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
    const attemptedSourceKeys = new Set([
      ...(context.selectedDataSources ?? [])
        .map((source) => source.key.trim().toLocaleLowerCase())
        .filter(Boolean),
      ...(context.rawEvidenceCorpus ?? [])
        .map((item) => item.sourceKey.trim().toLocaleLowerCase())
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
    const requesterScoped = Boolean(context.requestDescription?.trim());
    const zeroTrustedRequester = Boolean(
      requesterScoped &&
        !(context.canonicalEvidenceLedger ?? []).some(
          (item) =>
            item.verified &&
            (item.classification === 'DIRECT_PROBLEM' ||
              item.classification === 'SUPPORTING_SIGNAL'),
        ),
    );

    for (const key of attemptedSourceKeys) {
      /*
       * Text recovery is a single bounded rescue wave. Replaying a primary
       * source that returned ZERO rows is almost always a latency-only tail when
       * unused healthy sources are available, and replaying a source whose
       * broad corpus produced only CONTEXT rows frequently returns the same
       * provenance again. For text-bearing requests mark those surfaces
       * exhausted run-locally so recovery rotates to a genuinely new source.
       * Domain-only / no-input discovery keeps the older broader behavior.
       */
      const canonicalRows = canonicalBySource.get(key) ?? [];
      const rawCount = rawCountsBySource.get(key) ?? 0;
      const primarySourceReturnedNothing =
        requesterScoped && !zeroTrustedRequester && rawCount === 0;
      const broadContextOnlySurface =
        requesterScoped &&
        !zeroTrustedRequester &&
        rawCount >= 4 &&
        canonicalRows.length >= 4 &&
        canonicalRows.every(
          (item) => item.classification === 'CONTEXT_ONLY',
        );
      if (primarySourceReturnedNothing || broadContextOnlySurface) {
        excluded.add(key);
      }
      const everyReviewedRowWasUnrelated =
        !zeroTrustedRequester &&
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
    const discoveryMode =
      context.collectionPlan?.requestIntent?.mode !== 'EXPLICIT_PROBLEM';
    const resolvedDomainNames = [
      ...context.selectedDomains.map((domain) => domain.name.trim()),
      ...(context.domainName?.trim() ? [context.domainName.trim()] : []),
    ].filter(Boolean);
    const discoveryScopeDescription = [
      ...resolvedDomainNames,
      context.collectionPlan?.domainIdentity?.actor ?? '',
      context.collectionPlan?.domainIdentity?.object ?? '',
      context.collectionPlan?.domainIdentity?.workflow ?? '',
    ]
      .filter(Boolean)
      .join(' ');
    const problemOwnedKeywords = discoveryMode
      ? [
          ...resolvedDomainNames,
          ...(context.collectionPlan?.retrievalVocabulary ?? []),
          context.collectionPlan?.domainIdentity?.actor ?? '',
          context.collectionPlan?.domainIdentity?.object ?? '',
          context.collectionPlan?.domainIdentity?.workflow ?? '',
        ]
      : context.collectionPlan?.problemProfile
        ? [
            context.collectionPlan.problemProfile.actor,
            context.collectionPlan.problemProfile.object,
            context.collectionPlan.problemProfile.workflow,
            context.collectionPlan.problemProfile.friction ?? '',
            ...context.collectionPlan.problemProfile.failureModes,
            ...context.collectionPlan.problemProfile.consequences,
          ]
        : context.collectionPlan?.intentConcepts ?? [];
    const semanticFit = this.collectorsFactory.getCollectorRequestFitScore(
      source.key,
      {
        requestDescription:
          semanticDescription?.trim() ||
          (discoveryMode
            ? discoveryScopeDescription
            : context.requestDescription),
        domainName:
          context.domainName?.trim() ||
          context.selectedDomains[0]?.name?.trim() ||
          undefined,
        keywords: problemOwnedKeywords,
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
        ? 0.08
        : priorOutcome === 'CONTEXT_ONLY'
          ? -0.10
          : priorOutcome === 'UNRELATED_ONLY'
            ? -0.62
            : priorOutcome === 'EMPTY'
              ? -0.72
              : priorOutcome === 'DEGRADED'
                ? -0.55
                : 0;
    const attemptedSourceKeys = new Set([
      ...(context.selectedDataSources ?? []).map((item) => item.key),
      ...(context.rawEvidenceCorpus ?? []).map((item) => item.sourceKey),
    ].map((key) => key.trim().toLocaleLowerCase()).filter(Boolean));
    const sourceKey = source.key.trim().toLocaleLowerCase();
    const provenanceNoveltyAdjustment = attemptedSourceKeys.has(sourceKey)
      ? -0.12
      : 0.24;
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

  private deduplicateRecoveryQueries(queries: readonly string[]): string[] {
    const seen = new Set<string>();
    const output: string[] = [];
    for (const query of queries) {
      const cleaned = query.replace(/\s+/gu, ' ').trim();
      if (!cleaned) continue;
      const key = cleaned.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(cleaned);
    }
    return output;
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
    corroborationTargetFamily?: string | null,
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
    const normalizedCorroborationTarget =
      corroborationTargetFamily?.replace(/\s+/gu, ' ').trim() ?? '';
    const recoveryCollectionPlan = normalizedCorroborationTarget && context.collectionPlan
      ? {
          ...context.collectionPlan,
          requestIntent: {
            mode: 'EXPLICIT_PROBLEM' as const,
            summary: `Corroborate the already-selected canonical problem family: ${normalizedCorroborationTarget}`,
            explicitProblem: normalizedCorroborationTarget,
            desiredOutcome: null,
          },
          problemProfile: undefined,
        }
      : context.collectionPlan;
    const recoveryContext: IdeaGenerationContext = {
      ...context,
      requestDescription:
        normalizedCorroborationTarget || context.requestDescription,
      collectionPlan: recoveryCollectionPlan,
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
    corroborationOnly = false,
  ): {
    readonly maxFetchedPosts: number;
    readonly maxSavedPosts: number;
    readonly maxFetchedComments: number;
    readonly maxSavedComments: number;
  } {
    // Recovery is an exceptional sparse-first-pass rescue only. The main
    // collection wave already performs broad source-diverse retrieval, so a
    // recovery wave must stay tiny and cannot become a second broad crawl.
    if (corroborationOnly) {
      return {
        maxFetchedPosts: Math.min(
          this.readPositiveConfig('RECOVERY_CORROBORATION_MAX_FETCHED_POSTS', 2),
          2,
        ),
        maxSavedPosts: Math.min(
          this.readPositiveConfig('RECOVERY_CORROBORATION_MAX_SAVED_POSTS', 1),
          1,
        ),
        maxFetchedComments: Math.min(
          this.readPositiveConfig('RECOVERY_CORROBORATION_MAX_FETCHED_COMMENTS', 2),
          2,
        ),
        maxSavedComments: Math.min(
          this.readPositiveConfig('RECOVERY_CORROBORATION_MAX_SAVED_COMMENTS', 1),
          1,
        ),
      };
    }
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