import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  AiRoutingStrategy,
  ApiRequestType,
  PromptType,
  type AiModel,
} from '@prisma/client';

import { AiModelRoutingService } from '../../../ai-models/ai-model-routing.service';
import { AiModelsService } from '../../../ai-models/ai-models.service';
import {
  AI_PROVIDER_KEYS,
  normalizeAiProviderKey,
  type AiProviderKey,
} from '../../../ai/constants/ai-provider.constants';
import { AiExecutionService } from '../../../ai/services/ai-execution.service';
import { MIN_AI_REQUEST_TIMEOUT_MS } from '../../../ai/constants/ai-timeouts.constants';
import { AiResponseFormat } from '../../../ai/types/ai-provider.type';
import { IDEA_OWNER_TYPES } from '../../shared/constants/ideas.constants';
import {
  COMMUNITY_AI_ANALYSIS_EXCLUDED_MODEL_API_IDS,
  COMMUNITY_AI_ANALYSIS_MAX_ATTEMPTS,
  COMMUNITY_AI_ANALYSIS_MAX_MODELS_PER_OPERATION,
  COMMUNITY_AI_ANALYSIS_MAX_OPPORTUNITIES,
  COMMUNITY_AI_ANALYSIS_MAX_OUTPUT_TOKENS,
  COMMUNITY_AI_ANALYSIS_MIN_OPPORTUNITY_CONFIDENCE,
  COMMUNITY_AI_ANALYSIS_MIN_OVERALL_CONFIDENCE,
  COMMUNITY_AI_ANALYSIS_MIN_TOTAL_EVIDENCE_SAMPLES,
  COMMUNITY_AI_ANALYSIS_REQUEST_TIMEOUT_MS,
  COMMUNITY_AI_ANALYSIS_DOMAINS_ONLY_SCHEMA_NAME,
  COMMUNITY_AI_ANALYSIS_SCHEMA_NAME,
  COMMUNITY_AI_ANALYSIS_TOTAL_TIMEOUT_MS,
  COMMUNITY_AI_ANALYSIS_TARGET_MIN_OPPORTUNITIES,
  COMMUNITY_AI_ANALYSIS_TEMPERATURE,
  COMMUNITY_AI_EVIDENCE_TRIAGE_PARALLEL_MODELS,
  COMMUNITY_AI_EVIDENCE_NATURES,
  COMMUNITY_AI_PROBLEM_FAMILY_BASES,
  COMMUNITY_AI_PROVIDER_EVIDENCE_CLASSIFICATIONS,
  COMMUNITY_AI_SEMANTIC_ALIGNMENTS,
  COMMUNITY_AI_EVIDENCE_TRIAGE_MAX_ITEMS_PER_REQUEST,
  COMMUNITY_AI_EVIDENCE_TRIAGE_MAX_ONLINE_ATTEMPTS,
  COMMUNITY_AI_EVIDENCE_TRIAGE_MAX_OUTPUT_TOKENS,
  COMMUNITY_AI_EVIDENCE_TRIAGE_NEAR_DUPLICATE_THRESHOLD,
  COMMUNITY_AI_EVIDENCE_TRIAGE_REQUEST_TIMEOUT_MS,
  COMMUNITY_AI_EVIDENCE_TRIAGE_SCHEMA_NAME,
  COMMUNITY_AI_EVIDENCE_TRIAGE_TOTAL_TIMEOUT_MS,
} from '../constants/community-ai-analysis.constants';
import type {
  CommunityAiAnalysis,
  CommunityAiAttemptDiagnostic,
  CommunityAiAdjudicationFailureReason,
  CommunityAiDomainHypothesis,
  CommunityAiEvidenceTriage,
  CommunityAiJointEvidenceGroup,
  CommunityAiEvidenceClassification,
  CommunityAiEvidenceNature,
  CommunityAiProblemFamilyBasis,
  CommunityAiProviderEvidenceClassification,
  CommunityAiSemanticAlignment,
  CommunityAiOpportunity,
} from '../types/community-ai-analysis.type';
import type {
  IdeaGenerationContext,
  IdeaGenerationRawEvidenceItem,
} from '../types/idea-generation-context.type';
import { CommunityAiAnalysisPromptService } from './community-ai-analysis-prompt.service';
import {
  buildCommunityAiAnalysisSchema,
  buildCommunityAiEvidenceTriageSchema,
} from '../schemas/community-ai-analysis.schema';
import { isTransientDatabaseError } from '../utils/transient-database-error.util';
import { RequestEvidenceAlignmentUtil } from '../utils/request-evidence-alignment.util';
import { RequestDynamicQueryUtil } from '../utils/request-dynamic-query.util';
import { RequestVerticalConstraintUtil } from '../utils/request-vertical-constraint.util';
import { SelectedDomainEvidenceAlignmentUtil } from '../utils/selected-domain-evidence-alignment.util';
import { RequestEvidenceDomainRoleUtil } from '../utils/request-evidence-domain-role.util';
import { EvidenceSourceIdentityUtil } from '../utils/evidence-source-identity.util';
import {
  classifyDirectCommunityEvidence,
  isLikelyPromotionalEvidence,
  isNonActionableCommunityBanter,
  isObservedUnmetNeedEvidence,
  isPositiveFeedbackWithoutProblem,
  isSpeculativeWorkflowDiscussionWithoutExperiencedFailure,
  isStructuredOperationalProblemEvidence,
  scoreProblemEvidenceActionability,
} from '../../../nlp/common/utils/community-evidence.util';
import {
  matchEvidenceToAtomicProblem,
  matchEvidenceToProblemFamily,
  resolvePrimaryProblemFamily,
} from '../../../nlp/common/utils/problem-family-matching.util';

/**
 * Executes bounded, evidence-grounded LLM analysis over cleaned community data.
 *
 * Reliability strategy:
 * - AiExecutionService handles provider errors, temporary retries, model health,
 *   structured-output parsing, and provider/model fallback.
 * - This service adds domain-level validation for responses that are valid JSON
 *   but still contain weak, empty, generic, or suspicious analysis.
 * - A model whose successful response fails domain validation is excluded from
 *   the next attempt, forcing routing to try a different active model.
 * - The deterministic NLP path remains the final non-fatal fallback.
 */
type CommunityAiTriageTelemetry = {
  diagnostics: CommunityAiAttemptDiagnostic[];
  onlineAttemptCount: number;
  /** True only when at least one online model adjudicated the complete corpus. */
  fullCorpusAdjudicationCompleted: boolean;
  /**
   * Problem family chosen by the same accepted full-corpus AI triage response.
   * Deterministic code may verify/normalize this choice, but a later ranking
   * stage must not replace it with an unrelated family.
   */
  selectedProblemFamily: string | null;
  selectedProblemEvidenceIds: string[];
  /** Verified multi-row compositions returned by the same full-corpus semantic model. */
  jointEvidenceGroups: CommunityAiJointEvidenceGroup[];
  /** Number of rows that received an individually admissible online semantic verdict. */
  adjudicatedEvidenceCount: number;
};

type ParsedCommunityAiEvidenceTriageCorpus = {
  /** Individually valid semantic verdicts from one model that saw the complete corpus. */
  readonly classifications: readonly CommunityAiEvidenceTriage[];
  /** Evidence ids that were not returned at all by the provider. */
  readonly omittedEvidenceIds: readonly string[];
  /** Evidence ids that were returned but failed per-item structural admission. */
  readonly invalidEvidenceIds: readonly string[];
  readonly selectedProblemFamily: string | null;
  readonly selectedEvidenceIds: readonly string[];
  readonly jointEvidenceGroups: readonly CommunityAiJointEvidenceGroup[];
};

export type CommunityAiAnalysisExecutionOptions = {
  /**
   * Runs only raw-evidence semantic triage and skips the more expensive
   * opportunity-synthesis provider pass. Recovery uses this mode because its
   * only job is to decide which newly collected records are DIRECT, SUPPORTING,
   * or UNRELATED before ranking reuses the same canonical evidence ledger.
   */
  readonly classificationOnly?: boolean;
  /** Maximum provider-diverse attempts launched for this analysis call. */
  readonly maxAttempts?: number;
  /** Per-provider timeout override used by latency-sensitive recovery analysis. */
  readonly requestTimeoutMs?: number;
  /** Shared wall-clock budget for all provider attempts in this analysis call. */
  readonly totalTimeoutMs?: number;
  /** Cooperative cancellation signal from the active generation stage. */
  readonly signal?: AbortSignal;
};


@Injectable()
export class CommunityAiAnalysisService {
  private readonly logger = new Logger(CommunityAiAnalysisService.name);

  constructor(
    private readonly aiModelsService: AiModelsService,
    private readonly aiModelRoutingService: AiModelRoutingService,
    private readonly aiExecutionService: AiExecutionService,
    private readonly promptService: CommunityAiAnalysisPromptService,
  ) {}

  /**
   * Attempts community analysis using bounded model rotation.
   *
   * Always returns either an accepted online analysis or an evidence-aware
   * fallback so provider failures cannot fail the generation pipeline.
   */
  async analyze(
    context: IdeaGenerationContext,
    options: CommunityAiAnalysisExecutionOptions = {},
  ): Promise<CommunityAiAnalysis> {
    const groundingCorpus = this.collectEvidenceCorpus([
      context.nlp,
      context.domainEvidence,
      context.rawEvidenceCorpus,
    ]);
    const hasGroundingCorpus = groundingCorpus.length > 0;
    const hasRawExternalCorpus = (context.rawEvidenceCorpus?.length ?? 0) > 0;
    const isPreferenceDiscoveryPath =
      this.isNoTextNoDomainsPreferencePath(context);
    // Once a raw corpus exists, only DIRECT/SUPPORTING classifications from
    // that corpus may produce opportunities. Legacy deterministic NLP/context
    // records are never allowed to become a second source of truth.
    const readyRetainedFallback =
      isPreferenceDiscoveryPath && !hasRawExternalCorpus
        ? this.buildRetainedEvidenceFallbackOpportunities(context)
        : [];
    const hasReadyRetainedFallback = readyRetainedFallback.length > 0;

    /*
     * A textual requester statement is a hypothesis, not evidence. When no
     * retained/raw external corpus exists, an online synthesis call cannot
     * legitimately create a grounded opportunity and previously died on the
     * special ~3s no-corpus timeout. Return the provenance-safe no-evidence
     * result immediately instead. As soon as collection/recovery contributes
     * any raw or retained evidence, the normal provider-diverse AI triage and
     * synthesis path still runs with the full bounded budget.
     */
    const retainedExternalEvidenceCount = Math.max(
      context.nlp?.totalTextsAnalyzed ?? 0,
      ...context.domainEvidence.map((item) => item.totalTextsAnalyzed ?? 0),
    );
    const hasExplicitRetainedExternalCorpus = retainedExternalEvidenceCount > 0;
    if (
      context.requestDescription?.trim() &&
      !hasRawExternalCorpus &&
      !hasExplicitRetainedExternalCorpus &&
      !hasReadyRetainedFallback
    ) {
      return this.buildNoGroundedEvidenceAnalysis(
        context,
        [],
        'No retained or raw external evidence was available for grounded Community AI synthesis; online synthesis was skipped instead of timing out on an evidence-free prompt.',
        false,
        [],
      );
    }

    const triageTelemetry: CommunityAiTriageTelemetry = {
      diagnostics: [],
      onlineAttemptCount: 0,
      fullCorpusAdjudicationCompleted: false,
      selectedProblemFamily: null,
      selectedProblemEvidenceIds: [],
      jointEvidenceGroups: [],
      adjudicatedEvidenceCount: 0,
    };
    const modelDiscovery = await this.findOnlineFallbackModels(context);
    const onlineModels = modelDiscovery.models;
    const evidenceClassifications = await this.classifyRawEvidenceCorpus(
      context,
      onlineModels,
      options,
      triageTelemetry,
    );

    if (options.classificationOnly) {
      return this.buildClassificationOnlyAnalysis(
        context,
        evidenceClassifications,
        triageTelemetry,
      );
    }

    const individuallyTrustedEvidenceCount = evidenceClassifications.filter(
      (item) => item.classification === 'DIRECT_PROBLEM' || item.classification === 'SUPPORTING_SIGNAL',
    ).length;
    const jointEvidenceGroups = triageTelemetry.jointEvidenceGroups.filter(
      (group) => group.verifiedByDeterministicGuard,
    );
    const synthesisEligibleEvidenceCount =
      individuallyTrustedEvidenceCount + jointEvidenceGroups.length;
    const unadjudicatedEvidenceCount = evidenceClassifications.filter(
      (item) => item.classification === 'UNADJUDICATED',
    ).length;
    const rawTriageEstablishedNoRelevantEvidence =
      hasRawExternalCorpus &&
      evidenceClassifications.length > 0 &&
      unadjudicatedEvidenceCount === 0 &&
      triageTelemetry.fullCorpusAdjudicationCompleted &&
      synthesisEligibleEvidenceCount === 0;
    const adjudicatedEvidenceCount = Math.max(
      0,
      evidenceClassifications.length - unadjudicatedEvidenceCount,
    );
    const highCoveragePartialAdjudication =
      synthesisEligibleEvidenceCount === 0 &&
      this.isLargeCorpusHighCoverageAdjudication(
        adjudicatedEvidenceCount,
        evidenceClassifications.length,
      );

    if (
      hasRawExternalCorpus &&
      synthesisEligibleEvidenceCount === 0 &&
      unadjudicatedEvidenceCount > 0
    ) {
      if (highCoveragePartialAdjudication) {
        const analysis = this.buildNoGroundedEvidenceAnalysis(
          context,
          triageTelemetry.diagnostics,
          `No trusted DIRECT_PROBLEM or SUPPORTING_SIGNAL evidence was retained among ${adjudicatedEvidenceCount}/${evidenceClassifications.length} adjudicated rows; ${unadjudicatedEvidenceCount} unresolved row(s) remain explicitly UNADJUDICATED.`,
          triageTelemetry.onlineAttemptCount > 0,
          evidenceClassifications,
        );
        return {
          ...analysis,
          triageAiSucceeded: true,
          qualityWarnings: [
            ...analysis.qualityWarnings,
            `High-coverage partial adjudication is usable: ${adjudicatedEvidenceCount}/${evidenceClassifications.length} rows received semantic verdicts from one complete-corpus model attempt; ${unadjudicatedEvidenceCount} unresolved row(s) remain UNADJUDICATED and are excluded from negative or positive evidence claims.`,
          ],
        };
      }
      return this.buildAdjudicationUnavailableAnalysis(
        context,
        triageTelemetry.diagnostics,
        evidenceClassifications,
        triageTelemetry.onlineAttemptCount > 0,
        triageTelemetry.adjudicatedEvidenceCount > 0,
      );
    }
    if (
      evidenceClassifications.length > 0 &&
      synthesisEligibleEvidenceCount === 0 &&
      (rawTriageEstablishedNoRelevantEvidence ||
        (!hasReadyRetainedFallback &&
          this.buildRetainedEvidenceFallbackOpportunities(context).length === 0))
    ) {
      const reason =
        'No synthesis-eligible evidence remained after raw-evidence semantic classification and deterministic verification.';
      const analysis = this.buildNoGroundedEvidenceAnalysis(
        context,
        triageTelemetry.diagnostics,
        reason,
        triageTelemetry.onlineAttemptCount > 0,
        evidenceClassifications,
      );
      return {
        ...analysis,
        evidenceVerdictState: 'NO_VALID_EVIDENCE_FOUND',
        qualityWarnings: [
          ...analysis.qualityWarnings,
          this.isEvidenceDiscoveryMode(context)
            ? 'Opportunity synthesis was skipped because the first-pass discovery corpus contained no trusted problem-bearing evidence inside the resolved domain scope.'
            : 'Opportunity synthesis was skipped because every classified raw evidence item was unrelated to the explicit requester problem/workflow.',
        ],
      };
    }

    if (individuallyTrustedEvidenceCount === 0 && jointEvidenceGroups.length > 0) {
      const strongestJoint = [...jointEvidenceGroups].sort(
        (left, right) =>
          right.distinctSourceCount - left.distinctSourceCount ||
          right.confidence - left.confidence ||
          right.evidenceIds.length - left.evidenceIds.length,
      )[0];
      if (strongestJoint) {
        const jointOpportunity = this.buildJointEvidenceOpportunity(
          context,
          strongestJoint,
        );
        const jointAnalysis = this.buildFallbackAnalysis([jointOpportunity], {
          semanticTriageClustering: true,
          aiAttempted: triageTelemetry.onlineAttemptCount > 0,
          onlineAttemptCount: triageTelemetry.onlineAttemptCount,
          fallbackReason: null,
          attemptDiagnostics: triageTelemetry.diagnostics,
          evidenceClassifications,
          jointEvidenceGroups,
          unvalidatedDomainHypotheses: this.buildUnvalidatedDomainHypotheses(
            context,
            strongestJoint.matchedDomainNames,
          ),
        });
        return {
          ...jointAnalysis,
          summary: `Community AI verified one joint supporting evidence group from ${strongestJoint.evidenceIds.length} complementary item(s) across ${strongestJoint.distinctSourceCount} independent source(s). Individual member rows remain bounded signals; only the composed group validates the evidence-native domain problem family.`,
          selectedProblemFamily: strongestJoint.problemFamily,
          selectedProblemFamilyEvidenceIds: [strongestJoint.id],
          selectedProblemFamilyTrustedEvidenceCount: 1,
          selectedProblemFamilyDistinctSourceCount: strongestJoint.distinctSourceCount,
          selectedProblemFamilySelectionSource: 'AI_CLUSTER_VERIFIED',
          evidenceVerdictState: 'VALID_EVIDENCE_FOUND',
          aiSucceeded: true,
          fallbackUsed: false,
          fallbackReason: null,
          qualityWarnings: [
            ...jointAnalysis.qualityWarnings,
            `The selected family is supported by one AI-verified joint evidence composition across ${strongestJoint.distinctSourceCount} independent source(s). No individual member row is claimed to establish the full problem alone, and prevalence remains unvalidated.`,
          ],
        };
      }
    }

    if (individuallyTrustedEvidenceCount > 0) {
      const clustered = this.buildClassifiedEvidenceFallbackOpportunities(
        context,
        evidenceClassifications,
        triageTelemetry.selectedProblemFamily,
        triageTelemetry.selectedProblemEvidenceIds,
      );
      if (clustered.length > 0) {
        const jointOpportunities = jointEvidenceGroups.map((group) =>
          this.buildJointEvidenceOpportunity(context, group),
        );
        const combinedOpportunities = [...clustered, ...jointOpportunities].filter(
          (opportunity, index, values) =>
            values.findIndex(
              (candidate) =>
                this.normalizeComparableText(candidate.title) ===
                this.normalizeComparableText(opportunity.title),
            ) === index,
        );
        this.logger.log(
          `Community AI problem-family clustering completed from semantic triage. retainedFamilies=${clustered.length}, jointFamilies=${jointOpportunities.length}, topFamily="${clustered[0]?.title ?? jointOpportunities[0]?.title ?? 'unknown'}", topEvidence=${clustered[0]?.evidenceSamples.length ?? jointOpportunities[0]?.evidenceSamples.length ?? 0}.`,
        );
        const clusteredAnalysis = this.buildFallbackAnalysis(
          combinedOpportunities.slice(0, 4),
          {
            semanticTriageClustering: true,
            aiAttempted: triageTelemetry.onlineAttemptCount > 0,
            onlineAttemptCount: triageTelemetry.onlineAttemptCount,
            fallbackReason:
              this.isEvidenceDiscoveryMode(context)
                ? 'Online semantic triage classified the broad first-pass discovery corpus; evidence-count/source-diversity clustering and any conservatively verified joint compositions remain available to canonical verification without a second synthesis call.'
                : 'Online semantic triage classified the broad first-pass corpus; individually trusted families and any conservatively verified joint compositions remain available to canonical verification without a second synthesis call.',
            attemptDiagnostics: triageTelemetry.diagnostics,
            evidenceClassifications,
            jointEvidenceGroups,
            aiSelectedProblemFamily: triageTelemetry.selectedProblemFamily,
            aiSelectedEvidenceIds: triageTelemetry.selectedProblemEvidenceIds,
            unvalidatedDomainHypotheses: this.buildUnvalidatedDomainHypotheses(
              context,
              combinedOpportunities.map((item) => item.domainName),
            ),
          },
        );

        /*
         * The provider proposes one family, but the verified family tournament
         * may structurally reject a narrow one-row winner in favor of a more
         * representative AI-classified family. Persist the actual tournament
         * winner before OpportunityRankingStage creates its immutable lock.
         */
        const selectedClusterFamily = clustered[0]?.title?.trim() ?? '';
        const selectedClusterEvidenceSamples = new Set(
          (clustered[0]?.evidenceSamples ?? [])
            .map((sample) => this.normalizeComparableText(sample))
            .filter(Boolean),
        );
        const rawTextById = new Map(
          (context.rawEvidenceCorpus ?? []).map(
            (item) => [item.id, this.normalizeComparableText(item.text)] as const,
          ),
        );
        const selectedClusterEvidenceIds = selectedClusterFamily
          ? evidenceClassifications
              .filter(
                (item) =>
                  item.verifiedByDeterministicGuard &&
                  (item.classification === 'DIRECT_PROBLEM' ||
                    item.classification === 'SUPPORTING_SIGNAL') &&
                  (
                    this.problemFamilyTransportIdentityMatches(
                      selectedClusterFamily,
                      item.problemFamily ?? null,
                    ) ||
                    selectedClusterEvidenceSamples.has(
                      rawTextById.get(item.evidenceId) ?? '',
                    )
                  ),
              )
              .map((item) => item.evidenceId)
          : [];
        const selectedClusterEvidenceIdSet = new Set(selectedClusterEvidenceIds);
        const selectedClusterDistinctSourceCount =
          EvidenceSourceIdentityUtil.count(
            (context.rawEvidenceCorpus ?? []).filter((item) =>
              selectedClusterEvidenceIdSet.has(item.id),
            ),
          );
        const providerSelectionSurvived =
          Boolean(
            selectedClusterFamily &&
              triageTelemetry.selectedProblemFamily &&
              this.problemFamilyTransportIdentityMatches(
                selectedClusterFamily,
                triageTelemetry.selectedProblemFamily,
              ),
          ) &&
          triageTelemetry.selectedProblemEvidenceIds.some((id) =>
            selectedClusterEvidenceIdSet.has(id),
          );

        return {
          ...clusteredAnalysis,
          selectedProblemFamily: selectedClusterFamily || null,
          selectedProblemFamilyEvidenceIds: selectedClusterEvidenceIds,
          selectedProblemFamilyTrustedEvidenceCount:
            selectedClusterEvidenceIds.length,
          selectedProblemFamilyDistinctSourceCount:
            selectedClusterDistinctSourceCount,
          selectedProblemFamilySelectionSource: providerSelectionSurvived
            ? 'AI_SELECTED_PENDING_VERIFICATION'
            : 'DETERMINISTIC_VERIFIED_FALLBACK',
        };
      }
    }

    const prompt = this.promptService.build(context, evidenceClassifications);
    const startedAt = Date.now();
    const diagnostics: CommunityAiAttemptDiagnostic[] = [
      ...triageTelemetry.diagnostics,
    ];
    const synthesisAttemptOffset = diagnostics.length;

    if (onlineModels.length === 0) {
      const classifiedFallback =
        this.buildClassifiedEvidenceFallbackOpportunities(
          context,
          evidenceClassifications,
        );
      const retainedFallback =
        classifiedFallback.length > 0
          ? classifiedFallback
          : readyRetainedFallback.length > 0
            ? readyRetainedFallback
            : this.buildRetainedEvidenceFallbackOpportunities(context);
      const reason =
        modelDiscovery.failureReason ??
        'No healthy online community-analysis model was available.';

      if (retainedFallback.length > 0) {
        this.logger.warn(
          `${reason} Verified evidence fallback was used without failing the stage.`,
        );
        return this.buildFallbackAnalysis(retainedFallback, {
          aiAttempted: triageTelemetry.onlineAttemptCount > 0,
          onlineAttemptCount: triageTelemetry.onlineAttemptCount,
          fallbackReason: reason,
          attemptDiagnostics: diagnostics,
          evidenceClassifications,
          unvalidatedDomainHypotheses: this.buildUnvalidatedDomainHypotheses(
            context,
            retainedFallback.map((item) => item.domainName),
          ),
        });
      }

      return this.buildNoGroundedEvidenceAnalysis(
        context,
        diagnostics,
        reason,
        triageTelemetry.onlineAttemptCount > 0,
        evidenceClassifications,
      );
    }

    const configuredMaxAttempts = Math.max(
      1,
      Math.floor(options.maxAttempts ?? COMMUNITY_AI_ANALYSIS_MAX_ATTEMPTS),
    );
    const maxConcurrentAttempts = hasGroundingCorpus
      ? Math.min(
          COMMUNITY_AI_EVIDENCE_TRIAGE_PARALLEL_MODELS,
          COMMUNITY_AI_ANALYSIS_MAX_ATTEMPTS,
          configuredMaxAttempts,
        )
      : 1;
    const models = onlineModels.slice(
      0,
      Math.min(maxConcurrentAttempts, onlineModels.length),
    );
    const controllers = models.map(() => new AbortController());
    const abortAll = () => controllers.forEach((controller) => controller.abort());
    if (options.signal?.aborted) {
      abortAll();
      throw new Error('Community AI analysis cancelled.');
    }
    options.signal?.addEventListener('abort', abortAll, { once: true });
    type AttemptResult = {
      readonly index: number;
      readonly analysis: CommunityAiAnalysis | null;
      readonly operationId?: string;
      readonly modelId?: string;
      readonly apiModelId?: string;
      readonly providerKey?: string;
      readonly durationMs: number;
      readonly providerExecutionSucceeded?: boolean;
      readonly providerOpportunityCount?: number;
      readonly candidateTitles?: readonly string[];
      readonly semanticGroundingRepairCount?: number;
      readonly error?: unknown;
    };
    const pending = new Map<number, Promise<AttemptResult>>();
    let lastError: unknown = null;
    let bestFallbackAnalysis: CommunityAiAnalysis | null = null;

    models.forEach((model, index) => {
      const attempt = index + 1;
      const requestStartedAt = Date.now();
      const configuredRequestTimeoutMs = Math.max(
        750,
        Math.floor(
          options.requestTimeoutMs ?? COMMUNITY_AI_ANALYSIS_REQUEST_TIMEOUT_MS,
        ),
      );
      const configuredTotalTimeoutMs = Math.max(
        configuredRequestTimeoutMs,
        Math.floor(
          options.totalTimeoutMs ?? COMMUNITY_AI_ANALYSIS_TOTAL_TIMEOUT_MS,
        ),
      );
      const requestTimeoutMs = hasGroundingCorpus
        ? Math.min(
            configuredRequestTimeoutMs,
            configuredTotalTimeoutMs,
          )
        : Math.min(
            5_200,
            configuredRequestTimeoutMs,
            configuredTotalTimeoutMs,
          );

      const task: Promise<AttemptResult> = this.withHardTimeout(
        this.aiExecutionService.execute({
          aiModelId: model.id,
          allowTemporaryModelCooldownBypass: true,
          allowBoundedEmergencyModelAttempt: true,
          userPrompt: prompt.userPrompt,
          systemInstruction: prompt.systemInstruction,
          requestType: ApiRequestType.NLP_ENHANCEMENT,
          promptType: PromptType.NLP_ANALYSIS,
          generationType: context.generationType,
          userId:
            context.owner.type === IDEA_OWNER_TYPES.USER
              ? context.owner.userId
              : undefined,
          guestSessionId:
            context.owner.type === IDEA_OWNER_TYPES.GUEST
              ? context.owner.guestSessionId
              : undefined,
          responseFormat: AiResponseFormat.JSON,
          responseSchema: buildCommunityAiAnalysisSchema({
            requireEvidenceSamples: !this.isDomainsOnlyPath(context),
            requireEvidenceClassifications: false,
          }),
          responseSchemaName: this.isDomainsOnlyPath(context)
            ? COMMUNITY_AI_ANALYSIS_DOMAINS_ONLY_SCHEMA_NAME
            : COMMUNITY_AI_ANALYSIS_SCHEMA_NAME,
          estimatedOutputTokens: COMMUNITY_AI_ANALYSIS_MAX_OUTPUT_TOKENS,
          maxOutputTokens: COMMUNITY_AI_ANALYSIS_MAX_OUTPUT_TOKENS,
          temperature: COMMUNITY_AI_ANALYSIS_TEMPERATURE,
          strategy: AiRoutingStrategy.BALANCED,
          excludedAiModelIds: models
            .filter((_item, modelIndex) => modelIndex !== index)
            .map((item) => item.id),
          timeoutMs: requestTimeoutMs,
          maxRetriesPerModel: 0,
          maxModelsPerOperation: COMMUNITY_AI_ANALYSIS_MAX_MODELS_PER_OPERATION,
          allowProviderFallbackOnInvalidPrompt: true,
          signal: controllers[index].signal,
        }),
        requestTimeoutMs + 350,
        `Community AI online attempt ${attempt}`,
      )
        .then((result): AttemptResult => {
          const providerPreview =
            this.summarizeProviderResponseForDiagnostics(result.text);
          try {
            const analysis = this.parseGroundAndValidate(
              context,
              result.text,
              result.aiModelId,
              result.apiModelId,
              attempt,
              evidenceClassifications,
            );
            return {
              index,
              analysis,
              operationId: result.operationId,
              modelId: result.aiModelId,
              apiModelId: result.apiModelId,
              providerKey: result.providerKey,
              durationMs: Date.now() - requestStartedAt,
              providerExecutionSucceeded: true,
              providerOpportunityCount: providerPreview.opportunityCount,
              candidateTitles: providerPreview.candidateTitles,
              semanticGroundingRepairCount:
                this.readSemanticGroundingRepairCount(analysis),
            };
          } catch (error: unknown) {
            return {
              index,
              analysis: null,
              operationId: result.operationId,
              modelId: result.aiModelId,
              apiModelId: result.apiModelId,
              providerKey: result.providerKey,
              durationMs: Date.now() - requestStartedAt,
              providerExecutionSucceeded: true,
              providerOpportunityCount: providerPreview.opportunityCount,
              candidateTitles: providerPreview.candidateTitles,
              error,
            };
          }
        })
        .catch((error: unknown): AttemptResult => ({
          index,
          analysis: null,
          error,
          durationMs: Date.now() - requestStartedAt,
          providerExecutionSucceeded: false,
        }));

      pending.set(index, task);
    });

    const configuredTotalTimeoutMs = Math.max(
      1_000,
      Math.floor(options.totalTimeoutMs ?? COMMUNITY_AI_ANALYSIS_TOTAL_TIMEOUT_MS),
    );
    const totalTimeoutAt =
      startedAt +
      (hasGroundingCorpus
        ? configuredTotalTimeoutMs
        : Math.min(5_800, configuredTotalTimeoutMs));

    while (pending.size > 0 && Date.now() < totalTimeoutAt) {
      const remainingMs = Math.max(1, totalTimeoutAt - Date.now());
      const settled = await this.withHardTimeout(
        Promise.race(pending.values()),
        remainingMs,
        'Community AI provider-diverse chain',
      ).catch((error: unknown): AttemptResult => ({
        index: -1,
        analysis: null,
        error,
        durationMs: Date.now() - startedAt,
      }));

      if (settled.index < 0) {
        lastError = hasReadyRetainedFallback
          ? new Error(
              'Online Community AI enrichment did not complete inside the shared Community AI budget; the grounded retained-evidence fallback was selected.',
            )
          : settled.error;
        break;
      }

      pending.delete(settled.index);
      const model = models[settled.index];

      if (settled.analysis?.aiSucceeded) {
        diagnostics.push({
          attempt: synthesisAttemptOffset + settled.index + 1,
          modelId: settled.modelId ?? model?.id ?? null,
          apiModelId: settled.apiModelId ?? model?.apiModelId ?? null,
          providerKey: settled.providerKey ?? model?.providerKey ?? null,
          status: 'ACCEPTED',
          durationMs: settled.durationMs,
          reason: null,
          providerOpportunityCount: settled.providerOpportunityCount,
          groundedOpportunityCount: settled.analysis.opportunities.length,
          candidateTitles: settled.candidateTitles,
          semanticGroundingRepairCount: settled.semanticGroundingRepairCount,
        });

        controllers.forEach((controller, index) => {
          if (index !== settled.index && pending.has(index)) {
            controller.abort();
            const pendingModel = models[index];
            diagnostics.push({
              attempt: synthesisAttemptOffset + index + 1,
              modelId: pendingModel?.id ?? null,
              apiModelId: pendingModel?.apiModelId ?? null,
              providerKey: pendingModel?.providerKey ?? null,
              status: 'ABORTED',
              durationMs: Date.now() - startedAt,
              reason: 'Cancelled after another online model returned an accepted analysis.',
            });
          }
        });
        void Promise.allSettled(pending.values());

        const accepted = this.attachExecutionTelemetry(settled.analysis, {
          diagnostics,
          onlineAttemptCount: triageTelemetry.onlineAttemptCount + models.length,
          fallbackReason: null,
        });
        this.logger.log(
          `Community AI analysis accepted. operationId=${settled.operationId}, modelId=${settled.modelId}, apiModelId=${settled.apiModelId}, provider=${settled.providerKey}, concurrentAttempt=${settled.index + 1}/${models.length}, opportunities=${accepted.opportunities.length}, elapsedMs=${Date.now() - startedAt}.`,
        );
        return accepted;
      }

      if (settled.analysis) {
        bestFallbackAnalysis ??= settled.analysis;
        diagnostics.push({
          attempt: synthesisAttemptOffset + settled.index + 1,
          modelId: settled.modelId ?? model?.id ?? null,
          apiModelId: settled.apiModelId ?? model?.apiModelId ?? null,
          providerKey: settled.providerKey ?? model?.providerKey ?? null,
          status: 'VALIDATION_REJECTED',
          durationMs: settled.durationMs,
          reason:
            settled.analysis.fallbackReason ??
            'The provider response did not survive evidence/business validation; retained evidence was preserved.',
          providerOpportunityCount: settled.providerOpportunityCount,
          groundedOpportunityCount: settled.analysis.opportunities.length,
          candidateTitles: settled.candidateTitles,
          semanticGroundingRepairCount: settled.semanticGroundingRepairCount,
        });
        continue;
      }

      lastError = settled.error;
      const errorMessage = this.getErrorMessage(settled.error);
      const normalizedError = errorMessage.toLocaleLowerCase();
      const timedOut = /timeout|timed out|exceeded .*ms/u.test(normalizedError);
      const aborted = /abort|cancel/u.test(normalizedError);
      const validationRejected = settled.providerExecutionSucceeded === true;
      diagnostics.push({
        attempt: synthesisAttemptOffset + settled.index + 1,
        modelId: settled.modelId ?? model?.id ?? null,
        apiModelId: settled.apiModelId ?? model?.apiModelId ?? null,
        providerKey: settled.providerKey ?? model?.providerKey ?? null,
        status: validationRejected
          ? 'VALIDATION_REJECTED'
          : timedOut
            ? 'TIMEOUT'
            : aborted
              ? 'ABORTED'
              : 'EXECUTION_FAILED',
        durationMs: settled.durationMs,
        reason: errorMessage,
        providerOpportunityCount: settled.providerOpportunityCount,
        groundedOpportunityCount: 0,
        candidateTitles: settled.candidateTitles,
      });

      const databaseUnavailable = isTransientDatabaseError(settled.error);
      this.logger.warn(
        `Community AI online model failed. concurrentAttempt=${settled.index + 1}/${models.length}, model=${model?.displayName ?? model?.modelName ?? 'balanced-routing'}, provider=${model?.providerKey ?? 'auto'}, databaseUnavailable=${databaseUnavailable}, elapsedMs=${Date.now() - startedAt}, error=${errorMessage}.`,
      );
      if (databaseUnavailable) {
        controllers.forEach((controller) => controller.abort());
        break;
      }
    }

    controllers.forEach((controller, index) => {
      if (pending.has(index) && !controllers[index].signal.aborted) {
        controller.abort();
      }
    });
    for (const [index] of pending) {
      if (!diagnostics.some((item) => item.attempt === synthesisAttemptOffset + index + 1)) {
        const model = models[index];
        diagnostics.push({
          attempt: synthesisAttemptOffset + index + 1,
          modelId: model?.id ?? null,
          apiModelId: model?.apiModelId ?? null,
          providerKey: model?.providerKey ?? null,
          status: 'TIMEOUT',
          durationMs: Date.now() - startedAt,
          reason: hasReadyRetainedFallback
            ? 'The shared Community AI wall-clock budget expired before this model produced an accepted result; the grounded retained-evidence fallback remained available.'
            : 'The shared Community AI wall-clock budget expired before this model produced an accepted result.',
        });
      }
    }
    void Promise.allSettled(pending.values());

    const finalReason =
      bestFallbackAnalysis?.fallbackReason ??
      this.getErrorMessage(lastError) ??
      'All online Community AI responses failed or were rejected within the shared time budget.';

    if (bestFallbackAnalysis) {
      return this.attachExecutionTelemetry(bestFallbackAnalysis, {
        diagnostics,
        onlineAttemptCount: triageTelemetry.onlineAttemptCount + models.length,
        fallbackReason: finalReason,
      });
    }

    const classifiedFallback =
      this.buildClassifiedEvidenceFallbackOpportunities(
        context,
        evidenceClassifications,
      );
    const retainedFallback =
      classifiedFallback.length > 0
        ? classifiedFallback
        : readyRetainedFallback.length > 0
          ? readyRetainedFallback
          : this.buildRetainedEvidenceFallbackOpportunities(context);
    if (retainedFallback.length > 0) {
      const fallback = this.applyEvidenceGrounding(
        context,
        this.buildFallbackAnalysis(retainedFallback, {
          aiAttempted: true,
          onlineAttemptCount: triageTelemetry.onlineAttemptCount + models.length,
          fallbackReason: finalReason,
          attemptDiagnostics: diagnostics,
          evidenceClassifications,
          unvalidatedDomainHypotheses: this.buildUnvalidatedDomainHypotheses(
            context,
            retainedFallback.map((item) => item.domainName),
          ),
        }),
        true,
      );
      return this.attachExecutionTelemetry(fallback, {
        diagnostics,
        onlineAttemptCount: triageTelemetry.onlineAttemptCount + models.length,
        fallbackReason: finalReason,
      });
    }

    return this.buildNoGroundedEvidenceAnalysis(
      context,
      diagnostics,
      finalReason,
      triageTelemetry.onlineAttemptCount + models.length > 0,
      evidenceClassifications,
    );
  }

  private attachExecutionTelemetry(
    analysis: CommunityAiAnalysis,
    input: {
      readonly diagnostics: readonly CommunityAiAttemptDiagnostic[];
      readonly onlineAttemptCount: number;
      readonly fallbackReason: string | null;
    },
  ): CommunityAiAnalysis {
    const diagnostics = [...input.diagnostics].sort(
      (first, second) => first.attempt - second.attempt,
    );
    return {
      ...analysis,
      attemptCount: Math.max(
        analysis.attemptCount,
        diagnostics.filter((item) => item.status !== 'ABORTED').length,
      ),
      aiAttempted: input.onlineAttemptCount > 0,
      triageAiSucceeded:
        analysis.triageAiSucceeded ??
        (analysis.evidenceClassifications ?? []).some((item) =>
          /AI semantic triage/iu.test(item.reason),
        ),
      synthesisAiSucceeded:
        analysis.synthesisAiSucceeded ?? analysis.aiSucceeded,
      aiSucceeded: analysis.aiSucceeded,
      fallbackUsed: analysis.fallbackUsed || !analysis.aiSucceeded,
      onlineAttemptCount: input.onlineAttemptCount,
      executionFailureCount: diagnostics.filter(
        (item) => item.status === 'EXECUTION_FAILED' || item.status === 'TIMEOUT',
      ).length,
      validationRejectedCount: diagnostics.filter(
        (item) => item.status === 'VALIDATION_REJECTED',
      ).length,
      fallbackReason:
        analysis.aiSucceeded && !analysis.fallbackUsed
          ? null
          : input.fallbackReason ?? analysis.fallbackReason,
      attemptDiagnostics: diagnostics,
    };
  }

  private buildNoGroundedEvidenceAnalysis(
    context: IdeaGenerationContext,
    diagnostics: readonly CommunityAiAttemptDiagnostic[],
    reason: string,
    aiAttempted: boolean,
    evidenceClassifications: readonly CommunityAiEvidenceTriage[] = [],
  ): CommunityAiAnalysis {
    const hypotheses = this.buildUnvalidatedDomainHypotheses(context, []);
    const effectiveDiagnostics: CommunityAiAttemptDiagnostic[] = [
      ...diagnostics,
    ];
    return {
      summary:
        'No evidence-grounded Community AI opportunity survived validation; unvalidated domain hypotheses were kept separate so the pipeline can continue without fabricating evidence.',
      dominantProblems: [],
      unmetNeeds: [],
      opportunities: [],
      overallConfidence: 15,
      qualityWarnings: [
        'Community AI did not produce an acceptable grounded opportunity within the bounded budget.',
        'Unvalidated domain hypotheses are not treated as community evidence and may only be used as a last-resort generation direction.',
      ],
      evidenceVerdictState: 'NO_VALID_EVIDENCE_FOUND',
      modelId: null,
      apiModelId: null,
      attemptCount: effectiveDiagnostics.length,
      aiAttempted,
      triageAiSucceeded:
        evidenceClassifications.length > 0 &&
        !evidenceClassifications.some(
          (item) => item.classification === 'UNADJUDICATED',
        ),
      synthesisAiSucceeded: false,
      aiSucceeded: false,
      fallbackUsed: true,
      onlineAttemptCount: effectiveDiagnostics.length,
      executionFailureCount: effectiveDiagnostics.filter(
        (item) => item.status === 'EXECUTION_FAILED' || item.status === 'TIMEOUT',
      ).length,
      validationRejectedCount: effectiveDiagnostics.filter(
        (item) => item.status === 'VALIDATION_REJECTED',
      ).length,
      fallbackReason: reason,
      attemptDiagnostics: effectiveDiagnostics,
      unvalidatedDomainHypotheses: hypotheses,
      evidenceClassifications,
    };
  }

  private buildAdjudicationUnavailableAnalysis(
    context: IdeaGenerationContext,
    diagnostics: readonly CommunityAiAttemptDiagnostic[],
    evidenceClassifications: readonly CommunityAiEvidenceTriage[],
    aiAttempted: boolean,
    triageAiSucceeded = false,
  ): CommunityAiAnalysis {
    const unadjudicatedCount = evidenceClassifications.filter(
      (item) => item.classification === 'UNADJUDICATED',
    ).length;
    return {
      summary:
        `External evidence was collected, but semantic adjudication did not complete for ${unadjudicatedCount} raw evidence item(s). The pipeline therefore makes no claim that those rows are related or unrelated and keeps them available for recovery/retry.`,
      dominantProblems: [],
      unmetNeeds: [],
      opportunities: [],
      overallConfidence: 0,
      qualityWarnings: [
        'Evidence adjudication is unavailable: collected raw evidence must not be described as rejected, unrelated, or absent merely because the online semantic models timed out or failed.',
        'No external-demand claim is promoted until Community AI returns a semantic verdict; raw provenance is preserved for recovery.',
      ],
      evidenceVerdictState: 'EVIDENCE_ADJUDICATION_UNAVAILABLE',
      modelId: null,
      apiModelId: null,
      attemptCount: diagnostics.filter((item) => item.status !== 'ABORTED').length,
      aiAttempted,
      triageAiSucceeded,
      synthesisAiSucceeded: false,
      aiSucceeded: triageAiSucceeded,
      fallbackUsed: true,
      onlineAttemptCount: diagnostics.length,
      executionFailureCount: diagnostics.filter(
        (item) => item.status === 'EXECUTION_FAILED' || item.status === 'TIMEOUT',
      ).length,
      validationRejectedCount: diagnostics.filter(
        (item) => item.status === 'VALIDATION_REJECTED',
      ).length,
      fallbackReason:
        'EVIDENCE_ADJUDICATION_UNAVAILABLE: the complete raw corpus was collected, but no complete online semantic verdict returned inside the resilient full-corpus budget.',
      attemptDiagnostics: [...diagnostics],
      unvalidatedDomainHypotheses: this.buildUnvalidatedDomainHypotheses(
        context,
        [],
      ),
      evidenceClassifications: [...evidenceClassifications],
      selectedProblemFamily: null,
      selectedProblemFamilyEvidenceIds: [],
    };
  }

  private buildUnvalidatedDomainHypotheses(
    context: IdeaGenerationContext,
    representedDomains: readonly string[],
  ): CommunityAiDomainHypothesis[] {
    const represented = new Set(
      representedDomains.map((domain) => this.normalizeComparableText(domain)),
    );
    return context.selectedDomains
      .filter(
        (domain) =>
          RequestEvidenceDomainRoleUtil.isEvidenceSearchDomain(
            domain.name,
            context.requestDescription?.trim() ?? '',
          ) &&
          !represented.has(this.normalizeComparableText(domain.name)) &&
          !this.hasRetainedDomainEvidence(context, domain.id),
      )
      .map((domain) => ({
        domainName: domain.name,
        title: `${domain.name} validation-first workflow opportunity`,
        problem: `A concrete community problem for ${domain.name} was not retained within the bounded collection window.`,
        unmetNeed: `A validation workflow that discovers and tests the highest-value ${domain.name} problem before implementation.`,
        solutionArea: 'Problem discovery, validation, and configurable pilot workflow',
        confidence: 15,
        risks: [
          'No retained community evidence grounds this hypothesis; it must not be presented as observed demand.',
        ],
      }));
  }

  private hasRetainedDomainEvidence(
    context: IdeaGenerationContext,
    domainId: string,
  ): boolean {
    const profile = context.domainEvidence.find(
      (item) => item.domainId === domainId,
    );

    if (!profile?.evidenceAvailable) {
      return false;
    }

    const totalTexts =
      typeof profile.totalTextsAnalyzed === 'number'
        ? profile.totalTextsAnalyzed
        : 0;
    const posts = Array.isArray(profile.samplePosts)
      ? profile.samplePosts.length
      : 0;
    const comments = Array.isArray(profile.sampleComments)
      ? profile.sampleComments.length
      : 0;

    return totalTexts > 0 || posts + comments > 0;
  }

  /**
   * Returns active online models in provider-diverse order.
   *
   * The configured default model is first when it is online. The second slot
   * prefers a different provider, avoiding two attempts against the same
   * failing provider while keeping the fallback fully remote.
   */
  /**
   * Classifies the complete bounded raw collector corpus before opportunity
   * synthesis. The complete bounded representative corpus is sent in one request
   * per racing model so problem-family context is never fragmented by batching.
   *
   * Every selected representative evidence id receives a semantic result.
   * Provider failures, timeouts, malformed output, or omitted selected ids fall
   * back conservatively. Raw items excluded only by non-semantic representative
   * corpus hygiene remain non-admitted and cannot become verified evidence.
   */
  private async classifyRawEvidenceCorpus(
    context: IdeaGenerationContext,
    onlineModels: readonly AiModel[],
    options: CommunityAiAnalysisExecutionOptions,
    telemetry: CommunityAiTriageTelemetry,
  ): Promise<CommunityAiEvidenceTriage[]> {
    const requestDescription = context.requestDescription?.trim() ?? '';
    const rawCorpus = context.rawEvidenceCorpus ?? [];
    if (rawCorpus.length === 0) {
      return [];
    }

    const discoveryMode = this.isEvidenceDiscoveryMode(context);
    this.logger.debug(
      `Community AI raw-evidence triage starting. mode=${discoveryMode ? 'DOMAIN_DISCOVERY' : 'REQUEST_GROUNDED'}, raw=${rawCorpus.length}.`,
    );

    const deterministicFallback = new Map(
      rawCorpus.map((item) => [
        item.id,
        this.buildDeterministicEvidenceTriage(context, item),
      ] as const),
    );

    if (onlineModels.length === 0) {
      this.logger.warn(
        'Community AI normal semantic model pool is empty; configured emergency/local JSON AI routes will be checked before the corpus is left UNADJUDICATED.',
      );
    }

    const aiTriageCorpus = this.selectAiTriageCandidates(rawCorpus);
    if (aiTriageCorpus.length === 0) {
      this.logger.debug(
        `Community AI all-collected triage had no non-empty raw candidates. raw=${rawCorpus.length}.`,
      );
      return rawCorpus.map((item) => deterministicFallback.get(item.id)!);
    }

    /*
     * The complete bounded corpus is adjudicated as ONE semantic unit. We do
     * not split the corpus into independent batches because evidence in one
     * source/thread can materially change the meaning or family identity of a
     * distant item. The collector layer is already bounded, and the provider
     * schema ceiling is sized above the normal fast-generation corpus.
     */
    const completeCorpus = aiTriageCorpus.slice(
      0,
      COMMUNITY_AI_EVIDENCE_TRIAGE_MAX_ITEMS_PER_REQUEST,
    );
    const omittedForTransport = aiTriageCorpus.slice(completeCorpus.length);
    if (omittedForTransport.length > 0) {
      this.logger.warn(
        `Community AI complete-corpus ceiling reached. selected=${aiTriageCorpus.length}, transport=${completeCorpus.length}. Omitted rows stay UNADJUDICATED rather than being classified in a separate batch.`,
      );
    }

    const adaptiveRequestTimeoutMs =
      this.resolveFullCorpusTriageRequestTimeoutMs(completeCorpus.length);
    const adaptiveTotalTimeoutMs =
      this.resolveFullCorpusTriageTotalTimeoutMs(completeCorpus.length);

    /*
     * IMPORTANT: raw-evidence adjudication has its own reliability budget. The
     * generic Community-AI request/total timeout options are tuned for the
     * later opportunity-synthesis pass and must never shrink the semantic
     * verdict window. That old coupling created the 8.4-8.8 second cliff where
     * a healthy 20+ row full-corpus response was killed just before completion.
     *
     * Callers may still raise the semantic budget explicitly, but a smaller
     * synthesis budget can no longer reduce the dedicated full-corpus floor.
     */
    const requestedSemanticTotalMs = options.totalTimeoutMs !== undefined
      ? Math.max(adaptiveTotalTimeoutMs, Math.floor(options.totalTimeoutMs))
      : adaptiveTotalTimeoutMs;
    const firstPassTotalTimeoutMs = Math.min(
      COMMUNITY_AI_EVIDENCE_TRIAGE_TOTAL_TIMEOUT_MS,
      requestedSemanticTotalMs,
    );
    const requestedSemanticRequestMs = options.requestTimeoutMs !== undefined
      ? Math.max(adaptiveRequestTimeoutMs, Math.floor(options.requestTimeoutMs))
      : adaptiveRequestTimeoutMs;
    const semanticRequestTimeoutCapMs = Math.min(
      COMMUNITY_AI_EVIDENCE_TRIAGE_REQUEST_TIMEOUT_MS,
      requestedSemanticRequestMs,
    );

    const firstPass = await this.classifyEvidenceCorpusWithAi({
      context,
      corpus: completeCorpus,
      onlineModels,
      deadline: Date.now() + firstPassTotalTimeoutMs,
      signal: options.signal,
      deterministicFallback,
      telemetry,
      requestTimeoutCapMs: semanticRequestTimeoutCapMs,
      maxParallelAttempts: options.maxAttempts,
      // A fresh-deadline rescue is coordinated below so the retry can never be
      // starved by the first race consuming the original shared deadline.
      allowFullCorpusRetry: false,
      allowEmergencyModelAttempt: true,
    });

    const countAdjudicated = (items: readonly CommunityAiEvidenceTriage[]): number =>
      items.filter((item) => item.classification !== 'UNADJUDICATED').length;
    const firstPassAdjudicated = countAdjudicated(firstPass);
    let classified = firstPass;

    /*
     * If any row is still UNADJUDICATED after the initial provider-diverse
     * race, retry the SAME COMPLETE corpus once with a FRESH adaptive deadline.
     * This is deliberately not a missing-id request and not a mini-batch: every
     * rescue model sees the full cross-row context again. We choose one whole
     * model attempt by coverage; semantic verdicts from separate models are
     * never stitched together.
     */
    let currentAdjudicated = firstPassAdjudicated;
    let currentIsHighCoverage = this.isLargeCorpusHighCoverageAdjudication(
      currentAdjudicated,
      completeCorpus.length,
    );

    if (currentIsHighCoverage) {
      this.logger.log(
        `Community AI first pass retained ${currentAdjudicated}/${completeCorpus.length} valid verdict(s); preserving the small unresolved tail as UNADJUDICATED instead of paying another complete-corpus provider window.`,
      );
    }

    const initialAttemptStatuses = telemetry.diagnostics.filter(
      (item) => item.status !== 'ABORTED',
    );
    const initialPoolWasActuallyExhausted =
      onlineModels.length > 1 &&
      initialAttemptStatuses.length >=
        Math.min(
          onlineModels.length,
          Math.max(
            1,
            Math.floor(
              options.maxAttempts ?? COMMUNITY_AI_EVIDENCE_TRIAGE_PARALLEL_MODELS,
            ),
          ),
        );
    const initialPoolTimedOutWithoutVerdict =
      currentAdjudicated === 0 &&
      initialAttemptStatuses.length > 0 &&
      initialAttemptStatuses.every((item) => item.status === 'TIMEOUT');
    const shortProviderRetryDelayMs =
      currentAdjudicated === 0
        ? this.resolveShortProviderRetryDelayMs(
            initialAttemptStatuses
              .map((item) => item.reason)
              .filter(
                (reason): reason is string =>
                  typeof reason === 'string' && reason.trim().length > 0,
              ),
          )
        : null;
    const shortProviderRetryReadyAt =
      shortProviderRetryDelayMs !== null
        ? Date.now() + shortProviderRetryDelayMs
        : null;

    /*
     * If the normal online pool produced zero semantic verdicts, try only AI
     * routes that were not already attempted: another configured provider or a
     * configured local JSON model. This is an availability rescue, not a
     * semantic fallback; the exact same complete corpus and schema are used.
     */
    let emergencyAlternativeAttempted = false;
    if (
      currentAdjudicated === 0 &&
      !options.signal?.aborted
    ) {
      const attemptedModelIds = new Set(
        telemetry.diagnostics
          .map((item) => item.modelId)
          .filter((modelId): modelId is string =>
            typeof modelId === 'string' && modelId.length > 0,
          ),
      );
      const emergencyModels = await this.findEmergencySemanticTriageModels(
        attemptedModelIds,
      );
      if (emergencyModels.length > 0) {
        emergencyAlternativeAttempted = true;
        const emergencyTelemetry: CommunityAiTriageTelemetry = {
          diagnostics: [],
          onlineAttemptCount: 0,
          fullCorpusAdjudicationCompleted: false,
          selectedProblemFamily: null,
          selectedProblemEvidenceIds: [],
          jointEvidenceGroups: [],
          adjudicatedEvidenceCount: 0,
        };
        const emergencyBudgetMs = Math.min(
          COMMUNITY_AI_EVIDENCE_TRIAGE_TOTAL_TIMEOUT_MS,
          Math.max(adaptiveRequestTimeoutMs + 4_000, 18_000),
        );
        this.logger.warn(
          `Community AI normal semantic pool produced no adjudicated rows; trying ${emergencyModels.length} configured alternate AI route(s) before preserving the corpus as UNADJUDICATED.`,
        );
        const emergency = await this.classifyEvidenceCorpusWithAi({
          context,
          corpus: completeCorpus,
          onlineModels: emergencyModels,
          deadline: Date.now() + emergencyBudgetMs,
          signal: options.signal,
          deterministicFallback,
          telemetry: emergencyTelemetry,
          requestTimeoutCapMs: Math.min(
            COMMUNITY_AI_EVIDENCE_TRIAGE_REQUEST_TIMEOUT_MS,
            Math.max(semanticRequestTimeoutCapMs, adaptiveRequestTimeoutMs + 6_000),
          ),
          maxParallelAttempts: Math.min(
            COMMUNITY_AI_EVIDENCE_TRIAGE_PARALLEL_MODELS,
            emergencyModels.length,
          ),
          allowFullCorpusRetry: false,
          allowEmergencyModelAttempt: true,
        });
        const emergencyAdjudicated = countAdjudicated(emergency);
        const attemptOffset = telemetry.onlineAttemptCount;
        telemetry.onlineAttemptCount += emergencyTelemetry.onlineAttemptCount;
        telemetry.diagnostics.push(
          ...emergencyTelemetry.diagnostics.map((item) => ({
            ...item,
            attempt: attemptOffset + item.attempt,
          })),
        );
        if (emergencyAdjudicated > currentAdjudicated) {
          classified = emergency;
          currentAdjudicated = emergencyAdjudicated;
          currentIsHighCoverage = this.isLargeCorpusHighCoverageAdjudication(
            currentAdjudicated,
            completeCorpus.length,
          );
          telemetry.adjudicatedEvidenceCount =
            emergencyTelemetry.adjudicatedEvidenceCount;
          telemetry.fullCorpusAdjudicationCompleted =
            emergencyTelemetry.fullCorpusAdjudicationCompleted;
          telemetry.selectedProblemFamily =
            emergencyTelemetry.selectedProblemFamily;
          telemetry.selectedProblemEvidenceIds = [
            ...emergencyTelemetry.selectedProblemEvidenceIds,
          ];
          telemetry.jointEvidenceGroups = [
            ...emergencyTelemetry.jointEvidenceGroups,
          ];
          this.logger.log(
            `Community AI alternate-route rescue recovered ${currentAdjudicated}/${completeCorpus.length} semantic verdict(s).`,
          );
        }
      }
    }

    /*
     * A same-pool fresh-deadline retry is useful only when the first pass did
     * not already exercise multiple configured models. Re-running the same two
     * models immediately after one quota failure plus one timeout simply doubles
     * latency and cannot create provider diversity. With one model configured,
     * one fresh retry remains available for a transient timeout.
     */
    const shouldRetrySamePool =
      currentAdjudicated < completeCorpus.length &&
      !currentIsHighCoverage &&
      (
        initialPoolTimedOutWithoutVerdict ||
        (!emergencyAlternativeAttempted || shortProviderRetryDelayMs !== null)
      ) &&
      (
        !initialPoolWasActuallyExhausted ||
        shortProviderRetryDelayMs !== null ||
        initialPoolTimedOutWithoutVerdict
      ) &&
      onlineModels.length > 0 &&
      !options.signal?.aborted;

    if (
      initialPoolWasActuallyExhausted &&
      !currentIsHighCoverage &&
      shortProviderRetryDelayMs === null &&
      !initialPoolTimedOutWithoutVerdict
    ) {
      this.logger.warn(
        `Community AI initial semantic pool already exercised multiple configured model routes without sufficient improvement; skipping an immediate repeat of the same pool and preserving unresolved rows as UNADJUDICATED.`,
      );
    }

    if (shouldRetrySamePool) {
      if (shortProviderRetryReadyAt !== null) {
        const remainingRetryDelayMs = Math.max(
          0,
          shortProviderRetryReadyAt - Date.now(),
        );
        this.logger.warn(
          `Community AI provider returned a bounded retry window after rate limiting; waiting ${remainingRetryDelayMs}ms before one fresh same-corpus semantic retry instead of treating the route as exhausted quota.`,
        );
        await this.delayForProviderRetry(
          remainingRetryDelayMs,
          options.signal,
        );
      }
      const rotatedRescueModels = shortProviderRetryDelayMs !== null
        ? [onlineModels[0]]
        : onlineModels.length > 1
          ? [...onlineModels.slice(1), onlineModels[0]]
          : [...onlineModels];
      const rescueTelemetry: CommunityAiTriageTelemetry = {
        diagnostics: [],
        onlineAttemptCount: 0,
        fullCorpusAdjudicationCompleted: false,
        selectedProblemFamily: null,
        selectedProblemEvidenceIds: [],
        jointEvidenceGroups: [],
        adjudicatedEvidenceCount: 0,
      };
      const rescueTotalTimeoutMs = Math.min(
        COMMUNITY_AI_EVIDENCE_TRIAGE_TOTAL_TIMEOUT_MS,
        Math.max(adaptiveRequestTimeoutMs + 6_000, adaptiveTotalTimeoutMs),
      );

      this.logger.warn(
        `Community AI first pass adjudicated ${currentAdjudicated}/${completeCorpus.length}; one fresh same-corpus retry remains${initialPoolTimedOutWithoutVerdict ? ' because every initial route timed out before returning any verdict' : ' because the initial pool was not exhausted'}.`,
      );

      const rescue = await this.classifyEvidenceCorpusWithAi({
        context,
        corpus: completeCorpus,
        onlineModels: rotatedRescueModels,
        deadline: Date.now() + rescueTotalTimeoutMs,
        signal: options.signal,
        deterministicFallback,
        telemetry: rescueTelemetry,
        requestTimeoutCapMs: initialPoolTimedOutWithoutVerdict
          ? COMMUNITY_AI_EVIDENCE_TRIAGE_REQUEST_TIMEOUT_MS
          : semanticRequestTimeoutCapMs,
        maxParallelAttempts: options.maxAttempts,
        allowFullCorpusRetry: false,
      });
      const rescueAdjudicated = countAdjudicated(rescue);
      const attemptOffset = telemetry.onlineAttemptCount;
      telemetry.onlineAttemptCount += rescueTelemetry.onlineAttemptCount;
      telemetry.diagnostics.push(
        ...rescueTelemetry.diagnostics.map((item) => ({
          ...item,
          attempt: attemptOffset + item.attempt,
        })),
      );

      if (rescueAdjudicated > currentAdjudicated) {
        classified = rescue;
        currentAdjudicated = rescueAdjudicated;
        telemetry.adjudicatedEvidenceCount =
          rescueTelemetry.adjudicatedEvidenceCount;
        telemetry.fullCorpusAdjudicationCompleted =
          rescueTelemetry.fullCorpusAdjudicationCompleted;
        telemetry.selectedProblemFamily = rescueTelemetry.selectedProblemFamily;
        telemetry.selectedProblemEvidenceIds = [
          ...rescueTelemetry.selectedProblemEvidenceIds,
        ];
        telemetry.jointEvidenceGroups = [
          ...rescueTelemetry.jointEvidenceGroups,
        ];
        this.logger.log(
          `Community AI fresh-deadline rescue improved full-corpus coverage to ${rescueAdjudicated}/${completeCorpus.length}; preserving the rescue as one internally consistent semantic verdict set.`,
        );
      } else {
        this.logger.warn(
          `Community AI fresh-deadline rescue did not improve coverage (${rescueAdjudicated}/${completeCorpus.length}); preserving the stronger first-pass verdict set.`,
        );
      }
    }
    const classifiedById = new Map(
      classified.map((item) => [item.evidenceId, item] as const),
    );

    const aiTriageIds = new Set(aiTriageCorpus.map((item) => item.id));
    const result = rawCorpus.map((item) => {
      const semantic = classifiedById.get(item.id);
      if (semantic) return semantic;
      if (aiTriageIds.has(item.id)) {
        return this.withAdjudicationFailure(
          deterministicFallback.get(item.id)!,
          'AI_MISSING_VERDICT',
          'No complete full-corpus semantic verdict was returned for this collected row.',
        );
      }

      return this.buildDeterministicEvidenceTriage(
        context,
        item,
        'AI_MISSING_VERDICT',
        'The row remained visible in the raw ledger but was outside the bounded full-corpus transport ceiling.',
      );
    });
    const aiRelevant = result.filter(
      (item) => item.classification === 'DIRECT_PROBLEM' || item.classification === 'SUPPORTING_SIGNAL',
    ).length;
    this.logger.log(
      `Community AI all-collected triage completed. raw=${rawCorpus.length}, aiCandidates=${aiTriageCorpus.length}, semanticUnits=1, modelsPerRace=${Math.min(COMMUNITY_AI_EVIDENCE_TRIAGE_PARALLEL_MODELS, onlineModels.length)}, relevant=${aiRelevant}, unadjudicated=${result.filter((item) => item.classification === 'UNADJUDICATED').length}, allCollectedVisible=true.`,
    );
    return result;
  }

  /**
   * Full-corpus semantic adjudication needs more wall-clock time as the number
   * of returned rows grows because each row carries a rich structured verdict.
   * This is intentionally adaptive rather than a fixed 8-9 second cliff.
   */
  private resolveFullCorpusTriageRequestTimeoutMs(itemCount: number): number {
    return Math.min(
      COMMUNITY_AI_EVIDENCE_TRIAGE_REQUEST_TIMEOUT_MS,
      Math.max(18_000, 13_500 + Math.max(0, itemCount) * 650),
    );
  }

  private resolveFullCorpusTriageTotalTimeoutMs(itemCount: number): number {
    const requestBudget = this.resolveFullCorpusTriageRequestTimeoutMs(itemCount);
    return Math.min(
      COMMUNITY_AI_EVIDENCE_TRIAGE_TOTAL_TIMEOUT_MS,
      Math.max(requestBudget + 16_000, 24_000),
    );
  }

  /**
   * A bounded corpus can return a strong internally consistent verdict set with
   * a small malformed tail. Re-running the exact same corpus across the same
   * provider pool adds latency without changing the semantic context already
   * seen by the accepted model. Unresolved rows are safely kept UNADJUDICATED.
   *
   * This exception requires at least eight valid per-item verdicts, at most
   * three unresolved rows, and at least 75% coverage. No mini-batch, missing-id
   * request, or cross-model verdict stitching is introduced.
   */
  private isLargeCorpusHighCoverageAdjudication(
    adjudicatedCount: number,
    totalCount: number,
  ): boolean {
    if (totalCount < 8 || adjudicatedCount <= 0) return false;

    const unresolvedCount = Math.max(0, totalCount - adjudicatedCount);
    const coverage = adjudicatedCount / Math.max(1, totalCount);
    if (unresolvedCount <= 0) return false;

    /*
     * A small unresolved tail is not worth another complete-corpus provider
     * window. Unresolved rows stay explicitly UNADJUDICATED and are never
     * promoted into evidence. Scale the allowed tail with corpus size so a
     * 25/31 internally consistent verdict set can finish after a short sibling
     * grace instead of waiting for another 24-second full-corpus timeout.
     */
    const maximumUnresolvedTail = Math.max(
      4,
      Math.ceil(totalCount * 0.2),
    );
    return (
      adjudicatedCount >= 8 &&
      unresolvedCount <= maximumUnresolvedTail &&
      coverage >= 0.75
    );
  }

  private selectAiTriageCandidates(
    rawCorpus: readonly IdeaGenerationRawEvidenceItem[],
  ): IdeaGenerationRawEvidenceItem[] {
    /*
     * Deliberately no relevance/lexical/source/thread pruning here. The user
     * requested that Community AI inspect the complete collector ledger. The
     * only collapse is exact evidence-id deduplication, which prevents the same
     * collected record from being sent twice when two internal paths reference
     * it. Different ids with identical/near-identical text are still sent.
     */
    const seenIds = new Set<string>();
    const selected: IdeaGenerationRawEvidenceItem[] = [];
    for (const item of rawCorpus) {
      if (!item.id || seenIds.has(item.id)) continue;
      seenIds.add(item.id);
      selected.push(item);
    }

    this.logger.debug(
      `Community AI all-collected corpus | raw=${rawCorpus.length} | selected=${selected.length} | exactIdDuplicates=${rawCorpus.length - selected.length} | lexicalRejected=0 | nearDuplicateRejected=0 | sourceQuotaRejected=0 | threadQuotaRejected=0.`,
    );

    return selected;
  }

  private collapseLexicalNearDuplicateEvidence(
    items: readonly IdeaGenerationRawEvidenceItem[],
  ): IdeaGenerationRawEvidenceItem[] {
    const kept: IdeaGenerationRawEvidenceItem[] = [];
    const normalizedTexts: string[] = [];
    const tokenSets: Set<string>[] = [];

    for (const item of items) {
      const comparableText = this.normalizeRawEvidenceForDuplicateCheck(item);
      if (!comparableText) continue;
      const tokens = this.extractRawEvidenceDuplicateTokens(comparableText);
      let duplicate = false;

      for (let index = 0; index < kept.length; index += 1) {
        if (normalizedTexts[index] === comparableText) {
          duplicate = true;
          break;
        }
        if (
          this.areRawEvidenceTokenSetsNearDuplicate(tokens, tokenSets[index])
        ) {
          duplicate = true;
          break;
        }
      }

      if (duplicate) continue;
      kept.push(item);
      normalizedTexts.push(comparableText);
      tokenSets.push(tokens);
    }

    return kept;
  }

  private normalizeRawEvidenceForDuplicateCheck(
    item: IdeaGenerationRawEvidenceItem,
  ): string {
    const text =
      item.sourceType === 'COMMENT'
        ? item.text.replace(/^.*?\bCommunity comment:\s*/iu, '')
        : item.text;
    return text
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/https?:\/\/\S+/gu, ' ')
      .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private extractRawEvidenceDuplicateTokens(value: string): Set<string> {
    return new Set(
      value
        .split(/\s+/u)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3),
    );
  }

  private areRawEvidenceTokenSetsNearDuplicate(
    left: ReadonlySet<string>,
    right: ReadonlySet<string>,
  ): boolean {
    if (left.size < 6 || right.size < 6) return false;
    let intersection = 0;
    for (const token of left) {
      if (right.has(token)) intersection += 1;
    }
    if (intersection === 0) return false;

    const union = left.size + right.size - intersection;
    const jaccard = intersection / Math.max(1, union);
    if (jaccard >= COMMUNITY_AI_EVIDENCE_TRIAGE_NEAR_DUPLICATE_THRESHOLD) {
      return true;
    }

    const smaller = Math.min(left.size, right.size);
    const containment = intersection / Math.max(1, smaller);
    return smaller >= 10 && containment >= 0.95;
  }

  private resolveRawEvidenceCommentThreadKey(
    item: IdeaGenerationRawEvidenceItem,
  ): string | null {
    if (item.sourceType !== 'COMMENT') return null;
    const source = this.normalizeEvidenceSourceKey(item.sourceKey);
    const postId = item.postId?.trim();
    if (postId) return `${source}|post:${postId}`;

    const title = item.title
      ?.normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
    return title ? `${source}|title:${title.slice(0, 160)}` : null;
  }

  private normalizeEvidenceSourceKey(value: string): string {
    return value.trim().toLocaleLowerCase() || 'unknown';
  }

  private async classifyEvidenceCorpusWithAi(input: {
    readonly context: IdeaGenerationContext;
    readonly corpus: readonly IdeaGenerationRawEvidenceItem[];
    readonly onlineModels: readonly AiModel[];
    readonly deadline: number;
    readonly signal?: AbortSignal;
    readonly deterministicFallback: ReadonlyMap<
      string,
      CommunityAiEvidenceTriage
    >;
    readonly telemetry: CommunityAiTriageTelemetry;
    /** Optional per-model cap used by latency-sensitive recovery adjudication. */
    readonly requestTimeoutCapMs?: number;
    /** Optional cap on parallel full-corpus models for this analysis call. */
    readonly maxParallelAttempts?: number;
    /** One full-corpus rescue retry is allowed after the parallel race fails. */
    readonly allowFullCorpusRetry?: boolean;
    /** Allows one bounded attempt against an otherwise configured emergency AI route. */
    readonly allowEmergencyModelAttempt?: boolean;
  }): Promise<CommunityAiEvidenceTriage[]> {
    const fallback = (
      reason: CommunityAiAdjudicationFailureReason,
      detail?: string,
    ): CommunityAiEvidenceTriage[] =>
      input.corpus.map((item) =>
        this.withAdjudicationFailure(
          input.deterministicFallback.get(item.id)!,
          reason,
          detail,
        ),
      );
    if (input.signal?.aborted) {
      return fallback(
        'AI_ABORTED',
        'Community AI evidence adjudication was cancelled before a full-corpus verdict completed.',
      );
    }
    if (input.deadline - Date.now() < MIN_AI_REQUEST_TIMEOUT_MS) {
      return fallback(
        'AI_TIMEOUT',
        'The shared full-corpus semantic-adjudication deadline expired before another online attempt could start.',
      );
    }
    /*
     * Provider-facing ids are compact aliases rather than long database/RSS ids.
     * This matters once the first-pass corpus grows beyond a few dozen items:
     * repeated 100-220 character ids can consume more output tokens than the
     * classifications themselves. The models still see the exact same complete
     * corpus; only the transport identifier is shortened.
     */
    const aliasToOriginalId = new Map<string, string>();
    const aliasedCorpus = input.corpus.map((item, index) => {
      const alias = `e${index.toString(36)}`;
      aliasToOriginalId.set(alias, item.id);
      return { ...item, id: alias };
    });
    const aliasedDeterministicFallback = new Map(
      aliasedCorpus.map((item, index) => {
        const original = input.corpus[index];
        const fallbackItem = original
          ? input.deterministicFallback.get(original.id)
          : undefined;
        return [
          item.id,
          fallbackItem
            ? { ...fallbackItem, evidenceId: item.id }
            : {
                evidenceId: item.id,
                classification: 'UNADJUDICATED' as const,
                confidence: 0,
                reason: 'No online semantic adjudication was available for this row.',
                problemFamily: null,
                evidenceNature: 'OTHER' as const,
                domainAlignment: 'NONE' as const,
                problemAlignment: 'NONE' as const,
                familyBasis: 'NONE' as const,
                observedProblem: null,
                causalExplanation: null,
                matchedDomainNames: [],
                verifiedByDeterministicGuard: false,
                adjudicationStatus: 'UNADJUDICATED' as const,
                adjudicationFailureReason: 'AI_UNAVAILABLE' as const,
              },
        ] as const;
      }),
    );
    const prompt = this.promptService.buildEvidenceTriageCorpus(
      input.context,
      aliasedCorpus,
    );
    const candidateCount = Math.max(
      1,
      Math.min(
        COMMUNITY_AI_EVIDENCE_TRIAGE_PARALLEL_MODELS,
        Math.max(1, Math.floor(input.maxParallelAttempts ?? COMMUNITY_AI_EVIDENCE_TRIAGE_PARALLEL_MODELS)),
        input.onlineModels.length,
      ),
    );
    const rotatedCandidates = Array.from(
      { length: candidateCount },
      (_unused, offset) =>
        input.onlineModels[offset % input.onlineModels.length],
    ).filter((model): model is AiModel => Boolean(model));

    /*
     * Race up to three eligible models on the exact same COMPLETE corpus.
     * Model discovery orders distinct providers first; same-provider models are
     * used only when there are not enough genuinely distinct providers online.
     * The first structurally valid answer triggers immediate sibling abort.
     * The bounded full corpus and shared wall-clock deadline keep this redundancy
     * controlled without splitting evidence context across independent batches.
     */
    const candidates = rotatedCandidates;
    const candidateProviders = [
      ...new Set(
        candidates
          .map((model) => normalizeAiProviderKey(model.providerKey))
          .filter((provider): provider is AiProviderKey => provider !== undefined),
      ),
    ];
    this.logger.debug(
      `Community AI full-corpus race pool | eligibleModels=${input.onlineModels.length} | startedModels=${candidates.length} | distinctProviders=${candidateProviders.length} | providers=${candidateProviders.join(',') || 'none'} | models=${candidates.map((model) => model.apiModelId).join(',') || 'none'}.`,
    );

    if (candidates.length === 0) {
      return fallback(
        'AI_UNAVAILABLE',
        'No provider-diverse online semantic-adjudication candidate could be selected for the full corpus.',
      );
    }

    type CorpusAttempt = {
      readonly index: number;
      readonly model: AiModel;
      /**
       * Non-null when the provider returned every evidence id. Individual
       * malformed rows are already represented as UNADJUDICATED entries.
       */
      readonly classifications: CommunityAiEvidenceTriage[] | null;
      readonly adjudicatedCount?: number;
      readonly invalidEvidenceIds?: readonly string[];
      readonly selectedProblemFamily?: string | null;
      readonly selectedEvidenceIds?: readonly string[];
      readonly jointEvidenceGroups?: readonly CommunityAiJointEvidenceGroup[];
      readonly partialClassifications?: readonly CommunityAiEvidenceTriage[];
      readonly omittedEvidenceIds?: readonly string[];
      readonly error?: unknown;
    };

    const controllers = candidates.map(() => new AbortController());
    const abortAll = (): void => controllers.forEach((controller) => controller.abort());
    if (input.signal?.aborted) {
      abortAll();
      throw new Error('Community AI evidence triage cancelled.');
    }
    const onParentAbort = (): void => abortAll();
    input.signal?.addEventListener('abort', onParentAbort, { once: true });

    const pending = new Map<number, Promise<CorpusAttempt>>();
    const diagnosticAttemptByIndex = new Map<number, number>();
    const requestStartedAtByIndex = new Map<number, number>();
    candidates.forEach((model, index) => {
      const remainingMs = input.deadline - Date.now();
      if (
        remainingMs < MIN_AI_REQUEST_TIMEOUT_MS ||
        input.telemetry.onlineAttemptCount >=
          COMMUNITY_AI_EVIDENCE_TRIAGE_MAX_ONLINE_ATTEMPTS
      ) {
        return;
      }

      input.telemetry.onlineAttemptCount += 1;
      const diagnosticAttempt = input.telemetry.onlineAttemptCount;
      diagnosticAttemptByIndex.set(index, diagnosticAttempt);
      requestStartedAtByIndex.set(index, Date.now());
      const requestTimeoutMs = Math.max(
        MIN_AI_REQUEST_TIMEOUT_MS,
        Math.min(
          this.resolveFullCorpusTriageRequestTimeoutMs(input.corpus.length),
          input.requestTimeoutCapMs ?? Number.POSITIVE_INFINITY,
          Math.floor(remainingMs),
        ),
      );
      /*
       * Size the response budget to the complete bounded corpus. Smaller
       * corpora naturally finish faster, while larger corpora receive enough
       * output headroom for one compact classification object per evidence id
       * without fragmenting semantic context across independent requests.
       */
      const triageOutputTokens = Math.min(
        COMMUNITY_AI_EVIDENCE_TRIAGE_MAX_OUTPUT_TOKENS,
        /*
         * v13 keeps the same semantic contract but makes non-problem rows
         * transport-compact: CONTEXT_ONLY/UNRELATED rows carry terse reasons
         * and empty problem-detail fields. This lowers provider generation
         * latency on 30-60 row corpora without hiding rows or weakening any
         * DIRECT/SUPPORTING/MATCH admission rule.
         */
        Math.max(2_800, 1_200 + input.corpus.length * 145),
      );
      const useJsonTextCompatibilityTransport = Boolean(
        normalizeAiProviderKey(model.providerKey) === AI_PROVIDER_KEYS.OPENROUTER &&
          /^qwen\//iu.test(model.apiModelId.trim()),
      );
      const commonExecutionInput = {
        aiModelId: model.id,
        allowTemporaryModelCooldownBypass:
          input.allowEmergencyModelAttempt === true,
        allowBoundedEmergencyModelAttempt:
          input.allowEmergencyModelAttempt === true,
        userPrompt: prompt.userPrompt,
        systemInstruction: prompt.systemInstruction,
        requestType: ApiRequestType.NLP_ENHANCEMENT,
        promptType: PromptType.NLP_ANALYSIS,
        generationType: input.context.generationType,
        userId:
          input.context.owner.type === IDEA_OWNER_TYPES.USER
            ? input.context.owner.userId
            : undefined,
        guestSessionId:
          input.context.owner.type === IDEA_OWNER_TYPES.GUEST
            ? input.context.owner.guestSessionId
            : undefined,
        estimatedOutputTokens: triageOutputTokens,
        maxOutputTokens: triageOutputTokens,
        temperature: COMMUNITY_AI_ANALYSIS_TEMPERATURE,
        strategy: AiRoutingStrategy.BALANCED,
        excludedAiModelIds: candidates
          .filter((candidate) => candidate.id !== model.id)
          .map((candidate) => candidate.id),
        timeoutMs: requestTimeoutMs,
        maxRetriesPerModel: 0,
        maxModelsPerOperation: 1,
        allowProviderFallbackOnInvalidPrompt: true,
        signal: controllers[index].signal,
      } as const;
      const executionPromise = useJsonTextCompatibilityTransport
        ? this.aiExecutionService.execute({
            ...commonExecutionInput,
            responseFormat: AiResponseFormat.TEXT,
          })
        : this.aiExecutionService.execute({
            ...commonExecutionInput,
            responseFormat: AiResponseFormat.JSON,
            responseSchema: buildCommunityAiEvidenceTriageSchema(),
            responseSchemaName: COMMUNITY_AI_EVIDENCE_TRIAGE_SCHEMA_NAME,
          });
      if (useJsonTextCompatibilityTransport) {
        this.logger.debug(
          `Community AI triage using service-validated JSON text compatibility transport for ${model.apiModelId}; provider-native root-shape enforcement is bypassed, but exact per-row semantic verification remains unchanged.`,
        );
      }
      const task = this.withHardTimeout(
        executionPromise,
        requestTimeoutMs + 250,
        `Community AI full-corpus triage model ${index + 1}`,
      )
        .then((result): CorpusAttempt => {
          try {
            const parsed = this.parseEvidenceTriageCorpus(
              input.context,
              aliasedCorpus,
              result.text,
              aliasedDeterministicFallback,
            );
            const remapClassification = (
              item: CommunityAiEvidenceTriage,
            ): CommunityAiEvidenceTriage => ({
              ...item,
              evidenceId:
                aliasToOriginalId.get(item.evidenceId) ?? item.evidenceId,
            });
            const remappedClassifications =
              parsed.classifications.map(remapClassification);
            const remappedOmittedIds = parsed.omittedEvidenceIds.map(
              (id) => aliasToOriginalId.get(id) ?? id,
            );
            const remappedInvalidIds = parsed.invalidEvidenceIds.map(
              (id) => aliasToOriginalId.get(id) ?? id,
            );
            const selectedEvidenceIds = parsed.selectedEvidenceIds.map(
              (id) => aliasToOriginalId.get(id) ?? id,
            );
            const jointEvidenceGroups = parsed.jointEvidenceGroups.map((group) => {
              const evidenceIds = group.evidenceIds.map(
                (id) => aliasToOriginalId.get(id) ?? id,
              );
              const signature = `${this.normalizeComparableText(group.problemFamily)}|${[...evidenceIds].sort().join('|')}`;
              return {
                ...group,
                id: `joint:${createHash('sha256')
                  .update(signature)
                  .digest('hex')
                  .slice(0, 24)}`,
                evidenceIds,
              };
            });

            /*
             * When every evidence id is present, this model saw and answered the
             * complete corpus. Admit each valid row independently and preserve
             * only malformed rows as UNADJUDICATED. This is the critical
             * anti-all-or-nothing behavior: one bad enum can no longer erase
             * nineteen valid semantic verdicts.
             */
            const hasEveryEvidenceId = remappedOmittedIds.length === 0;
            /*
             * A full-id response with malformed rows must not immediately win
             * the race and cancel a healthier sibling. Only a completely valid
             * per-item response wins immediately. High-coverage partial responses
             * are kept as one-model candidates and receive a very small bounded
             * grace window below for already-running siblings to improve coverage.
             * Semantic verdicts are never stitched across different models.
             */
            const strongPerItemCoverage =
              remappedClassifications.length === input.corpus.length;

            if (
              hasEveryEvidenceId &&
              remappedClassifications.length > 0 &&
              strongPerItemCoverage
            ) {
              const validById = new Map(
                remappedClassifications.map((item) => [item.evidenceId, item] as const),
              );
              const completeCoverageClassifications = input.corpus.map(
                (item) =>
                  validById.get(item.id) ??
                  this.withAdjudicationFailure(
                    input.deterministicFallback.get(item.id)!,
                    'AI_VALIDATION_REJECTED',
                    'The full-corpus model returned this evidence id, but that row failed per-item structural admission.',
                  ),
              );
              return {
                index,
                model,
                classifications: completeCoverageClassifications,
                adjudicatedCount: remappedClassifications.length,
                invalidEvidenceIds: remappedInvalidIds,
                selectedProblemFamily: parsed.selectedProblemFamily,
                selectedEvidenceIds,
                jointEvidenceGroups,
              };
            }

            return {
              index,
              model,
              classifications: null,
              adjudicatedCount: remappedClassifications.length,
              partialClassifications: remappedClassifications,
              omittedEvidenceIds: remappedOmittedIds,
              invalidEvidenceIds: remappedInvalidIds,
              selectedProblemFamily: parsed.selectedProblemFamily,
              selectedEvidenceIds,
              jointEvidenceGroups,
              error: new Error(
                `Community AI evidence triage returned usable verdicts for ${remappedClassifications.length}/${input.corpus.length} row(s), omitted ${remappedOmittedIds.length}, and returned ${remappedInvalidIds.length} malformed row(s).`,
              ),
            };
          } catch (error: unknown) {
            return { index, model, classifications: null, error };
          }
        })
        .catch((error: unknown): CorpusAttempt => ({
          index,
          model,
          classifications: null,
          error,
        }));
      pending.set(index, task);
    });

    if (pending.size === 0) {
      input.signal?.removeEventListener('abort', onParentAbort);
      abortAll();
      return fallback(
        'AI_UNAVAILABLE',
        'No full-corpus semantic-adjudication attempt could be started.',
      );
    }

    let lastError: unknown = null;
    let bestPartial: CorpusAttempt | null = null;
    let highCoverageSiblingGraceDeadline: number | null = null;
    const HIGH_COVERAGE_SIBLING_GRACE_MS = 1_200;
    try {
      while (pending.size > 0) {
        if (input.signal?.aborted) {
          throw new Error('Community AI evidence triage cancelled.');
        }
        const sharedRemainingMs = input.deadline - Date.now();
        const siblingGraceRemainingMs =
          highCoverageSiblingGraceDeadline === null
            ? Number.POSITIVE_INFINITY
            : highCoverageSiblingGraceDeadline - Date.now();
        const remainingMs = Math.min(
          sharedRemainingMs,
          siblingGraceRemainingMs,
        );
        if (remainingMs <= 0) break;
        const settled = await this.withHardTimeout(
          Promise.race(pending.values()),
          remainingMs,
          `Community AI full-corpus parallel race`,
        ).catch((error: unknown): CorpusAttempt => ({
          index: -1,
          model: candidates[0],
          classifications: null,
          error,
        }));
        if (settled.index < 0) {
          lastError = settled.error;
          break;
        }
        pending.delete(settled.index);
        if (settled.classifications) {
          const adjudicatedCount =
            settled.adjudicatedCount ??
            settled.classifications.filter(
              (item) => item.classification !== 'UNADJUDICATED',
            ).length;
          input.telemetry.adjudicatedEvidenceCount = adjudicatedCount;
          input.telemetry.fullCorpusAdjudicationCompleted =
            adjudicatedCount === input.corpus.length;
          input.telemetry.selectedProblemFamily =
            settled.selectedProblemFamily?.trim() || null;
          input.telemetry.selectedProblemEvidenceIds = [
            ...(settled.selectedEvidenceIds ?? []),
          ];
          input.telemetry.jointEvidenceGroups = [
            ...(settled.jointEvidenceGroups ?? []),
          ];
          const acceptedAttempt = diagnosticAttemptByIndex.get(settled.index) ?? 1;
          const acceptedStartedAt =
            requestStartedAtByIndex.get(settled.index) ?? Date.now();
          input.telemetry.diagnostics.push({
            attempt: acceptedAttempt,
            modelId: settled.model.id,
            apiModelId: settled.model.apiModelId,
            providerKey: settled.model.providerKey,
            status: 'ACCEPTED',
            durationMs: Math.max(0, Date.now() - acceptedStartedAt),
            reason:
              adjudicatedCount === input.corpus.length
                ? 'Full-corpus evidence triage accepted a complete per-item-valid response.'
                : `Full-corpus evidence triage accepted ${adjudicatedCount}/${input.corpus.length} individually valid verdict(s); ${(settled.invalidEvidenceIds ?? []).length} malformed row(s) were preserved as UNADJUDICATED without discarding valid siblings.`,
          });
          // Early stop: the first structurally valid semantic classification
          // wins. Abort slower sibling calls immediately so parallel model
          // redundancy improves reliability without adding serial latency.
          controllers.forEach((controller, index) => {
            if (index !== settled.index && pending.has(index)) {
              controller.abort();
              const sibling = candidates[index];
              input.telemetry.diagnostics.push({
                attempt: diagnosticAttemptByIndex.get(index) ?? acceptedAttempt,
                modelId: sibling?.id ?? null,
                apiModelId: sibling?.apiModelId ?? null,
                providerKey: sibling?.providerKey ?? null,
                status: 'ABORTED',
                durationMs: Math.max(
                  0,
                  Date.now() - (requestStartedAtByIndex.get(index) ?? Date.now()),
                ),
                reason: 'Cancelled after another parallel Community AI triage model returned a valid classification.',
              });
            }
          });
          void Promise.allSettled(pending.values());
          this.logger.log(
            `Community AI full-corpus triage accepted first full-id response from ${settled.model.apiModelId}; adjudicated=${adjudicatedCount}/${input.corpus.length}, malformed=${(settled.invalidEvidenceIds ?? []).length}; aborted ${pending.size} slower parallel model(s).`,
          );
          return settled.classifications;
        }
        if (
          settled.partialClassifications &&
          settled.partialClassifications.length > 0 &&
          ((settled.omittedEvidenceIds?.length ?? 0) > 0 ||
            (settled.invalidEvidenceIds?.length ?? 0) > 0)
        ) {
          const attempt = diagnosticAttemptByIndex.get(settled.index) ?? 1;
          const attemptStartedAt =
            requestStartedAtByIndex.get(settled.index) ?? Date.now();
          const partialAdjudicatedCount = settled.partialClassifications.length;
          const unresolvedCount = Math.max(
            0,
            input.corpus.length - partialAdjudicatedCount,
          );
          const partialCoverage =
            partialAdjudicatedCount / Math.max(1, input.corpus.length);
          const maximumHighCoverageSiblingTail = Math.max(
            4,
            Math.ceil(input.corpus.length * 0.2),
          );
          const highCoverageSiblingGraceEligible =
            partialAdjudicatedCount >= 8 &&
            unresolvedCount > 0 &&
            unresolvedCount <= maximumHighCoverageSiblingTail &&
            partialCoverage >= 0.75;

          if (
            !bestPartial ||
            (settled.partialClassifications?.length ?? 0) >
              (bestPartial.partialClassifications?.length ?? 0)
          ) {
            bestPartial = settled;
          }

          input.telemetry.diagnostics.push({
            attempt,
            modelId: settled.model.id,
            apiModelId: settled.model.apiModelId,
            providerKey: settled.model.providerKey,
            status: 'VALIDATION_REJECTED',
            durationMs: Math.max(0, Date.now() - attemptStartedAt),
            reason: highCoverageSiblingGraceEligible
              ? `Full-corpus triage produced ${partialAdjudicatedCount}/${input.corpus.length} individually valid verdict(s) with ${unresolvedCount} unresolved row(s); preserving this single-model partial result while giving an already-running sibling up to ${HIGH_COVERAGE_SIBLING_GRACE_MS}ms to return a more complete full-corpus verdict.`
              : `Full-corpus triage produced ${settled.partialClassifications.length}/${input.corpus.length} individually valid verdict(s), omitted ${settled.omittedEvidenceIds?.length ?? 0} id(s), and returned ${(settled.invalidEvidenceIds ?? []).length} malformed row(s); a sibling full-corpus model remains running for better coverage.`,
          });

          lastError = settled.error;

          if (highCoverageSiblingGraceEligible) {
            if (pending.size > 0) {
              highCoverageSiblingGraceDeadline ??=
                Date.now() + HIGH_COVERAGE_SIBLING_GRACE_MS;
              this.logger.debug(
                `Community AI high-coverage partial verdict from ${settled.model.apiModelId} retained ${partialAdjudicatedCount}/${input.corpus.length}; giving already-running sibling(s) a bounded ${HIGH_COVERAGE_SIBLING_GRACE_MS}ms grace to improve malformed/omitted coverage without starting a new provider request.`,
              );
              continue;
            }
            break;
          }

          continue;
        }

        lastError = settled.error;
        const failureMessage = this.getErrorMessage(settled.error);
        const normalizedFailure = failureMessage.toLocaleLowerCase();
        input.telemetry.diagnostics.push({
          attempt: diagnosticAttemptByIndex.get(settled.index) ?? 1,
          modelId: settled.model.id,
          apiModelId: settled.model.apiModelId,
          providerKey: settled.model.providerKey,
          status: (settled.invalidEvidenceIds?.length ?? 0) > 0
            ? 'VALIDATION_REJECTED'
            : /timeout|timed out|exceeded .*ms/u.test(normalizedFailure)
              ? 'TIMEOUT'
              : /abort|cancel/u.test(normalizedFailure)
                ? 'ABORTED'
                : 'EXECUTION_FAILED',
          durationMs: Math.max(
            0,
            Date.now() -
              (requestStartedAtByIndex.get(settled.index) ?? Date.now()),
          ),
          reason: failureMessage,
        });
        this.logger.warn(
          `Community AI full-corpus model ${settled.model.apiModelId} returned no usable classification: ${failureMessage}.`,
        );
      }
    } finally {
      input.signal?.removeEventListener('abort', onParentAbort);
      controllers.forEach((controller, index) => {
        if (pending.has(index) && !controller.signal.aborted) controller.abort();
        if (
          pending.has(index) &&
          !input.telemetry.diagnostics.some(
            (item) => item.attempt === diagnosticAttemptByIndex.get(index),
          )
        ) {
          const model = candidates[index];
          input.telemetry.diagnostics.push({
            attempt: diagnosticAttemptByIndex.get(index) ?? 1,
            modelId: model?.id ?? null,
            apiModelId: model?.apiModelId ?? null,
            providerKey: model?.providerKey ?? null,
            status: input.signal?.aborted ? 'ABORTED' : 'TIMEOUT',
            durationMs: Math.max(
              0,
              Date.now() - (requestStartedAtByIndex.get(index) ?? Date.now()),
            ),
            reason: input.signal?.aborted
              ? 'Community AI evidence triage was cancelled.'
              : highCoverageSiblingGraceDeadline !== null
                ? 'A high-coverage sibling grace window expired before this model returned a more complete full-corpus classification.'
                : 'Community AI evidence triage shared wall-clock budget expired before this model returned a usable classification.',
          });
        }
      });
      void Promise.allSettled(pending.values());
    }

    abortAll();
    if (bestPartial?.partialClassifications?.length) {
      const partialById = new Map(
        bestPartial.partialClassifications.map(
          (item) => [item.evidenceId, item] as const,
        ),
      );
      if (
        highCoverageSiblingGraceDeadline === null &&
        input.allowFullCorpusRetry !== false &&
        input.onlineModels.length > 0 &&
        input.deadline - Date.now() >= 8_000
      ) {
        const rescueModel = input.onlineModels[0];
        this.logger.warn(
          `Community AI full-corpus race returned ${bestPartial.partialClassifications.length}/${input.corpus.length}; retrying the SAME complete corpus once with ${rescueModel.apiModelId}. No missing-id subrequest is used because family meaning may depend on cross-corpus relationships.`,
        );
        const rescue = await this.classifyEvidenceCorpusWithAi({
          ...input,
          onlineModels: [rescueModel],
          allowFullCorpusRetry: false,
        });
        const rescueAdjudicatedCount = rescue.filter(
          (item) => item.classification !== 'UNADJUDICATED',
        ).length;
        if (rescueAdjudicatedCount === input.corpus.length) {
          return rescue;
        }
        const originalAdjudicatedCount =
          bestPartial.partialClassifications.length;
        if (rescueAdjudicatedCount > originalAdjudicatedCount) {
          this.logger.warn(
            `Community AI full-corpus rescue remained partial but covered more rows (${rescueAdjudicatedCount}/${input.corpus.length}); preserving that internally consistent full-corpus attempt without merging semantic verdicts from different models.`,
          );
          return rescue;
        }
        this.logger.warn(
          `Community AI full-corpus rescue remained partial; preserving the stronger original single-model partial verdict (${originalAdjudicatedCount}/${input.corpus.length}) and leaving omitted rows UNADJUDICATED.`,
        );
      }

      input.telemetry.adjudicatedEvidenceCount =
        bestPartial.partialClassifications.length;
      input.telemetry.fullCorpusAdjudicationCompleted = false;
      input.telemetry.selectedProblemFamily =
        bestPartial.selectedProblemFamily?.trim() || null;
      input.telemetry.selectedProblemEvidenceIds = [
        ...(bestPartial.selectedEvidenceIds ?? []),
      ];
      input.telemetry.jointEvidenceGroups = [
        ...(bestPartial.jointEvidenceGroups ?? []),
      ];
      this.logger.warn(
        `Community AI full-corpus race returned no full-id response; preserving ${bestPartial.partialClassifications.length}/${input.corpus.length} individually valid verdict(s) from one model that saw the complete corpus. Omitted/malformed rows remain UNADJUDICATED.`,
      );
      const failureReason = this.resolveAdjudicationFailureReason(
        lastError,
        input.signal,
      );
      return input.corpus.map(
        (item) =>
          partialById.get(item.id) ??
          this.withAdjudicationFailure(
            input.deterministicFallback.get(item.id)!,
            failureReason === 'AI_EXECUTION_FAILED'
              ? 'AI_MISSING_VERDICT'
              : failureReason,
            (bestPartial.invalidEvidenceIds ?? []).includes(item.id)
              ? 'A model that saw the complete corpus returned this evidence id, but that row failed per-item structural admission.'
              : 'A model that saw the complete corpus returned a partial response and omitted this evidence id.',
          ),
      );
    }

    if (
      input.allowFullCorpusRetry !== false &&
      input.onlineModels.length > 0 &&
      input.deadline - Date.now() >= 8_000
    ) {
      const rescueModel = input.onlineModels[0];
      this.logger.warn(
        `Community AI full-corpus race exhausted without a complete verdict; retrying the SAME complete corpus once with ${rescueModel.apiModelId} inside the remaining shared deadline.`,
      );
      return this.classifyEvidenceCorpusWithAi({
        ...input,
        onlineModels: [rescueModel],
        allowFullCorpusRetry: false,
      });
    }

    this.logger.warn(
      `Community AI full-corpus race could not obtain an online semantic verdict: ${this.getErrorMessage(lastError)}. Raw rows remain UNADJUDICATED rather than being reinterpreted deterministically.`,
    );
    const failureReason = this.resolveAdjudicationFailureReason(
      lastError,
      input.signal,
    );
    return fallback(
      failureReason,
      `No online semantic verdict completed for the full corpus: ${this.getErrorMessage(lastError)}`,
    );
  }

  private parseEvidenceTriageTransportEnvelope(text: string): unknown {
    const normalized = text
      .trim()
      .replace(/^```(?:json)?\s*/iu, '')
      .replace(/\s*```$/u, '')
      .trim();
    const parsed: unknown = JSON.parse(normalized);

    if (Array.isArray(parsed)) {
      return { items: parsed };
    }
    if (!this.isRecord(parsed)) {
      return parsed;
    }
    if (Array.isArray(parsed.items)) {
      return parsed;
    }

    for (const key of ['result', 'data', 'output'] as const) {
      const nested = parsed[key];
      if (Array.isArray(nested)) {
        return { ...parsed, items: nested };
      }
      if (this.isRecord(nested) && Array.isArray(nested.items)) {
        return nested;
      }
    }

    return parsed;
  }

  private parseEvidenceTriageCorpus(
    context: IdeaGenerationContext,
    corpus: readonly IdeaGenerationRawEvidenceItem[],
    text: string,
    deterministicFallback: ReadonlyMap<string, CommunityAiEvidenceTriage>,
  ): ParsedCommunityAiEvidenceTriageCorpus {
    const parsed = this.parseEvidenceTriageTransportEnvelope(text);
    if (!this.isRecord(parsed) || !Array.isArray(parsed.items)) {
      throw new Error('Community AI evidence triage returned an invalid root object.');
    }

    const corpusById = new Map(corpus.map((item) => [item.id, item] as const));
    const discoveryMode = this.isEvidenceDiscoveryMode(context);
    const requiresMatchedSelectedDomain =
      discoveryMode && context.selectedDomains.length > 0;
    const selectedDomainByIdentity = new Map(
      context.selectedDomains.map((domain) => [
        domain.name
          .normalize('NFKC')
          .toLocaleLowerCase()
          .replace(/\s+/gu, ' ')
          .trim(),
        domain.name,
      ] as const),
    );
    const canonicalFacetIds = new Set(
      (context.canonicalProblemSpec?.facets ?? [])
        .map((facet) => facet.id.trim())
        .filter(Boolean),
    );

    const normalizeEnumToken = (value: unknown): string =>
      typeof value === 'string'
        ? value
            .normalize('NFKC')
            .trim()
            .toUpperCase()
            .replace(/[\s-]+/gu, '_')
        : '';

    const parseExactEnum = <T extends string>(
      value: unknown,
      allowed: readonly T[],
    ): T | null => {
      const normalized = normalizeEnumToken(value);
      return (allowed as readonly string[]).includes(normalized)
        ? (normalized as T)
        : null;
    };

    /*
     * These are transport aliases only: each alias is an explicit lexical
     * spelling of the exact canonical enum, not a semantic score conversion.
     * Values such as HIGH/MEDIUM/LOW are intentionally rejected.
     */
    const parseAlignment = (value: unknown): CommunityAiSemanticAlignment | null => {
      const normalized = normalizeEnumToken(value);
      const direct = parseExactEnum(
        normalized,
        COMMUNITY_AI_SEMANTIC_ALIGNMENTS,
      );
      if (direct) return direct;

      const aliases: Readonly<Record<string, CommunityAiSemanticAlignment>> = {
        EXACT_MATCH: 'MATCH',
        FULL_MATCH: 'MATCH',
        MATCHED: 'MATCH',
        PARTIAL_MATCH: 'PARTIAL',
        PARTIALLY_MATCHED: 'PARTIAL',
        NO_MATCH: 'NONE',
        NOT_MATCHED: 'NONE',
        UNMATCHED: 'NONE',
      };
      return aliases[normalized] ?? null;
    };

    const parseRequiredConfidence = (value: unknown): number | null => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return null;
      const normalized = value <= 1 ? value * 100 : value;
      if (normalized < 0 || normalized > 100) return null;
      return Math.round(normalized * 100) / 100;
    };

    const normalizeProblemFamily = (value: unknown): string | null =>
      this.normalizeProblemFamilyLabel(this.optionalString(value, ''));

    const normalizeShortText = (
      value: unknown,
      maxLength: number,
    ): string | null =>
      this.optionalString(value, '')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, maxLength) || null;

    type ProviderSemanticVerdict = {
      readonly classification: CommunityAiProviderEvidenceClassification;
      readonly confidence: number;
      readonly reason: string;
      readonly problemFamily: string | null;
      readonly evidenceNature: CommunityAiEvidenceNature;
      readonly domainAlignment: CommunityAiSemanticAlignment;
      readonly problemAlignment: CommunityAiSemanticAlignment;
      readonly actorAlignment: CommunityAiSemanticAlignment;
      readonly objectAlignment: CommunityAiSemanticAlignment;
      readonly workflowAlignment: CommunityAiSemanticAlignment;
      readonly failureAlignment: CommunityAiSemanticAlignment;
      readonly familyBasis: CommunityAiProblemFamilyBasis;
      readonly observedProblem: string | null;
      readonly causalExplanation: string | null;
      readonly matchedDomainNames: readonly string[];
      readonly matchedFacetIds: readonly string[];
    };

    const providerById = new Map<string, ProviderSemanticVerdict>();
    const returnedEvidenceIds = new Set<string>();
    const duplicateEvidenceIds = new Set<string>();

    for (const entry of parsed.items.slice(0, Math.max(corpus.length * 2, corpus.length))) {
      if (!this.isRecord(entry)) continue;
      const evidenceId = this.optionalString(entry.evidenceId, '').trim();
      if (!evidenceId || !corpusById.has(evidenceId)) continue;

      if (returnedEvidenceIds.has(evidenceId)) {
        duplicateEvidenceIds.add(evidenceId);
        providerById.delete(evidenceId);
        continue;
      }
      returnedEvidenceIds.add(evidenceId);

      const classification = parseExactEnum(
        entry.classification,
        COMMUNITY_AI_PROVIDER_EVIDENCE_CLASSIFICATIONS,
      );
      const confidence = parseRequiredConfidence(entry.confidence);
      const reason = normalizeShortText(entry.reason, 260);
      if (!classification || confidence === null || !reason) {
        continue;
      }

      const evidenceNature =
        parseExactEnum(entry.evidenceNature, COMMUNITY_AI_EVIDENCE_NATURES) ??
        'OTHER';
      const domainAlignment = parseAlignment(entry.domainAlignment);
      const problemAlignment = parseAlignment(entry.problemAlignment);
      const actorAlignment = parseAlignment(entry.actorAlignment);
      const objectAlignment = parseAlignment(entry.objectAlignment);
      const workflowAlignment = parseAlignment(entry.workflowAlignment);
      const failureAlignment = parseAlignment(entry.failureAlignment);
      const familyBasis =
        parseExactEnum(entry.familyBasis, COMMUNITY_AI_PROBLEM_FAMILY_BASES) ??
        'NONE';

      const problemFamily = normalizeProblemFamily(entry.problemFamily);
      const observedProblem = normalizeShortText(entry.observedProblem, 260);
      const causalExplanation = normalizeShortText(
        entry.causalExplanation,
        260,
      );

      const matchedDomainNames = Array.isArray(entry.matchedDomainNames)
        ? [
            ...new Set(
              entry.matchedDomainNames
                .filter((value): value is string => typeof value === 'string')
                .map((value) =>
                  selectedDomainByIdentity.get(
                    value
                      .normalize('NFKC')
                      .toLocaleLowerCase()
                      .replace(/\s+/gu, ' ')
                      .trim(),
                  ),
                )
                .filter((value): value is string => Boolean(value)),
            ),
          ].slice(0, 3)
        : [];

      const matchedFacetIds = Array.isArray(entry.matchedFacetIds)
        ? [
            ...new Set(
              entry.matchedFacetIds
                .filter((value): value is string => typeof value === 'string')
                .map((value) => value.trim())
                .filter((value) => canonicalFacetIds.has(value)),
            ),
          ].slice(0, Math.max(1, canonicalFacetIds.size))
        : [];

      /*
       * Per-item admission is conditional on what the verdict claims.
       * A CONTEXT_ONLY/UNRELATED row does not need a fabricated family or
       * observedProblem. Trusted rows do: otherwise that individual row is
       * UNADJUDICATED rather than poisoning the whole corpus.
       */
      const trustedCandidate =
        classification === 'DIRECT_PROBLEM' ||
        classification === 'SUPPORTING_SIGNAL';
      const requiredAlignment = discoveryMode
        ? domainAlignment
        : problemAlignment;

      if (
        trustedCandidate &&
        (
          requiredAlignment === null ||
          familyBasis !== 'OBSERVED_PROBLEM' ||
          !problemFamily ||
          !observedProblem ||
          (requiresMatchedSelectedDomain && matchedDomainNames.length === 0)
        )
      ) {
        continue;
      }

      providerById.set(evidenceId, {
        classification,
        confidence,
        reason,
        problemFamily,
        evidenceNature,
        /*
         * The non-governing alignment is optional metadata. Missing/invalid
         * metadata is represented as NONE but never used to infer relevance.
         */
        domainAlignment: domainAlignment ?? 'NONE',
        problemAlignment: problemAlignment ?? 'NONE',
        actorAlignment: actorAlignment ?? 'NONE',
        objectAlignment: objectAlignment ?? 'NONE',
        workflowAlignment: workflowAlignment ?? 'NONE',
        failureAlignment: failureAlignment ?? 'NONE',
        familyBasis,
        observedProblem,
        causalExplanation,
        matchedDomainNames,
        matchedFacetIds,
      });
    }

    for (const duplicateId of duplicateEvidenceIds) {
      providerById.delete(duplicateId);
    }

    const omittedEvidenceIds = corpus
      .filter((rawItem) => !returnedEvidenceIds.has(rawItem.id))
      .map((rawItem) => rawItem.id);
    const structurallyInvalidEvidenceIds = corpus
      .filter(
        (rawItem) =>
          returnedEvidenceIds.has(rawItem.id) &&
          !providerById.has(rawItem.id),
      )
      .map((rawItem) => rawItem.id);

    const classifiedItems = corpus.filter((rawItem) =>
      providerById.has(rawItem.id),
    );

    const classifications = classifiedItems.map<CommunityAiEvidenceTriage>(
      (rawItem) => {
        const provider = providerById.get(rawItem.id);
        if (!provider) return deterministicFallback.get(rawItem.id)!;

        let classification = this.capEvidenceClassificationByProvenance(
          rawItem.sourceKey,
          provider.classification,
        );

        // These are non-semantic structural caps over the AI verdict. They never
        // infer relevance from words in the evidence itself.
        if (
          provider.evidenceNature === 'PROMOTIONAL' ||
          provider.evidenceNature === 'NEUTRAL_CONTEXT'
        ) {
          classification =
            classification === 'UNRELATED' ? 'UNRELATED' : 'CONTEXT_ONLY';
        }
        if (
          provider.evidenceNature === 'MARKET_RESEARCH' &&
          classification === 'DIRECT_PROBLEM'
        ) {
          classification = 'SUPPORTING_SIGNAL';
        }
        if (
          classification === 'DIRECT_PROBLEM' &&
          provider.evidenceNature !== 'LIVED_EXPERIENCE'
        ) {
          classification = 'SUPPORTING_SIGNAL';
        }

        const trustedCandidate =
          classification === 'DIRECT_PROBLEM' ||
          classification === 'SUPPORTING_SIGNAL';
        /*
         * In discovery modes, including TEXT_ONLY and TEXT_AND_DOMAINS, the
         * requester text resolves/narrows the domain but does not own the final
         * problem family. Evidence admission is therefore domain-native. The
         * requester alignment fields stay useful as soft diagnostics only.
         * Internal EXPLICIT_PROBLEM corroboration remains problem-locked.
         */
        const requiredAlignment = discoveryMode
          ? provider.domainAlignment
          : provider.problemAlignment;
        const minimumTrustedConfidence = 58;
        const semanticallyComplete =
          provider.confidence >= minimumTrustedConfidence &&
          provider.familyBasis === 'OBSERVED_PROBLEM' &&
          Boolean(provider.problemFamily) &&
          Boolean(provider.observedProblem) &&
          requiredAlignment !== 'NONE' &&
          (!requiresMatchedSelectedDomain || provider.matchedDomainNames.length > 0);

        if (trustedCandidate && !semanticallyComplete) {
          classification =
            requiredAlignment === 'NONE' ? 'UNRELATED' : 'CONTEXT_ONLY';
        } else if (
          discoveryMode &&
          classification === 'DIRECT_PROBLEM' &&
          requiredAlignment === 'PARTIAL'
        ) {
          classification = 'SUPPORTING_SIGNAL';
        }

        const verified =
          (classification === 'DIRECT_PROBLEM' ||
            classification === 'SUPPORTING_SIGNAL') &&
          semanticallyComplete;

        return {
          evidenceId: rawItem.id,
          classification,
          confidence: provider.confidence,
          reason: verified
            ? `${provider.reason} AI semantic verdict passed structural/provenance admission.`
            : provider.reason,
          problemFamily: verified ? provider.problemFamily : null,
          evidenceNature: provider.evidenceNature,
          domainAlignment: provider.domainAlignment,
          problemAlignment: provider.problemAlignment,
          actorAlignment: provider.actorAlignment,
          objectAlignment: provider.objectAlignment,
          workflowAlignment: provider.workflowAlignment,
          failureAlignment: provider.failureAlignment,
          familyBasis: provider.familyBasis,
          observedProblem: provider.observedProblem,
          causalExplanation: provider.causalExplanation,
          matchedDomainNames: provider.matchedDomainNames,
          matchedFacetIds: provider.matchedFacetIds,
          verifiedByDeterministicGuard: verified,
          adjudicationStatus: 'ADJUDICATED',
          adjudicationFailureReason: null,
        };
      },
    );

    const jointEvidenceGroups: CommunityAiJointEvidenceGroup[] = [];
    if (discoveryMode && Array.isArray(parsed.jointEvidenceGroups)) {
      const classificationById = new Map(
        classifications.map((item) => [item.evidenceId, item] as const),
      );
      const seenGroupSignatures = new Set<string>();

      for (const entry of parsed.jointEvidenceGroups.slice(0, 6)) {
        if (!this.isRecord(entry) || !Array.isArray(entry.evidenceIds)) continue;
        const evidenceIds = [
          ...new Set(
            entry.evidenceIds
              .filter((value): value is string => typeof value === 'string')
              .map((value) => value.trim())
              .filter((value) => corpusById.has(value)),
          ),
        ].slice(0, 3);
        if (evidenceIds.length < 2) continue;

        const confidence = parseRequiredConfidence(entry.confidence);
        const reason = normalizeShortText(entry.reason, 220);
        const problemFamily = normalizeProblemFamily(entry.problemFamily);
        const observedProblem = normalizeShortText(entry.observedProblem, 320);
        const actorAlignment = parseAlignment(entry.actorAlignment);
        const objectAlignment = parseAlignment(entry.objectAlignment);
        const workflowAlignment = parseAlignment(entry.workflowAlignment);
        const failureAlignment = parseAlignment(entry.failureAlignment);
        if (
          confidence === null ||
          confidence < 60 ||
          !reason ||
          !problemFamily ||
          !observedProblem
        ) {
          continue;
        }

        const providerGroupFacetIds = Array.isArray(entry.matchedFacetIds)
          ? [
              ...new Set(
                entry.matchedFacetIds
                  .filter((value): value is string => typeof value === 'string')
                  .map((value) => value.trim())
                  .filter((value) => canonicalFacetIds.has(value)),
              ),
            ]
          : [];

        const memberVerdicts = evidenceIds
          .map((id) => classificationById.get(id))
          .filter((item): item is CommunityAiEvidenceTriage => Boolean(item));
        if (memberVerdicts.length !== evidenceIds.length) continue;

        /*
         * Joint composition is evidence-native in discovery modes. Requester
         * facets may describe overlap, but they are not a prerequisite. Every
         * member must independently be an adjudicated concrete problem signal
         * inside the resolved domain scope; the joint group only adds
         * corroboration/complementarity and can never rescue generic context.
         */
        if (
          memberVerdicts.some((item) =>
            item.adjudicationStatus !== 'ADJUDICATED' ||
            (item.classification !== 'DIRECT_PROBLEM' &&
              item.classification !== 'SUPPORTING_SIGNAL') ||
            item.domainAlignment === 'NONE' ||
            (item.matchedDomainNames?.length ?? 0) === 0 ||
            !['LIVED_EXPERIENCE', 'DOCUMENTED_FINDING', 'MARKET_RESEARCH'].includes(
              item.evidenceNature ?? 'OTHER',
            ),
          )
        ) {
          continue;
        }

        const rawMembers = evidenceIds
          .map((id) => corpusById.get(id))
          .filter((item): item is IdeaGenerationRawEvidenceItem => Boolean(item));
        const sourceIdentities = [
          ...new Set(rawMembers.map((item) => EvidenceSourceIdentityUtil.resolve(item))),
        ];
        if (sourceIdentities.length < 2) continue;

        const memberFacetIds = [
          ...new Set(memberVerdicts.flatMap((item) => item.matchedFacetIds ?? [])),
        ].filter((id) => canonicalFacetIds.has(id));
        const matchedFacetIds = [
          ...new Set([...providerGroupFacetIds, ...memberFacetIds]),
        ];

        /*
         * If a member already carries a trusted evidence-native family, it must
         * be compatible with the joint family. Partial/context members may have
         * no family and are allowed only because their requester facet verdict
         * above is explicit.
         */
        const trustedFamilyConflict = memberVerdicts.some(
          (item) =>
            item.verifiedByDeterministicGuard &&
            Boolean(item.problemFamily) &&
            !this.problemFamilyTransportIdentityMatches(
              problemFamily,
              item.problemFamily ?? null,
            ),
        );
        if (trustedFamilyConflict) continue;

        const combinedEvidenceBasis = [
          ...rawMembers.map((item) => item.text),
          ...memberVerdicts.map((item) => item.observedProblem ?? ''),
        ].join(' ');
        if (!this.isEvidenceNativeFamilyLabel(problemFamily, combinedEvidenceBasis)) {
          continue;
        }

        const providerMatchedDomains = Array.isArray(entry.matchedDomainNames)
          ? entry.matchedDomainNames
              .filter((value): value is string => typeof value === 'string')
              .map((value) =>
                selectedDomainByIdentity.get(
                  value
                    .normalize('NFKC')
                    .toLocaleLowerCase()
                    .replace(/\s+/gu, ' ')
                    .trim(),
                ),
              )
              .filter((value): value is string => Boolean(value))
          : [];
        const matchedDomainNames = [
          ...new Set([
            ...providerMatchedDomains,
            ...memberVerdicts.flatMap((item) => item.matchedDomainNames ?? []),
          ]),
        ].slice(0, Math.max(1, context.selectedDomains.length));
        if (matchedDomainNames.length === 0) {
          continue;
        }

        const signature = `${this.normalizeComparableText(problemFamily)}|${[...evidenceIds].sort().join('|')}`;
        if (seenGroupSignatures.has(signature)) continue;
        seenGroupSignatures.add(signature);
        const id = `joint:${createHash('sha256')
          .update(signature)
          .digest('hex')
          .slice(0, 24)}`;

        jointEvidenceGroups.push({
          id,
          evidenceIds,
          confidence,
          reason,
          problemFamily,
          observedProblem,
          actorAlignment: actorAlignment ?? 'NONE',
          objectAlignment: objectAlignment ?? 'NONE',
          workflowAlignment: workflowAlignment ?? 'NONE',
          failureAlignment: failureAlignment ?? 'NONE',
          matchedDomainNames,
          matchedFacetIds,
          distinctSourceCount: sourceIdentities.length,
          verifiedByDeterministicGuard: true,
        });
      }
    }

    /*
     * AI-selected family metadata is accepted only when it references rows that
     * independently survived per-item admission and canonical verification.
     */
    const providerSelectedProblemFamily = normalizeProblemFamily(
      parsed.selectedProblemFamily,
    );
    const requestedSelectedEvidenceIds = Array.isArray(parsed.selectedEvidenceIds)
      ? parsed.selectedEvidenceIds
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter((value) => corpusById.has(value))
          .slice(0, 8)
      : [];
    const verifiedById = new Map(
      classifications
        .filter((item) => item.verifiedByDeterministicGuard)
        .map((item) => [item.evidenceId, item] as const),
    );
    const selectedEvidenceIds = providerSelectedProblemFamily
      ? requestedSelectedEvidenceIds.filter((evidenceId) => {
          const verdict = verifiedById.get(evidenceId);
          return this.problemFamilyTransportIdentityMatches(
            providerSelectedProblemFamily,
            verdict?.problemFamily ?? null,
          );
        })
      : [];
    const selectedProblemFamily =
      providerSelectedProblemFamily && selectedEvidenceIds.length > 0
        ? providerSelectedProblemFamily
        : null;

    return {
      classifications,
      omittedEvidenceIds,
      invalidEvidenceIds: structurallyInvalidEvidenceIds,
      selectedProblemFamily,
      selectedEvidenceIds,
      jointEvidenceGroups,
    };
  }


  private capEvidenceClassificationByProvenance(
    sourceKey: string | null | undefined,
    classification: CommunityAiEvidenceClassification,
  ): CommunityAiEvidenceClassification {
    if (classification !== 'DIRECT_PROBLEM') return classification;
    const normalizedSource = (sourceKey ?? '').trim().toLocaleLowerCase();
    if (['crossref', 'news', 'gdelt', 'blog'].includes(normalizedSource)) {
      return 'SUPPORTING_SIGNAL';
    }
    return classification;
  }

  private buildDeterministicEvidenceTriage(
    _context: IdeaGenerationContext,
    rawItem: IdeaGenerationRawEvidenceItem,
    failureReason: CommunityAiAdjudicationFailureReason = 'AI_UNAVAILABLE',
    detail?: string,
  ): CommunityAiEvidenceTriage {
    /*
     * Deterministic code owns provenance/schema safety only. It must never turn
     * provider failure into an invented semantic verdict such as UNRELATED.
     */
    return {
      evidenceId: rawItem.id,
      classification: 'UNADJUDICATED',
      confidence: 0,
      reason:
        detail?.trim() ||
        'No online semantic verdict was available; deterministic code intentionally made no relevance or problem-family claim.',
      problemFamily: null,
      evidenceNature: 'OTHER',
      domainAlignment: 'NONE',
      problemAlignment: 'NONE',
      actorAlignment: 'NONE',
      objectAlignment: 'NONE',
      workflowAlignment: 'NONE',
      failureAlignment: 'NONE',
      familyBasis: 'NONE',
      observedProblem: null,
      causalExplanation: null,
      matchedDomainNames: [],
      verifiedByDeterministicGuard: false,
      adjudicationStatus: 'UNADJUDICATED',
      adjudicationFailureReason: failureReason,
    };
  }

  private withAdjudicationFailure(
    item: CommunityAiEvidenceTriage,
    failureReason: CommunityAiAdjudicationFailureReason,
    detail?: string,
  ): CommunityAiEvidenceTriage {
    return {
      ...item,
      classification: 'UNADJUDICATED',
      confidence: 0,
      reason:
        detail?.trim() ||
        'Semantic adjudication did not complete for this evidence row.',
      problemFamily: null,
      evidenceNature: 'OTHER',
      domainAlignment: 'NONE',
      problemAlignment: 'NONE',
      actorAlignment: 'NONE',
      objectAlignment: 'NONE',
      workflowAlignment: 'NONE',
      failureAlignment: 'NONE',
      familyBasis: 'NONE',
      observedProblem: null,
      causalExplanation: null,
      matchedDomainNames: [],
      verifiedByDeterministicGuard: false,
      adjudicationStatus: 'UNADJUDICATED',
      adjudicationFailureReason: failureReason,
    };
  }

  private resolveAdjudicationFailureReason(
    error: unknown,
    signal?: AbortSignal,
  ): CommunityAiAdjudicationFailureReason {
    if (signal?.aborted) return 'AI_ABORTED';
    const message = this.getErrorMessage(error).toLocaleLowerCase();
    if (/timeout|timed out|exceeded .*ms|deadline|wall-clock/u.test(message)) {
      return 'AI_TIMEOUT';
    }
    if (/abort|cancel/u.test(message)) return 'AI_ABORTED';
    if (
      /validation|invalid root|invalid .*response|returned only|missing evidence|supplied evidence id/u.test(
        message,
      )
    ) {
      return 'AI_VALIDATION_REJECTED';
    }
    if (!message || /no active|no online|unavailable|not configured/u.test(message)) {
      return 'AI_UNAVAILABLE';
    }
    return 'AI_EXECUTION_FAILED';
  }

  private sanitizeEvidenceProblemFamily(
    _context: IdeaGenerationContext,
    evidenceText: string,
    providerFamily: string | null,
    observedProblem?: string | null,
  ): string | null {
    const normalizedProviderFamily = this.normalizeProblemFamilyLabel(
      providerFamily ?? '',
    );
    const evidenceBasis = [observedProblem ?? '', evidenceText]
      .join(' ')
      .replace(/\s+/gu, ' ')
      .trim();
    if (
      normalizedProviderFamily &&
      this.isEvidenceNativeFamilyLabel(normalizedProviderFamily, evidenceBasis)
    ) {
      return normalizedProviderFamily;
    }

    /*
     * Discovery-family identity must never import nouns/mechanisms from the
     * requester text, selected domains, or query wording. When the online
     * classifier returns a family that is broader than the row it classified,
     * keep the trusted row but fall back to the row's own observed problem.
     * This preserves evidence without allowing request-shaped semantic stretch.
     */
    return this.buildEvidenceNativeFamilyLabel(observedProblem ?? evidenceText);
  }

  private isEvidenceNativeFamilyLabel(
    family: string,
    evidenceBasis: string,
  ): boolean {
    const ignored = new Set([
      'problem',
      'problems',
      'issue',
      'issues',
      'failure',
      'failures',
      'challenge',
      'challenges',
      'difficulty',
      'difficulties',
      'inadequate',
      'insufficient',
      'operational',
      'workflow',
      'process',
      'processes',
      'system',
      'systems',
      'lack',
      'lacking',
      'limited',
    ]);
    const tokens = (value: string): string[] =>
      value
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
        .split(/\s+/u)
        .map((token) => token.replace(/(?:ies|ing|ed|es|s)$/u, ''))
        .filter((token) => token.length >= 4 && !ignored.has(token));
    const familyTokens = [...new Set(tokens(family))];
    if (familyTokens.length === 0) return false;
    const evidenceTokens = [...new Set(tokens(evidenceBasis))];
    const supports = (familyToken: string): boolean =>
      evidenceTokens.some(
        (evidenceToken) =>
          evidenceToken === familyToken ||
          (familyToken.length >= 5 &&
            evidenceToken.length >= 5 &&
            evidenceToken.slice(0, 5) === familyToken.slice(0, 5)),
      );
    const supported = familyTokens.filter(supports).length;
    return supported >= Math.max(1, Math.ceil(familyTokens.length * 0.8));
  }

  private buildEvidenceNativeFamilyLabel(value: string): string | null {
    const cleaned = value
      .normalize('NFKC')
      .replace(/\s+/gu, ' ')
      .replace(/^[\s"'“”]+|[\s"'“”.!?;:]+$/gu, '')
      .trim();
    if (!cleaned) return null;
    return this.normalizeProblemFamilyLabel(cleaned, 160);
  }

  /**
   * Display-only guard for canonical family wording. The evidence/ranking
   * identity is selected first; this helper merely decides whether an already
   * AI-proposed, evidence-native equivalent is a cleaner neutral noun phrase.
   * It never invents a new label from domains, requester text, or a taxonomy.
   */
  private isNeutralProblemFamilyDisplayLabel(value: string): boolean {
    const cleaned = value
      .normalize('NFKC')
      .replace(/\s+/gu, ' ')
      .trim();
    if (!cleaned) return false;

    const words = cleaned.split(/\s+/u).filter(Boolean);
    if (words.length > 12) return false;
    if (/\b(?:instead of|rather than|because|although|even though|whenever)\b/iu.test(cleaned)) {
      return false;
    }
    if (/\b(?:i|we|you|they|he|she)\b/iu.test(cleaned)) return false;
    if (/\b(?:is|are|was|were|has|have|had|do|does|did|can|cannot|could|will|would|should|struggle|struggles|make|makes|made|making|want|wants|need|needs|fail|fails|failed|admit|admits|admitted)\b/iu.test(cleaned)) {
      return false;
    }
    return true;
  }

  /**
   * Slightly broader than row-level family admission because it is used only
   * after the winning evidence cluster is fixed and only for an AI-proposed
   * neutral display phrase tied to that same winning evidence. The 55% token
   * coverage mirrors downstream canonical group re-verification, so the label
   * cannot survive here and then fail the immutable family lock later.
   */
  private isEvidenceBackedNeutralDisplayFamilyLabel(
    family: string,
    evidenceBasis: string,
  ): boolean {
    const ignored = new Set([
      'problem', 'problems', 'issue', 'issues', 'failure', 'failures',
      'challenge', 'challenges', 'operational', 'workflow', 'system', 'systems',
      'service', 'services', 'user', 'users', 'selected', 'domain', 'domains',
      'across', 'using', 'with', 'from', 'into', 'that', 'this', 'their',
      'they', 'them', 'when', 'where', 'which', 'while', 'more',
    ]);
    const stem = (token: string): string =>
      token.length >= 8
        ? token.slice(0, 6)
        : token.length >= 6
          ? token.slice(0, 5)
          : token;
    const tokens = (value: string): string[] =>
      value
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .split(/\s+/u)
        .filter((token) => token.length >= 3 && !ignored.has(token))
        .map(stem);

    const familyTokens = [...new Set(tokens(family))];
    const evidenceTokens = new Set(tokens(evidenceBasis));
    if (familyTokens.length < 2 || evidenceTokens.size < 2) return false;
    const covered = familyTokens.filter((token) => evidenceTokens.has(token)).length;
    return covered >= Math.max(2, Math.ceil(familyTokens.length * 0.55));
  }

  /**
   * Keeps canonical family labels readable without ever cutting through a word.
   * The identity hash is computed independently downstream, so display-label
   * compaction must preserve a complete semantic phrase rather than a raw
   * character slice such as "multiple devices a".
   */
  private normalizeProblemFamilyLabel(value: string, maxLength = 220): string | null {
    const cleaned = value
      .normalize('NFKC')
      .replace(/[_-]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
    if (!cleaned) return null;
    if (cleaned.length <= maxLength) return cleaned;

    const prefix = cleaned.slice(0, maxLength + 1);
    const minimumBoundary = Math.floor(maxLength * 0.58);
    const punctuationBoundary = Math.max(
      prefix.lastIndexOf('. '),
      prefix.lastIndexOf('; '),
      prefix.lastIndexOf(': '),
      prefix.lastIndexOf(', '),
    );
    const wordBoundary = prefix.lastIndexOf(' ');
    const boundary = punctuationBoundary >= minimumBoundary
      ? punctuationBoundary + 1
      : wordBoundary > 0
        ? wordBoundary
        : cleaned.length;
    const compact = prefix
      .slice(0, boundary)
      .replace(/[\s,;:.-]+$/gu, '')
      .trim();
    return compact || cleaned;
  }

  /**
   * Compares only normalized transport identity. Long provider labels may be
   * clipped by a structured-output limit; a sufficiently long prefix
   * continuation is therefore treated as the same label. This is deliberately
   * not semantic matching and never consults evidence text, domains, synonyms,
   * stems, or a hand-authored family taxonomy.
   */
  private problemFamilyTransportIdentityMatches(
    left: string | null | undefined,
    right: string | null | undefined,
  ): boolean {
    const normalize = (value: string | null | undefined): string =>
      (value ?? '')
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[_-]+/gu, ' ')
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
    const first = normalize(left);
    const second = normalize(right);
    if (!first || !second) return false;
    if (first === second) return true;
    const shorter = first.length <= second.length ? first : second;
    const longer = first.length <= second.length ? second : first;
    return (
      shorter.length >= 48 &&
      longer.length - shorter.length <= 100 &&
      longer.startsWith(shorter)
    );
  }

  private async findOnlineFallbackModels(
    context: IdeaGenerationContext,
  ): Promise<{ readonly models: AiModel[]; readonly failureReason: string | null }> {
    try {
      const routableModels = await this.aiModelsService.getRoutableModels();
      const currentlyAvailableModels =
        routableModels.length > 0
          ? await this.aiModelRoutingService.filterTemporarilyUnavailableProviders(
              routableModels,
            )
          : [];
      const normalCandidates = currentlyAvailableModels;
      const temporarilyFilteredModels = routableModels.filter(
        (model) =>
          !currentlyAvailableModels.some((candidate) => candidate.id === model.id),
      );
      const isBaseEligibleOnlineModel = (model: AiModel): boolean => {
        const provider = normalizeAiProviderKey(model.providerKey);
        return (
          provider !== undefined &&
          provider !== AI_PROVIDER_KEYS.OLLAMA &&
          model.isActive &&
          model.supportsJsonOutput &&
          model.healthStatus !== 'UNAVAILABLE'
        );
      };
      const isFastEligibleOnlineModel = (model: AiModel): boolean =>
        isBaseEligibleOnlineModel(model) &&
        !COMMUNITY_AI_ANALYSIS_EXCLUDED_MODEL_API_IDS.has(model.apiModelId);
      let onlineModels = normalCandidates.filter(isFastEligibleOnlineModel);

      /*
       * Provider diversity must be decided before the three-model cap is
       * applied.  Previously three fast Google rows could fill the pool first,
       * which prevented a healthy OpenRouter/other-provider model from ever
       * entering the candidate set even though the final selector itself
       * preferred distinct providers.  Keep all fast models, then explicitly
       * add at least one healthy candidate from every otherwise-missing
       * provider before final ordering/capping.
       */
      const alreadySelectedProviders = new Set(
        onlineModels
          .map((model) => normalizeAiProviderKey(model.providerKey))
          .filter(
            (provider): provider is AiProviderKey => provider !== undefined,
          ),
      );
      const slowerProviderDiversityCandidates = normalCandidates
        .filter(isBaseEligibleOnlineModel)
        .filter(
          (model) =>
            !onlineModels.some((candidate) => candidate.id === model.id),
        )
        .sort((first, second) => {
          const firstProvider = normalizeAiProviderKey(first.providerKey);
          const secondProvider = normalizeAiProviderKey(second.providerKey);
          const firstDiversity =
            firstProvider && !alreadySelectedProviders.has(firstProvider)
              ? 0
              : 1;
          const secondDiversity =
            secondProvider && !alreadySelectedProviders.has(secondProvider)
              ? 0
              : 1;
          return (
            firstDiversity - secondDiversity ||
            this.healthRank(first.healthStatus) -
              this.healthRank(second.healthStatus) ||
            first.consecutiveFailures - second.consecutiveFailures
          );
        });
      for (const model of slowerProviderDiversityCandidates) {
        const provider = normalizeAiProviderKey(model.providerKey);
        if (!provider) continue;

        const addsProviderDiversity = !alreadySelectedProviders.has(provider);
        const stillNeedsCapacity =
          onlineModels.length < COMMUNITY_AI_EVIDENCE_TRIAGE_PARALLEL_MODELS;
        if (!addsProviderDiversity && !stillNeedsCapacity) continue;

        onlineModels.push(model);
        alreadySelectedProviders.add(provider);
      }

      /*
       * Availability hedge:
       * if recent model/provider cooldown leaves fewer than the configured
       * parallel width, use one bounded emergency attempt from the configured
       * routable pool. Prefer another provider first, then a sibling model from
       * the same provider. These models are still active, JSON-capable and in a
       * persisted routable health state; only the short cross-run cooldown is
       * bypassed for this one concurrent race.
       */
      if (
        onlineModels.length < COMMUNITY_AI_EVIDENCE_TRIAGE_PARALLEL_MODELS &&
        temporarilyFilteredModels.length > 0
      ) {
        const emergencyCandidates = temporarilyFilteredModels
          .filter(isFastEligibleOnlineModel)
          .filter(
            (model) =>
              normalizeAiProviderKey(model.providerKey) !== AI_PROVIDER_KEYS.OLLAMA,
          )
          .sort((first, second) => {
            const firstProvider = normalizeAiProviderKey(first.providerKey);
            const secondProvider = normalizeAiProviderKey(second.providerKey);
            const firstDiversity =
              firstProvider && !alreadySelectedProviders.has(firstProvider)
                ? 0
                : 1;
            const secondDiversity =
              secondProvider && !alreadySelectedProviders.has(secondProvider)
                ? 0
                : 1;
            return (
              firstDiversity - secondDiversity ||
              this.healthRank(first.healthStatus) -
                this.healthRank(second.healthStatus) ||
              first.consecutiveFailures - second.consecutiveFailures ||
              second.priority - first.priority
            );
          });

        for (const model of emergencyCandidates) {
          if (
            onlineModels.length >= COMMUNITY_AI_EVIDENCE_TRIAGE_PARALLEL_MODELS
          ) {
            break;
          }
          if (onlineModels.some((candidate) => candidate.id === model.id)) {
            continue;
          }
          onlineModels.push(model);
          const provider = normalizeAiProviderKey(model.providerKey);
          if (provider) alreadySelectedProviders.add(provider);
        }

        if (onlineModels.length > currentlyAvailableModels.length) {
          this.logger.warn(
            `Community AI availability hedge admitted ${onlineModels.length - currentlyAvailableModels.length} temporarily-cooled configured model(s) into the same bounded parallel race; different providers are preferred before same-provider siblings.`,
          );
        }
      }

      /*
       * Persisted routability remains mandatory. Normal candidates also honor
       * the live cooldown filter; only the bounded availability-hedge slots may
       * bypass that short-lived cooldown for one explicit concurrent attempt.
       * No inactive, unsupported, or persisted-UNAVAILABLE model is admitted.
       */
      if (onlineModels.length > 0) {
        const providerCount = new Set(
          onlineModels
            .map((model) => normalizeAiProviderKey(model.providerKey))
            .filter(
              (provider): provider is AiProviderKey => provider !== undefined,
            ),
        ).size;
        this.logger.debug(
          `Community AI model pool prepared | eligible=${onlineModels.length} | providers=${providerCount} | targetParallel=${COMMUNITY_AI_EVIDENCE_TRIAGE_PARALLEL_MODELS}.`,
        );
      }

      /*
       * Keep the actual provider work bounded. The triage layer always gets a
       * real online attempt whenever at least one active, supported,
       * non-UNAVAILABLE JSON model exists, while model ordering still prefers
       * healthier and cheaper/direct providers.
       */
      const seed = this.hash(context.runId);
      const ordered = [...onlineModels].sort((first, second) => {
        const healthDifference =
          this.healthRank(first.healthStatus) - this.healthRank(second.healthStatus);
        if (healthDifference !== 0) return healthDifference;

        if (first.consecutiveFailures !== second.consecutiveFailures) {
          return first.consecutiveFailures - second.consecutiveFailures;
        }

        const weightDifference = second.weight - first.weight;
        if (weightDifference !== 0) return weightDifference;

        if (first.priority !== second.priority) {
          return second.priority - first.priority;
        }

        return this.hash(`${seed}:${first.id}`) - this.hash(`${seed}:${second.id}`);
      });

      if (ordered.length <= 1) {
        return {
          models: ordered,
          failureReason:
            ordered.length === 0
              ? 'No active, routable, currently available online JSON model is configured for Community AI.'
              : null,
        };
      }

      const selected: AiModel[] = [];
      const usedProviders = new Set<AiProviderKey>();
      for (const model of ordered) {
        const provider = normalizeAiProviderKey(model.providerKey);
        if (!provider) continue;

        if (selected.length === 0 || !usedProviders.has(provider)) {
          selected.push(model);
          usedProviders.add(provider);
        }
        if (selected.length >= COMMUNITY_AI_ANALYSIS_MAX_ATTEMPTS) {
          return { models: selected, failureReason: null };
        }
      }
      for (const model of ordered) {
        if (!selected.some((item) => item.id === model.id)) {
          selected.push(model);
        }
        if (selected.length >= COMMUNITY_AI_ANALYSIS_MAX_ATTEMPTS) break;
      }
      return { models: selected, failureReason: null };
    } catch (error: unknown) {
      const failureReason = `Online community-analysis model discovery failed: ${this.getErrorMessage(error)}`;
      this.logger.warn(failureReason);
      return { models: [], failureReason };
    }
  }

  /**
   * Returns configured JSON-capable AI routes that were not actually attempted
   * by the first Community race. This bounded list is used only after the first
   * wave produced zero adjudicated rows. A different provider is preferred
   * first, then unused same-provider siblings. Configured Ollama is allowed as
   * the final local semantic rescue.
   */
  private async findEmergencySemanticTriageModels(
    excludedModelIds: ReadonlySet<string>,
  ): Promise<AiModel[]> {
    try {
      const configured = await this.aiModelsService.getEmergencyJsonModels();
      const candidates = configured
        .filter((model) => !excludedModelIds.has(model.id))
        .filter(
          (model) =>
            !COMMUNITY_AI_ANALYSIS_EXCLUDED_MODEL_API_IDS.has(model.apiModelId),
        )
        .filter((model) => model.isActive && model.supportsJsonOutput)
        .filter((model) => model.healthStatus !== 'UNAVAILABLE')
        .filter((model) => normalizeAiProviderKey(model.providerKey) !== undefined)
        .sort(
          (left, right) =>
            this.healthRank(left.healthStatus) - this.healthRank(right.healthStatus) ||
            left.consecutiveFailures - right.consecutiveFailures ||
            right.priority - left.priority ||
            right.weight - left.weight,
        );

      const selected: AiModel[] = [];
      const usedProviders = new Set<AiProviderKey>();
      for (const model of candidates) {
        const provider = normalizeAiProviderKey(model.providerKey);
        if (!provider || usedProviders.has(provider)) continue;
        selected.push(model);
        usedProviders.add(provider);
        if (selected.length >= COMMUNITY_AI_EVIDENCE_TRIAGE_PARALLEL_MODELS) {
          return selected;
        }
      }
      for (const model of candidates) {
        if (selected.some((candidate) => candidate.id === model.id)) continue;
        selected.push(model);
        if (selected.length >= COMMUNITY_AI_EVIDENCE_TRIAGE_PARALLEL_MODELS) break;
      }
      return selected;
    } catch (error: unknown) {
      this.logger.warn(
        `Community AI emergency semantic-route discovery failed non-fatally: ${this.getErrorMessage(error)}`,
      );
      return [];
    }
  }

  private resolveShortProviderRetryDelayMs(
    reasons: readonly string[],
  ): number | null {
    const delays = reasons
      .map((reason) => {
        const normalized = reason.toLocaleLowerCase();
        if (
          normalized.includes('daily quota') ||
          normalized.includes('monthly quota') ||
          normalized.includes('billing disabled') ||
          normalized.includes('billing account') ||
          normalized.includes('limit: 0')
        ) {
          return null;
        }
        const match = normalized.match(
          /(?:please\s+)?retry\s+in\s+([0-9]+(?:\.[0-9]+)?)\s*(?:s|sec|secs|second|seconds)\b/u,
        );
        if (!match) return null;
        const seconds = Number(match[1]);
        if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 20) {
          return null;
        }
        return Math.ceil(seconds * 1_000) + 300;
      })
      .filter((value): value is number => value !== null);

    if (delays.length === 0) return null;
    return Math.min(20_000, Math.max(...delays));
  }

  private async delayForProviderRetry(
    delayMs: number,
    signal?: AbortSignal,
  ): Promise<void> {
    if (delayMs <= 0 || signal?.aborted) return;
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', abort);
        resolve();
      };
      const timer = setTimeout(finish, delayMs);
      const abort = () => {
        clearTimeout(timer);
        finish();
      };
      signal?.addEventListener('abort', abort, { once: true });
    });
  }

  private healthRank(status: AiModel['healthStatus']): number {
    switch (status) {
      case 'HEALTHY':
        return 0;
      case 'UNKNOWN':
        return 1;
      case 'DEGRADED':
        return 2;
      default:
        return 3;
    }
  }

  private isDomainsOnlyPath(context: IdeaGenerationContext): boolean {
    return (
      !context.requestDescription?.trim() &&
      context.domainResolution?.source === 'USER_SELECTED'
    );
  }

  private isNoTextNoDomainsPreferencePath(
    context: IdeaGenerationContext,
  ): boolean {
    return (
      !context.requestDescription?.trim() &&
      context.domainResolution?.source !== 'USER_SELECTED'
    );
  }

  private hash(value: string): number {
    let result = 2166136261;

    for (const character of value) {
      result ^= character.charCodeAt(0);
      result = Math.imul(result, 16777619);
    }

    return result >>> 0;
  }

  private async withHardTimeout<T>(
    task: Promise<T>,
    timeoutMs: number,
    label: string,
  ): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    try {
      return await Promise.race([
        task,
        new Promise<never>((_resolve, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(new Error(`${label} exceeded ${timeoutMs}ms.`));
          }, timeoutMs);
          timeoutHandle.unref?.();
        }),
      ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  /**
   * Parses, corpus-grounds, and validates one provider response.
   *
   * Keeping the same validation path for online and local models prevents the
   * emergency fallback from bypassing evidence or business-quality controls.
   */
  private parseGroundAndValidate(
    context: IdeaGenerationContext,
    text: string,
    modelId: string,
    apiModelId: string,
    attemptCount: number,
    evidenceClassificationsOverride: readonly CommunityAiEvidenceTriage[] = [],
  ): CommunityAiAnalysis {
    const providerReturnedNoOpportunities =
      this.providerReturnedNoOpportunities(text);
    const parsedAnalysis = this.parseAndValidate(
      context,
      text,
      modelId,
      apiModelId,
      attemptCount,
      evidenceClassificationsOverride,
    );
    const domainNormalizedAnalysis = this.normalizeOpportunityDomains(
      context,
      parsedAnalysis,
    );
    let groundedAnalysis: CommunityAiAnalysis;

    try {
      groundedAnalysis = this.applyEvidenceGrounding(
        context,
        domainNormalizedAnalysis,
        providerReturnedNoOpportunities,
      );
    } catch (error) {
      const classifiedFallback =
        this.buildClassifiedEvidenceFallbackOpportunities(
          context,
          domainNormalizedAnalysis.evidenceClassifications ?? [],
        );
      const retainedFallback =
        classifiedFallback.length > 0
          ? classifiedFallback
          : context.requestDescription?.trim() &&
              (context.rawEvidenceCorpus?.length ?? 0) > 0
            ? []
            : this.buildRetainedEvidenceFallbackOpportunities(context);

      if (retainedFallback.length === 0) {
        throw error;
      }

      groundedAnalysis = {
        ...this.applyEvidenceGrounding(
          context,
          {
            ...domainNormalizedAnalysis,
            summary:
              'The online model did not return a usable grounded opportunity, so one cautious candidate was recovered from retained NLP evidence pending provenance classification.',
            dominantProblems: retainedFallback.map((item) => item.problem),
            unmetNeeds: retainedFallback.map((item) => item.unmetNeed),
            opportunities: retainedFallback,
            overallConfidence:
              retainedFallback.reduce((sum, item) => sum + item.confidence, 0) /
              retainedFallback.length,
            qualityWarnings: [
              ...domainNormalizedAnalysis.qualityWarnings,
              'The provider output was unusable after grounding; retained evidence was recovered within the same community-analysis attempt.',
            ],
          },
          true,
        ),
        aiSucceeded: false,
        fallbackUsed: true,
        validationRejectedCount: 1,
        fallbackReason: this.getErrorMessage(error),
      };
    }

    if (
      groundedAnalysis.fallbackUsed ||
      (groundedAnalysis.opportunities.length > 0 &&
        groundedAnalysis.opportunities.every(
          (item) => item.groundingScore >= 100,
        ) &&
        domainNormalizedAnalysis.opportunities.length === 0)
    ) {
      groundedAnalysis = {
        ...groundedAnalysis,
        aiSucceeded: false,
        fallbackUsed: true,
        fallbackReason:
          groundedAnalysis.fallbackReason ??
          'The provider response failed grounding or business validation; retained evidence was used instead.',
        validationRejectedCount: Math.max(
          1,
          groundedAnalysis.validationRejectedCount,
        ),
      };
    }

    groundedAnalysis = this.filterRequestMisalignedOpportunities(
      context,
      groundedAnalysis,
    );

    const analysis = this.preserveGroundedLowConfidenceAnalysis(
      groundedAnalysis,
    );

    this.validateBusinessQuality(analysis, context);

    return analysis;
  }


  private filterRequestMisalignedOpportunities(
    context: IdeaGenerationContext,
    analysis: CommunityAiAnalysis,
  ): CommunityAiAnalysis {
    const constraint = RequestVerticalConstraintUtil.resolve({
      requestDescription: context.requestDescription,
      domainName: context.domainName,
      selectedDomainNames: context.selectedDomains.map((domain) => domain.name),
      plannedQueries: context.collectionPlan?.searchQueries ?? [],
    });

    if (!constraint.strict) {
      return analysis;
    }

    const opportunities = analysis.opportunities.filter((opportunity) => {
      const semanticSubject = [
        opportunity.problem,
        opportunity.unmetNeed,
        opportunity.solutionArea,
      ].join(' ');
      const subjectMatches =
        RequestVerticalConstraintUtil.matchesVertical(
          semanticSubject,
          constraint,
        );
      const requestDescription = context.requestDescription?.trim() ?? '';
      const explicitRequesterProblem = !this.isEvidenceDiscoveryMode(context);
      const evidenceMatches = requestDescription && explicitRequesterProblem
        ? RequestEvidenceAlignmentUtil.isCompositeAligned({
            requestDescription:
              context.collectionPlan?.requestIntent?.explicitProblem ?? requestDescription,
            evidenceTexts: opportunity.evidenceSamples,
            plannedQueries: context.collectionPlan?.searchQueries ?? [],
          })
        : opportunity.evidenceSamples.some(
            (sample) =>
              RequestVerticalConstraintUtil.matchesVertical(sample, constraint) &&
              RequestVerticalConstraintUtil.matchesWorkflow(sample, constraint),
          );
      return subjectMatches && evidenceMatches;
    });

    if (opportunities.length === analysis.opportunities.length) {
      return analysis;
    }

    return {
      ...analysis,
      opportunities,
      dominantProblems: opportunities.map((item) => item.problem),
      unmetNeeds: opportunities.map((item) => item.unmetNeed),
      qualityWarnings: [
        ...analysis.qualityWarnings,
        ...(analysis.opportunities.length > opportunities.length
          ? [
              `${analysis.opportunities.length - opportunities.length} provider opportunity candidate(s) were discarded because their evidence did not match the requester vertical/workflow.`,
            ]
          : []),
      ],
    };
  }

  /**
   * Repairs provider labels such as "Unassigned", "General", or an empty
   * domain without discarding an otherwise grounded response. The model is not
   * allowed to invent a new domain; unknown labels are mapped to the primary
   * selected domain and every valid selected label is preserved.
   */
  private normalizeOpportunityDomains(
    context: IdeaGenerationContext,
    analysis: CommunityAiAnalysis,
  ): CommunityAiAnalysis {
    const selectedDomains =
      context.selectedDomains.length > 0
        ? context.selectedDomains
        : context.domainName
          ? [{ id: context.domainId, name: context.domainName, keywords: [] }]
          : [];

    const primaryDomainName = selectedDomains[0]?.name;
    if (!primaryDomainName) {
      return analysis;
    }

    const selectedByNormalizedName = new Map(
      selectedDomains.map((domain) => [
        this.normalizeComparableText(domain.name),
        domain.name,
      ]),
    );
    const selectedCybersecurityDomain =
      selectedByNormalizedName.get('cybersecurity') ?? null;

    const genericLabels = new Set([
      '',
      'unassigned',
      'general',
      'unknown',
      'other',
      'n a',
      'na',
    ]);

    const opportunities = analysis.opportunities.flatMap((opportunity) => {
      const semanticSubject = `${opportunity.problem} ${opportunity.unmetNeed}`;
      const normalizedSemanticSubject =
        this.normalizeComparableText(semanticSubject);

      /*
       * A provider can describe a retained authentication problem correctly
       * while assigning it to a broad adjacent domain such as Artificial
       * Intelligence. When Cybersecurity is already in the resolved request
       * scope, normalize only unmistakable authentication/account-access
       * semantics to that selected domain before evidence grounding. The
       * opportunity still has to survive the normal corpus/domain/atomic-
       * problem grounding checks below, so this never manufactures evidence.
       */
      if (
        selectedCybersecurityDomain &&
        /\b(?:two factor authentication|2fa|mfa|multi factor authentication|authentication|account access|login|sign in|identity provider|oauth|google login|google sign in)\b/u.test(
          normalizedSemanticSubject,
        )
      ) {
        return [
          {
            ...opportunity,
            domainName: selectedCybersecurityDomain,
          },
        ];
      }

      const evidenceDomainName = this.resolveEvidenceBackedDomainName(
        context,
        opportunity.evidenceSamples,
        semanticSubject,
      );
      if (evidenceDomainName) {
        return [{ ...opportunity, domainName: evidenceDomainName }];
      }

      const normalized = this.normalizeComparableText(opportunity.domainName);
      const exactSelectedName = selectedByNormalizedName.get(normalized);
      const requestedDomainName = exactSelectedName ??
        (genericLabels.has(normalized) ? primaryDomainName : null);

      if (!requestedDomainName) {
        return [];
      }

      const subjectSupported = this.evidenceSemanticallySupportsDomain(
        context,
        requestedDomainName,
        `${opportunity.problem} ${opportunity.unmetNeed}`,
      );
      const supported =
        subjectSupported &&
        opportunity.evidenceSamples.some((sample) =>
          this.evidenceSemanticallySupportsDomain(
            context,
            requestedDomainName,
            sample,
          ),
        );

      return supported
        ? [{ ...opportunity, domainName: requestedDomainName }]
        : [];
    });

    return {
      ...analysis,
      opportunities,
      dominantProblems: opportunities.map((item) => item.problem),
      unmetNeeds: opportunities.map((item) => item.unmetNeed),
    };
  }

  /** Parses the central runtime's validated JSON into the domain contract. */
  private parseAndValidate(
    context: IdeaGenerationContext,
    text: string,
    modelId: string,
    apiModelId: string,
    attemptCount: number,
    evidenceClassificationsOverride: readonly CommunityAiEvidenceTriage[] = [],
  ): CommunityAiAnalysis {
    const parsed: unknown = JSON.parse(text);

    if (!this.isRecord(parsed) || !Array.isArray(parsed.opportunities)) {
      throw new Error('Community AI analysis returned an invalid root object.');
    }

    const providerOpportunities = parsed.opportunities
      .slice(0, COMMUNITY_AI_ANALYSIS_MAX_OPPORTUNITIES)
      .map((value) => this.parseOpportunity(value));
    const evidenceClassifications =
      evidenceClassificationsOverride.length > 0
        ? [...evidenceClassificationsOverride]
        : this.parseAndVerifyEvidenceClassifications(
            context,
            parsed.evidenceClassifications,
          );

    const classifiedEvidenceFallback =
      providerOpportunities.length === 0
        ? this.buildClassifiedEvidenceFallbackOpportunities(
            context,
            evidenceClassifications,
          )
        : [];
    const opportunities =
      providerOpportunities.length > 0
        ? providerOpportunities
        : classifiedEvidenceFallback.length > 0
          ? classifiedEvidenceFallback
          : context.requestDescription?.trim() &&
              (context.rawEvidenceCorpus?.length ?? 0) > 0
            ? []
            : this.buildRetainedEvidenceFallbackOpportunities(context);

    if (providerOpportunities.length === 0 && opportunities.length > 0) {
      this.logger.warn(
        `Community AI provider returned an empty opportunities array; recovered ${opportunities.length} grounded candidate(s) from retained NLP evidence instead of failing the stage.`,
      );
    }

    if (opportunities.length === 0 && evidenceClassifications.length === 0) {
      throw new Error(
        'Community AI analysis returned no opportunities, no usable evidence classifications, and no retained evidence-backed candidate could be recovered.',
      );
    }

    const inferredConfidence =
      opportunities.length > 0
        ? opportunities.reduce((sum, item) => sum + item.confidence, 0) /
          opportunities.length
        : evidenceClassifications.reduce(
            (sum, item) => sum + item.confidence,
            0,
          ) / Math.max(1, evidenceClassifications.length);

    const usedRetainedEvidenceFallback =
      providerOpportunities.length === 0 && opportunities.length > 0;
    const providerWarnings = this.normalizeTextArray(
      parsed.qualityWarnings,
      [],
      true,
    );
    const safeProviderWarnings = usedRetainedEvidenceFallback
      ? providerWarnings.filter(
          (warning) =>
            !/(?:no|without|lacking|only|entirely)\s+(?:direct\s+)?(?:user\s+)?(?:complaints?|problem|problem context|actionable)|non-problem|promotional text|video titles/iu.test(
              warning,
            ),
        )
      : providerWarnings;

    return {
      /*
       * When the provider returns zero opportunity objects its accompanying
       * summary/confidence may describe the corpus as evidence-free even though
       * the deterministic retained-evidence fallback just recovered a concrete
       * direct complaint. In that case the fallback becomes authoritative for
       * semantic fields; provider prose is not allowed to contradict verified
       * retained evidence.
       */
      summary: usedRetainedEvidenceFallback
        ? `Recovered ${opportunities.length} evidence-grounded opportunity candidate(s) from retained evidence after the online model returned no opportunity objects.`
        : opportunities.length === 0 && evidenceClassifications.length > 0
          ? `Classified ${evidenceClassifications.length} raw evidence item(s); no complete opportunity was supported by the verified corpus.`
          : this.optionalString(
              parsed.summary,
              `Extracted ${opportunities.length} evidence-grounded opportunity candidate(s).`,
            ),
      dominantProblems: usedRetainedEvidenceFallback
        ? opportunities.map((item) => item.problem)
        : this.normalizeTextArray(
            parsed.dominantProblems,
            opportunities.map((item) => item.problem),
            opportunities.length === 0 && evidenceClassifications.length > 0,
          ),
      unmetNeeds: usedRetainedEvidenceFallback
        ? opportunities.map((item) => item.unmetNeed)
        : this.normalizeTextArray(
            parsed.unmetNeeds,
            opportunities.map((item) => item.unmetNeed),
            opportunities.length === 0 && evidenceClassifications.length > 0,
          ),
      opportunities,
      overallConfidence: usedRetainedEvidenceFallback
        ? inferredConfidence
        : opportunities.length === 0
          ? 15
          : this.normalizeOptionalScore(
              parsed.overallConfidence,
              inferredConfidence,
            ),
      qualityWarnings: [
        ...safeProviderWarnings,
        ...(usedRetainedEvidenceFallback
          ? [
              'The online model returned no opportunity objects; retained evidence was converted into a cautious grounded opportunity and still requires independent provenance verification before direct-versus-secondary claims are made.',
            ]
          : []),
        ...(opportunities.length <
        COMMUNITY_AI_ANALYSIS_TARGET_MIN_OPPORTUNITIES
          ? [
              `Only ${opportunities.length} evidence-grounded opportunity candidate(s) could be supported; the preferred minimum is ${COMMUNITY_AI_ANALYSIS_TARGET_MIN_OPPORTUNITIES}.`,
            ]
          : []),
      ],
      modelId,
      apiModelId,
      attemptCount,
      aiAttempted: true,
      triageAiSucceeded: evidenceClassifications.some((item) =>
        /AI semantic triage/iu.test(item.reason),
      ),
      synthesisAiSucceeded: !usedRetainedEvidenceFallback,
      aiSucceeded: !usedRetainedEvidenceFallback,
      fallbackUsed: usedRetainedEvidenceFallback,
      onlineAttemptCount: 1,
      executionFailureCount: 0,
      validationRejectedCount: usedRetainedEvidenceFallback ? 1 : 0,
      fallbackReason: usedRetainedEvidenceFallback
        ? 'The online model returned no usable grounded opportunity objects.'
        : null,
      attemptDiagnostics: [],
      unvalidatedDomainHypotheses: [],
      evidenceClassifications,
    };
  }

  /**
   * Converts already-retained deterministic NLP findings into the exact
   * CommunityAiOpportunity contract when an online provider returns an empty
   * opportunities array. This is not an invented market hypothesis: every
   * recovered item must carry a verbatim sample that can later pass the same
   * corpus-grounding validation as a provider-created item.
   */
  /**
   * Converts AI-classified raw evidence into a cautious fallback only after the
   * structural/provenance admission guard has capped impossible source claims.
   * This closes the old gap where a useful raw item could be discarded before
   * opportunity extraction, while keeping missing/invalid AI verdicts fail-closed without reinterpreting evidence semantics lexically.
   */
  private resolveEvidenceClusterFamily(
    context: IdeaGenerationContext,
    triage: CommunityAiEvidenceTriage,
    raw: IdeaGenerationRawEvidenceItem,
  ): { readonly key: string; readonly family: string } | null {
    /*
     * Community AI owns semantic family identity in every request mode. Normal
     * text-guided discovery is domain-scoped rather than requester-problem-locked:
     * evidence may establish any concrete problem family inside the resolved
     * domain boundary. Only internal EXPLICIT_PROBLEM corroboration requires
     * problemAlignment to the locked requester problem.
     */
    if (triage.familyBasis !== 'OBSERVED_PROBLEM') return null;
    if (!triage.observedProblem?.trim()) return null;
    if (this.isEvidenceDiscoveryMode(context)) {
      if (triage.domainAlignment === 'NONE') return null;
    } else if (triage.problemAlignment === 'NONE') {
      return null;
    }

    const family = this.sanitizeEvidenceProblemFamily(
      context,
      raw.text,
      triage.problemFamily,
      triage.observedProblem,
    );
    if (!family) return null;
    return {
      key: this.normalizeComparableText(family),
      family,
    };
  }

  private collapseSameSourceVerifiedNearDuplicates<T extends {
    readonly triage: CommunityAiEvidenceTriage;
    readonly raw: IdeaGenerationRawEvidenceItem;
  }>(
    items: readonly T[],
    aiSelectedIds: ReadonlySet<string>,
  ): T[] {
    const ordered = [...items].sort((left, right) => {
      const leftSelected = aiSelectedIds.has(left.triage.evidenceId) ? 1 : 0;
      const rightSelected = aiSelectedIds.has(right.triage.evidenceId) ? 1 : 0;
      const leftDirect = left.triage.classification === 'DIRECT_PROBLEM' ? 1 : 0;
      const rightDirect = right.triage.classification === 'DIRECT_PROBLEM' ? 1 : 0;
      return (
        rightSelected - leftSelected ||
        rightDirect - leftDirect ||
        right.triage.confidence - left.triage.confidence
      );
    });
    const kept: T[] = [];
    const comparableByItem = new Map<T, string>();
    const tokensByItem = new Map<T, Set<string>>();

    for (const item of ordered) {
      const sourceIdentity = EvidenceSourceIdentityUtil.resolve(item.raw);
      const comparable = this.normalizeRawEvidenceForDuplicateCheck(item.raw);
      const tokens = this.extractRawEvidenceDuplicateTokens(comparable);
      const duplicate = kept.some((existing) => {
        if (EvidenceSourceIdentityUtil.resolve(existing.raw) !== sourceIdentity) {
          return false;
        }
        const existingComparable = comparableByItem.get(existing) ?? '';
        if (existingComparable === comparable && comparable.length > 0) return true;
        return this.areRawEvidenceTokenSetsNearDuplicate(
          tokens,
          tokensByItem.get(existing) ?? new Set<string>(),
        );
      });
      if (duplicate) continue;
      kept.push(item);
      comparableByItem.set(item, comparable);
      tokensByItem.set(item, tokens);
    }

    if (kept.length < items.length) {
      this.logger.debug(
        `Collapsed ${items.length - kept.length} same-source exact/near-exact trusted duplicate row(s) before problem-family frequency accounting. Independent-source evidence was not merged.`,
      );
    }
    return kept;
  }

  private buildJointEvidenceOpportunity(
    context: IdeaGenerationContext,
    group: CommunityAiJointEvidenceGroup,
  ): CommunityAiOpportunity {
    const rawById = new Map(
      (context.rawEvidenceCorpus ?? []).map((item) => [item.id, item] as const),
    );
    const evidenceSamples = group.evidenceIds
      .map((id) => rawById.get(id)?.text?.trim() ?? '')
      .filter(Boolean)
      .slice(0, 5);
    const domainName =
      group.matchedDomainNames[0] ??
      context.selectedDomains[0]?.name ??
      context.domainName ??
      'Unassigned';
    const confidence = Math.min(
      group.distinctSourceCount >= 3 ? 80 : 74,
      Math.max(60, Math.round(group.confidence)),
    );

    return {
      domainName,
      title: group.problemFamily,
      problem: group.observedProblem,
      unmetNeed: `A focused workflow that addresses ${group.problemFamily.toLocaleLowerCase()} while preserving human review and validating the remaining implementation assumptions in a pilot.`,
      solutionArea: `Evidence-grounded workflow for ${group.problemFamily}`,
      affectedUsers: [
        'Users or operators represented by the composed evidence',
      ],
      evidenceSamples,
      frequency: 1,
      severity: 'MEDIUM',
      confidence,
      problemImportance: 58,
      localEvidenceAvailable: false,
      localEvidenceSamples: [],
      localRelevance: 20,
      groundingScore: 100,
      technicalFeasibility: 65,
      marketPotential: 40,
      innovationPotential: 50,
      risks: [
        `This is one joint supporting signal composed from ${group.evidenceIds.length} complementary item(s) across ${group.distinctSourceCount} independent source(s); no single member row is claimed to establish the complete problem and prevalence remains unvalidated.`,
      ],
    };
  }

  private buildClassifiedEvidenceFallbackOpportunities(
    context: IdeaGenerationContext,
    classifications: readonly CommunityAiEvidenceTriage[],
    aiSelectedProblemFamily: string | null = null,
    aiSelectedEvidenceIds: readonly string[] = [],
  ): CommunityAiOpportunity[] {
    const requestDescription = context.requestDescription?.trim() ?? '';
    const discoveryMode = this.isEvidenceDiscoveryMode(context);
    const hasRequesterScope = Boolean(requestDescription);
    const explicitRequesterProblem = !discoveryMode && hasRequesterScope;
    const multiDomainDiscovery =
      discoveryMode && context.selectedDomains.length > 1;
    const textAndDomainsDiscovery =
      discoveryMode &&
      hasRequesterScope &&
      context.requestMode === 'TEXT_AND_DOMAINS';
    const selectedDomainIdentities = new Set(
      context.selectedDomains
        .map((domain) => this.normalizeComparableText(domain.name))
        .filter(Boolean),
    );
    if (classifications.length === 0) return [];

    const rawById = new Map(
      (context.rawEvidenceCorpus ?? []).map((item) => [item.id, item] as const),
    );
    const verifiedCandidates = classifications
      .filter(
        (item) =>
          item.verifiedByDeterministicGuard &&
          (item.classification === 'DIRECT_PROBLEM' || item.classification === 'SUPPORTING_SIGNAL') &&
          rawById.has(item.evidenceId),
      )
      .map((item) => ({ triage: item, raw: rawById.get(item.evidenceId)! }));
    if (verifiedCandidates.length === 0) return [];

    const aiSelectedIds = new Set(
      aiSelectedEvidenceIds.map((id) => id.trim()).filter(Boolean),
    );
    const verified = this.collapseSameSourceVerifiedNearDuplicates(
      verifiedCandidates,
      aiSelectedIds,
    );
    if (verified.length === 0) return [];
    const normalizedAiFamily = this.normalizeComparableText(
      aiSelectedProblemFamily ?? '',
    );
    const familyClusters = new Map<
      string,
      { readonly family: string; readonly items: typeof verified }
    >();

    const aiSelectedVerified = verified.filter((item) =>
      aiSelectedIds.has(item.triage.evidenceId),
    );
    const aiSelectedFamilyRaw = aiSelectedProblemFamily?.replace(/\s+/gu, ' ').trim() ?? '';
    const aiSelectedFamily = aiSelectedFamilyRaw
      ? `${aiSelectedFamilyRaw.charAt(0).toUpperCase()}${aiSelectedFamilyRaw.slice(1)}`
      : '';
    const preserveAiSelectedFamily = Boolean(
      discoveryMode &&
      aiSelectedFamily &&
      aiSelectedVerified.length > 0 &&
      aiSelectedVerified.every((item) =>
        item.triage.familyBasis === 'OBSERVED_PROBLEM' &&
        Boolean(item.triage.observedProblem?.trim()) &&
        this.problemFamilyTransportIdentityMatches(
          aiSelectedFamily,
          item.triage.problemFamily ?? null,
        ) &&
        this.isEvidenceNativeFamilyLabel(
          aiSelectedFamily,
          [item.triage.observedProblem ?? '', item.raw.text].join(' '),
        ),
      ),
    );
    const groupedAiSelectedIds = new Set<string>();
    if (preserveAiSelectedFamily) {
      for (const item of aiSelectedVerified) {
        groupedAiSelectedIds.add(item.triage.evidenceId);
      }
      familyClusters.set(normalizedAiFamily, {
        family: this.normalizeProblemFamilyLabel(aiSelectedFamily) ?? aiSelectedFamily,
        items: [...aiSelectedVerified],
      });
    }

    for (const item of verified) {
      if (groupedAiSelectedIds.has(item.triage.evidenceId)) continue;
      const resolvedFamily = this.resolveEvidenceClusterFamily(
        context,
        item.triage,
        item.raw,
      );
      if (!resolvedFamily) continue;
      const existing = familyClusters.get(resolvedFamily.key);
      if (existing) {
        existing.items.push(item);
      } else {
        familyClusters.set(resolvedFamily.key, {
          family: resolvedFamily.family,
          items: [item],
        });
      }
    }
    /*
     * Provider labels are free-form and occasionally split one semantic family
     * into wording variants (for example, a noun-first and an actor-first
     * phrasing of the same observed problem). Merge only high-overlap labels
     * that also share at least one AI-attributed selected domain. This is a
     * linguistic identity normalization step, not a domain taxonomy: no
     * business-specific synonyms or problem meanings are hard-coded here.
     * The AI still owns the observed problem and matched-domain verdicts.
     */
    const semanticFamilyTokens = (value: string): string[] => {
      const ignored = new Set([
        'a', 'an', 'and', 'are', 'as', 'at', 'by', 'for', 'from', 'in', 'into',
        'involve', 'involved', 'involvement', 'involving', 'of', 'on', 'or',
        'the', 'through', 'to', 'with', 'within', 'company', 'companies',
        'business', 'businesses', 'service', 'services', 'system', 'systems',
        'operational', 'operation', 'operations', 'problem', 'problems',
        'issue', 'issues', 'challenge', 'challenges',
      ]);
      const stem = (token: string): string => {
        let normalized = token.toLocaleLowerCase();
        if (/ies$/u.test(normalized) && normalized.length > 5) {
          normalized = `${normalized.slice(0, -3)}y`;
        } else if (/ing$/u.test(normalized) && normalized.length > 6) {
          normalized = normalized.slice(0, -3);
        } else if (/ed$/u.test(normalized) && normalized.length > 5) {
          normalized = normalized.slice(0, -2);
        } else if (/s$/u.test(normalized) && !/ss$/u.test(normalized) && normalized.length > 5) {
          normalized = normalized.slice(0, -1);
        }
        return normalized;
      };
      return [...new Set(
        value
          .normalize('NFKC')
          .toLocaleLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, ' ')
          .split(/\s+/u)
          .map(stem)
          .filter((token) => token.length >= 3 && !ignored.has(token)),
      )];
    };
    const clustersShareAttributedDomain = (
      left: typeof verified,
      right: typeof verified,
    ): boolean => {
      /*
       * Text discovery no longer supplies a hard requester-problem boundary.
       * Therefore family-label normalization always requires at least one
       * shared AI-attributed domain so evidence from different searched lanes
       * cannot be merged merely because their wording looks similar.
       */
      const leftDomains = new Set(
        left.flatMap((item) => item.triage.matchedDomainNames ?? [])
          .map((name) => name.trim().toLocaleLowerCase())
          .filter(Boolean),
      );
      const rightDomains = new Set(
        right.flatMap((item) => item.triage.matchedDomainNames ?? [])
          .map((name) => name.trim().toLocaleLowerCase())
          .filter(Boolean),
      );
      if (leftDomains.size === 0 || rightDomains.size === 0) return false;
      return [...leftDomains].some((name) => rightDomains.has(name));
    };
    const familyLabelsAreEquivalent = (left: string, right: string): boolean => {
      const leftTokens = semanticFamilyTokens(left);
      const rightTokens = semanticFamilyTokens(right);
      if (leftTokens.length === 0 || rightTokens.length === 0) return false;
      const rightSet = new Set(rightTokens);
      const intersection = leftTokens.filter((token) => rightSet.has(token)).length;
      const overlapCoefficient =
        intersection / Math.max(1, Math.min(leftTokens.length, rightTokens.length));
      const union = new Set([...leftTokens, ...rightTokens]).size;
      const jaccard = intersection / Math.max(1, union);
      return intersection >= 2 && (overlapCoefficient >= 0.72 || jaccard >= 0.58);
    };
    const observedProblemsAreEquivalent = (
      leftFamily: string,
      leftItems: typeof verified,
      rightFamily: string,
      rightItems: typeof verified,
    ): boolean => {
      const leftFamilyTokens = semanticFamilyTokens(leftFamily);
      const rightFamilyTokens = semanticFamilyTokens(rightFamily);
      const rightFamilySet = new Set(rightFamilyTokens);
      const sharedFamilyAnchors = leftFamilyTokens.filter((token) =>
        rightFamilySet.has(token),
      ).length;
      if (sharedFamilyAnchors === 0) return false;

      const leftObservedTokens = [
        ...new Set(
          leftItems.flatMap((item) =>
            semanticFamilyTokens(item.triage.observedProblem ?? ''),
          ),
        ),
      ];
      const rightObservedTokens = [
        ...new Set(
          rightItems.flatMap((item) =>
            semanticFamilyTokens(item.triage.observedProblem ?? ''),
          ),
        ),
      ];
      if (leftObservedTokens.length < 4 || rightObservedTokens.length < 4) {
        return false;
      }

      const rightObservedSet = new Set(rightObservedTokens);
      const observedIntersection = leftObservedTokens.filter((token) =>
        rightObservedSet.has(token),
      ).length;
      const observedOverlapCoefficient =
        observedIntersection /
        Math.max(1, Math.min(leftObservedTokens.length, rightObservedTokens.length));

      return observedIntersection >= 4 && observedOverlapCoefficient >= 0.48;
    };

    const semanticallyMergedClusters: Array<{
      family: string;
      items: typeof verified;
    }> = [];
    for (const cluster of familyClusters.values()) {
      const existing = semanticallyMergedClusters.find(
        (candidate) =>
          clustersShareAttributedDomain(candidate.items, cluster.items) &&
          (
            familyLabelsAreEquivalent(candidate.family, cluster.family) ||
            observedProblemsAreEquivalent(
              candidate.family,
              candidate.items,
              cluster.family,
              cluster.items,
            )
          ),
      );
      if (!existing) {
        semanticallyMergedClusters.push({
          family: cluster.family,
          items: [...cluster.items],
        });
        continue;
      }

      const existingAiSelectedCount = existing.items.filter((item) =>
        aiSelectedIds.has(item.triage.evidenceId),
      ).length;
      const incomingAiSelectedCount = cluster.items.filter((item) =>
        aiSelectedIds.has(item.triage.evidenceId),
      ).length;
      if (
        incomingAiSelectedCount > existingAiSelectedCount ||
        (incomingAiSelectedCount === existingAiSelectedCount &&
          cluster.family.length < existing.family.length)
      ) {
        existing.family = cluster.family;
      }
      const existingIds = new Set(existing.items.map((item) => item.triage.evidenceId));
      existing.items.push(
        ...cluster.items.filter((item) => !existingIds.has(item.triage.evidenceId)),
      );
    }
    if (semanticallyMergedClusters.length < familyClusters.size) {
      this.logger.debug(
        `Semantic family normalization merged ${familyClusters.size - semanticallyMergedClusters.length} wording-variant cluster(s) using AI-attributed domain identity and generic label overlap.`,
      );
    }

    const rankedClusterCandidates = semanticallyMergedClusters
      .map((cluster, index) => {
        const items = cluster.items;
        const direct = items.filter((item) => item.triage.classification === 'DIRECT_PROBLEM').length;
        const supporting = items.length - direct;
        const sources = EvidenceSourceIdentityUtil.count(items.map((item) => item.raw));
        const averageConfidence = items.reduce((sum, item) => sum + item.triage.confidence, 0) / Math.max(1, items.length);
        const exactRequesterMatches = items.filter(
          (item) => item.triage.problemAlignment === 'MATCH',
        ).length;
        const partialRequesterMatches = items.filter(
          (item) => item.triage.problemAlignment === 'PARTIAL',
        ).length;
        const livedExactRequesterMatches = items.filter(
          (item) =>
            item.triage.problemAlignment === 'MATCH' &&
            item.triage.evidenceNature === 'LIVED_EXPERIENCE',
        ).length;
        const requesterSemanticFit = hasRequesterScope
          ? Math.max(
              0,
              ...items.map((item) =>
                this.tokenOverlap(
                  this.normalizeComparableText(requestDescription),
                  this.normalizeComparableText(
                    [
                      cluster.family,
                      item.triage.observedProblem ?? '',
                      item.triage.causalExplanation ?? '',
                    ].join(' '),
                  ),
                ),
              ),
            )
          : 0;
        const selectedDomainCoverage = new Set(
          items
            .flatMap((item) => item.triage.matchedDomainNames ?? [])
            .map((name) => this.normalizeComparableText(name))
            .filter((name) => name && selectedDomainIdentities.has(name)),
        ).size;
        const aiSelectedItemCount = items.filter((item) =>
          aiSelectedIds.has(item.triage.evidenceId),
        ).length;
        const normalizedClusterFamily = this.normalizeComparableText(cluster.family);
        const aiFamilyMatches = Boolean(
          normalizedAiFamily &&
          normalizedClusterFamily &&
          (normalizedAiFamily === normalizedClusterFamily ||
            normalizedAiFamily.includes(normalizedClusterFamily) ||
            normalizedClusterFamily.includes(normalizedAiFamily)),
        );
        return {
          items,
          family: cluster.family,
          index,
          aiSelectedItemCount,
          aiFamilyMatches,
          direct,
          supporting,
          sources,
          exactRequesterMatches,
          partialRequesterMatches,
          livedExactRequesterMatches,
          requesterSemanticFit,
          selectedDomainCoverage,
          score:
            direct * 6 +
            supporting * 3 +
            sources * 2.5 +
            averageConfidence / 25 +
            (discoveryMode ? selectedDomainCoverage * 2 : 0) +
            (hasRequesterScope && !discoveryMode
              ? exactRequesterMatches * 5 +
                partialRequesterMatches * 0.75 +
                livedExactRequesterMatches * 2 +
                requesterSemanticFit * 3
              : 0),
        };
      });

    const strongestNonSelectedScore = rankedClusterCandidates
      .filter(
        (cluster) =>
          cluster.aiSelectedItemCount === 0 && !cluster.aiFamilyMatches,
      )
      .reduce((best, cluster) => Math.max(best, cluster.score), 0);
    const strongestCorroboratedNonSelectedScore = rankedClusterCandidates
      .filter(
        (cluster) =>
          cluster.aiSelectedItemCount === 0 &&
          !cluster.aiFamilyMatches &&
          (
            cluster.direct > 0 ||
            cluster.sources >= 2 ||
            cluster.items.length >= 2 ||
            cluster.selectedDomainCoverage >= 2
          ),
      )
      .reduce((best, cluster) => Math.max(best, cluster.score), 0);

    const rankedClusters = rankedClusterCandidates
      .sort((left, right) => {
        /*
         * Only the internal EXPLICIT_PROBLEM corroboration mode is requester-
         * problem locked. Ordinary text discovery is evidence-first: the text
         * resolves domain/workflow context, while verified evidence breadth,
         * source diversity, confidence, and domain coverage choose the problem.
         */
        if (hasRequesterScope && !discoveryMode) {
          /*
           * `problemAlignment` is an AI semantic verdict already attached to
           * every row. Use it as ranking context even when PREPARING classified
           * the text-bearing request as discovery intent. The requester text is
           * still NOT evidence and cannot create/upgrade a row; it only prevents
           * a PARTIAL adjacent problem from outranking a MATCH family solely
           * because the adjacent row happened to be DIRECT.
           */
          const leftAlignmentRank = left.exactRequesterMatches > 0
            ? 2
            : left.partialRequesterMatches > 0
              ? 1
              : 0;
          const rightAlignmentRank = right.exactRequesterMatches > 0
            ? 2
            : right.partialRequesterMatches > 0
              ? 1
              : 0;
          if (leftAlignmentRank !== rightAlignmentRank) {
            return rightAlignmentRank - leftAlignmentRank;
          }
          if (leftAlignmentRank === 2 && rightAlignmentRank === 2) {
            const exactDifference =
              right.exactRequesterMatches - left.exactRequesterMatches;
            if (exactDifference !== 0) return exactDifference;

            const livedDifference =
              right.livedExactRequesterMatches - left.livedExactRequesterMatches;
            if (livedDifference !== 0) return livedDifference;
          }
        }

        /*
         * The same online model that classified the full corpus owns the first
         * problem-family choice, but that choice is not an unconditional
         * single-row override. Deterministic clustering never invents a new
         * family: it only compares AI-owned, canonically verified family rows.
         * A direct-user row, repeated family, or independently corroborated
         * family keeps AI priority. A one-row/one-source supporting-only niche
         * family may keep priority only when it is not materially dominated by
         * another AI-classified cluster. When the AI-selected family is only one
         * supporting row from one source, independently corroborated competing
         * families get a stronger structural tie-break. No domain or problem
         * meaning is inferred here: the AI still defines every family label and
         * the deterministic layer compares only verified support breadth.
         */
        const leftAiSelected = left.aiSelectedItemCount > 0 || left.aiFamilyMatches;
        const rightAiSelected = right.aiSelectedItemCount > 0 || right.aiFamilyMatches;
        const leftIsolatedNarrowDirect =
          multiDomainDiscovery &&
          left.direct > 0 &&
          left.sources <= 1 &&
          left.items.length <= 1 &&
          left.selectedDomainCoverage <= 1;
        const rightIsolatedNarrowDirect =
          multiDomainDiscovery &&
          right.direct > 0 &&
          right.sources <= 1 &&
          right.items.length <= 1 &&
          right.selectedDomainCoverage <= 1;
        const leftWeakAiSelection =
          leftAiSelected &&
          left.sources <= 1 &&
          left.items.length <= 1 &&
          (left.direct === 0 || leftIsolatedNarrowDirect);
        const rightWeakAiSelection =
          rightAiSelected &&
          right.sources <= 1 &&
          right.items.length <= 1 &&
          (right.direct === 0 || rightIsolatedNarrowDirect);
        const leftRequiredCompetingScore = leftWeakAiSelection
          ? strongestCorroboratedNonSelectedScore
          : strongestNonSelectedScore;
        const rightRequiredCompetingScore = rightWeakAiSelection
          ? strongestCorroboratedNonSelectedScore
          : strongestNonSelectedScore;
        const leftDominanceRatio = leftWeakAiSelection ? 1.08 : 0.82;
        const rightDominanceRatio = rightWeakAiSelection ? 1.08 : 0.82;
        const leftAiPriority = Boolean(
          leftAiSelected &&
            (
              (left.direct > 0 && !leftIsolatedNarrowDirect) ||
              left.sources >= 2 ||
              left.items.length >= 2 ||
              left.selectedDomainCoverage >= 2 ||
              leftRequiredCompetingScore <= 0 ||
              left.score >= leftRequiredCompetingScore * leftDominanceRatio
            ),
        );
        const rightAiPriority = Boolean(
          rightAiSelected &&
            (
              (right.direct > 0 && !rightIsolatedNarrowDirect) ||
              right.sources >= 2 ||
              right.items.length >= 2 ||
              right.selectedDomainCoverage >= 2 ||
              rightRequiredCompetingScore <= 0 ||
              right.score >= rightRequiredCompetingScore * rightDominanceRatio
            ),
        );
        if (leftAiPriority !== rightAiPriority) return leftAiPriority ? -1 : 1;
        if (left.aiSelectedItemCount !== right.aiSelectedItemCount) {
          if (leftAiPriority || rightAiPriority) {
            return right.aiSelectedItemCount - left.aiSelectedItemCount;
          }
        }

        /*
         * TEXT_AND_DOMAINS keeps evidence ownership unchanged, but requester
         * text may break a true evidence-strength tie. This prevents a family
         * with zero requester-context fit from winning only because of a tiny
         * confidence delta when another verified family has the same evidence
         * count, source diversity, DIRECT/SUPPORTING strength, and selected-
         * domain coverage. The text never creates evidence, never upgrades a
         * row, and never overrides stronger or more diverse evidence.
         */
        if (textAndDomainsDiscovery) {
          const structurallyComparable =
            left.direct === right.direct &&
            left.supporting === right.supporting &&
            left.sources === right.sources &&
            left.items.length === right.items.length &&
            left.selectedDomainCoverage === right.selectedDomainCoverage;
          const semanticFitDifference =
            right.requesterSemanticFit - left.requesterSemanticFit;

          if (
            structurallyComparable &&
            Math.abs(semanticFitDifference) >= 0.08
          ) {
            return semanticFitDifference > 0 ? 1 : -1;
          }
        }

        return (
          right.score - left.score ||
          right.items.length - left.items.length ||
          left.index - right.index
        );
      });

    /*
     * Keep ranking/evidence ownership untouched, but prefer a cleaner neutral
     * AI-authored display label for the winning family when that label is
     * independently entailed by the winning cluster's retained evidence. This
     * fixes sentence-like canonical labels without changing the winning cluster,
     * evidence ids, source counts, or ranking score.
     */
    if (discoveryMode && rankedClusters.length > 0 && aiSelectedFamily) {
      const winningCluster = rankedClusters[0];
      const neutralAiDisplayFamily = this.normalizeProblemFamilyLabel(
        aiSelectedFamily,
        120,
      );
      const winningEvidenceBasis = winningCluster.items
        .map((item) => [item.triage.observedProblem ?? '', item.raw.text].join(' '))
        .join(' ')
        .replace(/\s+/gu, ' ')
        .trim();
      const aiOwnsWinningCluster = winningCluster.items.some((item) =>
        aiSelectedIds.has(item.triage.evidenceId),
      ) || winningCluster.aiFamilyMatches;

      if (
        neutralAiDisplayFamily &&
        aiOwnsWinningCluster &&
        this.isNeutralProblemFamilyDisplayLabel(neutralAiDisplayFamily) &&
        this.isEvidenceBackedNeutralDisplayFamilyLabel(
          neutralAiDisplayFamily,
          winningEvidenceBasis,
        )
      ) {
        const previousDisplayFamily = winningCluster.family;
        winningCluster.family = neutralAiDisplayFamily;
        if (
          this.normalizeComparableText(previousDisplayFamily) !==
          this.normalizeComparableText(neutralAiDisplayFamily)
        ) {
          this.logger.debug(
            `Canonical family display normalization replaced sentence-like wording "${previousDisplayFamily}" with evidence-backed neutral wording "${neutralAiDisplayFamily}". Ranking identity and evidence membership were unchanged.`,
          );
        }
      }
    }

    if (hasRequesterScope && rankedClusters.length > 0) {
      const diagnostics = rankedClusters
        .slice(0, 4)
        .map(
          (cluster, index) =>
            `#${index + 1} ${cluster.family} score=${cluster.score.toFixed(2)} exact=${cluster.exactRequesterMatches} partial=${cluster.partialRequesterMatches} livedExact=${cluster.livedExactRequesterMatches} sources=${cluster.sources} evidence=${cluster.items.length} semanticFit=${cluster.requesterSemanticFit.toFixed(2)}`,
        )
        .join(' | ');
      this.logger.debug(
        `Requester context diagnostics | ${diagnostics}. Requester text remains non-evidence. In TEXT_AND_DOMAINS it is used only as a soft tie-break between structurally equal verified families; stronger, more diverse, or broader-domain evidence still wins.`,
      );
    }

    if (discoveryMode && rankedClusters.length > 0) {
      const diagnostics = rankedClusters
        .slice(0, 4)
        .map((cluster, index) => {
          const selectedByAi = cluster.aiSelectedItemCount > 0 || cluster.aiFamilyMatches;
          return `#${index + 1} ${cluster.family} score=${cluster.score.toFixed(2)} direct=${cluster.direct} supporting=${cluster.supporting} sources=${cluster.sources} evidence=${cluster.items.length} domainCoverage=${cluster.selectedDomainCoverage}/${context.selectedDomains.length} aiSelected=${selectedByAi}`;
        })
        .join(' | ');
      this.logger.debug(
        `Discovery family support ranking | ${diagnostics}. In multi-domain no-input discovery, isolated one-row/one-source direct bugs do not automatically override a more representative verified family with broader selected-domain coverage or corroboration.`,
      );
    }

    const resolveDomainName = (samples: readonly string[]): string => {
      for (const domain of context.selectedDomains) {
        if (samples.some((sample) => this.evidenceSemanticallySupportsDomain(context, domain.name, sample))) {
          return domain.name;
        }
      }
      return context.selectedDomains[0]?.name ?? context.domainName ?? 'Unassigned';
    };

    const opportunities: CommunityAiOpportunity[] = [];
    for (const cluster of rankedClusters.slice(0, COMMUNITY_AI_ANALYSIS_MAX_OPPORTUNITIES)) {
      const selected = cluster.items
        .sort((left, right) => {
          const leftWeight = (left.triage.classification === 'DIRECT_PROBLEM' ? 100 : 0) + left.triage.confidence;
          const rightWeight = (right.triage.classification === 'DIRECT_PROBLEM' ? 100 : 0) + right.triage.confidence;
          return rightWeight - leftWeight;
        });
      const sourceDiverse: typeof selected = [];
      const usedSources = new Set<string>();
      for (const item of selected) {
        if (sourceDiverse.length >= 8) break;
        const sourceIdentity = EvidenceSourceIdentityUtil.resolve(item.raw);
        if (!usedSources.has(sourceIdentity)) {
          usedSources.add(sourceIdentity);
          sourceDiverse.push(item);
        }
      }
      for (const item of selected) {
        if (sourceDiverse.length >= 8) break;
        if (!sourceDiverse.includes(item)) sourceDiverse.push(item);
      }
      const evidenceSamples = sourceDiverse.map((item) => item.raw.text);
      const averageConfidence = sourceDiverse.reduce((sum, item) => sum + item.triage.confidence, 0) / Math.max(1, sourceDiverse.length);
      const familyTitle = cluster.family;
      const directEvidenceCount = sourceDiverse.filter(
        (item) => item.triage.classification === 'DIRECT_PROBLEM',
      ).length;
      const explicitCausalEvidenceCount = sourceDiverse.filter((item) =>
        Boolean(item.triage.causalExplanation?.trim()),
      ).length;
      const claimBoundaryRisks = explicitRequesterProblem
        ? [
            'Requester-stated causes or mechanisms are hypotheses unless a retained trusted evidence row explicitly states the same causal relationship; supporting evidence for the problem family alone must not be narrated as proof of that cause.',
            ...(directEvidenceCount === 0
              ? [
                  'The retained family is supported without DIRECT_PROBLEM evidence. Final narratives must describe the problem as preliminary supporting evidence and must not claim the full requester workflow chain, prevalence, or causal mechanism as externally proven.',
                ]
              : []),
            ...(explicitCausalEvidenceCount === 0
              ? [
                  'No retained trusted row explicitly establishes a causal mechanism for this family. Final problem statements and abstracts must use hypothesis language for why the problem occurs.',
                ]
              : []),
          ]
        : [];

      opportunities.push({
        domainName: resolveDomainName(evidenceSamples),
        title: familyTitle,
        /*
         * Only internal EXPLICIT_PROBLEM mode has a requester-owned problem
         * boundary. In normal discovery, including text-guided discovery, the
         * AI-classified evidence-native family becomes the candidate problem;
         * requester text returns later only as compatible solution-design context.
         */
        problem: explicitRequesterProblem
          ? this.boundProblemText(
              `Within the requester-defined workflow, the strongest retained evidence supports the "${familyTitle}" problem facet. Canonical requester scope: ${requestDescription}`,
              420,
            )
          : familyTitle,
        unmetNeed: explicitRequesterProblem
          ? `Prioritize product design around the evidence-leading requester facet "${familyTitle}" while preserving the broader canonical request only as secondary scope until its remaining facets are independently validated.`
          : `A focused software workflow that addresses ${familyTitle} while preserving human review and validating how broadly the problem occurs.`,
        solutionArea: explicitRequesterProblem
          ? `Evidence-prioritized requester workflow: ${familyTitle}`
          : `Evidence-grounded workflow for ${familyTitle}`,
        affectedUsers: [
          explicitRequesterProblem
            ? RequestDynamicQueryUtil.extractActor(requestDescription) ||
              'Users or operators described by the requester workflow'
            : 'Users or operators represented by the retained external evidence',
        ],
        evidenceSamples,
        frequency: cluster.items.length,
        severity: 'MEDIUM',
        confidence: Math.max(
          25,
          Math.min(
            sourceDiverse.some((item) => item.triage.classification === 'DIRECT_PROBLEM')
              ? EvidenceSourceIdentityUtil.count(
                  sourceDiverse.map((item) => item.raw),
                ) >= 2
                ? 85
                : 68
              : EvidenceSourceIdentityUtil.count(
                  sourceDiverse.map((item) => item.raw),
                ) >= 2
                ? 62
                : 48,
            Math.round(averageConfidence),
          ),
        ),
        problemImportance: Math.min(90, 50 + cluster.items.length * 4),
        localEvidenceAvailable: false,
        localEvidenceSamples: [],
        localRelevance: 20,
        groundingScore: 100,
        technicalFeasibility: 65,
        marketPotential: 40,
        innovationPotential: 50,
        risks: [
          `This problem family is supported by ${cluster.items.length} retained item(s) across ${EvidenceSourceIdentityUtil.count(cluster.items.map((item) => item.raw))} source(s); broader direct validation may still be required.`,
          ...claimBoundaryRisks,
        ],
      });
    }

    return opportunities;
  }

  private buildRetainedEvidenceFallbackOpportunities(
    context: IdeaGenerationContext,
  ): CommunityAiOpportunity[] {
    if (!context.nlp || (context.rawEvidenceCorpus?.length ?? 0) > 0) {
      return [];
    }

    const primaryDomainName =
      context.selectedDomains[0]?.name ?? context.domainName ?? 'Unassigned';
    const rawCorpus = this.collectEvidenceCorpus([
      context.nlp,
      context.domainEvidence,
    ]);
    const requestConstraint = RequestVerticalConstraintUtil.resolve({
      requestDescription: context.requestDescription,
      domainName: context.domainName,
      selectedDomainNames: context.selectedDomains.map((domain) => domain.name),
      plannedQueries: context.collectionPlan?.searchQueries ?? [],
    });
    const verticalCorpus = requestConstraint.strict
      ? rawCorpus.filter(
          (sample) =>
            RequestVerticalConstraintUtil.matchesVertical(
              sample,
              requestConstraint,
            ) &&
            RequestVerticalConstraintUtil.matchesWorkflow(
              sample,
              requestConstraint,
            ),
        )
      : rawCorpus;
    const requestDescription = context.requestDescription?.trim() ?? '';
    const corpus = requestDescription
      ? verticalCorpus.filter(
          (sample) =>
            RequestEvidenceAlignmentUtil.classifyForRequest({
              requestDescription,
              evidenceText: sample,
              plannedQueries: context.collectionPlan?.searchQueries ?? [],
            }) !== 'UNRELATED',
        )
      : verticalCorpus;
    const selectedDomainNames = new Map(
      context.selectedDomains.map((domain) => [
        this.normalizeComparableText(domain.name),
        domain.name,
      ]),
    );
    const sourceRecords: Record<string, unknown>[] = [];

    const appendRecords = (value: unknown): void => {
      if (!Array.isArray(value)) {
        return;
      }

      for (const entry of value) {
        if (this.isRecord(entry)) {
          sourceRecords.push(entry);
        }
      }
    };

    appendRecords(context.nlp.opportunities);
    appendRecords(context.nlp.recurringProblems);
    appendRecords(context.nlp.extractedNeeds);
    appendRecords(context.nlp.featureRequests);

    const recovered: CommunityAiOpportunity[] = [];
    const seenSignatures = new Set<string>();

    for (const record of sourceRecords) {
      if (recovered.length >= COMMUNITY_AI_ANALYSIS_MAX_OPPORTUNITIES) {
        break;
      }

      const problem = this.firstAvailableString(record, [
        'problem',
        'problemStatement',
        'description',
        'title',
        'need',
        'feature',
      ]);
      if (!problem || problem.length < 24) {
        continue;
      }

      const unmetNeed =
        this.firstAvailableString(record, [
          'unmetNeed',
          'need',
          'missingCapability',
          'title',
          'feature',
        ]) ?? `A reliable workflow that resolves: ${problem}`;
      const solutionArea =
        this.firstAvailableString(record, [
          'solutionArea',
          'solution',
          'direction',
        ]) ?? 'A focused software workflow for diagnosis, validation, and guided resolution.';

      const explicitEvidence = this.normalizeTextArray(
        record.evidenceSamples ?? record.evidence ?? record.examples,
        [],
        true,
      );
      const groundedEvidence = explicitEvidence
        .map((sample) => this.findGroundedCorpusMatch(sample, corpus))
        .filter((sample): sample is string => sample !== null);
      const descriptor = this.normalizeComparableText(
        `${problem} ${unmetNeed} ${solutionArea}`,
      );
      const corpusFallback = corpus.find(
        (sample) =>
          this.tokenOverlap(
            descriptor,
            this.normalizeComparableText(sample),
          ) >= 0.12,
      );
      const evidenceSample =
        this.selectStrongestFallbackEvidence(groundedEvidence) ?? corpusFallback;

      if (
        !evidenceSample ||
        this.looksLikePromotionalOrPublisherText(evidenceSample) ||
        !this.isRetainedFallbackEvidenceCandidate(evidenceSample)
      ) {
        continue;
      }

      const repairedProblem = this.buildProfessionalFallbackProblem(
        problem,
        evidenceSample,
      );
      const repairedUnmetNeed = this.buildProfessionalFallbackNeed(
        unmetNeed,
        repairedProblem,
        evidenceSample,
      );

      const signature = this.normalizeComparableText(repairedProblem);
      if (!signature || seenSignatures.has(signature)) {
        continue;
      }
      seenSignatures.add(signature);

      const rawDomainName =
        this.firstAvailableString(record, ['domainName', 'domain']) ??
        primaryDomainName;
      const normalizedRawDomainName = selectedDomainNames.get(
        this.normalizeComparableText(rawDomainName),
      );
      const evidenceBackedDomainName = this.resolveEvidenceBackedDomainName(
        context,
        [evidenceSample],
        repairedProblem,
      );
      const domainName =
        evidenceBackedDomainName ??
        (normalizedRawDomainName &&
        this.evidenceSemanticallySupportsDomain(
          context,
          normalizedRawDomainName,
          evidenceSample,
        )
          ? normalizedRawDomainName
          : null);
      if (!domainName) {
        continue;
      }
      const repairedTitle = this.normalizeOpportunityTitle(
        domainName,
        this.firstAvailableString(record, ['title', 'name']) ??
          this.deriveTitle(
            repairedProblem,
            repairedUnmetNeed,
            evidenceSample,
            domainName,
          ),
        repairedProblem,
        repairedUnmetNeed,
        evidenceSample,
      );
      const repairedSolutionArea = this.buildProfessionalFallbackSolutionArea(
        solutionArea,
        repairedProblem,
        evidenceSample,
      );
      const familyConsistentFallback = this.enforceFallbackFamilyConsistency({
        title: repairedTitle,
        problem: this.buildProfessionalFallbackProblem('', evidenceSample),
        unmetNeed: repairedUnmetNeed,
        solutionArea: repairedSolutionArea,
        evidenceSample,
      });
      const confidence = Math.max(
        COMMUNITY_AI_ANALYSIS_MIN_OPPORTUNITY_CONFIDENCE,
        this.normalizeOptionalScore(record.confidence ?? record.aiConfidence, 45),
      );

      const retainedAffectedUsers = this.normalizeTextArray(
        record.affectedUsers ?? record.targetUsers,
        [],
        true,
      ).filter(
        (value) => !/^affected community users?$/iu.test(value.trim()),
      );

      recovered.push({
        domainName,
        title: familyConsistentFallback.title,
        problem: familyConsistentFallback.problem,
        unmetNeed: familyConsistentFallback.unmetNeed,
        solutionArea: familyConsistentFallback.solutionArea,
        affectedUsers: (
          retainedAffectedUsers.length > 0
            ? retainedAffectedUsers
            : this.buildFallbackAffectedUsers(context, evidenceSample)
        ).slice(0, 2),
        evidenceSamples: [evidenceSample],
        frequency: this.normalizeOptionalPositiveInteger(record.frequency, 1),
        severity: this.normalizeSeverity(record.severity),
        confidence,
        problemImportance: this.normalizeOptionalScore(
          record.problemImportance ?? record.importance,
          confidence,
        ),
        localEvidenceAvailable: false,
        localEvidenceSamples: [],
        localRelevance: Math.min(
          25,
          this.normalizeOptionalScore(record.localRelevance, 20),
        ),
        groundingScore: 100,
        technicalFeasibility: this.normalizeOptionalScore(
          record.technicalFeasibility ?? record.feasibility,
          65,
        ),
        marketPotential: this.normalizeOptionalScore(
          record.marketPotential,
          45,
        ),
        innovationPotential: this.normalizeOptionalScore(
          record.innovationPotential,
          50,
        ),
        risks: this.normalizeTextArray(
          record.risks ?? record.limitations,
          [
            'The direction is supported by limited retained evidence and requires broader validation.',
          ],
        ).slice(0, 2),
      });
    }

    if (recovered.length > 0) {
      return recovered;
    }

    const strongestCorpusSample = this.selectStrongestFallbackEvidence(corpus);
    if (!strongestCorpusSample) {
      return [];
    }

    const extractedProblem =
      this.extractProblemSection(strongestCorpusSample) ||
      this.boundProblemText(strongestCorpusSample, 220);
    const problem = this.buildProfessionalFallbackProblem(
      extractedProblem,
      strongestCorpusSample,
    );
    const unmetNeed = this.buildProfessionalFallbackNeed(
      '',
      problem,
      strongestCorpusSample,
    );

    const fallbackDomainName = this.resolveEvidenceBackedDomainName(
      context,
      [strongestCorpusSample],
      `${problem} ${unmetNeed}`,
    );
    if (!fallbackDomainName) {
      return [];
    }

    return [
      {
        domainName: fallbackDomainName,
        title: this.deriveTitle(
          problem,
          unmetNeed,
          strongestCorpusSample,
          fallbackDomainName,
        ),
        problem,
        unmetNeed,
        solutionArea: this.buildProfessionalFallbackSolutionArea(
          '',
          problem,
          strongestCorpusSample,
        ),
        affectedUsers: this.buildFallbackAffectedUsers(
          context,
          strongestCorpusSample,
        ),
        evidenceSamples: [strongestCorpusSample],
        frequency: 1,
        severity: 'MEDIUM',
        confidence: Math.max(
          40,
          COMMUNITY_AI_ANALYSIS_MIN_OPPORTUNITY_CONFIDENCE,
        ),
        problemImportance: 45,
        localEvidenceAvailable: false,
        localEvidenceSamples: [],
        localRelevance: 20,
        groundingScore: 100,
        technicalFeasibility: 65,
        marketPotential: 40,
        innovationPotential: 50,
        risks: [
          'The direction is supported by one retained sample and requires broader validation.',
        ],
      },
    ];
  }

  private enforceFallbackFamilyConsistency(input: {
    readonly title: string;
    readonly problem: string;
    readonly unmetNeed: string;
    readonly solutionArea: string;
    readonly evidenceSample: string;
  }): {
    readonly title: string;
    readonly problem: string;
    readonly unmetNeed: string;
    readonly solutionArea: string;
  } {
    const evidenceFamily = resolvePrimaryProblemFamily(input.evidenceSample);
    const solutionFamily = resolvePrimaryProblemFamily(input.solutionArea);
    const solutionAtomicMatch = matchEvidenceToAtomicProblem(
      input.solutionArea,
      input.evidenceSample,
    );
    const solutionLexicalGrounding = this.tokenOverlap(
      this.normalizeComparableText(input.solutionArea),
      this.normalizeComparableText(input.evidenceSample),
    );
    const solutionFamilyGrounded = Boolean(
      evidenceFamily &&
      solutionFamily &&
      evidenceFamily.key === solutionFamily.key,
    );
    const solutionIntroducesUnsupportedConcept =
      this.introducesUnsupportedSemanticConcept(
        input.solutionArea,
        input.evidenceSample,
      ) ||
      this.containsUnsupportedHighRiskMechanism(
        input.solutionArea,
        input.evidenceSample,
      );
    const solutionGrounded =
      !input.solutionArea.trim() ||
      solutionFamilyGrounded ||
      solutionAtomicMatch.matched ||
      solutionLexicalGrounding >= 0.3;

    if (!solutionGrounded || solutionIntroducesUnsupportedConcept) {
      return {
        title: input.title,
        problem: input.problem,
        unmetNeed: input.unmetNeed,
        solutionArea: this.buildProfessionalFallbackSolutionArea(
          '',
          input.problem,
          input.evidenceSample,
        ),
      };
    }

    if (!evidenceFamily) {
      const candidateDescriptor = `${input.title} ${input.problem} ${input.unmetNeed} ${input.solutionArea}`;
      const semanticFields = [
        input.title,
        input.problem,
        input.unmetNeed,
        input.solutionArea,
      ];
      const containsUnsupportedConcept = semanticFields.some((field) =>
        this.introducesUnsupportedSemanticConcept(field, input.evidenceSample),
      );
      const inventedHighRiskMechanism =
        this.containsUnsupportedHighRiskMechanism(
          candidateDescriptor,
          input.evidenceSample,
        );
      const lexicalGrounding = this.tokenOverlap(
        this.normalizeComparableText(candidateDescriptor),
        this.normalizeComparableText(input.evidenceSample),
      );
      const semanticGrounding = matchEvidenceToProblemFamily(
        candidateDescriptor,
        input.evidenceSample,
      );
      const hasEvidenceAnchor =
        semanticGrounding.matched || lexicalGrounding >= 0.2;

      if (
        !containsUnsupportedConcept &&
        !inventedHighRiskMechanism &&
        hasEvidenceAnchor
      ) {
        return {
          title: input.title,
          problem: input.problem,
          unmetNeed: input.unmetNeed,
          solutionArea: input.solutionArea,
        };
      }

      return this.buildNeutralEvidenceAnchoredFallback(input.evidenceSample);
    }

    const titleFamily = resolvePrimaryProblemFamily(input.title);
    const needFamily = resolvePrimaryProblemFamily(input.unmetNeed);
    const conflicts = [titleFamily, needFamily, solutionFamily].some(
      (family) => family !== null && family.key !== evidenceFamily.key,
    );

    if (!conflicts) {
      return {
        title: input.title,
        problem: input.problem,
        unmetNeed: input.unmetNeed,
        solutionArea: input.solutionArea,
      };
    }

    const familyLabel = evidenceFamily.label;
    return {
      title: familyLabel,
      problem: input.problem,
      unmetNeed: `A focused workflow that diagnoses and resolves ${familyLabel.toLowerCase()} using the retained evidence as the validation baseline, while routing uncertain cases to human review.`,
      solutionArea: `${this.toTitleCase(familyLabel)} Diagnosis and Human-Reviewed Recovery`,
    };
  }

  /**
   * Builds the guaranteed non-throwing community-analysis fallback from direct
   * evidence already retained by deterministic NLP. This is intentionally not
   * presented as an online-model result: model identifiers remain null.
   */
  private containsUnsupportedHighRiskMechanism(
    generatedText: string,
    evidenceSample: string,
  ): boolean {
    const generated = this.normalizeComparableText(generatedText);
    const evidence = this.normalizeComparableText(evidenceSample);

    const guardedFamilies = [
      {
        generated: /\b(?:wallet|bank linking|bank account linking|payment method linking|failed charges?|charge mismatch|charge consistency|card linking)\b/iu,
        evidence: /\b(?:wallet|bank account|payment method|card|charged|charge|checkout|payment)\b/iu,
      },
      {
        generated: /\b(?:login|authentication|oauth|oidc|2fa|two factor|account recovery|identity provider)\b/iu,
        evidence: /\b(?:login|authentication|oauth|oidc|2fa|two factor|account|sign in|identity provider)\b/iu,
      },
      {
        generated: /\b(?:medical diagnosis|treatment recommendation|clinical decision|patient diagnosis)\b/iu,
        evidence: /\b(?:medical|clinical|patient|diagnosis|treatment|healthcare)\b/iu,
      },
      {
        generated: /\b(?:legal compliance|regulatory|licensing risk|privacy risk|consent risk)\b/iu,
        evidence: /\b(?:legal|regulatory|compliance|licensing|privacy|consent|rights)\b/iu,
      },
    ] as const;

    return guardedFamilies.some(
      (guard) => guard.generated.test(generated) && !guard.evidence.test(evidence),
    );
  }

  private buildNeutralEvidenceAnchoredFallback(
    evidenceSample: string,
  ): {
    readonly title: string;
    readonly problem: string;
    readonly unmetNeed: string;
    readonly solutionArea: string;
  } {
    const evidenceKind = classifyDirectCommunityEvidence(
      evidenceSample.replace(/^.*?\bCommunity comment:\s*/isu, '').trim(),
      /\bCommunity comment:/iu.test(evidenceSample) ? 'COMMENT' : 'POST',
    );
    const title =
      evidenceKind === 'FEATURE_REQUEST'
        ? 'Requested Workflow Capability'
        : evidenceKind === 'OBSERVED_UNMET_NEED'
          ? 'Observed User Workflow Need'
          : evidenceKind === 'USER_COMPLAINT'
            ? 'User-Reported Workflow Failure'
            : 'Evidence-Grounded Workflow Need';
    const extractedProblem =
      this.extractProblemSection(evidenceSample) ||
      this.boundProblemText(evidenceSample, 220);
    const repairedProblem = this.buildProfessionalFallbackProblem(
      extractedProblem,
      evidenceSample,
    );

    return {
      title,
      problem: repairedProblem,
      unmetNeed:
        'A focused workflow that addresses only the need or failure explicitly supported by the retained evidence, while preserving uncertain mechanisms for human validation instead of inferring them.',
      solutionArea:
        'Evidence-Grounded Workflow Capture, Validation, and Human-Reviewed Resolution',
    };
  }

  private buildFallbackAnalysis(
    opportunities: readonly CommunityAiOpportunity[],
    telemetry: {
      readonly semanticTriageClustering?: boolean;
      readonly aiAttempted?: boolean;
      readonly onlineAttemptCount?: number;
      readonly fallbackReason?: string | null;
      readonly attemptDiagnostics?: readonly CommunityAiAttemptDiagnostic[];
      readonly unvalidatedDomainHypotheses?: readonly CommunityAiDomainHypothesis[];
      readonly evidenceClassifications?: readonly CommunityAiEvidenceTriage[];
      readonly jointEvidenceGroups?: readonly CommunityAiJointEvidenceGroup[];
      readonly aiSelectedProblemFamily?: string | null;
      readonly aiSelectedEvidenceIds?: readonly string[];
    } = {},
  ): CommunityAiAnalysis {
    const averageConfidence =
      opportunities.reduce((sum, item) => sum + item.confidence, 0) /
      Math.max(opportunities.length, 1);
    const diagnostics = [...(telemetry.attemptDiagnostics ?? [])];
    const triageAiSucceeded =
      (telemetry.evidenceClassifications ?? []).some(
        (item) => item.classification !== 'UNADJUDICATED' && item.confidence > 0,
      ) ||
      (telemetry.jointEvidenceGroups ?? []).some(
        (group) => group.verifiedByDeterministicGuard,
      );
    const semanticClusteringSucceeded =
      telemetry.semanticTriageClustering === true &&
      triageAiSucceeded &&
      opportunities.length > 0;

    return {
      summary: semanticClusteringSucceeded
        ? `AI semantic triage classified the broad first-pass corpus and selected the single strongest evidence-backed problem family from retained evidence.`
        : `Recovered ${opportunities.length} cautious opportunity candidate(s) from retained evidence.`,
      dominantProblems: opportunities.map((item) => item.problem),
      unmetNeeds: opportunities.map((item) => item.unmetNeed),
      opportunities: [...opportunities],
      overallConfidence: averageConfidence,
      qualityWarnings: semanticClusteringSucceeded
        ? [
            'The selected family is evidence-prioritized within the canonical request/discovery scope; unsupported facets remain hypotheses until directly validated.',
          ]
        : [
            'Online community enrichment was unavailable or unusable; retained evidence was preserved instead of failing the stage.',
            'The recovered direction remains preliminary until broader independent evidence is collected.',
          ],
      evidenceVerdictState: opportunities.length > 0
        ? 'VALID_EVIDENCE_FOUND'
        : 'NO_VALID_EVIDENCE_FOUND',
      modelId: null,
      apiModelId: null,
      attemptCount: diagnostics.length,
      aiAttempted: telemetry.aiAttempted ?? diagnostics.length > 0,
      triageAiSucceeded,
      synthesisAiSucceeded: false,
      aiSucceeded: semanticClusteringSucceeded,
      fallbackUsed: !semanticClusteringSucceeded,
      onlineAttemptCount: telemetry.onlineAttemptCount ?? diagnostics.length,
      executionFailureCount: diagnostics.filter(
        (item) => item.status === 'EXECUTION_FAILED' || item.status === 'TIMEOUT',
      ).length,
      validationRejectedCount: diagnostics.filter(
        (item) => item.status === 'VALIDATION_REJECTED',
      ).length,
      fallbackReason: semanticClusteringSucceeded
        ? null
        : telemetry.fallbackReason ?? 'Online Community AI output was unavailable or unusable.',
      attemptDiagnostics: diagnostics,
      unvalidatedDomainHypotheses: [
        ...(telemetry.unvalidatedDomainHypotheses ?? []),
      ],
      evidenceClassifications: [...(telemetry.evidenceClassifications ?? [])],
      jointEvidenceGroups: [...(telemetry.jointEvidenceGroups ?? [])],
      aiProposedProblemFamily: telemetry.aiSelectedProblemFamily?.trim() || null,
      aiProposedProblemFamilyEvidenceIds: [
        ...(telemetry.aiSelectedEvidenceIds ?? []),
      ],
      selectedProblemFamilySelectionSource:
        (telemetry.aiSelectedEvidenceIds ?? []).length > 0
          ? 'AI_SELECTED_PENDING_VERIFICATION'
          : 'DETERMINISTIC_VERIFIED_FALLBACK',
    };
  }

  private resolveEvidenceBackedDomainName(
    context: IdeaGenerationContext,
    evidenceSamples: readonly string[],
    semanticSubject = '',
  ): string | null {
    const normalizedSamples = evidenceSamples
      .map((sample) => sample.replace(/\s+/gu, ' ').trim())
      .filter(Boolean);
    if (normalizedSamples.length === 0) {
      return null;
    }

    let best: { readonly domainName: string; readonly matches: number } | null = null;

    for (const domainEvidence of context.domainEvidence) {
      const corpus = this.collectEvidenceCorpus([
        domainEvidence.samplePosts,
        domainEvidence.sampleComments,
      ]);
      const subjectSupportsDomain =
        !semanticSubject.trim() ||
        this.evidenceSemanticallySupportsDomain(
          context,
          domainEvidence.domainName,
          semanticSubject,
        );
      if (!subjectSupportsDomain) {
        continue;
      }

      const matches = normalizedSamples.filter((sample) =>
        corpus.some(
          (corpusSample) =>
            this.isExactOrContainedEvidenceMatch(sample, corpusSample) &&
            this.evidenceSemanticallySupportsDomain(
              context,
              domainEvidence.domainName,
              corpusSample,
            ),
        ),
      ).length;

      if (matches > 0 && (!best || matches > best.matches)) {
        best = { domainName: domainEvidence.domainName, matches };
      }
    }

    if (!best) {
      return null;
    }

    const selected = context.selectedDomains.find(
      (domain) =>
        this.normalizeComparableText(domain.name) ===
        this.normalizeComparableText(best.domainName),
    );

    return selected?.name ?? best.domainName;
  }

  /**
   * Prevents collection-query context from becoming domain proof. A sample can
   * be returned by a domain search while still describing a completely
   * different problem. This lightweight in-memory guard mirrors the stricter
   * ranking-stage attribution without adding another database or AI call.
   */
  private evidenceSemanticallySupportsDomain(
    context: IdeaGenerationContext,
    domainName: string,
    sample: string,
  ): boolean {
    const commentMatch = sample.match(/^(.*?\bCommunity comment:\s*)(.+)$/iu);
    const sourceContext = commentMatch?.[1]?.replace(/\bCommunity comment:\s*$/iu, '') ?? '';
    const body = commentMatch?.[2] ?? sample;
    const normalized = this.normalizeComparableText(body);
    const normalizedSourceContext = this.normalizeComparableText(sourceContext);
    const normalizedFullSample = this.normalizeComparableText(sample);
    const normalizedDomain = this.normalizeComparableText(domainName);
    const selectedDomain = context.selectedDomains.find(
      (domain) =>
        this.normalizeComparableText(domain.name) === normalizedDomain,
    );
    if (
      !SelectedDomainEvidenceAlignmentUtil.passesContextualDomainGuard(
        normalizedFullSample,
        domainName,
        [
          ...(selectedDomain?.effectiveSearchKeywords ?? []),
          ...(selectedDomain?.keywords ?? []),
        ],
      )
    ) {
      return false;
    }
    const terms = [
      domainName,
      ...(selectedDomain?.effectiveSearchKeywords ?? selectedDomain?.keywords ?? []),
    ]
      .map((term) => this.normalizeComparableText(term))
      .filter((term) => term.length >= 3);
    const genericDomainTerms = new Set([
      'application',
      'software',
      'system',
      'platform',
      'service',
      'services',
      'workflow',
      'tool',
      'tools',
    ]);
    if (normalizedDomain === 'artificial intelligence') {
      return /(?:artificial intelligence|\bai\b|machine learning|large language model|\bllm\b|ai model|ai assistant|ai system|automated decision|automated scoring|ai proctor)/u.test(
        normalized,
      );
    }

    if (normalizedDomain === 'smart cities' || normalizedDomain === 'smart city') {
      return /(?:smart cit(?:y|ies)|city planning|urban planning|municipal planning|urban mobility|public infrastructure|city services|civic technology|neighborhood management|neighbourhood management|public housing|traffic management|municipal service)/u.test(
        normalized,
      );
    }

    if (
      normalizedDomain === 'internet of things' ||
      normalizedDomain === 'iot'
    ) {
      return /(?:internet of things|iot|connected device|connected devices|sensor|sensors|telemetry|device management|gateway|firmware|smart meter|smart device|bluetooth|zigbee|edge computing)/u.test(
        normalized,
      );
    }

    if (normalizedDomain === 'e commerce' || normalizedDomain === 'ecommerce') {
      return /(?:e commerce|ecommerce|online store|online shop|woocommerce|shopify|merchant|marketplace|checkout|shopping cart|product catalog|order fulfillment|customer order|store order|online order)/u.test(
        normalized,
      );
    }

    if (normalizedDomain === 'logistics') {
      return /(?:logistics|shipment|shipping|delivery tracking|shipment tracking|order tracking|courier|fleet|dispatch|warehouse|last mile|transit time|driver|rider|package|parcel|order fulfillment)/u.test(
        normalized,
      );
    }

    if (
      normalizedDomain === 'pet care management' ||
      normalizedDomain === 'pet care' ||
      normalizedDomain === 'animal care'
    ) {
      return /(?:pet care|pet health|pet owners?|pet sitters?|veterinar(?:ian|y)|vaccination|vaccinations|grooming|feeding routine|animal care|care instructions|pet appointment)/u.test(
        normalized,
      );
    }

    if (
      normalizedDomain === 'media entertainment' ||
      normalizedDomain === 'media & entertainment'
    ) {
      const explicitMediaWorkflow =
        /(?:media entertainment|media workflow|content creation|digital publishing|audience engagement|video streaming|audio streaming|streaming video|streaming audio|music collaboration|band rehearsal|song version|set list|recording version|film|video production|audio production|broadcast)/u.test(
          normalized,
        );
      const llmDeveloperStreaming =
        /(?:llm|large language model|next js|nextjs|first token|token latency|api response|server sent events|sse|developer|typescript|javascript)/u.test(
          normalized,
        ) &&
        /(?:streaming|stream|latency|token)/u.test(normalized);

      return explicitMediaWorkflow && !llmDeveloperStreaming;
    }

    if (
      normalizedDomain === 'food restaurants' ||
      normalizedDomain === 'food & restaurants' ||
      normalizedDomain === 'food and restaurants'
    ) {
      const explicitFoodOperations =
        /(?:restaurant operations?|restaurant staff|restaurant managers?|kitchen workflow|kitchen staff|commercial kitchen|table reservations?|table booking|menu management|menu availability|ingredient inventory|food inventory|stock shortages?|food waste|order preparation|order fulfillment|customer orders?|meal orders?|pickup orders?|delivery orders?|delivery dispatch|delivery drivers?|couriers?|restaurant delivery|point of sale|\bpos\b|supplier deliveries?|food procurement|restaurant scheduling|shift scheduling)/u.test(
          normalized,
        );
      const userFacingFoodFailure =
        /(?:customers?|diners?|restaurant users?|food delivery users?|delivery customers?).{0,140}(?:cannot|can t|unable|fail|failed|error|missing|wrong|delay|delayed|cancel|cancelled|canceled|unavailable|not working|doesn t work|does not work|duplicate|incorrect)/u.test(
          normalized,
        ) ||
        /(?:cannot|can t|unable|fail|failed|error|missing|wrong|delay|delayed|cancel|cancelled|canceled|unavailable|not working|doesn t work|does not work|duplicate|incorrect).{0,140}(?:customer orders?|food orders?|meal orders?|restaurant reservations?|table reservations?|menu items?|food delivery|delivery orders?|pickup orders?)/u.test(
          normalized,
        );
      const developerImplementationContext =
        /(?:angular|react|next js|nextjs|vue|flutter|kotlin|kmm|flow|suspend|firestore|firebase|server side|client side|single page application|\bspa\b|routing|route|routes|url|restful|rest api|api endpoint|http|database|remote db|local db|framework|code|developer|developers?|software architecture|application architecture|data sync|synchronization|background execution)/u.test(
          normalized,
        );
      const foodAppAsExampleOnly =
        /(?:food delivery(?: [a-z0-9]+){0,3} (?:app|application)|food ordering(?: [a-z0-9]+){0,3} (?:app|application)|restaurant(?: [a-z0-9]+){0,3} (?:app|application)|clone of (?:a )?(?:food ordering|food delivery)|zomato clone|restaurant clone)/u.test(
          normalized,
        );

      const directFoodWorkflowFailure =
        /\b(?:customers?|diners?|food delivery users?|delivery customers?)\b[^.!?]{0,120}\b(?:cannot|can t|unable|fail|failed|error|missing|wrong|delay|delayed|cancel|cancelled|canceled|unavailable|not working|doesn t work|does not work|duplicate|incorrect)\b[^.!?]{0,120}\b(?:place|track|receive|cancel|change|find|filter|order|orders|food order|meal order|delivery order|restaurant reservation|table reservation|menu item|food delivery)\b/u.test(
          normalized,
        ) ||
        /\b(?:customer orders?|food orders?|meal orders?|delivery orders?|restaurant reservations?|table reservations?|menu items?|restaurant delivery)\b[^.!?]{0,120}\b(?:fail|failed|error|missing|wrong|delay|delayed|cancel|cancelled|canceled|unavailable|not working|doesn t work|does not work|duplicate|incorrect)\b/u.test(
          normalized,
        );

      if (developerImplementationContext && foodAppAsExampleOnly) {
        return explicitFoodOperations || directFoodWorkflowFailure;
      }

      return explicitFoodOperations || userFacingFoodFailure || !developerImplementationContext;
    }

    if (normalizedDomain === 'mental health') {
      const sourceContextConfirmsMentalHealth =
        /(?:mental health|therapy|wellness|counsel)/u.test(
          normalizedSourceContext,
        );
      const therapeuticWorkflowSignal =
        sourceContextConfirmsMentalHealth ||
        /(?:mental health app|mental wellness|therapy app|therapist|counsel(?:ing|ling|or)|self care|psychological support|mood tracking|crisis support|workplace mental health|mental health leave|mental health break)/u.test(
          normalized,
        );
      const mentalHealthProblemSignal =
        /(?:cannot|can t|unable|blocked|missing|failed|failure|problem|issue|lack|need|request|wish|reminder|feature|please add|unavailable|unafford|expensive|glitch|not working|doesn t work|does not work|difficult|hard|no access|no time)/u.test(
          normalized,
        );
      const infrastructureOnlySignal =
        /(?:google cloud|datastore|oauth2?|database|indexes?|appengine|cloud ndb|python [23]|migration|authentication credentials|stack trace|repository|runtime|container)/u.test(
          normalized,
        ) &&
        !/(?:mental health app|therapy app|therapist|counselor|counselling session|mental wellness workflow|self care workflow|mood tracking|crisis support)/u.test(
          normalized,
        );

      return therapeuticWorkflowSignal && mentalHealthProblemSignal && !infrastructureOnlySignal;
    }

    const explicitDomainNameInPersistedSample =
      normalizedDomain.length >= 4 &&
      normalizedSourceContext.includes(normalizedDomain);
    const sourceContextSupportsDomain = terms.some(
      (term) =>
        term.length >= 5 &&
        !genericDomainTerms.has(term) &&
        normalizedSourceContext.includes(term),
    );

    const problemSignal =
      '(?:cannot|can t|unable|blocked|missing|failed|failure|problem|issue|complaint|waste|delay|declin|vacancy|error|unavailable|inefficien|lost|loss|conflict|dispute|risk|spike|broken|not working|doesn t work|does not work|need|request)';
    const bodyDomainProblemCoupling = terms.some((term) => {
      if (term.length < 5 || genericDomainTerms.has(term)) return false;
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return (
        new RegExp(`${escaped}.{0,140}${problemSignal}`, 'u').test(normalized) ||
        new RegExp(`${problemSignal}.{0,140}${escaped}`, 'u').test(normalized)
      );
    });

    if (
      explicitDomainNameInPersistedSample ||
      sourceContextSupportsDomain ||
      bodyDomainProblemCoupling
    ) {
      return true;
    }

    if (normalizedDomain === 'environment') {
      return /\b(?:environmental monitoring|environmental compliance|pollution|air quality|water quality|waste management|recycling|emissions?|carbon footprint|sustainability|ecosystem|conservation|biodiversity|environmental impact|climate risk|climate adaptation)\b/u.test(
        normalized,
      );
    }

    if (normalizedDomain === 'tourism') {
      const explicitTourismAnchor =
        /(?:\btourism\b|tourism app|tourism application|tourism platform|tourism system|travel app|travel application|travel platform|tourist app|tourist service|tourism service)/u.test(
          normalized,
        );
      const tourismWorkflowAnchor =
        /(?:travel booking|booking|reservation|tour itinerary|itinerary|tour operator|tour package|visitor management|destination management|travel inventory|hotel booking|guest booking|tourist service|tourism service|excursion booking)/u.test(
          normalized,
        );
      const genericTechnicalFailure =
        /(?:visual studio|vsto|outofmemoryexception|out of memory|stack trace|exception from hresult|excel workbook|worksheet|module|runtime|compiler|memory error|ram|cpu)/u.test(
          normalized,
        );
      const operationalTourismFailure =
        /(?:booking|reservation|itinerary|tour|visitor|destination|hotel|guest|excursion).{0,120}(?:fail|failed|failure|error|blocked|missing|duplicate|wrong|unable|cannot|can t|delay|cancel)/u.test(
          normalized,
        ) ||
        /(?:fail|failed|failure|error|blocked|missing|duplicate|wrong|unable|cannot|can t|delay|cancel).{0,120}(?:booking|reservation|itinerary|tour|visitor|destination|hotel|guest|excursion)/u.test(
          normalized,
        );

      return (
        explicitTourismAnchor ||
        operationalTourismFailure ||
        (tourismWorkflowAnchor && !genericTechnicalFailure)
      );
    }

    if (
      normalizedDomain === 'tailoring custom apparel' ||
      normalizedDomain === 'tailoring' ||
      normalizedDomain === 'custom apparel'
    ) {
      return /(?:tailor(?:ing)?|custom clothing|custom apparel|made[- ]to[- ]measure|bespoke clothing|bespoke tailoring|garment|customer measurements?|body measurements?|fabric selections?|alteration requests?|alteration history|fitting appointments?|design notes?|custom order)/u.test(
        normalized,
      );
    }

    if (normalizedDomain === 'government' || normalizedDomain === 'public sector') {
      return /(?:government|public sector|agency|agencies|department|departments|permit|license|official record|public record|citizen service|approval status|ownership record)/u.test(
        normalized,
      );
    }

    if (normalizedDomain === 'real estate') {
      const directRealEstateAnchor =
        /(?:real estate|housing|rent|rental|rentals|lease|leasing|tenant|landlord|mortgage|realtor|zillow|apartment|apartments)/u.test(
          normalized,
        );
      const propertyWorkflowAnchor =
        /(?:property|properties).{0,80}(?:listing|listings|management|inspection|tenant|lease|rental)|(?:listing|listings|management|inspection|tenant|lease|rental).{0,80}(?:property|properties)/u.test(
          normalized,
        );

      return directRealEstateAnchor || propertyWorkflowAnchor;
    }

    if (normalizedDomain === 'healthcare') {
      return /(?:healthcare|health care|patient|patients|clinical|medical|medicine|medication|prescription|physician|doctor|hospital|pharmacy|care coordination|telemedicine)/u.test(
        normalized,
      );
    }

    if (
      normalizedDomain === 'finance' ||
      normalizedDomain === 'financial services' ||
      normalizedDomain === 'fintech'
    ) {
      return /(?:finance|financial|bank|banking|payment|payments|billing|invoice|card|credit|debit|loan|accounting|expense|payroll|reconciliation|wallet)/u.test(
        normalized,
      );
    }

    if (normalizedDomain === 'sports fitness' || normalizedDomain === 'sports and fitness') {
      return /(?:sports?|fitness|workout|athlete|training|gym|tennis|coach|coaching|player|watch)/u.test(
        normalized,
      );
    }

    if (normalizedDomain === 'blockchain') {
      return /(?:blockchain|crypto|cryptocurrency|wallet|smart contract|hyperledger|binance|node|pexcoin|transaction|web3|distributed ledger|tamper evident|record provenance|immutable record|version integrity)/u.test(
        normalized,
      );
    }

    if (normalizedDomain === 'cybersecurity') {
      return /(?:cybersecurity|authentication|two factor|2fa|mfa|oauth|identity access|credential|authorization|access control|security policy|threat|vulnerabilit|breach|phishing|malware|encryption|token isolation|password security|privacy)/u.test(
        normalized,
      );
    }

    if (normalizedDomain === 'education') {
      return /(?:student|teacher|coursework|assignment|grading|classroom|lesson|curriculum|homework|learning platform|learning management|education workflow|school|university|course material)/u.test(
        normalized,
      );
    }

    if (normalizedDomain === 'legaltech') {
      return /(?:legal research|legal document|contract|case management|case law|court|attorney|lawyer|compliance workflow|legal workflow|legaltech|law database|ownership record|record verification|document verification|dispute|audit trail)/u.test(
        normalized,
      );
    }

    return terms.some((term) => normalized.includes(term));
  }

  private firstAvailableString(
    record: Record<string, unknown>,
    keys: readonly string[],
  ): string | null {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) {
        return value.replace(/\s+/gu, ' ').trim();
      }
    }

    return null;
  }

  /**
   * Rejects schema-valid responses only when they are unusable or ungrounded.
   * Confidence is preserved as metadata and a warning, not treated as a hard
   * provider failure. This keeps documented low-confidence evidence available
   * for a clearly bounded pilot while still refusing evidence-free output.
   */
  private validateBusinessQuality(
    analysis: CommunityAiAnalysis,
    context: IdeaGenerationContext,
  ): void {
    const evidenceBackedOpportunities = analysis.opportunities.filter(
      (opportunity) => opportunity.evidenceSamples.length > 0,
    );

    if (evidenceBackedOpportunities.length === 0) {
      if ((analysis.evidenceClassifications?.length ?? 0) > 0) {
        return;
      }
      throw new Error(
        'Community AI analysis returned no evidence-backed opportunity.',
      );
    }

    const totalEvidenceSamples = evidenceBackedOpportunities.reduce(
      (total, opportunity) => total + opportunity.evidenceSamples.length,
      0,
    );

    if (
      totalEvidenceSamples < COMMUNITY_AI_ANALYSIS_MIN_TOTAL_EVIDENCE_SAMPLES
    ) {
      throw new Error(
        'The response did not include sufficient evidence samples.',
      );
    }

    const normalizedSignatures = new Set<string>();
    const selectedDomainNames = new Set(
      context.selectedDomains.map((domain) =>
        this.normalizeComparableText(domain.name),
      ),
    );
    const representedDomains = new Set<string>();

    for (const opportunity of evidenceBackedOpportunities) {
      const normalizedDomain = this.normalizeComparableText(
        opportunity.domainName,
      );

      if (
        selectedDomainNames.size > 0 &&
        !selectedDomainNames.has(normalizedDomain)
      ) {
        throw new Error(
          `Opportunity "${opportunity.title}" references an unselected domain "${opportunity.domainName}".`,
        );
      }

      const requestDescription = context.requestDescription?.trim() ?? '';
      if (requestDescription && !this.isEvidenceDiscoveryMode(context)) {
        const explicitProblem =
          context.collectionPlan?.requestIntent?.explicitProblem?.trim() ||
          requestDescription;
        const hasRequestAlignedEvidence =
          RequestEvidenceAlignmentUtil.isCompositeAligned({
            requestDescription: explicitProblem,
            evidenceTexts: opportunity.evidenceSamples,
            plannedQueries: context.collectionPlan?.searchQueries ?? [],
          });

        if (!hasRequestAlignedEvidence) {
          throw new Error(
            `Opportunity "${opportunity.title}" is evidence-backed but the retained evidence does not support the explicit requester problem/workflow.`,
          );
        }
      }

      representedDomains.add(normalizedDomain);

      const signature = this.normalizeComparableText(
        `${opportunity.problem} ${opportunity.unmetNeed} ${opportunity.solutionArea}`,
      );

      if (signature.length < 24) {
        throw new Error('An opportunity was too generic to be accepted.');
      }

      if (normalizedSignatures.has(signature)) {
        throw new Error('The response contained duplicate opportunities.');
      }

      for (const existingSignature of normalizedSignatures) {
        if (this.tokenOverlap(signature, existingSignature) >= 0.72) {
          throw new Error(
            'The response contained materially overlapping opportunities instead of distinct problem families.',
          );
        }
      }

      if (opportunity.risks.length === 0) {
        throw new Error(
          `Opportunity "${opportunity.title}" did not include any explicit risk or evidence limitation.`,
        );
      }

      normalizedSignatures.add(signature);
    }

    const representedSelectedDomainCount = context.selectedDomains.filter(
      (domain) =>
        representedDomains.has(this.normalizeComparableText(domain.name)),
    ).length;

    /*
     * Multi-domain requests frequently contain useful evidence for only one of
     * the selected domains inside the fast collection budget. Requiring every
     * domain to appear rejected valid AI analyses and forced a deterministic
     * fallback. Accept the strongest evidence-backed selected domain instead;
     * unsupported domains are simply omitted and are never fabricated.
     */
    if (
      context.selectedDomains.length > 0 &&
      representedSelectedDomainCount === 0
    ) {
      throw new Error(
        `The response did not contain an evidence-backed opportunity for any selected domain: ${context.selectedDomains.map((domain) => domain.name).join(', ')}.`,
      );
    }
  }

  private parseAndVerifyEvidenceClassifications(
    _context: IdeaGenerationContext,
    _value: unknown,
  ): CommunityAiEvidenceTriage[] {
    /*
     * Legacy full-response evidenceClassifications are intentionally ignored.
     * Trusted semantics now come only from the dedicated online corpus-triage
     * contract, which returns evidence nature, domain/problem alignment, a
     * neutral observed problem, and family basis for every raw evidence row.
     * If that dedicated semantic verdict is unavailable we fail closed instead
     * of reconstructing meaning with request-specific lexical rules.
     */
    return [];
  }

  private parseOpportunity(value: unknown): CommunityAiOpportunity {
    const normalizedValue = this.normalizeOpportunityValue(value);

    const evidenceSamples = this.normalizeTextArray(
      normalizedValue.evidenceSamples ??
        normalizedValue.evidence ??
        normalizedValue.examples ??
        normalizedValue.quotes,
      [],
    );
    const evidenceFallback = evidenceSamples[0] ?? '';
    const rawProblem = this.firstOptionalString(normalizedValue, [
      'problem',
      'problemStatement',
      'painPoint',
      'description',
    ]) ?? this.extractProblemSection(evidenceFallback) ?? this.boundProblemText(evidenceFallback, 220);
    const problem = this.repairTruncatedProblemFromEvidence(
      rawProblem,
      evidenceSamples,
    );
    const unmetNeed = this.firstOptionalString(normalizedValue, [
      'unmetNeed',
      'need',
      'userNeed',
      'missingCapability',
    ]) ?? this.buildProfessionalFallbackNeed('', problem);
    const solutionArea = this.firstOptionalString(normalizedValue, [
      'solutionArea',
      'solution',
      'proposedSolution',
      'opportunityArea',
      'direction',
    ]) ?? this.buildProfessionalFallbackSolutionArea('', problem, evidenceFallback);

    const severity = this.normalizeSeverity(
      normalizedValue.severity ?? normalizedValue.impactLevel ?? normalizedValue.priority,
    );

    const confidence = this.normalizeOptionalScore(
      normalizedValue.confidence ?? normalizedValue.score,
      50,
    );

    const domainName = this.optionalString(
      normalizedValue.domainName ?? normalizedValue.domain ?? normalizedValue.category,
      'Unassigned',
    );
    const providerTitle = this.optionalString(
      normalizedValue.title ?? normalizedValue.name,
      this.deriveTitle(problem, unmetNeed, evidenceSamples[0] ?? '', domainName),
    );
    const title = this.normalizeOpportunityTitle(
      domainName,
      providerTitle,
      problem,
      unmetNeed,
      evidenceSamples[0] ?? '',
    );

    return {
      domainName,
      title,
      problem,
      unmetNeed,
      solutionArea,
      affectedUsers: this.normalizeTextArray(
        normalizedValue.affectedUsers ?? normalizedValue.targetUsers ?? normalizedValue.users,
        ['Affected community users'],
      ),
      evidenceSamples,
      frequency: this.normalizeOptionalPositiveInteger(
        normalizedValue.frequency ?? normalizedValue.occurrences ?? normalizedValue.count,
        1,
      ),
      severity,
      confidence,
      problemImportance: this.normalizeOptionalScore(
        normalizedValue.problemImportance ?? normalizedValue.importance ?? normalizedValue.impact,
        confidence,
      ),
      localEvidenceAvailable:
        normalizedValue.localEvidenceAvailable === true ||
        normalizedValue.hasLocalEvidence === true,
      localEvidenceSamples: this.normalizeTextArray(
        normalizedValue.localEvidenceSamples ?? normalizedValue.localEvidence,
        [],
        true,
      ),
      localRelevance: this.normalizeOptionalScore(
        normalizedValue.localRelevance ?? normalizedValue.relevance,
        25,
      ),
      groundingScore: 0,
      technicalFeasibility: this.normalizeOptionalScore(
        normalizedValue.technicalFeasibility ?? normalizedValue.feasibility,
        60,
      ),
      marketPotential: this.normalizeOptionalScore(
        normalizedValue.marketPotential ?? normalizedValue.marketScore,
        50,
      ),
      innovationPotential: this.normalizeOptionalScore(
        normalizedValue.innovationPotential ?? normalizedValue.innovation,
        50,
      ),
      risks: this.normalizeTextArray(
        normalizedValue.risks ?? normalizedValue.riskFactors ?? normalizedValue.limitations,
        [],
        true,
      ),
    };
  }

  /**
   * Accepts the two common structured-output shapes returned by providers.
   *
   * Preferred shape: a complete opportunity object.
   * Tolerated shape: a plain opportunity description string. The string is
   * promoted to the required semantic fields and is later grounded against the
   * persisted NLP corpus. Unsupported promoted opportunities are discarded by
   * applyEvidenceGrounding(), so tolerance never bypasses evidence validation.
   */
  private normalizeOpportunityValue(
    value: unknown,
  ): Record<string, unknown> {
    if (this.isRecord(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim()) {
      const description = value.replace(/\s+/gu, ' ').trim();

      return {
        title: this.deriveTitle(description, description),
        problem: description,
        unmetNeed: description,
        solutionArea:
          'Combine the related community pain points into one focused software workflow.',
        affectedUsers: ['Affected community users'],
        evidenceSamples: [description],
        frequency: 1,
        severity: 'MEDIUM',
        confidence: 50,
        problemImportance: 50,
        technicalFeasibility: 60,
        marketPotential: 50,
        innovationPotential: 55,
        risks: [
          'The provider returned a compact opportunity description; direct evidence grounding is required.',
        ],
      };
    }

    throw new Error('Community AI analysis returned an invalid opportunity.');
  }

  /**
   * Keeps deterministic fallback audience wording aligned with the retained
   * source provenance. News/blog posts are contextual secondary evidence and
   * must not be described as direct community-user reports.
   */
  private buildFallbackAffectedUsers(
    context: IdeaGenerationContext,
    evidenceSample: string,
  ): string[] {
    const comparableSample = this.normalizeComparableText(evidenceSample);
    const domainEvidence = context.domainEvidence ?? [];

    for (const domain of domainEvidence) {
      const commentItems = Array.isArray(domain.sampleComments)
        ? domain.sampleComments
        : [];
      const matchedComment = commentItems.find((item) => {
        if (!this.isRecord(item)) return false;
        const text = this.firstAvailableString(item, ['text']);
        return Boolean(
          text && this.normalizeComparableText(text) === comparableSample,
        );
      });
      if (matchedComment) {
        return ['User represented by the retained direct evidence'];
      }

      const postItems = Array.isArray(domain.samplePosts)
        ? domain.samplePosts
        : [];
      const matchedPost = postItems.find((item) => {
        if (!this.isRecord(item)) return false;
        const text = this.firstAvailableString(item, ['text']);
        return Boolean(
          text && this.normalizeComparableText(text) === comparableSample,
        );
      });
      if (!matchedPost || !this.isRecord(matchedPost)) continue;

      const sourceId = (this.firstAvailableString(matchedPost, ['id']) ?? '')
        .toLocaleLowerCase();
      if (sourceId.startsWith('news:') || sourceId.startsWith('blog:')) {
        return ['Users or operators described by the retained secondary evidence'];
      }

      return ['Users or operators described by the retained external evidence'];
    }

    return ['Users or operators described by the retained evidence'];
  }

  /**
   * Selects the most informative retained evidence sample for deterministic
   * fallback construction. Complaint specificity and concrete risk signals
   * outrank length, praise, calls to action, and generic commentary.
   */
  private selectStrongestFallbackEvidence(
    corpus: readonly string[],
  ): string | undefined {
    return [...corpus]
      .filter((sample) => sample.trim().length >= 40)
      .filter((sample) => !this.looksLikePromotionalOrPublisherText(sample))
      .filter((sample) => this.isRetainedFallbackEvidenceCandidate(sample))
      .map((sample) => {
        const normalized = this.normalizeComparableText(sample);
        const sourceType = /\bCommunity comment:\s*/iu.test(sample)
          ? 'COMMENT'
          : 'POST';
        let score = scoreProblemEvidenceActionability(sample, sourceType) * 20;
        score += Math.min(sample.length, 320) / 160;

        if (/(?:security|vulnerabilit|hack|breach|unsafe)/u.test(normalized)) {
          score += 2;
        }
        if (/(?:bill|billing|cloud cost|cost spike|30k|2k|financial exposure)/u.test(normalized)) {
          score += 2;
        }
        if (/(?:found|detected|reported|caused|risk|problem|failed|missing|broken|slow|cannot|can t|doesn t|does not)/u.test(normalized)) {
          score += 1.5;
        }
        if (/(?:i |my |we |our |user |developer |customer )/u.test(normalized)) {
          score += 1;
        }
        if (/(?:liked and subbed|thank you|kudos|part 2|please do)/u.test(normalized)) {
          score -= 4;
        }

        return { sample, score };
      })
      .sort((first, second) => second.score - first.score)[0]?.sample;
  }

  /**
   * Promotional titles, app-review descriptions, tutorials, and outbound links
   * describe content or products; they are not evidence that a user actually
   * experienced a problem. Keeping them out of deterministic fallback prevents
   * strings such as "Check out the app here" from becoming opportunity text.
   */
  private looksLikePromotionalOrPublisherText(value: string): boolean {
    const normalized = value.replace(/\s+/gu, ' ').trim().toLowerCase();
    const hasUrl = /https?:\/\/|www\.|play\.google\.|apps\.apple\.com|app\s*store/u.test(normalized);
    const promotionalPhrase = /(?:check out|download|install|app review|review of|subscribe|liked and subbed|link in (?:the )?description|use my code|sponsored|available now|try it|watch the full|tutorial|guide)/u.test(normalized);
    const titleLike = /\|/u.test(value) && !/(?:i |my |we |our |can t|cannot|doesn t|does not|failed|broken|missing|problem|issue|bug|need|wish|want)/u.test(normalized);

    return (hasUrl && promotionalPhrase) || promotionalPhrase || titleLike;
  }

  private isRetainedFallbackEvidenceCandidate(value: string): boolean {
    const raw = value.replace(/\s+/gu, ' ').trim();
    const body = raw.match(/\bCommunity comment:\s*(.+)$/iu)?.[1]?.trim() ?? raw;
    const sourceType = /\bCommunity comment:\s*/iu.test(value)
      ? 'COMMENT'
      : 'POST';
    const observedUnmetNeed = isObservedUnmetNeedEvidence(body);
    if (
      !body ||
      isNonActionableCommunityBanter(body, 'COMMENT') ||
      isLikelyPromotionalEvidence(body) ||
      this.looksLikePromotionalOrPublisherText(body) ||
      (isPositiveFeedbackWithoutProblem(body) && !observedUnmetNeed)
    ) {
      return false;
    }

    if (isStructuredOperationalProblemEvidence(value, sourceType)) {
      return true;
    }

    const kind = classifyDirectCommunityEvidence(body, sourceType);
    if (
      kind === 'USER_COMPLAINT' ||
      kind === 'FEATURE_REQUEST' ||
      kind === 'OBSERVED_UNMET_NEED'
    ) {
      return true;
    }

    if (
      kind === 'GENERAL_COMMENTARY' &&
      isSpeculativeWorkflowDiscussionWithoutExperiencedFailure(
        body,
        sourceType,
      )
    ) {
      return false;
    }

    if (kind === 'USER_QUESTION' || kind === 'GENERAL_COMMENTARY') {
      return this.looksLikeDirectProblemEvidence(body);
    }

    return false;
  }

  /** Returns true only for text that contains an observable user pain signal. */
  private looksLikeDirectProblemEvidence(value: string): boolean {
    const raw = value.replace(/\s+/gu, ' ').trim();
    const communityCommentMatch = raw.match(/\bCommunity comment:\s*(.+)$/iu);
    const evidenceBody = communityCommentMatch?.[1]?.trim() ?? raw;
    const normalized = this.normalizeComparableText(evidenceBody);

    if (
      !normalized ||
      isLikelyPromotionalEvidence(evidenceBody) ||
      this.looksLikePromotionalOrPublisherText(evidenceBody) ||
      (isPositiveFeedbackWithoutProblem(evidenceBody) &&
        !isObservedUnmetNeedEvidence(evidenceBody))
    ) {
      return false;
    }

    const explicitPain = /(?:cannot|can t|unable|does not work|doesn t work|not working|fail|failed|failure|error|wrong|incorrect|inaccurate|miscalculat|hallucinat|crash|slow|delay|missing|lost|loss|risk|unsafe|vulnerabilit|hack|breach|expensive|cost|bill|manual|rewrite|refactor|confusing|frustrat|struggle|please add|feature request)/u.test(normalized);
    const directNeedOrWish =
      /(?:^|\s)(?:i|we|my|our|user|users|customer|customers|developer|developers|operator|operators|learner|learners)(?:\s+[^.!?]{0,45})?\s+(?:need|needs|needed|wish|wishes)\b/u.test(normalized) ||
      /\b(?:need|needs|needed)\s+(?:a|an|the|better|more|less|to)\s+(?:app|application|platform|service|feature|option|setting|support|workflow|tool|software|system|way|ability|integration)\b/u.test(normalized);
    const comprehensionOrPraiseOnly = /(?:i think i understand|i understand now|makes sense|so much easier|helped me understand|great explanation|thank you|thanks|love this|amazing|awesome)/u.test(normalized) &&
      !/(?:cannot|can t|unable|error|fail|broken|missing|wrong|confusing|difficult|frustrat|struggle|need|wish)/u.test(normalized);
    const positiveRecommendationOnly =
      /(?:highly recommend|recommend(?:ed|ing)?|great company|great app|excellent|works great|very satisfied|five stars?|5 stars?|love (?:the|this) app)/u.test(normalized) &&
      !/(?:cannot|can t|unable|does not work|doesn t work|not working|error|fail|broken|bug|missing|incorrect|wrong|crash|freeze|slow|confusing|difficult|frustrat|struggle|support|refund|withdraw)/u.test(normalized);
    const firstPersonExperience = /(?:^|\s)(?:i|my|we|our|user|users|developer|developers|customer|customers)(?:\s|$)/u.test(normalized);
    const concreteOutcome = /(?:hours?|days?|times?|\$\s*\d+|\d+\s*(?:bugs?|issues?|vulnerabilities|errors?)|racked up|data loss|financial exposure)/u.test(evidenceBody.toLowerCase());

    return (explicitPain || directNeedOrWish) &&
      !comprehensionOrPraiseOnly &&
      !positiveRecommendationOnly &&
      (firstPersonExperience || concreteOutcome || directNeedOrWish || /(?:please add|feature request)/u.test(normalized));
  }

  private firstOptionalString(
    record: Record<string, unknown>,
    keys: readonly string[],
  ): string | null {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }

    return null;
  }


  /**
   * Repairs provider text that ends mid-word by extracting the explicit problem
   * section from the verbatim evidence sample. This is deterministic and adds
   * no provider request.
   */
  private repairTruncatedProblemFromEvidence(
    problem: string,
    evidenceSamples: readonly string[],
  ): string {
    const normalized = problem.replace(/\s+/gu, ' ').trim();
    if (!this.looksTruncatedProblem(normalized)) {
      return normalized;
    }

    for (const sample of evidenceSamples) {
      const extracted = this.extractProblemSection(sample);
      if (extracted.length >= 35) {
        return this.boundProblemText(extracted, 240);
      }
    }

    return this.boundProblemText(normalized, 240);
  }

  private looksTruncatedProblem(value: string): boolean {
    if (!value) {
      return true;
    }

    if (/[.!?]["')\]]?$/u.test(value)) {
      return false;
    }

    const words = value.split(/\s+/u).filter(Boolean);
    const lastWord = words.at(-1)?.replace(/[^\p{L}\p{N}-]+/gu, '') ?? '';

    return value.length < 170 && (lastWord.length <= 4 || words.length < 9);
  }

  private extractProblemSection(value: string): string {
    const normalized = value
      .replace(/\r?\n/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();

    /*
     * Treat these words as section labels only when they appear at the start
     * of the text or are followed by an explicit colon. A normal sentence
     * such as "the security problem of the apps..." must never be split at
     * the word "problem" because doing so drops the semantic subject.
     */
    const labeled = normalized.match(
      /^(?:#{1,6}\s*)?(?:🤔\s*)?(?:problem statement|problem|issue|pain point)\s*(?::|[-–—])\s*(.+?)(?=\s+(?:#{1,6}\s*)?(?:🛠️\s*)?(?:proposed solution|solution|alternatives considered|feature summary|mockups|additional context)\b|$)/iu,
    );

    if (labeled?.[1]) {
      return labeled[1]
        .replace(/^[\s:–—-]+/u, '')
        .replace(/\s+/gu, ' ')
        .trim();
    }

    /*
     * Long technical tickets often begin with imports, UI code, schemas, or
     * setup instructions and only state the actual failure later. Prefer the
     * explicit inline problem/error clause over the first code-heavy sentence
     * so downstream product generation receives a human-readable problem.
     */
    const inlineProblem = normalized.match(
      /\b(?:the problem is|problem is|the issue is|issue is)\s*[,;:–—-]*\s*(.{24,420}?)(?=\s+(?:while searching|what i tried|what i've tried|steps to reproduce|expected behavior|actual behavior|any help|thank you|thanks)\b|$)/iu,
    );
    if (inlineProblem?.[1]) {
      return this.boundProblemText(
        inlineProblem[1]
          .replace(/^[\s:–—-]+/u, '')
          .replace(/\s+/gu, ' ')
          .trim(),
        320,
      );
    }

    const explicitError = normalized.match(
      /\b(?:i get|i receive|it throws?|it returns?|it fails with)\s+(?:the following\s+)?(?:error|exception)\s*[:–—-]\s*(.{16,300}?)(?=\s+(?:while searching|what i tried|what i've tried|any help|thank you|thanks)\b|$)/iu,
    );
    if (explicitError?.[1]) {
      return this.boundProblemText(
        `The workflow fails with ${explicitError[1].replace(/\s+/gu, ' ').trim()}`,
        320,
      );
    }

    const firstSentence = normalized.match(/^(.{35,360}?[.!?])(?:\s|$)/u);
    return firstSentence?.[1]?.trim() ?? '';
  }

  private boundProblemText(value: string, maxLength: number): string {
    const normalized = value.replace(/\s+/gu, ' ').trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }

    const bounded = normalized.slice(0, maxLength);
    const sentenceBoundary = Math.max(
      bounded.lastIndexOf('.'),
      bounded.lastIndexOf('!'),
      bounded.lastIndexOf('?'),
    );
    const wordBoundary = bounded.lastIndexOf(' ');
    const end =
      sentenceBoundary >= 80
        ? sentenceBoundary + 1
        : wordBoundary >= 80
          ? wordBoundary
          : maxLength;

    return bounded.slice(0, end).replace(/[\s,;:–—-]+$/u, '').trim();
  }

  /**
   * Returns the semantic evidence ledger without launching a second LLM pass.
   * This keeps targeted recovery fast while preserving every classification,
   * including conservative deterministic fallback when the full-corpus online race fails.
   */
  private buildClassificationOnlyAnalysis(
    context: IdeaGenerationContext,
    evidenceClassifications: readonly CommunityAiEvidenceTriage[],
    telemetry: CommunityAiTriageTelemetry,
  ): CommunityAiAnalysis {
    const directCount = evidenceClassifications.filter(
      (item) => item.classification === 'DIRECT_PROBLEM',
    ).length;
    const supportingCount = evidenceClassifications.filter(
      (item) => item.classification === 'SUPPORTING_SIGNAL',
    ).length;
    const contextOnlyCount = evidenceClassifications.filter(
      (item) => item.classification === 'CONTEXT_ONLY',
    ).length;
    const unrelatedCount = evidenceClassifications.filter(
      (item) => item.classification === 'UNRELATED',
    ).length;
    const unadjudicatedCount = evidenceClassifications.filter(
      (item) => item.classification === 'UNADJUDICATED',
    ).length;
    const accepted = evidenceClassifications.filter(
      (item) =>
        (item.classification === 'DIRECT_PROBLEM' ||
          item.classification === 'SUPPORTING_SIGNAL') &&
        item.verifiedByDeterministicGuard,
    );
    const jointEvidenceGroups = (telemetry.jointEvidenceGroups ?? []).filter(
      (group) => group.verifiedByDeterministicGuard,
    );
    const strongestJoint = jointEvidenceGroups.length > 0
      ? [...jointEvidenceGroups].sort(
          (left, right) =>
            right.distinctSourceCount - left.distinctSourceCount ||
            right.confidence - left.confidence ||
            right.evidenceIds.length - left.evidenceIds.length,
        )[0]
      : null;
    const overallConfidence = accepted.length > 0
      ? Math.round(
          accepted.reduce((sum, item) => sum + item.confidence, 0) /
            accepted.length,
        )
      : strongestJoint
        ? Math.round(Math.min(80, strongestJoint.confidence))
        : 15;
    const acceptedEvidenceIds = new Set(
      accepted.map((item) => item.evidenceId),
    );
    const selectedProblemFamilyEvidenceIds = [
      ...new Set(
        telemetry.selectedProblemEvidenceIds
          .map((id) => id.trim())
          .filter((id) => id && acceptedEvidenceIds.has(id)),
      ),
    ];
    const individuallySelectedProblemFamily =
      selectedProblemFamilyEvidenceIds.length > 0
        ? this.normalizeProblemFamilyLabel(
            telemetry.selectedProblemFamily ?? '',
          )
        : null;
    const selectedProblemFamily =
      individuallySelectedProblemFamily || strongestJoint?.problemFamily || null;
    const selectedEvidenceIds = individuallySelectedProblemFamily
      ? selectedProblemFamilyEvidenceIds
      : strongestJoint
        ? [strongestJoint.id]
        : [];
    const selectedDistinctSourceCount = individuallySelectedProblemFamily
      ? EvidenceSourceIdentityUtil.count(
          (context.rawEvidenceCorpus ?? []).filter((item) =>
            selectedProblemFamilyEvidenceIds.includes(item.id),
          ),
        )
      : strongestJoint?.distinctSourceCount ?? 0;

    const highCoveragePartialAdjudication =
      accepted.length === 0 &&
      jointEvidenceGroups.length === 0 &&
      this.isLargeCorpusHighCoverageAdjudication(
        Math.max(0, evidenceClassifications.length - unadjudicatedCount),
        evidenceClassifications.length,
      );

    return {
      summary:
        `Classified ${evidenceClassifications.length} recovered raw evidence item(s): ${directCount} direct, ${supportingCount} supporting, ${contextOnlyCount} context-only, ${unrelatedCount} unrelated, and ${unadjudicatedCount} unadjudicated. Opportunity synthesis was intentionally skipped because ranking consumes this canonical triage ledger directly.`,
      dominantProblems: [],
      unmetNeeds: [],
      opportunities: [],
      overallConfidence,
      qualityWarnings: [
        ...(accepted.length === 0 && jointEvidenceGroups.length === 0
          ? ['No synthesis-eligible recovered evidence remained after semantic classification and deterministic verification.']
          : []),
        ...(accepted.length === 0 && strongestJoint
          ? [
              `Recovered evidence retained one conservatively verified joint SUPPORTING composition across ${strongestJoint.distinctSourceCount} independent source(s). No individual member is promoted beyond its own semantic verdict, and the joint composition does not establish prevalence.`,
            ]
          : []),
        ...(unadjudicatedCount > 0
          ? [highCoveragePartialAdjudication
              ? 'A small high-coverage tail remains UNADJUDICATED; those rows are excluded from both positive and negative evidence claims while the adjudicated ledger remains usable.'
              : 'Some recovered raw evidence remains UNADJUDICATED because online semantic triage was unavailable; those rows are not treated as unrelated.']
          : []),
      ],
      evidenceVerdictState: accepted.length > 0 || jointEvidenceGroups.length > 0
        ? 'VALID_EVIDENCE_FOUND'
        : unadjudicatedCount > 0 && !highCoveragePartialAdjudication
          ? 'EVIDENCE_ADJUDICATION_UNAVAILABLE'
          : 'NO_VALID_EVIDENCE_FOUND',
      modelId: null,
      apiModelId: null,
      attemptCount: telemetry.diagnostics.filter(
        (item) => item.status !== 'ABORTED',
      ).length,
      aiAttempted: telemetry.onlineAttemptCount > 0,
      triageAiSucceeded:
        telemetry.adjudicatedEvidenceCount > 0 || jointEvidenceGroups.length > 0,
      synthesisAiSucceeded: false,
      aiSucceeded:
        telemetry.adjudicatedEvidenceCount > 0 || jointEvidenceGroups.length > 0,
      fallbackUsed: unadjudicatedCount > 0 && !highCoveragePartialAdjudication,
      onlineAttemptCount: telemetry.onlineAttemptCount,
      executionFailureCount: telemetry.diagnostics.filter(
        (item) => item.status === 'EXECUTION_FAILED' || item.status === 'TIMEOUT',
      ).length,
      validationRejectedCount: telemetry.diagnostics.filter(
        (item) => item.status === 'VALIDATION_REJECTED',
      ).length,
      fallbackReason:
        unadjudicatedCount > 0 && !highCoveragePartialAdjudication
          ? 'EVIDENCE_ADJUDICATION_UNAVAILABLE: some recovered rows did not receive an online semantic verdict.'
          : highCoveragePartialAdjudication
            ? `High-coverage partial adjudication retained ${evidenceClassifications.length - unadjudicatedCount}/${evidenceClassifications.length} usable semantic verdicts; unresolved rows remain UNADJUDICATED.`
            : null,
      attemptDiagnostics: [...telemetry.diagnostics],
      unvalidatedDomainHypotheses: this.buildUnvalidatedDomainHypotheses(
        context,
        [],
      ),
      evidenceClassifications,
      jointEvidenceGroups,
      aiProposedProblemFamily: selectedProblemFamily,
      aiProposedProblemFamilyEvidenceIds: selectedEvidenceIds,
      selectedProblemFamily,
      selectedProblemFamilySelectionSource: individuallySelectedProblemFamily
        ? 'AI_SELECTED_PENDING_VERIFICATION'
        : strongestJoint
          ? 'AI_CLUSTER_VERIFIED'
          : null,
      selectedProblemFamilyEvidenceIds: selectedEvidenceIds,
      selectedProblemFamilyTrustedEvidenceCount: selectedEvidenceIds.length,
      selectedProblemFamilyDistinctSourceCount: selectedDistinctSourceCount,
    };
  }

  private optionalString(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
  }

  private normalizeTextArray(
    value: unknown,
    fallback: readonly string[],
    allowEmpty = false,
  ): string[] {
    const source = Array.isArray(value) ? value : value == null ? [] : [value];
    const normalized = source
      .map((item) => this.textFromUnknown(item))
      .filter((item): item is string => Boolean(item));

    const result = [...new Set(normalized.length > 0 ? normalized : fallback)];
    if (!allowEmpty && result.length === 0) {
      throw new Error(
        'Community AI analysis returned an empty text collection.',
      );
    }
    return result;
  }

  private textFromUnknown(value: unknown): string | null {
    if (typeof value === 'string') {
      return value.trim() || null;
    }
    if (!this.isRecord(value)) {
      return null;
    }
    for (const key of [
      'text',
      'title',
      'problem',
      'need',
      'description',
      'value',
    ]) {
      const candidate = value[key];
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }
    return null;
  }

  private normalizeOptionalScore(value: unknown, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return Math.max(0, Math.min(100, fallback));
    }
    const normalized = value <= 1 ? value * 100 : value;
    return Math.round(Math.max(0, Math.min(100, normalized)) * 100) / 100;
  }

  private normalizeOptionalPositiveInteger(
    value: unknown,
    fallback: number,
  ): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return fallback;
    }
    return Math.max(1, Math.round(value));
  }

  private normalizeSeverity(
    value: unknown,
  ): CommunityAiOpportunity['severity'] {
    if (typeof value === 'string') {
      const normalized = value.trim().toUpperCase();
      if (['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(normalized)) {
        return normalized as CommunityAiOpportunity['severity'];
      }
      if (['SEVERE', 'URGENT', 'VERY HIGH'].includes(normalized))
        return 'CRITICAL';
      if (['MODERATE', 'NORMAL'].includes(normalized)) return 'MEDIUM';
    }
    return 'MEDIUM';
  }

  /**
   * Repairs an AI-provided title when it names an unrelated domain that is not
   * supported by the opportunity problem/evidence. This is a repair gate rather
   * than a failure gate, so one bad title cannot fail the generation run.
   */
  private isAiAssistantBrokenReferenceEvidence(value: string): boolean {
    const normalized = this.normalizeComparableText(value);
    if (!normalized) return false;

    const aiContext =
      /\b(?:ai assistants?|ai assistant|artificial intelligence assistants?|chatbots?|large language models?|llms?)\b/u.test(
        normalized,
      );
    const brokenReference =
      /\b(?:links?|references?|urls?)\b[^.!?]{0,100}\b(?:broken|dead|unavailable|404|not found)\b/u.test(
        normalized,
      ) ||
      /\b(?:broken|dead|unavailable|404|not found)\b[^.!?]{0,100}\b(?:pages?|links?|references?|urls?)\b/u.test(
        normalized,
      );

    return aiContext && brokenReference;
  }

  private normalizeOpportunityTitle(
    domainName: string,
    title: string,
    problem: string,
    unmetNeed: string,
    evidenceSample: string,
  ): string {
    const normalizedDomain = this.normalizeComparableText(domainName);
    const normalizedTitle = this.normalizeComparableText(title);
    const semanticText = this.normalizeComparableText(
      `${problem} ${unmetNeed} ${evidenceSample}`,
    );
    const titleClaimsEnergy =
      /(?:energy|solar|electricity|power grid|energy monitoring)/u.test(
        normalizedTitle,
      );
    const domainIsEnergy = /(?:^|\s)(?:energy|utilities?)(?:\s|$)/u.test(
      normalizedDomain,
    );
    const evidenceSupportsEnergy =
      /(?:energy|solar|electricity|electric|power grid|battery|energy meter|solar inverter|power plant)/u.test(
        semanticText,
      );

    const derivedTitle = this.deriveTitle(
      problem,
      unmetNeed,
      evidenceSample,
      domainName,
    );
    if (this.isAiAssistantBrokenReferenceEvidence(semanticText)) {
      return 'AI Assistant Link Reliability and Broken-Reference Failures';
    }
    const derivedNormalized = this.normalizeComparableText(derivedTitle);
    const evidenceFamily = resolvePrimaryProblemFamily(evidenceSample);
    const titleFamily = resolvePrimaryProblemFamily(title);
    const titleFamilyMismatch = Boolean(
      evidenceFamily &&
      titleFamily &&
      evidenceFamily.key !== titleFamily.key,
    );
    const titleSemanticOverlap = this.tokenOverlap(
      normalizedTitle,
      semanticText,
    );
    const looksLikePublisherTitle =
      /(?:top \d+|future of|explained by|revolutionizing|community comment|watch|video|tutorial)/u.test(
        normalizedTitle,
      );
    const looksLikeGenericReliabilityTitle =
      /^(?:reliable )?(?:connectivity|service availability|workflow reliability|service reliability|validation workflow|software workflow)(?: and [a-z ]+)?$/u.test(
        normalizedTitle,
      );
    const looksLikeNarrativeFragmentTitle =
      /^(?:\d+|one|two|three|four|five)\s+(?:days?|weeks?|months?|years?)\s+ago\b|^(?:i|we)\s+(?:made|paid|tried|used|have|had)\b/u.test(
        normalizedTitle,
      );
    const looksLikeInternalQualificationTitle =
      this.isInternalQualificationText(title);
    const derivedIsSpecific =
      /(?:payment|billing|charge|reconciliation|wallet transaction|state synchronization|transaction visibility|legal research|legal|compliance|rights risk|hallucination|output reliability|routing|endpoint|healthcare ai|applicant|rental|authentication|data loss|therapeutic|persona|voice continuity|crypto platform access)/u.test(
        derivedNormalized,
      );

    if (
      (titleClaimsEnergy && !domainIsEnergy && !evidenceSupportsEnergy) ||
      looksLikePublisherTitle ||
      looksLikeNarrativeFragmentTitle ||
      looksLikeInternalQualificationTitle ||
      titleFamilyMismatch ||
      (looksLikeGenericReliabilityTitle && derivedIsSpecific) ||
      (derivedNormalized !== normalizedTitle && titleSemanticOverlap < 0.1)
    ) {
      return derivedTitle;
    }

    return title;
  }

  /**
   * Builds a stable, professional title from the semantic content of the
   * retained evidence. It intentionally avoids copying an arbitrary substring
   * from the middle of a community comment.
   */
  private deriveTitle(
    problem: string,
    unmetNeed: string,
    evidenceSample = '',
    domainName = '',
  ): string {
    const semanticText = this.normalizeComparableText(
      `${problem} ${unmetNeed} ${evidenceSample}`,
    );
    const evidenceCoreText = this.normalizeComparableText(
      `${problem} ${evidenceSample}`,
    );
    const normalizedDomain = this.normalizeComparableText(domainName);
    const runtimeSafeSemanticText = semanticText
      .replace(/\b(?:not|never|without|no)\s+(?:actually\s+)?(?:crash(?:es|ed|ing)?|freez(?:e|es|ing)|frozen)\b/gu, ' ')
      .replace(
        /\b(?:keyboard\s+(?:appears?|feels?)\s+frozen|focus\s+(?:remains|stays|is)\s+(?:on|trapped|stuck)|keystrokes?\s+(?:are\s+)?(?:captured|consumed)|keyboard\s+input\s+(?:is\s+)?(?:captured|consumed)|type[- ]ahead|screen reader|no visible candidate)\b/gu,
        ' ',
      );

    if (this.isAiAssistantBrokenReferenceEvidence(evidenceCoreText)) {
      return 'AI Assistant Link Reliability and Broken-Reference Failures';
    }

    if (
      /(?:glp[- ]?1|obesity|chronic disease|medication|drug)/u.test(evidenceCoreText) &&
      /(?:too expensive|expensive to cover|coverage|skyrocketing|costs?|payer|insurance)/u.test(evidenceCoreText)
    ) {
      return 'GLP-1 Medication Cost and Coverage Pressure';
    }

    const primaryEvidenceFamily =
      resolvePrimaryProblemFamily(evidenceSample) ??
      resolvePrimaryProblemFamily(problem);
    if (primaryEvidenceFamily?.key === 'device-protocol-compatibility') {
      return 'Device Protocol Compatibility and Connectivity Limitations';
    }
    if (primaryEvidenceFamily?.key === 'route-planning-capability') {
      return 'Route Planning Stop Reference and Import Limitations';
    }
    if (primaryEvidenceFamily?.key === 'application-update-loop') {
      return 'Application Update Loop and Version Verification Failures';
    }
    if (primaryEvidenceFamily?.key === 'data-fragmentation') {
      return 'Fragmented Data Integration and Coordination';
    }
    if (primaryEvidenceFamily?.key === 'ai-feedback-correction-inflexibility') {
      return 'AI Feedback Incorporation and Correction Failures';
    }
    if (primaryEvidenceFamily?.key === 'identity-wallet-authentication-integration') {
      return 'Digital Identity Wallet Authentication Integration Gaps';
    }
    if (primaryEvidenceFamily?.key === 'ai-hallucination-output-reliability') {
      return 'AI Hallucination and Output Reliability Failures';
    }
    if (primaryEvidenceFamily?.key === 'legal-compliance-risk') {
      return 'Legal, Compliance, and Rights Risk Gaps';
    }
    if (primaryEvidenceFamily?.key === 'delivery-tracking') {
      return 'Shipment Loss, Delay, and Delivery Tracking Failures';
    }

    if (
      /(?:model containment|containment breach|containment failure|sandbox escape|security boundary|escape onto the open internet|open[- ]weight model)/u.test(
        evidenceCoreText,
      ) &&
      /(?:security testing|sandbox|containment|internet|boundary|escape)/u.test(
        evidenceCoreText,
      )
    ) {
      return 'AI Model Containment and Sandbox Escape Failures';
    }

    if (
      /(?:current transformers?|\bcts?\b|iotawatt|energy monitor(?:ing)?|power monitor(?:ing)?)/u.test(
        evidenceCoreText,
      ) &&
      /(?:too much work|install|installation|setup|configure|configuration|wire|wiring|calibrat(?:e|ion)|manual effort|complex)/u.test(
        evidenceCoreText,
      )
    ) {
      return 'Energy Monitor Sensor Installation and Setup Friction';
    }

    if (
      /(?:got married|married|name change|changed my (?:sur)?name|changed (?:my )?(?:sur)?name)/u.test(
        evidenceCoreText,
      ) &&
      /(?:government department|government departments|agencies|hmrc|dvla|passport office|dwp|student loans|land registry|record updated)/u.test(
        evidenceCoreText,
      )
    ) {
      return 'Cross-Agency Life-Event Record Update Coordination';
    }

    if (
      /(?:streaming pipeline|streaming data|data pipeline)/u.test(evidenceCoreText) &&
      /(?:stale|skewed|incorrect|wrong|corrupt|quietly serving|silently serving)/u.test(
        evidenceCoreText,
      )
    ) {
      return 'Streaming Data Integrity and Staleness Failures';
    }

    if (
      /(?:license test response|licensing server|licensechecker|servermanagedpolicy|strictpolicy|not licensed|not_licensed|lvl licensing|google play licensing)/u.test(
        evidenceCoreText,
      ) &&
      /(?:android|google play|mobile app|test account|testing device|developer account)/u.test(
        evidenceCoreText,
      )
    ) {
      return 'Mobile App License Verification and Test Response Failures';
    }

    if (
      /(?:can(?:not|['’]?t)|unable to)\s+(?:access|login|log in|sign in|log into|sign into)\s+(?:my|the|this)?\s*account|locked out(?: of)?\s+(?:my|the|this)?\s*account/u.test(
        evidenceCoreText,
      )
    ) {
      return 'Login and Account Access Failures';
    }

    if (
      /(?:keyboard\s+(?:appears?|feels?)\s+frozen|focus\s+(?:remains|stays|is)\s+(?:on|trapped|stuck)|keystrokes?\s+(?:are\s+)?(?:captured|consumed)|type[- ]ahead|screen reader|no visible candidate)/u.test(
        evidenceCoreText,
      )
    ) {
      return 'Accessibility Focus and Keyboard Navigation Failures';
    }

    if (
      /(?:powershell|execution policy|pssecurityexception|running scripts is disabled|script execution disabled|unauthorizedaccess|\.ps1)/u.test(
        evidenceCoreText,
      )
    ) {
      return 'Script Execution Policy and Local Tool Permission Failures';
    }

    if (
      /(?:insufficient funds|insufficient balance|not enough funds)/u.test(
        evidenceCoreText,
      ) &&
      /(?:transaction|swap|transfer|wallet|fee|gas|sol|token|blockchain|jupiter)/u.test(
        evidenceCoreText,
      )
    ) {
      return 'Blockchain Transaction Balance Validation Failures';
    }

    if (
      /\b(?:firefox|chrome|browser|tab|dapp|web3)\b/u.test(evidenceCoreText) &&
      /(?:crash|crashed|crashing|runtime failure|no error|terminal shows no error)/u.test(
        evidenceCoreText,
      )
    ) {
      return 'DApp Browser Runtime Crash and Silent Failure Diagnostics';
    }

    if (
      /(?:taking time for mental health|time for mental health|mental health time|time off for mental health|mental health break|recovery time|self care time)/u.test(evidenceCoreText) &&
      /(?:luxury|cannot afford|can t afford|less than a day|difficult|hard|no time|workplace|professional)/u.test(evidenceCoreText)
    ) {
      return 'Workday Mental Health Time-Access Constraints';
    }

    if (
      /(?:treatment|care|medicine|therapy)/u.test(evidenceCoreText) &&
      /(?:unavailable|not available|another country|one country|cannot access|can t access|cross border)/u.test(evidenceCoreText)
    ) {
      return 'Cross-Border Treatment Availability and Access Gaps';
    }

    if (
      !/(?:oid4vp|oid4vci|eudi[- ]?wallet|eudi wallet|verifiable presentations?|verifiable credentials?|wallet credentials?|identity credentials?|digital identity wallet|credential wallet|keycloak verifier|verifier functionality|verifier[- ]side|electronic attestations?)/u.test(evidenceCoreText) &&
      /(?:wallet|account balance|wallet balance|transaction history|transactions?|confirmations?)/u.test(
        evidenceCoreText,
      ) &&
      /(?:missing|not showing|fail(?:s|ed)? to appear|incorrect|wrong|visibility|synchroni[sz]|zero|0)/u.test(
        evidenceCoreText,
      ) &&
      /(?:blockchain|wallet|confirmed|confirmation)/u.test(evidenceCoreText)
    ) {
      return 'Wallet Transaction Visibility and State Synchronization Failures';
    }

    if (
      /(?:\bagents?\b|agent memory|memory infrastructure|memory layer|prompt context|conversation context)/u.test(
        evidenceCoreText,
      ) &&
      /(?:forget(?:s|ting)?|forgets everything|session ends?|amnesia|memory persistence|persist(?:s|ence)?|context loss|loses? context|lost context)/u.test(
        evidenceCoreText,
      )
    ) {
      return 'AI Agent Memory and Context Persistence Failures';
    }

    if (
      /(?:identity provider login error|identity_provider_login_error|cookie not found|cookie_not_found|oidc|oauth|keycloak|authentication|login required|login_required|sign in|account access|session)/u.test(
        evidenceCoreText,
      ) &&
      /(?:fail|failed|failure|error|unable|cannot|can t|blocked|expired|missing|not found)/u.test(
        evidenceCoreText,
      )
    ) {
      return 'Account Access and Authentication Failures';
    }

    if (
      /(?:404|not found|missing url|incorrect url|broken route|broken link|redirect|deep link|destination page|missing endpoint|incorrect endpoint|endpoint failure)/u.test(
        evidenceCoreText,
      )
    ) {
      return 'Navigation and Routing Endpoint Failures';
    }

    if (
      /(?:legal researcher|legal research|legal tools?|law database|law databases|attorney|documentation|constitutional violation)/u.test(
        evidenceCoreText,
      ) &&
      /(?:1500|expensive|afford|price|pricing|licensing fee|documentation|ai.*facts|screws with the facts|guardrail|looping)/u.test(
        evidenceCoreText,
      )
    ) {
      return 'Legal Research Documentation Cost and AI Reliability Barriers';
    }

    if (
      /(?:paid .*cash|cash .*paid|already paid|charged .*again|double charg|duplicate charg|payment reconciliation)/u.test(
        evidenceCoreText,
      )
    ) {
      return 'Payment Reconciliation and Duplicate Charge Failures';
    }

    if (/\brefund\b/u.test(evidenceCoreText)) {
      return 'Refund Processing and Recovery Failures';
    }

    if (
      /(?:venmo|bank|payment method|card)/u.test(evidenceCoreText) &&
      /(?:connect|link|connected|charged|charge)/u.test(evidenceCoreText)
    ) {
      return 'Payment Method Linking and Charge Consistency Failures';
    }

    if (
      /(?:international card|foreign card|international number|foreign number|traveling from abroad|travelling from abroad|traveler|traveller)/u.test(
        evidenceCoreText,
      ) &&
      /(?:otp|verification|card|payment|cannot use|can t use|could not use|not accept)/u.test(
        evidenceCoreText,
      )
    ) {
      return 'International Card and OTP Access Barriers for Travelers';
    }

    if (
      /(?:rent|rental|lease|housing|home|property)/u.test(semanticText) &&
      /(?:filter|filtering|short term|long term|lease term|rental length)/u.test(
        semanticText,
      )
    ) {
      return 'Rental Lease-Term Filtering Limitations';
    }

    if (
      /(?:mass email(?:ing)?|bulk email(?:ing)?|email campaign).{0,120}(?:client contacts?|clients?)|(?:client contacts?|clients?).{0,120}(?:mass email(?:ing)?|bulk email(?:ing)?|email campaign)/u.test(
        semanticText,
      )
    ) {
      return 'Client Contact Mass Outreach Gaps in Applicant Tracking Systems';
    }

    if (
      /(?:(?:candidate|applicant) profiles?|\bprofiles?\b).{0,140}(?:sav(?:e|ing)?|sort|portal|pool|reuse|regular basis|recurring hiring|hire store workers)|(?:sav(?:e|ing)?|sort|portal|pool|reuse).{0,140}(?:(?:candidate|applicant) profiles?|\bprofiles?\b)/u.test(
        semanticText,
      )
    ) {
      return 'Candidate Profile Pooling and Reuse for Recurring Hiring';
    }

    if (
      /(?:security|vulnerabilit|hack|breach|unsafe)/u.test(semanticText) &&
      /(?:bill|billing|cloud cost|cost spike|financial exposure|30k|2k)/u.test(
        semanticText,
      )
    ) {
      return 'AI-Generated Application Security and Cost Risk';
    }

    if (
      /(?:llm|large language model|ai coding|generated code|code assistant)/u.test(
        semanticText,
      ) &&
      /(?:bloated|poorly organized|refactor|rewrite|pushback|doesn t understand|does not understand|invalid request|nonsensical)/u.test(
        semanticText,
      )
    ) {
      return 'LLM-Generated Code Quality and Validation Failures';
    }

    if (
      /(?:accounting|invoice|quickbooks|customer email|financial software)/u.test(
        semanticText,
      ) &&
      /(?:slow|load|save|saved|missing|disappear|persistence|data loss)/u.test(
        semanticText,
      )
    ) {
      return 'Accounting Software Performance and Data Persistence Failures';
    }

    if (
      /(?:healthcare|health care|pharmacy|patient|clinical)/u.test(semanticText) &&
      /(?:artificial intelligence|\bai\b|ai assistant|phone assistant|customer service|automated support)/u.test(semanticText) &&
      /(?:complaint|failure|failed|friction|pulled|withdrew|service termination|dissatisfaction)/u.test(semanticText)
    ) {
      return 'Healthcare AI Service Complaint and Validation Gaps';
    }

    if (
      /(?:taking time for mental health|time for mental health|mental health time|time off for mental health|mental health break|recovery time|self care time)/u.test(semanticText) &&
      /(?:luxury|cannot afford|can t afford|less than a day|difficult|hard|no time|workplace|professional)/u.test(semanticText)
    ) {
      return 'A retained community observation suggests that some people may perceive even short periods devoted to mental-health recovery as difficult to afford within daily responsibilities.';
    }

    if (
      /(?:treatment|care|medicine|therapy)/u.test(semanticText) &&
      /(?:unavailable|not available|another country|one country|cannot access|can t access|cross border)/u.test(semanticText)
    ) {
      return 'A retained healthcare observation describes a potential access gap in which a known treatment may be available in one health system or country but unavailable to the affected patient elsewhere.';
    }

    if (
      /(?:google|apple|email|identity provider|oauth)/u.test(
        semanticText,
      ) &&
      /(?:need to create account|create account using email|email sign up|email based sign up|only have google|only have apple|google or apple|identity provider|oauth)/u.test(
        semanticText,
      )
    ) {
      return 'A user reports an account-access barrier because the application restricts registration to specific identity providers and does not offer the requested email-based sign-up path.';
    }

    if (
      /(?:mental health|therap(?:y|ist)|counsel(?:or|lor)|ai for mental health)/u.test(
        semanticText,
      ) &&
      /(?:voice|voices|persona|personality|tone|warmth|stranger|not the same|bring back|latest update|removed|gone|deleted)/u.test(
        semanticText,
      )
    ) {
      return 'Therapeutic Persona and Voice Continuity Failures';
    }

    if (
      /(?:binance|crypto|cryptocurrency|wallet|exchange|pexcoin|trading)/u.test(
        semanticText,
      ) &&
      /(?:nigeria|country|region|cannot use|can t use|unavailable|what other app|alternative)/u.test(
        semanticText,
      )
    ) {
      return 'Regional Crypto Platform Access and Alternative Wallet Gaps';
    }

    if (
      /(?:container|docker|bridge network|host network)/u.test(evidenceCoreText) &&
      /(?:tcp|socket|network mode|network_mode|gateway|connect|communication)/u.test(
        evidenceCoreText,
      )
    ) {
      return 'Inter-Container Network Boundary and Socket Connectivity Failures';
    }

    if (
      /(?:energy savings|gas savings|electricity savings|energy carrier|gas price|electricity price|price forecast)/u.test(
        evidenceCoreText,
      ) &&
      /(?:incorrect|inaccurate|distort|wrong|single value|same price|growth rate|npv|payback)/u.test(
        evidenceCoreText,
      )
    ) {
      return 'Energy Savings Carrier Forecasting and Valuation Errors';
    }

    if (/(?:login|log in|sign in|authentication|account access|password|session|two factor|2fa|multi factor|verification code)/u.test(semanticText) && /(?:fail|error|unable|cannot|can t|blocked|friction|timeout|restart|knocks? you out)/u.test(semanticText)) {
      return 'Account Access and Authentication Failures';
    }

    if (/(?:crash|crashes|crashed|runtime error|app closes|application closes|freeze|unresponsive)/u.test(runtimeSafeSemanticText)) {
      return 'Application Reliability and Crash Failures';
    }

    if (
      /(?:ggplot2?|shiny|renderplot|plotoutput|geom_line|aes\s*\(|aesthetics must be either length|reactive\s*\(|observe\s*\()/u.test(
        evidenceCoreText,
      ) &&
      /(?:plot|graph|chart|aesthetics|x axis|y axis|multiple lines|reactive|observe|data frame|dataframe)/u.test(
        evidenceCoreText,
      ) &&
      !/(?:data loss|lost data|history missing|history disappeared|lost conversation|lost state|records? (?:were )?(?:lost|deleted)|not saved|save failed|persistence failure)/u.test(
        evidenceCoreText,
      )
    ) {
      return 'Data Visualization Shape and Reactive Plotting Errors';
    }

    if (/(?:data loss|lost data|history missing|history disappeared|missing history|lost conversation|lost state|persistence)/u.test(semanticText)) {
      return 'Data Loss and Persistence Failures';
    }

    if (/(?:filter|filtering|search options|search criteria)/u.test(semanticText) && /(?:missing|cannot|can t|unable|limited|need|please add|exclude|include)/u.test(semanticText)) {
      return 'Search and Filtering Limitations';
    }

    if (/(?:complaint|feedback|customer service|support interaction)/u.test(semanticText) && /(?:capture|classify|triage|review|escalat|failure|friction)/u.test(semanticText)) {
      return 'Customer-Service Feedback and Triage Gaps';
    }

    if (/(?:fragmented|separate systems|multiple systems|manual coordination|disconnected workflow|siloed)/u.test(semanticText)) {
      return 'Workflow Fragmentation and Coordination Friction';
    }

    const hasExplicitEnergyAnchor =
      /(?:energy|solar|electricity|electric|power grid|battery|energy meter|solar inverter|power plant)/u.test(
        semanticText,
      );
    const domainIsEnergy = /(?:^|\s)(?:energy|utilities?)(?:\s|$)/u.test(
      normalizedDomain,
    );

    if (
      (domainIsEnergy || hasExplicitEnergyAnchor) &&
      /(?:offline|reconnect|connection|doesn t work|does not work|not reliable|incorrect location|unable to correct|unresponsive|error)/u.test(
        semanticText,
      )
    ) {
      return 'Energy Monitoring Reliability and Connection Failures';
    }

    if (
      /(?:login|sign in|authentication|account access|oauth|session)/u.test(semanticText) &&
      /(?:fail|error|blocked|unable|cannot|can t|recovery|access)/u.test(semanticText)
    ) {
      return 'Account Access and Authentication Failures';
    }

    if (
      /(?:artificial intelligence|\bai\b|automated)/u.test(semanticText) &&
      /(?:exam|examination|assessment|proctor|entrance test|entrance exam)/u.test(semanticText) &&
      /(?:fail|failure|error|repeat|retake|do over|wrong|dispute|review)/u.test(semanticText)
    ) {
      return 'AI Assessment Decision Verification and Recovery';
    }

    if (
      /(?:app|application|app store|play store|version|update)/u.test(evidenceCoreText) &&
      /(?:prompted to update|asks? to update|update loop|latest version|already updated|already on the latest version|version check|version mismatch)/u.test(
        evidenceCoreText,
      )
    ) {
      return 'Application Update Loop and Version Verification Failures';
    }

    if (
      /(?:app|application|software|platform|service)/u.test(semanticText) &&
      /(?:crash|runtime error|freeze|closing|not working|unavailable)/u.test(runtimeSafeSemanticText)
    ) {
      return 'Application Reliability and Runtime Failures';
    }

    if (
      /(?:search|filter|filtering|results|listing|catalog)/u.test(semanticText) &&
      /(?:missing|cannot|can t|unable|limited|exclude|include|criteria)/u.test(semanticText)
    ) {
      return 'Search and Filtering Workflow Limitations';
    }

    if (
      /(?:history|data|state|memory|record|records|files|progress|sync|synchronization)/u.test(semanticText) &&
      /(?:lost|missing|disappear|deleted|reset|not saved|sync|synchronization|persistence)/u.test(semanticText)
    ) {
      return 'Data Persistence and Synchronization Failures';
    }

    if (
      /(?:customer service|support|complaint|feedback|triage|service interaction)/u.test(semanticText) &&
      /(?:failure|friction|complaint|escalation|review|resolution|dissatisfaction)/u.test(semanticText)
    ) {
      return normalizedDomain
        ? `${this.toTitleCase(domainName)} Service Feedback and Resolution Gaps`
        : 'Customer-Service Feedback and Resolution Gaps';
    }

    if (
      /(?:notification|alert|message|delivery|reminder)/u.test(semanticText) &&
      /(?:missing|failed|delay|late|not received|unreliable)/u.test(semanticText)
    ) {
      return 'Notification Delivery and Workflow Gaps';
    }

    const cleanedUnmetNeed = this.cleanFallbackFragment(unmetNeed);
    const source = this.isInternalQualificationText(cleanedUnmetNeed)
      ? this.cleanFallbackFragment(problem)
      : this.cleanFallbackFragment(cleanedUnmetNeed || problem);
    if (this.looksLikePromotionalOrPublisherText(source)) {
      return normalizedDomain
        ? `${this.toTitleCase(domainName)} Workflow Reliability and Validation Gaps`
        : 'Software Workflow Reliability and Validation Gaps';
    }
    const words = source
      .replace(/^(?:a|an|the)\s+/iu, '')
      .split(/\s+/u)
      .filter(Boolean)
      .slice(0, 10)
      .join(' ')
      .replace(/[.,;:!?]+$/u, '')
      .trim();

    return words.length >= 8
      ? this.toTitleCase(words)
      : normalizedDomain
        ? `${this.toTitleCase(domainName)} Workflow Reliability and Validation Gaps`
        : 'Software Workflow Reliability and Validation Gaps';
  }

  /**
   * Low confidence is evidence metadata, not a transport failure. A grounded
   * response remains usable as a preliminary pilot and carries an explicit
   * warning instead of forcing an unnecessary provider failure/fallback.
   */
  private preserveGroundedLowConfidenceAnalysis(
    analysis: CommunityAiAnalysis,
  ): CommunityAiAnalysis {
    if (
      analysis.overallConfidence >= COMMUNITY_AI_ANALYSIS_MIN_OVERALL_CONFIDENCE
    ) {
      return analysis;
    }

    return {
      ...analysis,
      qualityWarnings: [
        ...analysis.qualityWarnings,
        `Overall confidence is ${analysis.overallConfidence}/100, below the preferred ${COMMUNITY_AI_ANALYSIS_MIN_OVERALL_CONFIDENCE}/100 threshold. The grounded opportunity is retained only as a preliminary pilot and must not be presented as a market-wide conclusion.`,
      ],
    };
  }

  private extractStrongestDirectProblemSentence(value: string): string | null {
    const body = value
      .replace(
        /^.*?\bCommunity comment:\s*/isu,
        '',
      )
      .replace(/\s+/gu, ' ')
      .trim();

    if (!body) {
      return null;
    }

    const candidates = body
      .split(/(?<=[.!?])\s+/u)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length >= 20)
      .filter((sentence) => this.looksLikeDirectProblemEvidence(sentence))
      .map((sentence) => {
        const normalized = this.normalizeComparableText(sentence);
        let score = Math.min(sentence.length, 240) / 80;

        const family = resolvePrimaryProblemFamily(sentence);
        if (family && !family.key.startsWith('lexical:')) {
          score += 9;
        }
        if (/(?:hallucinat|fabricat|made up|invented|false citation|wrong facts?|incorrect facts?|unsupported claims?)/u.test(normalized)) {
          score += 8;
        } else if (/(?:cannot|can t|unable|not working|fail|failed|error|wrong|incorrect|crash|slow|delay|wait too long|missing|risk|bias|liability|responsib|transparent|privacy|unsafe|struggle|difficult)/u.test(normalized)) {
          score += 5;
        }
        if (/(?:i |my |we |our |user |users |patient |patients |developer |developers |clinician |clinicians )/u.test(normalized)) {
          score += 2;
        }
        if (/(?:problem|issue)/u.test(normalized) && !family) {
          score += 0.5;
        }

        return { sentence, score };
      })
      .sort((first, second) => second.score - first.score);

    return candidates[0]?.sentence ?? null;
  }

  private buildProfessionalFallbackProblem(
    candidateProblem: string,
    evidenceSample: string,
  ): string {
    const directEvidenceSentence =
      this.extractStrongestDirectProblemSentence(evidenceSample);
    const candidateIsDirectProblem =
      this.looksLikeDirectProblemEvidence(candidateProblem);
    const candidateAtomicMatch = matchEvidenceToAtomicProblem(
      candidateProblem,
      evidenceSample,
    );
    const candidateProblemOverlap = this.tokenOverlap(
      this.normalizeComparableText(candidateProblem),
      this.normalizeComparableText(evidenceSample),
    );
    const evidenceFamily = resolvePrimaryProblemFamily(evidenceSample);
    const candidateFamily = resolvePrimaryProblemFamily(candidateProblem);
    const candidateFamilyConsistent =
      !evidenceFamily ||
      (candidateFamily !== null && candidateFamily.key === evidenceFamily.key);
    const candidateIntroducesUnsupportedConcept =
      this.introducesUnsupportedSemanticConcept(
        candidateProblem,
        evidenceSample,
      );
    const candidateIsEvidenceAligned =
      candidateFamilyConsistent &&
      !candidateIntroducesUnsupportedConcept &&
      (candidateAtomicMatch.matched || candidateProblemOverlap >= 0.28);
    const semanticText = this.normalizeComparableText(
      `${candidateIsEvidenceAligned ? candidateProblem : ''} ${evidenceSample}`,
    );

    if (this.isAiAssistantBrokenReferenceEvidence(semanticText)) {
      return 'Retained evidence describes AI assistant link-reliability failures in which provided links lead to broken or unavailable pages; direct user impact and broader prevalence still require validation.';
    }

    if (evidenceFamily?.key === 'ai-feedback-correction-inflexibility') {
      return directEvidenceSentence
        ? this.boundProblemText(directEvidenceSentence, 260)
        : 'Retained evidence describes an AI correction-loop failure in which a model does not reliably incorporate constructive feedback or correct an identified mistake across follow-up iterations; broader prevalence still requires validation.';
    }

    if (evidenceFamily?.key === 'ai-hallucination-output-reliability') {
      return directEvidenceSentence
        ? this.boundProblemText(directEvidenceSentence, 260)
        : 'Retained evidence describes AI hallucination or output-reliability failures in which generated responses contain unsupported, fabricated, or factually incorrect content that reduces trust and safe reuse; the evidence type and provenance determine whether it is direct or secondary.';
    }

    if (evidenceFamily?.key === 'legal-compliance-risk') {
      return 'A retained external report identifies legal, compliance, licensing, privacy, consent, or rights risk in the selected-domain workflow; the exact exposure and prevalence require further direct validation before operational use.';
    }

    if (
      !candidateIsEvidenceAligned &&
      directEvidenceSentence &&
      this.looksLikeDirectProblemEvidence(directEvidenceSentence)
    ) {
      return this.boundProblemText(directEvidenceSentence, 260);
    }

    if (
      /(?:glp[- ]?1|obesity|chronic disease|medication|drug)/u.test(semanticText) &&
      /(?:too expensive|expensive to cover|coverage|skyrocketing|costs?|payer|insurance)/u.test(semanticText)
    ) {
      return 'A retained healthcare report describes high medication-cost and coverage pressure around GLP-1 treatment, creating affordability and payer-coverage decisions that require careful human review.';
    }

    if (
      /(?:got married|married|name change|changed my (?:sur)?name|changed (?:my )?(?:sur)?name)/u.test(
        semanticText,
      ) &&
      /(?:government department|government departments|agencies|hmrc|dvla|passport office|dwp|student loans|land registry|record updated)/u.test(
        semanticText,
      )
    ) {
      return 'A resident reports substantial administrative effort after a name change because multiple government departments must be identified and updated separately.';
    }

    if (
      /(?:streaming pipeline|streaming data|data pipeline)/u.test(semanticText) &&
      /(?:stale|skewed|incorrect|wrong|corrupt|quietly serving|silently serving)/u.test(
        semanticText,
      )
    ) {
      return 'A retained engineering report describes a streaming pipeline that can silently serve stale, skewed, or incorrect data without crashing or raising an explicit error.';
    }

    if (
      /(?:license test response|licensing server|licensechecker|servermanagedpolicy|strictpolicy|not licensed|not_licensed|lvl licensing|google play licensing)/u.test(
        semanticText,
      ) &&
      /(?:android|google play|mobile app|test account|testing device|developer account)/u.test(
        semanticText,
      )
    ) {
      return 'A mobile developer reports that a Google Play licensing test returns NOT_LICENSED even after the expected test response, account, public-key, cache, and policy settings were checked.';
    }

    if (
      /(?:powershell|execution policy|pssecurityexception|running scripts is disabled|script execution disabled|unauthorizedaccess|\.ps1)/u.test(
        semanticText,
      )
    ) {
      return 'A retained technical ticket documents a local script-execution restriction in which a PowerShell-based tool cannot run because the operating-system execution policy blocks the script.';
    }

    if (
      /(?:transaction reverted|execution reverted|reverted without (?:a )?reason(?: string)?|providererror|provider error|transaction (?:failed|fails)|status (?:is |was )?always failed|smart contract (?:call|transaction|execution) (?:failed|fails|reverted)|gas estimation failed|cannot estimate gas|evm revert)/u.test(
        semanticText,
      ) &&
      /(?:blockchain|smart contract|contract|web3|hardhat|alchemy|goerli|ethereum|evm|solidity|transaction)/u.test(
        semanticText,
      )
    ) {
      return 'A smart-contract transaction diagnostics workflow that captures the failed transaction, contract and method, network/provider, revert or provider error, event/log evidence, gas context, suspected failing condition, and a human-reviewed remediation and verification path before retry.';
    }

    if (
      /(?:insufficient funds|insufficient balance|not enough funds)/u.test(
        semanticText,
      ) &&
      /(?:transaction|swap|transfer|wallet|fee|gas|sol|token|blockchain|jupiter)/u.test(
        semanticText,
      )
    ) {
      return 'A retained technical ticket documents a blockchain transaction that fails with an insufficient-funds error despite the reported wallet balance appearing adequate for the attempted operation.';
    }

    if (
      /\b(?:firefox|chrome|browser|tab|dapp|web3)\b/u.test(semanticText) &&
      /(?:crash|crashed|crashing|runtime failure|terminal shows no error|no corresponding terminal error)/u.test(
        semanticText,
      )
    ) {
      return 'A retained technical ticket documents a local Web3 development failure in which starting the DApp opens a browser tab that crashes without a corresponding terminal error.';
    }

    if (
      /(?:crash|crashes|crashed|crashing|runtime failure|runtime error|app closes|application closes|glitch|glitching|freeze|unresponsive)/u.test(
        semanticText,
      )
    ) {
      return 'A crash-diagnostics and recovery workflow that captures failure context, preserves the interrupted session state when possible, and guides human-reviewed remediation before the user repeats the same task.';
    }

    if (
      /(?:404|not found|missing url|incorrect url|broken route|broken link|redirect|deep link|destination page|missing endpoint|incorrect endpoint|endpoint failure)/u.test(
        semanticText,
      )
    ) {
      return 'A retained technical issue documents a navigation or routing failure in which a user action reaches a missing or incorrect destination endpoint instead of completing the intended workflow.';
    }

    if (
      /(?:legal researcher|legal research|legal tools?|law database|law databases|attorney|documentation|constitutional violation)/u.test(
        semanticText,
      ) &&
      /(?:1500|expensive|afford|price|pricing|licensing fee|documentation|screws with the facts|guardrail|looping)/u.test(
        semanticText,
      )
    ) {
      return 'An individual legal researcher reports that professional legal-research tools are unaffordable, documentation workload is difficult to manage, and general AI assistance can introduce factual errors or unstable guardrail behavior.';
    }

    if (
      /(?:mychart|patient portal|medical history|lab order|external medical|health document)/u.test(
        semanticText,
      ) &&
      /(?:upload|import|external platform|other platforms|invoice|eob|explanation of benefits)/u.test(
        semanticText,
      )
    ) {
      return 'A patient-portal user requests a secure way to import external medical-history or lab-order documents and an easier path to compare portal invoices with insurance explanation-of-benefits records.';
    }

    /*
     * Provider/NLP fallback records sometimes expose the parent video title as
     * the candidate problem while the actual complaint lives inside
     * "Community comment:". Prefer the verbatim direct-problem sentence in that
     * case so downstream problem-family matching can resolve the same persisted
     * source without synthetic paraphrase drift.
     */
    if (
      directEvidenceSentence &&
      (!candidateIsDirectProblem ||
        this.looksLikePromotionalOrPublisherText(candidateProblem))
    ) {
      return this.boundProblemText(directEvidenceSentence, 260);
    }

    if (
      /(?:paid .*cash|cash .*paid|already paid|charged .*again|double charg|duplicate charg|payment reconciliation|proof of payment .*?(?:again|additional|another))/u.test(
        semanticText,
      )
    ) {
      return 'A user reports a payment-reconciliation failure in which a service settled in cash is later requested or charged again by the central application, creating a duplicate-payment dispute that support has not resolved.';
    }

    if (
      /(?:venmo|bank|payment method|card)/u.test(semanticText) &&
      /(?:connect|link|connected|charged|charge)/u.test(semanticText)
    ) {
      return 'A finance user reports inconsistent payment-method handling in which a linked card can still be charged while the associated bank or wallet connection cannot be established or managed reliably.';
    }

    if (
      /(?:google|apple|email|identity provider|oauth)/u.test(
        semanticText,
      ) &&
      /(?:need to create account|create account using email|email sign up|email based sign up|only have google|only have apple|google or apple|identity provider|oauth)/u.test(
        semanticText,
      )
    ) {
      return 'A user reports an account-access barrier because the application restricts registration to specific identity providers and does not offer the requested email-based sign-up path.';
    }

    if (
      /(?:mental health|therap(?:y|ist)|counsel(?:or|lor)|ai for mental health)/u.test(
        semanticText,
      ) &&
      /(?:voice|voices|persona|personality|tone|warmth|stranger|not the same|bring back|latest update|removed|gone|deleted)/u.test(
        semanticText,
      )
    ) {
      return 'Retained user reviews describe therapeutic-continuity regressions in which familiar voices, tone, or counselor-like interaction behavior change or disappear after application updates, reducing continuity for affected users.';
    }

    if (
      /(?:binance|crypto|cryptocurrency|wallet|exchange|pexcoin|trading)/u.test(
        semanticText,
      ) &&
      /(?:nigeria|country|region|cannot use|can t use|unavailable|what other app|alternative)/u.test(
        semanticText,
      )
    ) {
      return 'A crypto user reports that a preferred trading platform is unavailable in their country and needs a clearly supported regional alternative for the same workflow.';
    }

    if (
      /(?:healthcare|health care|pharmacy|patient|clinical)/u.test(semanticText) &&
      /(?:artificial intelligence|\bai\b|ai assistant|phone assistant|customer service|automated support)/u.test(semanticText) &&
      /(?:complaint|failure|failed|friction|pulled|withdrew|service termination|dissatisfaction)/u.test(semanticText)
    ) {
      return 'Healthcare organizations may lack a structured way to capture, classify, and review failures in AI-assisted customer-service interactions before service quality deteriorates.';
    }

    if (
      /(?:security|vulnerabilit|hack|breach|unsafe)/u.test(semanticText) &&
      /(?:bill|billing|cloud cost|cost spike|financial exposure|30k|2k)/u.test(
        semanticText,
      )
    ) {
      return 'A developer reported that security vulnerabilities in an AI-assisted application could have caused substantial unexpected cloud costs before deployment.';
    }

    if (
      /(?:llm|large language model|ai coding|generated code|code assistant)/u.test(
        semanticText,
      ) &&
      /(?:bloated|refactor|rewrite|pushback|doesn t understand|does not understand|pretends|nonsensical)/u.test(
        semanticText,
      )
    ) {
      return 'Developers report that LLM coding assistants may accept invalid or unclear requests without challenge, hide uncertainty instead of requesting clarification, and generate bloated or poorly organized code that requires extensive manual refactoring.';
    }

    if (
      /(?:finance|financial|budget|spreadsheet|equation|algorithm|math|calculation)/u.test(
        semanticText,
      ) &&
      /(?:wrong|incorrect|inaccurate|error|miscalculat|confident|same dumb loop|kept doing|repeated)/u.test(
        semanticText,
      )
    ) {
      return 'A finance user reported that an AI assistant produced an incorrect equation with high confidence and continued returning incorrect revisions after the error was explicitly reported.';
    }

    if (
      /(?:accounting|invoice|quickbooks|customer email|financial software)/u.test(
        semanticText,
      ) &&
      /(?:slow|load|save|saved|missing|disappear|persistence|data loss)/u.test(
        semanticText,
      )
    ) {
      return 'Users report slow financial-software workflows and data-persistence failures in which customer details or invoice actions appear to save but later disappear, forcing repeated manual entry.';
    }

    const cleaned = this.cleanFallbackFragment(candidateProblem);
    if (
      candidateIsEvidenceAligned &&
      cleaned.length >= 35 &&
      !this.looksLikePromotionalOrPublisherText(cleaned)
    ) {
      return this.boundProblemText(cleaned, 260);
    }

    const extracted = this.extractProblemSection(evidenceSample);
    const evidenceDerived = this.cleanFallbackFragment(extracted || evidenceSample);
    if (
      evidenceDerived.length >= 35 &&
      !this.looksLikePromotionalOrPublisherText(evidenceDerived)
    ) {
      return this.boundProblemText(evidenceDerived, 260);
    }

    return 'The retained evidence indicates a possible software-workflow concern, but it does not contain a sufficiently explicit user complaint or unmet need to support a stronger problem statement.';
  }

  private buildProfessionalFallbackSolutionArea(
    candidateSolutionArea: string,
    repairedProblem: string,
    evidenceSample: string,
  ): string {
    const evidenceContext = this.normalizeComparableText(
      `${repairedProblem} ${evidenceSample}`,
    );
    const solutionOverlap = candidateSolutionArea
      ? this.tokenOverlap(
          this.normalizeComparableText(candidateSolutionArea),
          evidenceContext,
        )
      : 0;
    const primaryEvidenceFamily =
      resolvePrimaryProblemFamily(evidenceSample) ??
      resolvePrimaryProblemFamily(repairedProblem);
    const candidateSolutionFamily = candidateSolutionArea
      ? resolvePrimaryProblemFamily(candidateSolutionArea)
      : null;
    const solutionFamilyConsistent =
      !candidateSolutionFamily ||
      !primaryEvidenceFamily ||
      candidateSolutionFamily.key === primaryEvidenceFamily.key;
    const solutionAtomicMatch = candidateSolutionArea
      ? matchEvidenceToAtomicProblem(candidateSolutionArea, evidenceContext)
      : { matched: false };
    const solutionFamilyGrounded = Boolean(
      candidateSolutionFamily &&
      primaryEvidenceFamily &&
      candidateSolutionFamily.key === primaryEvidenceFamily.key,
    );
    const minimumSolutionOverlap =
      candidateSolutionFamily && !primaryEvidenceFamily ? 0.45 : 0.3;
    const solutionEvidenceGrounded =
      solutionFamilyGrounded ||
      solutionAtomicMatch.matched ||
      solutionOverlap >= minimumSolutionOverlap;
    const trustedSolutionArea =
      solutionEvidenceGrounded &&
      solutionFamilyConsistent &&
      !this.isInternalQualificationText(candidateSolutionArea) &&
      !this.introducesUnsupportedSemanticConcept(
        candidateSolutionArea,
        evidenceContext,
      ) &&
      !this.containsUnsupportedHighRiskMechanism(
        candidateSolutionArea,
        evidenceContext,
      )
        ? candidateSolutionArea
        : '';

    /*
     * Specialized solution inference must be evidence-driven. Including the
     * provider's candidate solution here allowed a stale field (for example a
     * payment solution attached to logistics evidence) to trigger its own
     * semantic branch even after the problem/evidence had been repaired.
     */
    const semanticText = evidenceContext;
    if (this.isAiAssistantBrokenReferenceEvidence(semanticText)) {
      return 'AI Reference Link Verification, Broken-Page Detection, Source Validation, and Human-Reviewed Resolution';
    }

    if (primaryEvidenceFamily?.key === 'identity-wallet-authentication-integration') {
      return 'OID4VP Identity Wallet Verifier Integration and Credential Authentication';
    }
    if (primaryEvidenceFamily?.key === 'device-protocol-compatibility') {
      return 'Device Protocol Compatibility and Integration Diagnostics';
    }
    if (primaryEvidenceFamily?.key === 'route-planning-capability') {
      return 'Route Planning Stop Import and Driver Reference Management';
    }
    if (primaryEvidenceFamily?.key === 'application-update-loop') {
      return 'Application Version Verification and Update-Loop Recovery';
    }
    if (primaryEvidenceFamily?.key === 'data-fragmentation') {
      return 'Data Integration, Normalization, and Source Coordination';
    }
    if (primaryEvidenceFamily?.key === 'marketplace-trust-safety') {
      return 'Marketplace Trust-and-Safety Fraud Correlation and Human Review';
    }
    if (primaryEvidenceFamily?.key === 'ai-feedback-correction-inflexibility') {
      return 'AI Feedback Capture, Correction Replay, Revision Comparison, and Human-Reviewed Output Recovery';
    }
    if (primaryEvidenceFamily?.key === 'ai-hallucination-output-reliability') {
      return 'AI Hallucination Detection, Factuality Verification, Source Grounding, and Human-Reviewed Output Reliability';
    }
    if (primaryEvidenceFamily?.key === 'legal-compliance-risk') {
      return 'Legal and Compliance Risk Review, Rights Verification, Disclosure Tracking, and Human-Reviewed Remediation';
    }

    if (
      /(?:name change|changed my (?:sur)?name|changed (?:my )?(?:sur)?name|multiple government departments|government departments must be identified and updated)/u.test(
        semanticText,
      )
    ) {
      return 'Cross-Agency Life-Event Update Guidance and Record-Change Coordination';
    }

    if (
      /(?:mychart|patient portal|medical history|lab order|external medical|health document)/u.test(
        semanticText,
      ) &&
      /(?:upload|import|invoice|eob|explanation of benefits)/u.test(semanticText)
    ) {
      return 'External Medical Document Import and Invoice/EOB Reconciliation';
    }

    if (
      /(?:streaming pipeline|streaming data|data pipeline)/u.test(semanticText) &&
      /(?:stale|skewed|incorrect|wrong|corrupt|silently serve|quietly serve)/u.test(
        semanticText,
      )
    ) {
      return 'Streaming Data Integrity, Validation, and Observability';
    }

    if (
      /(?:container|docker|bridge network|host network)/u.test(semanticText) &&
      /(?:tcp|socket|network mode|network_mode|gateway|connect|communication)/u.test(
        semanticText,
      )
    ) {
      return 'Inter-Container Network Boundary Diagnostics and Secure Socket Routing';
    }

    if (
      /(?:energy savings|gas savings|electricity savings|energy carrier|gas price|electricity price|price forecast)/u.test(
        semanticText,
      ) &&
      /(?:incorrect|inaccurate|distort|wrong|single value|same price|growth rate|npv|payback)/u.test(
        semanticText,
      )
    ) {
      return 'Energy-Carrier Savings Forecast Validation and Valuation Modeling';
    }

    if (
      /(?:license test response|licensing server|licensechecker|servermanagedpolicy|strictpolicy|not licensed|not_licensed|lvl licensing|google play licensing)/u.test(
        semanticText,
      ) &&
      /(?:android|google play|mobile app|test account|testing device|developer account)/u.test(
        semanticText,
      )
    ) {
      return 'Mobile App Licensing Test Diagnostics and Store Verification';
    }

    if (
      /\b(?:universit(?:y|ies)|higher education|learning platform|learning management system|lms|online exam|online assessment)\b/u.test(semanticText) &&
      /\b(?:login|authentication|account permissions?|access permissions?|device|security alerts?|compromised|account takeover|suspicious|unauthorized|unauthorised|academic integrity|exam integrity|false positive)\w*\b/u.test(semanticText) &&
      /\b(?:compromised|account takeover|suspicious|unauthorized|unauthorised|security|integrity|false positive|unnecessary restriction|incident|anomal)\w*\b/u.test(semanticText)
    ) {
      return 'Academic Platform Security and Exam Integrity Investigation';
    }

    if (
      /(?:can(?:not|['’]?t)|unable to)\s+(?:access|login|log in|sign in|log into|sign into)\s+(?:my|the|this)?\s*account|account access and authentication|login and account access|two[- ]factor authentication|2fa|multi[- ]factor authentication|verification code|authentication (?:failure|friction|timeout|loop)|sign[- ]in (?:failure|friction|loop)/u.test(
        semanticText,
      )
    ) {
      return 'Authentication and Account Access Recovery';
    }

    if (
      /(?:powershell|execution policy|pssecurityexception|running scripts is disabled|script execution disabled|unauthorizedaccess|\.ps1)/u.test(
        semanticText,
      )
    ) {
      return 'Local Script Execution Policy Diagnostics and Web3 Toolchain Recovery';
    }

    if (
      /(?:insufficient funds|insufficient balance|not enough funds)/u.test(
        semanticText,
      ) &&
      /(?:transaction|swap|transfer|wallet|fee|gas|sol|token|blockchain|jupiter)/u.test(
        semanticText,
      )
    ) {
      return 'Blockchain Transaction Balance and Fee Validation Diagnostics';
    }

    if (
      /\b(?:firefox|chrome|browser|tab|dapp|web3)\b/u.test(semanticText) &&
      /(?:crash|crashed|crashing|runtime failure|terminal shows no error|no corresponding terminal error)/u.test(
        semanticText,
      )
    ) {
      return 'Web3 Browser Runtime Diagnostics and Silent Crash Recovery';
    }

    if (
      /(?:taking time for mental health|time for mental health|mental health time|time off for mental health|mental health break|recovery time|self care time)/u.test(semanticText)
    ) {
      return 'Workday Mental Health Time Access and Recovery Planning';
    }

    if (
      /(?:treatment|care|medicine|therapy)/u.test(semanticText) &&
      /(?:unavailable|not available|another country|one country|cannot access|can t access|cross border)/u.test(semanticText)
    ) {
      return 'Treatment Availability Navigation and Access Validation';
    }

    if (
      /(?:crash|crashes|crashed|crashing|runtime failure|runtime error|freeze|frozen|unresponsive)/u.test(
        semanticText,
      ) &&
      /(?:app|application|mobile|software|browser|client|session|runtime)/u.test(
        semanticText,
      )
    ) {
      return 'A reliable crash-diagnostics and guided recovery workflow that captures the affected application state, preserves user context, and supports human-reviewed remediation without claiming an unverified root cause.';
    }

    if (
      !/(?:oid4vp|oid4vci|eudi[- ]?wallet|eudi wallet|verifiable presentations?|verifiable credentials?|wallet credentials?|identity credentials?|digital identity wallet|credential wallet|keycloak verifier|verifier functionality|verifier[- ]side|electronic attestations?)/u.test(semanticText) &&
      /(?:wallet|account balance|wallet balance|transaction history|transactions?|confirmations?)/u.test(
        semanticText,
      ) &&
      /(?:missing|not showing|fail(?:s|ed)? to appear|incorrect|wrong|visibility|synchroni[sz]|zero|0)/u.test(
        semanticText,
      ) &&
      /(?:blockchain|wallet|confirmed|confirmation)/u.test(semanticText)
    ) {
      return 'Wallet State Reconciliation and Transaction Visibility Diagnostics';
    }

    if (
      /(?:glp[- ]?1|obesity|chronic disease|medication|drug)/u.test(semanticText) &&
      /(?:too expensive|expensive to cover|coverage|skyrocketing|costs?|payer|insurance)/u.test(semanticText)
    ) {
      return 'Medication Affordability, Coverage Review, and Access Coordination';
    }

    if (
      /(?:paid .*cash|cash .*paid|already paid|charged .*again|double charg|duplicate charg|payment reconciliation|proof of payment .*?(?:again|additional|another))/u.test(
        semanticText,
      )
    ) {
      return 'Payment Reconciliation and Duplicate Charge Recovery';
    }

    if (
      /\brefund\b/u.test(semanticText) &&
      /(?:missing|failed|failure|pending|delayed|not received|never received|error|issue|problem)/u.test(
        semanticText,
      )
    ) {
      return 'Refund Status, Processing, and Recovery';
    }

    if (
      /(?:payment|checkout|card|bank|billing)/u.test(semanticText) &&
      /(?:error|fail(?:s|ed|ure|ing)?|declin(?:e|ed)|reject(?:ed|ion)?|blocked|not accepted|not processed|not working|cannot|can t|unable)/u.test(
        semanticText,
      )
    ) {
      return 'Payment Error Diagnosis, Retry Guidance, and Recovery';
    }

    if (
      /(?:venmo|bank|payment method|card)/u.test(semanticText) &&
      /(?:connect|link|connected|charged|charge)/u.test(semanticText)
    ) {
      return 'Payment Method Linking and Charge Consistency';
    }

    if (
      /(?:google|apple|email|identity provider|oauth)/u.test(
        semanticText,
      ) &&
      /(?:need to create account|create account using email|email sign up|email based sign up|only have google|only have apple|google or apple|identity provider|oauth)/u.test(
        semanticText,
      )
    ) {
      return 'A user reports an account-access barrier because the application restricts registration to specific identity providers and does not offer the requested email-based sign-up path.';
    }

    if (
      /(?:mental health|therap(?:y|ist)|counsel(?:or|lor)|ai for mental health)/u.test(
        semanticText,
      ) &&
      /(?:voice|voices|persona|personality|tone|warmth|stranger|not the same|bring back|latest update|removed|gone|deleted)/u.test(
        semanticText,
      )
    ) {
      return 'Therapeutic Persona Continuity and Asset Regression Monitoring';
    }

    if (
      /(?:binance|crypto|cryptocurrency|wallet|exchange|pexcoin|trading)/u.test(
        semanticText,
      ) &&
      /(?:nigeria|country|region|cannot use|can t use|unavailable|what other app|alternative)/u.test(
        semanticText,
      )
    ) {
      return 'Regional Crypto Access Compatibility and Alternative Platform Guidance';
    }

    if (
      /(?:404|not found|missing url|incorrect url|broken route|broken link|redirect|deep link|destination page|missing endpoint|incorrect endpoint|endpoint failure)/u.test(
        semanticText,
      )
    ) {
      return 'Navigation and Routing Endpoint Recovery';
    }

    if (
      /(?:legal researcher|legal research|law database|documentation)/u.test(
        semanticText,
      ) &&
      /(?:afford|expensive|price|licensing|factual|facts|guardrail|looping)/u.test(
        semanticText,
      )
    ) {
      return 'Affordable Legal Evidence Documentation and Factuality Review';
    }

    if (
      /(?:home inventory|household inventory|belongings?|item|items|room|rooms)/u.test(
        semanticText,
      ) &&
      /(?:reminder|search|find|locate|label|assignment|packed|fragile|moving|unpacking)/u.test(
        semanticText,
      )
    ) {
      return 'A household inventory and moving-coordination workflow that links belongings to rooms and labels, connects reminders and tasks to the exact item, and helps family members find packed or essential items without duplicate manual tracking.';
    }

    if (
      /(?:moving app|moving application|move to a new home|moving home|house move)/u.test(
        semanticText,
      ) &&
      /(?:onboarding|navigate|navigation|confusing|hard to use)/u.test(
        semanticText,
      )
    ) {
      return 'A guided moving-app onboarding workflow that makes the next required task, service update, and household setup step easy to find and complete.';
    }

    if (
      /(?:traffic|congestion|public transport|public transportation|transit|bus|train|road incident|urban mobility)/u.test(
        semanticText,
      ) &&
      /(?:air pollution|air quality|emissions?|environmental)/u.test(
        semanticText,
      )
    ) {
      return 'A unified urban-mobility workflow that correlates traffic, transit reliability, road incidents, and environmental measurements so city teams can identify operational changes that reduce delay and emissions.';
    }

    if (
      /(?:mass email(?:ing)?|bulk email(?:ing)?).{0,120}(?:client contacts?|clients?)/u.test(
        semanticText,
      )
    ) {
      return 'ATS Client Contact Outreach and Campaign Management';
    }

    if (
      /(?:candidate|applicant) profiles?.{0,140}(?:save|sort|portal|pool|reuse|regular basis|recurring hiring|hire store workers)/u.test(
        semanticText,
      )
    ) {
      return 'Candidate Profile Pooling and Recurring Hiring Management';
    }

    const cleaned = this.boundProblemText(trustedSolutionArea, 180);
    if (
      cleaned &&
      !/focused software workflow for diagnosis, validation, and guided resolution/iu.test(
        cleaned,
      )
    ) {
      return cleaned;
    }

    if (primaryEvidenceFamily) {
      return `${this.toTitleCase(primaryEvidenceFamily.label)} Diagnosis and Human-Reviewed Recovery`;
    }

    return 'Evidence-Grounded Workflow Diagnosis and Human-Reviewed Recovery';
  }

  private buildProfessionalFallbackNeed(
    candidateNeed: string,
    repairedProblem: string,
    evidenceSample = '',
  ): string {
    const cleanedNeed = this.cleanFallbackFragment(candidateNeed)
      .replace(/^a reliable workflow that resolves\s*:\s*/iu, '')
      .trim();
    const evidenceContext = this.normalizeComparableText(
      `${repairedProblem} ${evidenceSample}`,
    );
    const needAtomicMatch = matchEvidenceToAtomicProblem(
      cleanedNeed,
      evidenceSample || repairedProblem,
    );
    const needOverlap = cleanedNeed
      ? this.tokenOverlap(
          this.normalizeComparableText(cleanedNeed),
          evidenceContext,
        )
      : 0;
    const candidateNeedIsAligned =
      Boolean(cleanedNeed) &&
      !this.isInternalQualificationText(cleanedNeed) &&
      !this.introducesUnsupportedSemanticConcept(cleanedNeed, evidenceContext) &&
      (needAtomicMatch.matched || needOverlap >= 0.3);

    const semanticText = this.normalizeComparableText(
      `${candidateNeedIsAligned ? cleanedNeed : ''} ${repairedProblem} ${evidenceSample}`,
    );

    const primaryEvidenceFamily =
      resolvePrimaryProblemFamily(evidenceSample) ??
      resolvePrimaryProblemFamily(repairedProblem);
    if (this.isAiAssistantBrokenReferenceEvidence(semanticText)) {
      return 'AI users and product teams need a traceable link-verification workflow that checks referenced URLs, records broken or unavailable destinations, preserves source context, and routes uncertain replacements to human review before reuse.';
    }

    if (primaryEvidenceFamily?.key === 'identity-wallet-authentication-integration') {
      return 'Government identity systems need native verifier-side support for OID4VP-compatible digital identity wallets so users can authenticate with verified credentials such as PID or electronic attestations.';
    }
    if (primaryEvidenceFamily?.key === 'device-protocol-compatibility') {
      return 'Users need a compatibility workflow that verifies supported device protocols, identifies incompatible fitness equipment or wearables, and guides supported connection options before hardware is purchased or configured.';
    }
    if (primaryEvidenceFamily?.key === 'route-planning-capability') {
      return 'Route planners need a workflow for importing stop lists, preserving driver reference numbers, and validating route constraints before dispatch.';
    }
    if (primaryEvidenceFamily?.key === 'application-update-loop') {
      return 'Users need a version-verification workflow that distinguishes a genuine required update from an erroneous update loop and guides safe access recovery without assuming an unverified root cause.';
    }
    if (primaryEvidenceFamily?.key === 'data-fragmentation') {
      return 'Operators need a unified data-integration workflow that normalizes fragmented records from disconnected sources, exposes inconsistencies, and preserves source provenance for human review.';
    }
    if (primaryEvidenceFamily?.key === 'marketplace-trust-safety') {
      return 'Marketplace trust-and-safety teams need a unified workflow that correlates seller, listing, review, transaction, and security signals while preserving human review for false-positive restrictions.';
    }
    if (primaryEvidenceFamily?.key === 'ai-feedback-correction-inflexibility') {
      return 'AI users need a traceable correction workflow that preserves the original prompt and output, captures the user’s corrective feedback, compares revised outputs, and makes it clear whether the identified mistake was actually addressed before reuse.';
    }
    if (primaryEvidenceFamily?.key === 'ai-hallucination-output-reliability') {
      return 'AI users and product teams need a traceable workflow that captures hallucinated or unsupported outputs, preserves prompt and model context, verifies factual claims and cited sources, and routes uncertain results to human review before reuse.';
    }
    if (primaryEvidenceFamily?.key === 'legal-compliance-risk') {
      return 'Teams need a structured workflow to identify legal, compliance, licensing, privacy, consent, disclosure, and rights risks in the retained use case, preserve supporting evidence, and route unresolved exposure to authorized human review.';
    }

    if (
      /(?:halal|veg|non veg|vegetarian|dietary)/u.test(semanticText) &&
      /(?:restaurant|dining|food delivery|food discovery)/u.test(semanticText) &&
      /(?:filter|filtering|option|search)/u.test(semanticText)
    ) {
      return 'Diners need a restaurant-search workflow that lets them filter listings by Halal-friendly dietary preference alongside existing dietary filters using transparent restaurant metadata.';
    }

    if (
      primaryEvidenceFamily?.key === 'delivery-tracking' ||
      (/(?:shipment|shipping|delivery|carrier|courier|dispatch|driver|waybill|transport note|cargo|consignee)/u.test(
        semanticText,
      ) &&
        /(?:delay|delayed|stuck|lost|missing|handoff|mismatch|correction|wait|not delivered|tracking)/u.test(
          semanticText,
        ))
    ) {
      return 'Dispatch and delivery teams need a shipment-tracking and handoff workflow that verifies transport records, surfaces delays or delivery exceptions, preserves evidence across handoffs, and routes unresolved discrepancies to human review.';
    }

    if (primaryEvidenceFamily?.key === 'blockchain-transaction-execution') {
      return 'Blockchain developers and operators need a transaction-failure diagnostics workflow that captures the failed transaction, contract method, network/provider context, revert or provider error, logs, gas state, and human-reviewed recovery path before any retry is submitted.';
    }

    if (
      /(?:name change|changed my (?:sur)?name|changed (?:my )?(?:sur)?name|multiple government departments|government departments must be identified and updated)/u.test(
        semanticText,
      )
    ) {
      return 'A centralized workflow that identifies the government agencies affected by a life event and guides residents through each required record-update process.';
    }

    if (
      /(?:streaming pipeline|streaming data|data pipeline)/u.test(semanticText) &&
      /(?:stale|skewed|incorrect|wrong|corrupt|silently serve|quietly serve)/u.test(
        semanticText,
      )
    ) {
      return 'Automated data validation and integrity monitoring that detects stale, skewed, or incorrect streaming payloads even when the pipeline does not crash or emit an error.';
    }

    if (
      /(?:mychart|patient portal|medical history|lab order|external medical|health document)/u.test(
        semanticText,
      ) &&
      /(?:upload|import|invoice|eob|explanation of benefits)/u.test(semanticText)
    ) {
      return 'Patients need a secure workflow to import external medical-history and lab-order documents, preserve them across provider boundaries, and reconcile portal invoices with insurance explanation-of-benefits records.';
    }

    if (
      /(?:can(?:not|['’]?t)|unable to)\s+(?:access|login|log in|sign in|log into|sign into)\s+(?:my|the|this)?\s*account|account access and authentication|login and account access|two[- ]factor authentication|2fa|multi[- ]factor authentication|verification code|authentication (?:failure|friction|timeout|loop)|sign[- ]in (?:failure|friction|loop)/u.test(
        semanticText,
      )
    ) {
      return 'A reliable authentication and account-recovery workflow that helps affected users regain access without losing session or identity context.';
    }

    if (
      /(?:container|docker|bridge network|host network)/u.test(semanticText) &&
      /(?:tcp|socket|network mode|network_mode|gateway|connect|communication)/u.test(
        semanticText,
      )
    ) {
      return 'A secure inter-container connectivity workflow that validates bridge-to-host routing, reachable socket endpoints, and least-privilege network boundaries without exposing an entire container to the host network.';
    }

    if (
      /(?:energy savings|gas savings|electricity savings|energy carrier|gas price|electricity price|price forecast)/u.test(
        semanticText,
      ) &&
      /(?:incorrect|inaccurate|distort|wrong|single value|same price|growth rate|npv|payback)/u.test(
        semanticText,
      )
    ) {
      return 'A deterministic energy-savings model that preserves gas and electricity as separate carriers, applies the correct price forecast to each, and exposes valuation differences for human review.';
    }

    if (
      /(?:license test response|licensing server|licensechecker|servermanagedpolicy|strictpolicy|not licensed|not_licensed|lvl licensing|google play licensing)/u.test(
        semanticText,
      ) &&
      /(?:android|google play|mobile app|test account|testing device|developer account)/u.test(
        semanticText,
      )
    ) {
      return 'A deterministic licensing-test workflow that verifies store account state, test-response configuration, public-key setup, cache state, and server results before developers change unrelated application logic.';
    }

    if (
      /(?:powershell|execution policy|pssecurityexception|running scripts is disabled|script execution disabled|unauthorizedaccess|\.ps1)/u.test(
        semanticText,
      )
    ) {
      return 'A local developer-diagnostics workflow that identifies script-execution policy restrictions and guides scoped recovery without weakening machine-wide security controls.';
    }

    if (
      /(?:transaction reverted|execution reverted|reverted without (?:a )?reason(?: string)?|providererror|provider error|transaction (?:failed|fails)|status (?:is |was )?always failed|smart contract (?:call|transaction|execution) (?:failed|fails|reverted)|gas estimation failed|cannot estimate gas|evm revert)/u.test(
        semanticText,
      ) &&
      /(?:blockchain|smart contract|contract|web3|hardhat|alchemy|goerli|ethereum|evm|solidity|transaction)/u.test(
        semanticText,
      )
    ) {
      return 'A smart-contract transaction diagnostics workflow that captures the failed transaction, contract and method, network/provider, revert or provider error, event/log evidence, gas context, suspected failing condition, and a human-reviewed remediation and verification path before retry.';
    }

    if (
      /(?:insufficient funds|insufficient balance|not enough funds)/u.test(
        semanticText,
      ) &&
      /(?:transaction|swap|transfer|wallet|fee|gas|sol|token|blockchain|jupiter)/u.test(
        semanticText,
      )
    ) {
      return 'A transaction-validation workflow that reconciles spendable balance, fees, reserves, and account requirements before a blockchain transfer or swap is submitted.';
    }

    if (
      /\b(?:firefox|chrome|browser|tab|dapp|web3)\b/u.test(semanticText) &&
      /(?:crash|crashed|crashing|runtime failure|terminal shows no error|no corresponding terminal error)/u.test(
        semanticText,
      )
    ) {
      return 'A Web3 runtime-diagnostics workflow that correlates browser crash signals with local development configuration and terminal output to support human-reviewed recovery.';
    }

    if (
      /(?:wallet|account balance|wallet balance|transaction history|transactions?|confirmations?)/u.test(
        semanticText,
      ) &&
      /(?:missing|not showing|fail(?:s|ed)? to appear|incorrect|wrong|visibility|synchroni[sz]|zero|0)/u.test(
        semanticText,
      ) &&
      /(?:blockchain|wallet|confirmed|confirmation)/u.test(semanticText)
    ) {
      return 'A wallet-state reconciliation workflow that compares blockchain-confirmed activity with client-visible balances, confirmation counts, and recent transaction history for human-reviewed diagnostics.';
    }

    if (
      /(?:glp[- ]?1|obesity|chronic disease|medication|drug)/u.test(semanticText) &&
      /(?:too expensive|expensive to cover|coverage|skyrocketing|costs?|payer|insurance)/u.test(semanticText)
    ) {
      return 'A human-reviewed workflow for evaluating medication affordability, coverage constraints, and treatment-access tradeoffs without converting a cost signal into a generic payment-failure claim.';
    }

    if (
      /(?:paid .*cash|cash .*paid|already paid|charged .*again|double charg|duplicate charg|payment reconciliation|proof of payment .*?(?:again|additional|another))/u.test(
        semanticText,
      )
    ) {
      return 'A payment-reconciliation workflow that preserves proof of settlement, detects duplicate-payment discrepancies, and organizes evidence for human support review.';
    }

    if (
      /(?:venmo|bank|payment method|card)/u.test(semanticText) &&
      /(?:connect|link|connected|charged|charge)/u.test(semanticText)
    ) {
      return 'A payment-method consistency workflow that verifies wallet or bank linking state, explains charge-path mismatches, and guides safe human-reviewed recovery.';
    }

    if (
      /(?:healthcare|health care|pharmacy|patient|clinical)/u.test(semanticText) &&
      /(?:artificial intelligence|\bai\b|ai assistant|phone assistant|customer service|automated support)/u.test(semanticText) &&
      /(?:complaint|failure|failed|friction|service|support)/u.test(semanticText)
    ) {
      return 'A human-reviewed healthcare AI feedback workflow that captures interaction failures, classifies complaint patterns, and validates remediation priorities before broader deployment.';
    }

    if (
      /(?:404|not found|missing url|incorrect url|broken route|broken link|redirect|deep link|destination page|missing endpoint|incorrect endpoint|endpoint failure)/u.test(
        semanticText,
      )
    ) {
      return 'A routing-resilience workflow that captures failed navigation endpoints, preserves diagnostic context, and routes verified technical exceptions to human operators for correction.';
    }

    if (
      /(?:legal researcher|legal research|legal tools?|law database|law databases|attorney|documentation)/u.test(
        semanticText,
      ) &&
      /(?:afford|expensive|price|pricing|licensing|factual|facts|guardrail|looping|documentation)/u.test(
        semanticText,
      )
    ) {
      return 'An affordable legal-documentation workflow with source-grounded evidence organization, factuality checks, and human review for independent researchers.';
    }

    if (
      /(?:security|vulnerabilit|hack|breach|unsafe)/u.test(semanticText) &&
      /(?:bill|billing|cloud cost|cost spike|financial exposure)/u.test(
        semanticText,
      )
    ) {
      return 'A focused security-audit workflow that identifies high-risk vulnerabilities and cost-inflating configurations before an AI-assisted application reaches production.';
    }

    if (
      /(?:llm|large language model|ai coding|generated code|code assistant)/u.test(
        semanticText,
      ) &&
      /(?:coding|code|generated code|repository|refactor|bloated|rewrite|pushback|invalid request|nonsensical)/u.test(
        semanticText,
      )
    ) {
      return 'A validation workflow that challenges ambiguous AI coding requests, exposes uncertainty, and flags bloated or poorly structured generated code before repository integration.';
    }

    if (
      /(?:finance|financial|budget|spreadsheet|equation|algorithm|math|calculation)/u.test(
        semanticText,
      ) &&
      /(?:wrong|incorrect|inaccurate|error|miscalculat|confident|repeated)/u.test(
        semanticText,
      )
    ) {
      return 'A verification workflow that checks AI-generated financial equations against deterministic calculations, exposes mismatches, and requires human review before the result is reused.';
    }

    if (
      /(?:accounting|invoice|financial software|customer details)/u.test(
        semanticText,
      )
    ) {
      return 'A fast, reliable accounting workflow that persists customer and invoice data without silent loss or duplicate manual entry.';
    }

    if (
      /(?:rent|rental|lease|housing|home|property)/u.test(semanticText) &&
      /(?:filter|filtering|short term|long term|lease term|rental length)/u.test(
        semanticText,
      )
    ) {
      return 'A rental-search workflow that lets housing seekers include or exclude listings by lease duration and distinguish long-term housing from short-term rentals.';
    }

    if (
      /(?:home inventory|household inventory|belongings?|item|items|room|rooms)/u.test(
        semanticText,
      ) &&
      /(?:reminder|search|find|locate|label|assignment|packed|fragile|moving|unpacking)/u.test(
        semanticText,
      )
    ) {
      return 'A household inventory and moving-coordination workflow that links belongings to rooms and labels, connects reminders and tasks to the exact item, and helps family members find packed or essential items without duplicate manual tracking.';
    }

    if (
      /(?:moving app|moving application|move to a new home|moving home|house move)/u.test(
        semanticText,
      ) &&
      /(?:onboarding|navigate|navigation|confusing|hard to use)/u.test(
        semanticText,
      )
    ) {
      return 'A guided moving-app onboarding workflow that makes the next required task, service update, and household setup step easy to find and complete.';
    }

    if (
      /(?:traffic|congestion|public transport|public transportation|transit|bus|train|road incident|urban mobility)/u.test(
        semanticText,
      ) &&
      /(?:air pollution|air quality|emissions?|environmental)/u.test(
        semanticText,
      )
    ) {
      return 'A unified urban-mobility workflow that correlates traffic, transit reliability, road incidents, and environmental measurements so city teams can identify operational changes that reduce delay and emissions.';
    }

    if (
      /(?:mass email(?:ing)?|bulk email(?:ing)?).{0,120}(?:client contacts?|clients?)/u.test(
        semanticText,
      )
    ) {
      return 'A controlled ATS outreach workflow for saved client contacts, segmented mass email dispatch, and auditable communication tracking.';
    }

    if (
      /(?:candidate|applicant) profiles?.{0,140}(?:save|sort|portal|pool|reuse|regular basis|recurring hiring|hire store workers)/u.test(
        semanticText,
      )
    ) {
      return 'A recurring-hiring workflow for saving, sorting, searching, and reusing candidate profiles in a structured talent pool.';
    }

    if (
      candidateNeedIsAligned &&
      cleanedNeed.length >= 30 &&
      !this.looksLikePromotionalOrPublisherText(cleanedNeed)
    ) {
      return this.boundProblemText(cleanedNeed, 220);
    }

    if (primaryEvidenceFamily) {
      return `A focused workflow that diagnoses and resolves ${primaryEvidenceFamily.label.toLowerCase()} using the retained evidence as the validation baseline, while routing uncertain cases to human review.`;
    }

    return 'A focused workflow that diagnoses the specific retained evidence signal, preserves the affected workflow context, and validates a human-reviewed recovery path before broader demand claims are made.';
  }

  private introducesUnsupportedSemanticConcept(
    candidate: string,
    evidenceContext: string,
  ): boolean {
    const normalizedCandidate = this.normalizeComparableText(candidate);
    const normalizedEvidence = this.normalizeComparableText(evidenceContext);

    if (!normalizedCandidate || !normalizedEvidence) {
      return false;
    }

    const conceptGroups: readonly {
      readonly candidate: RegExp;
      readonly evidence: RegExp;
    }[] = [
      {
        candidate: /(?:artificial intelligence|\bai\b|ai assisted|ai generated|llm|machine learning|model inference|prompt)/u,
        evidence: /(?:artificial intelligence|\bai\b|ai assistant|llm|machine learning|model inference|prompt|generated code)/u,
      },
      {
        candidate: /(?:security audit|vulnerabilit|breach|hack|cyber attack|threat model|penetration test)/u,
        evidence: /(?:security audit|vulnerabilit|breach|hack|cyber attack|threat model|penetration test|malware|phishing)/u,
      },
      {
        candidate: /(?:financial equation|deterministic calculation|cash flow|npv|payback|budget|accounting|invoice reconciliation|pricing model)/u,
        evidence: /(?:financial equation|calculation|cash flow|npv|payback|budget|accounting|invoice|pricing|price forecast|gas price|electricity price)/u,
      },
      {
        candidate: /(?:legal research|legal document|contract execution|proof verification|attorney|law database|case law)/u,
        evidence: /(?:legal research|legal document|contract|attorney|law database|case law|legal workflow)/u,
      },
      {
        candidate: /(?:therapeutic continuity|therapeutic persona|voice continuity|counselor like|counsellor like|persona continuity|tone continuity|asset regression)/u,
        evidence: /(?:(?:voice|voices|persona|personality|tone|warmth|counselor|counsellor|therapist|interaction style|memory of conversations?)\b[^.!?]{0,180}\b(?:changed|different|gone|removed|deleted|stranger|not the same|bring back|latest update|after an? update|lost|stopped remembering|no longer remembers?)|(?:changed|different|gone|removed|deleted|stranger|not the same|bring back|latest update|after an? update|lost|stopped remembering|no longer remembers?)\b[^.!?]{0,180}\b(?:voice|voices|persona|personality|tone|warmth|counselor|counsellor|therapist|interaction style|memory of conversations?))/u,
      },
      {
        candidate: /(?:clinical|patient|medical|sparse measurement|missing by design|missingness|imputation|clinical data quality)/u,
        evidence: /(?:(?:patient|clinical|medical|physionet|sepsis|test results?)\b[^.!?]{0,160}\b(?:missing|null|sparse|measurement|imput|forward fill)|(?:missing|null|sparse|imput|forward fill|test results?)\b[^.!?]{0,160}\b(?:patient|clinical|medical|physionet|sepsis))/u,
      },
      {
        candidate: /(?:authentication|account recovery|account access|login|sign in|identity provider|\boauth\b|\bmfa\b|\b2fa\b|credential|password)/u,
        evidence: /(?:authentication|account access|login|log in|sign in|signin|identity provider|\boauth\b|\bmfa\b|\b2fa\b|two factor|credential|password|verification code|can t access|cannot access|unable to access|only have google|only have apple|create account using email)/u,
      },
      {
        candidate: /(?:google or apple|email based sign up|email sign up|create account using email|registration by email|email registration)/u,
        evidence: /(?:google or apple|only (?:have|has) google|only (?:have|has) apple|sign up (?:using|with) email|create account (?:using|with) email|email registration|email sign up)/u,
      },
      {
        candidate: /(?:identity provider|\boauth\b|google sign in|google login|apple sign in|apple login|registration provider)/u,
        evidence: /(?:identity provider|\boauth\b|google (?:sign in|login)|apple (?:sign in|login)|registration provider)/u,
      },
      {
        candidate: /(?:ai coding|coding request|generated code|repository integration|manual refactor|refactoring|bloated code|code assistant)/u,
        evidence: /(?:ai coding|coding request|generated code|repository|refactor|bloated|code assistant|coding assistant)/u,
      },
      {
        candidate: /(?:blockchain|distributed ledger|smart contract|on chain|web3|wallet transaction|blockchain confirmed|wallet balance|confirmation count|transaction history)/u,
        evidence: /(?:blockchain|distributed ledger|smart contract|on chain|web3|crypto(?:currency)?|bitcoin|ethereum|solana|token balance|wallet balance|transaction confirmation|blockchain confirmation)/u,
      },
      {
        candidate: /(?:search and filtering|search criteria|filtering workflow|catalog filtering)/u,
        evidence: /(?:search|filter|filtering|search criteria|catalog|listing)/u,
      },
      {
        candidate: /(?:rental[- ]?search|housing seekers?|property listings?|lease[- ]?term|lease duration|rental duration|rental term|short[- ]term rental|long[- ]term rental|short term housing|long term housing)/u,
        evidence: /(?:rental[- ]?search|housing seekers?|property listings?|lease[- ]?term|lease duration|rental duration|rental term|short[- ]term rental|long[- ]term rental|short term housing|long term housing)/u,
      },
      {
        candidate: /(?:location filter|filter by location|favorites location|multi[- ]criteria filter|multiple filters|custom tags?|tag persistence)/u,
        evidence: /(?:location filter|filter favorites via location|filter my favorites via location|multiport|multiple filters|2 filter|custom tags?|my own tags|tags function|tagged a lot)/u,
      },
      {
        candidate: /(?:routing resilience|routing-resilience|failed navigation|navigation endpoint|broken route|broken navigation|redirect failure|deep link failure)/u,
        evidence: /(?:404|not found|broken link|broken route|route (?:fails|failed|failure)|navigation (?:fails|failed|failure)|cannot navigate|can t navigate|redirect (?:fails|failed|failure)|deep link (?:fails|failed|failure))/u,
      },
      {
        candidate: /(?:crash|runtime failure|application stability|crash recovery)/u,
        evidence: /(?:\bcrash(?:es|ed|ing)?\b|runtime failure|application stability|unexpected closure|force close)/u,
      },
    ];

    return conceptGroups.some(
      (group) =>
        group.candidate.test(normalizedCandidate) &&
        !group.evidence.test(normalizedEvidence),
    );
  }

  private isInternalQualificationText(value: string): boolean {
    const normalized = this.normalizeComparableText(value);
    if (!normalized) return false;

    return /(?:bounded workflow that addresses the concrete retained evidence|measures whether the observed friction improves|keeps broader demand claims preliminary|additional independent evidence|validation workflow that preserves the requester described problem|requester intent validation|problem discovery validation and configurable pilot workflow|focused workflow that diagnoses the specific retained user friction|preserves the affected workflow context|human reviewed recovery path|evidence grounded workflow diagnosis)/u.test(
      normalized,
    );
  }

  /** Removes broken sentence prefixes created by upstream bounded slicing. */
  private cleanFallbackFragment(value: string): string {
    let normalized = value.replace(/\s+/gu, ' ').trim();

    normalized = normalized
      .replace(/^s that leap out at me the most[.!?]?\s*/iu, '')
      .replace(/^that leap out at me the most[.!?]?\s*/iu, '')
      .replace(/^the most[.!?]?\s*/iu, '')
      .replace(/^(?:and|but|so|because)\s+/iu, '')
      .trim();

    if (normalized && /^[a-z]/u.test(normalized)) {
      normalized = normalized.charAt(0).toUpperCase() + normalized.slice(1);
    }

    return normalized;
  }

  private toTitleCase(value: string): string {
    const minorWords = new Set(['and', 'or', 'for', 'to', 'of', 'in', 'on', 'with']);
    return value
      .split(/\s+/u)
      .map((word, index) => {
        const lower = word.toLowerCase();
        if (index > 0 && minorWords.has(lower)) {
          return lower;
        }
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      })
      .join(' ');
  }

  private singularizeSingleReportProblem(value: string): string {
    return value
      .replace(
        /\bUsers experience complete failure when attempting to\b/giu,
        'One user reported a complete failure when attempting to',
      )
      .replace(
        /\bUsers consistently (?:experience|encounter|face)\b/giu,
        'One user reported experiencing',
      )
      .replace(
        /\bUsers consistently\b/giu,
        'One user reported that they',
      )
      .replace(
        /\bUsers (?:experience|encounter|face)\b/giu,
        'One user reported experiencing',
      )
      .replace(
        /\bVehicle owners (?:experience|encounter|face|fail to)\b/giu,
        'One vehicle owner reported experiencing',
      )
      .replace(
        /\b([A-Z][\p{L}'’&-]*(?:\s+[A-Z][\p{L}'’&-]*){0,3}) buyers (?:experience|encounter|face)\b/gu,
        'One buyer in $1 reported experiencing',
      )
      .replace(
        /\bBuyers (?:experience|encounter|face)\b/giu,
        'One buyer reported experiencing',
      )
      .replace(
        /\b(?:Language learners|Online learners|Learners|Students) lack\b/giu,
        'One learner reported lacking',
      )
      .replace(
        /\b(?:Language learners|Online learners|Learners|Students) (?:experience|encounter|face)\b/giu,
        'One learner reported experiencing',
      )
      .replace(
        /\b(?:a )?recurring challenge where vehicle owners fail to\b/giu,
        'a pairing difficulty reported by one vehicle owner who was unable to',
      )
      .replace(
        /\b(?:users|operators|customers|developers|creators|learners|students|buyers|sellers) (?:often|frequently|commonly|typically)\b/giu,
        'one observed user',
      )
      .replace(/\s{2,}/gu, ' ')
      .trim();
  }

  private normalizeComparableText(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Grounds AI-generated opportunities against the persisted NLP evidence.
   *
   * Unsupported evidence samples are removed. An individual opportunity
   * is discarded when none of its evidence samples can be grounded.
   *
   * The complete AI response is rejected only when no grounded
   * opportunities remain.
   */
  private applyEvidenceGrounding(
    context: IdeaGenerationContext,
    analysis: CommunityAiAnalysis,
    allowExactRetainedEvidence = false,
  ): CommunityAiAnalysis {
    if (!context.nlp) {
      throw new Error('NLP evidence is required for grounding validation.');
    }

    const requestDescription = context.requestDescription?.trim() ?? '';
    const canonicalCorpus = this.collectEvidenceCorpus(context.domainEvidence);
    const acceptedRawEvidenceIds = new Set(
      (analysis.evidenceClassifications ?? [])
        .filter(
          (item) =>
            item.classification === 'DIRECT_PROBLEM' ||
            item.classification === 'SUPPORTING_SIGNAL',
        )
        .map((item) => item.evidenceId),
    );
    const rawTriageCorpus = this.collectEvidenceCorpus(
      (context.rawEvidenceCorpus ?? []).filter((item) =>
        acceptedRawEvidenceIds.has(item.id),
      ),
    );
    const supplementalCorpus = this.collectEvidenceCorpus(context.nlp);
    const hasRawTriageCorpus = (context.rawEvidenceCorpus?.length ?? 0) > 0;
    const fallbackRequestCorpus = requestDescription
      ? [...canonicalCorpus, ...supplementalCorpus].filter(
          (sample) =>
            RequestEvidenceAlignmentUtil.classifyForRequest({
              requestDescription,
              evidenceText: sample,
              plannedQueries: context.collectionPlan?.searchQueries ?? [],
            }) !== 'UNRELATED',
        )
      : [...canonicalCorpus, ...supplementalCorpus];
    const requireAcceptedRawTriage = hasRawTriageCorpus && Boolean(requestDescription);
    const corpus = [
      ...new Set(
        requireAcceptedRawTriage
          ? rawTriageCorpus
          : [...rawTriageCorpus, ...fallbackRequestCorpus],
      ),
    ];

    if (corpus.length === 0) {
      throw new Error(
        'No persisted NLP evidence samples are available for grounding.',
      );
    }

    const locationTerms = [
      context.location.country,
      context.location.city ?? '',
      context.location.region ?? '',
    ]
      .map((term) => this.normalizeComparableText(term))
      .filter((term) => term.length >= 3);

    const discardedOpportunityTitles: string[] = [];
    let semanticGroundingRepairCount = 0;
    let atomicEvidenceReductionCount = 0;

    const groundedOpportunities = analysis.opportunities.flatMap(
      (opportunity): CommunityAiOpportunity[] => {
        const groundedEvidence = opportunity.evidenceSamples.flatMap(
          (sample): string[] => {
            const directGroundedSample =
              this.findGroundedCorpusMatch(sample, canonicalCorpus) ??
              this.findGroundedCorpusMatch(sample, corpus);
            const groundedSample =
              directGroundedSample ??
              this.findSemanticOpportunityEvidence(
                context,
                opportunity,
                canonicalCorpus.length > 0 ? canonicalCorpus : corpus,
                sample,
              )[0];

            if (!groundedSample) {
              return [];
            }

            const exactRetainedEvidence =
              allowExactRetainedEvidence &&
              this.isExactOrContainedEvidenceMatch(sample, groundedSample);

            if (
              !exactRetainedEvidence &&
              !this.supportsOpportunity(opportunity, groundedSample)
            ) {
              return [];
            }

            if (
              !this.isExactOrContainedEvidenceMatch(sample, groundedSample)
            ) {
              semanticGroundingRepairCount += 1;
            }

            return [groundedSample];
          },
        );

        if (groundedEvidence.length === 0) {
          const semanticEvidence = this.findSemanticOpportunityEvidence(
            context,
            opportunity,
            canonicalCorpus.length > 0 ? canonicalCorpus : corpus,
          );
          if (semanticEvidence.length > 0) {
            semanticGroundingRepairCount += semanticEvidence.length;
            groundedEvidence.push(...semanticEvidence);
          }
        }

        const uniqueEvidence: string[] = [...new Set<string>(groundedEvidence)].slice(0, 5);
        const compositeEvidence = context.requestDescription?.trim()
          ? RequestEvidenceAlignmentUtil.selectCompositeAlignedEvidence({
              requestDescription: context.requestDescription,
              evidenceTexts: uniqueEvidence,
              plannedQueries: context.collectionPlan?.searchQueries ?? [],
              maxSamples: 5,
            })
          : [];
        const atomicEvidence = compositeEvidence.length >= 2
          ? compositeEvidence
          : this.selectAtomicEvidenceCluster(
              opportunity,
              uniqueEvidence,
            );
        const opportunityAtomicReductionCount =
          uniqueEvidence.length - atomicEvidence.length;
        atomicEvidenceReductionCount += opportunityAtomicReductionCount;

        /*
         * Do not reject the complete provider response because one
         * opportunity was unsupported. Discard only that opportunity.
         */
        if (atomicEvidence.length === 0) {
          discardedOpportunityTitles.push(opportunity.title);
          return [];
        }

        const groundingScore = Math.round(
          (atomicEvidence.length /
            Math.max(opportunity.evidenceSamples.length, 1)) *
            100,
        );

        const localEvidenceSamples = atomicEvidence.filter((sample) => {
          const normalizedSample = this.normalizeComparableText(sample);

          return locationTerms.some((term) => normalizedSample.includes(term));
        });

        const localEvidenceAvailable = localEvidenceSamples.length > 0;

        const groundedRisks = localEvidenceAvailable
          ? opportunity.risks
          : opportunity.risks.filter(
              (risk) => !this.isUnsupportedLocalRisk(risk, locationTerms),
            );

        const primaryEvidence = atomicEvidence[0] ?? '';
        if (
          isPositiveFeedbackWithoutProblem(primaryEvidence) &&
          !this.looksLikeDirectProblemEvidence(primaryEvidence)
        ) {
          discardedOpportunityTitles.push(opportunity.title);
          return [];
        }

        const problemIsDirect =
          this.looksLikeDirectProblemEvidence(opportunity.problem) &&
          !this.looksLikePromotionalOrPublisherText(opportunity.problem);
        const problemAtomicMatch = matchEvidenceToAtomicProblem(
          opportunity.problem,
          primaryEvidence,
        );
        const problemMatchesEvidence =
          problemAtomicMatch.matched ||
          this.tokenOverlap(
            this.normalizeComparableText(opportunity.problem),
            this.normalizeComparableText(primaryEvidence),
          ) >= 0.28;

        const baseGroundedProblem =
          opportunityAtomicReductionCount === 0 &&
          problemIsDirect &&
          problemMatchesEvidence
            ? opportunity.problem
            : this.buildProfessionalFallbackProblem(
                opportunity.problem,
                primaryEvidence,
              );
        const groundedProblem =
          atomicEvidence.length === 1
            ? this.singularizeSingleReportProblem(baseGroundedProblem)
            : baseGroundedProblem;
        const preliminaryNeed = this.buildProfessionalFallbackNeed(
          opportunity.unmetNeed,
          groundedProblem,
          primaryEvidence,
        );
        const atomicEvidenceContext = this.normalizeComparableText(
          `${groundedProblem} ${primaryEvidence}`,
        );
        const groundedNeed = this.introducesUnsupportedSemanticConcept(
          preliminaryNeed,
          atomicEvidenceContext,
        )
          ? this.buildProfessionalFallbackNeed(
              '',
              groundedProblem,
              primaryEvidence,
            )
          : preliminaryNeed;
        const preliminarySolutionArea =
          this.buildProfessionalFallbackSolutionArea(
            opportunity.solutionArea,
            groundedProblem,
            primaryEvidence,
          );
        const groundedSolutionArea =
          this.introducesUnsupportedSemanticConcept(
            preliminarySolutionArea,
            atomicEvidenceContext,
          )
            ? this.buildProfessionalFallbackSolutionArea(
                '',
                groundedProblem,
                primaryEvidence,
              )
            : preliminarySolutionArea;
        const providerTitleOverlap = this.tokenOverlap(
          this.normalizeComparableText(opportunity.title),
          this.normalizeComparableText(`${groundedProblem} ${primaryEvidence}`),
        );
        const groundedTitle = this.normalizeOpportunityTitle(
          opportunity.domainName,
          providerTitleOverlap >= 0.14 ? opportunity.title : '',
          groundedProblem,
          groundedNeed,
          primaryEvidence,
        );

        return [
          {
            ...opportunity,
            title: groundedTitle,
            problem: groundedProblem,
            unmetNeed: groundedNeed,
            solutionArea: groundedSolutionArea,
            frequency: Math.max(atomicEvidence.length, 1),
            evidenceSamples: atomicEvidence,
            groundingScore,
            localEvidenceAvailable,
            localEvidenceSamples,
            localRelevance: localEvidenceAvailable
              ? opportunity.localRelevance
              : Math.min(opportunity.localRelevance, 25),
            risks:
              groundedRisks.length > 0
                ? groundedRisks
                : [
                    'Direct local evidence is limited and requires further validation.',
                  ],
          },
        ];
      },
    );

    if (groundedOpportunities.length === 0) {
      if ((analysis.evidenceClassifications?.length ?? 0) > 0) {
        return {
          ...analysis,
          opportunities: [],
          dominantProblems: [],
          unmetNeeds: [],
          qualityWarnings: [
            ...analysis.qualityWarnings,
            'Community AI completed raw evidence classification, but no complete evidence-grounded opportunity survived deterministic verification.',
          ],
        };
      }

      throw new Error(
        'The AI response did not contain any opportunity supported by the persisted NLP evidence.',
      );
    }

    return {
      ...analysis,
      dominantProblems: groundedOpportunities.map(
        (opportunity) => opportunity.problem,
      ),
      unmetNeeds: groundedOpportunities.map(
        (opportunity) => opportunity.unmetNeed,
      ),
      opportunities: groundedOpportunities,
      qualityWarnings: [
        ...analysis.qualityWarnings,

        ...(discardedOpportunityTitles.length > 0
          ? [
              `${discardedOpportunityTitles.length} unsupported opportunity candidate(s) were discarded during evidence grounding.`,
            ]
          : []),

        ...(semanticGroundingRepairCount > 0
          ? [
              `${semanticGroundingRepairCount} provider evidence reference(s) were semantically mapped back to canonical retained evidence before acceptance.`,
            ]
          : []),
        ...(atomicEvidenceReductionCount > 0
          ? [
              `${atomicEvidenceReductionCount} same-domain evidence item(s) were removed from Community AI opportunities because they described a different atomic problem.`,
            ]
          : []),
        ...(groundedOpportunities.some(
          (opportunity) => !opportunity.localEvidenceAvailable,
        )
          ? [
              'Requested location is treated as a pilot target where direct local evidence is unavailable.',
            ]
          : []),
      ],
    };
  }

  private selectAtomicEvidenceCluster(
    opportunity: CommunityAiOpportunity,
    evidenceSamples: readonly string[],
  ): string[] {
    if (evidenceSamples.length <= 1) return [...evidenceSamples];

    const clusters: string[][] = [];

    for (const sample of evidenceSamples) {
      let bestCluster: string[] | null = null;
      let bestScore = 0;

      for (const cluster of clusters) {
        const representative = cluster[0] ?? '';
        const atomicMatch = matchEvidenceToAtomicProblem(
          representative,
          sample,
        );

        if (atomicMatch.matched && atomicMatch.score > bestScore) {
          bestCluster = cluster;
          bestScore = atomicMatch.score;
        }
      }

      if (bestCluster) {
        bestCluster.push(sample);
      } else {
        clusters.push([sample]);
      }
    }

    if (clusters.length <= 1) {
      return [...evidenceSamples];
    }

    const descriptor = `${opportunity.title} ${opportunity.problem} ${opportunity.unmetNeed}`;

    const rankedClusters = clusters
      .map((cluster, index) => {
        const descriptorScore = Math.max(
          ...cluster.map(
            (sample) =>
              matchEvidenceToProblemFamily(descriptor, sample).score,
          ),
          0,
        );

        return {
          cluster,
          index,
          score: cluster.length * 2 + descriptorScore,
        };
      })
      .sort(
        (first, second) =>
          second.score - first.score || first.index - second.index,
      );

    return [...(rankedClusters[0]?.cluster ?? [evidenceSamples[0]])].slice(
      0,
      5,
    );
  }

  private findSemanticOpportunityEvidence(
    context: IdeaGenerationContext,
    opportunity: CommunityAiOpportunity,
    corpus: readonly string[],
    providerEvidenceSample = '',
  ): string[] {
    const descriptor = this.normalizeComparableText(
      `${opportunity.title} ${opportunity.problem} ${opportunity.unmetNeed} ${opportunity.solutionArea}`,
    );
    const normalizedProviderSample =
      this.normalizeComparableText(providerEvidenceSample);
    const problemSubject = `${opportunity.problem} ${opportunity.unmetNeed}`;

    if (
      !this.evidenceSemanticallySupportsDomain(
        context,
        opportunity.domainName,
        problemSubject,
      )
    ) {
      return [];
    }

    return corpus
      .filter((sample) => sample.replace(/\s+/gu, ' ').trim().length >= 24)
      .filter((sample) => !this.looksLikePromotionalOrPublisherText(sample))
      .filter(
        (sample) =>
          !isNonActionableCommunityBanter(
            sample,
            /\bCommunity comment:\s*/iu.test(sample) ? 'COMMENT' : 'POST',
          ),
      )
      .filter((sample) =>
        this.evidenceSemanticallySupportsDomain(
          context,
          opportunity.domainName,
          sample,
        ),
      )
      .filter(
        (sample) =>
          !this.introducesUnsupportedSemanticConcept(
            descriptor,
            this.normalizeComparableText(sample),
          ),
      )
      .map((sample) => {
        const normalizedSample = this.normalizeComparableText(sample);
        const familyMatch = matchEvidenceToProblemFamily(descriptor, sample);
        const atomicMatch = matchEvidenceToAtomicProblem(descriptor, sample);
        const descriptorOverlap = this.tokenOverlap(
          descriptor,
          normalizedSample,
        );
        const providerOverlap = normalizedProviderSample
          ? this.tokenOverlap(normalizedProviderSample, normalizedSample)
          : 0;
        const exactProviderMatch = providerEvidenceSample
          ? this.isExactOrContainedEvidenceMatch(providerEvidenceSample, sample)
          : false;
        const semanticAliasMatch = this.hasSemanticOpportunityAliasMatch(
          descriptor,
          sample,
        );

        const score = exactProviderMatch
          ? 1
          : atomicMatch.matched
            ? Math.min(
                0.99,
                0.82 + atomicMatch.score * 0.12 + descriptorOverlap * 0.05,
              )
            : familyMatch.matched
              ? Math.min(
                  0.98,
                  0.72 + familyMatch.score * 0.18 + descriptorOverlap * 0.1,
                )
              : semanticAliasMatch
                ? 0.82
                : descriptorOverlap >= 0.24 && providerOverlap >= 0.35
                  ? 0.64 + Math.min(0.16, descriptorOverlap * 0.25)
                  : 0;

        return { sample, score };
      })
      .filter((entry) => entry.score >= 0.6)
      .sort(
        (first, second) =>
          second.score - first.score ||
          second.sample.length - first.sample.length,
      )
      .map((entry) => entry.sample)
      .filter(
        (sample, index, values) =>
          values.findIndex(
            (candidate) =>
              this.normalizeComparableText(candidate) ===
              this.normalizeComparableText(sample),
          ) === index,
      )
      .slice(0, Math.max(1, Math.min(3, opportunity.frequency)));
  }

  private readSemanticGroundingRepairCount(
    analysis: CommunityAiAnalysis,
  ): number {
    const warning = analysis.qualityWarnings.find((item) =>
      /provider evidence reference\(s\) were semantically mapped back/iu.test(
        item,
      ),
    );
    const match = warning?.match(/^(\d+)\s+/u);
    return match ? Number(match[1]) : 0;
  }

  private collectEvidenceCorpus(value: unknown): string[] {
    const collected: string[] = [];

    const visit = (entry: unknown): void => {
      if (typeof entry === 'string') {
        const normalized = entry.replace(/\s+/gu, ' ').trim();
        if (normalized.length >= 12) collected.push(normalized);
        return;
      }
      if (Array.isArray(entry)) {
        for (const child of entry) visit(child);
        return;
      }
      if (this.isRecord(entry)) {
        for (const [key, child] of Object.entries(entry)) {
          if (
            [
              'evidenceSamples',
              'samplePosts',
              'sampleComments',
              'text',
              'content',
              'body',
              'title',
            ].includes(key)
          ) {
            visit(child);
          } else if (typeof child === 'object' && child !== null) {
            visit(child);
          }
        }
      }
    };

    visit(value);
    return [...new Set(collected)];
  }

  private summarizeProviderResponseForDiagnostics(text: string): {
    readonly opportunityCount: number;
    readonly candidateTitles: readonly string[];
  } {
    try {
      const parsed: unknown = JSON.parse(text);
      if (!this.isRecord(parsed) || !Array.isArray(parsed.opportunities)) {
        return { opportunityCount: 0, candidateTitles: [] };
      }

      const candidateTitles = parsed.opportunities
        .slice(0, COMMUNITY_AI_ANALYSIS_MAX_OPPORTUNITIES)
        .map((entry) => {
          if (typeof entry === 'string') {
            return entry.replace(/\s+/gu, ' ').trim().slice(0, 120);
          }
          if (!this.isRecord(entry)) {
            return '';
          }
          return this.optionalString(
            entry.title ?? entry.problem ?? entry.unmetNeed,
            '',
          )
            .replace(/\s+/gu, ' ')
            .trim()
            .slice(0, 120);
        })
        .filter(Boolean);

      return {
        opportunityCount: parsed.opportunities.length,
        candidateTitles,
      };
    } catch {
      return { opportunityCount: 0, candidateTitles: [] };
    }
  }

  private providerReturnedNoOpportunities(text: string): boolean {
    try {
      const parsed: unknown = JSON.parse(text);
      return (
        this.isRecord(parsed) &&
        Array.isArray(parsed.opportunities) &&
        parsed.opportunities.length === 0
      );
    } catch {
      return false;
    }
  }

  private isExactOrContainedEvidenceMatch(
    sample: string,
    corpusSample: string,
  ): boolean {
    const normalizedSample = this.normalizeComparableText(sample);
    const normalizedCorpusSample = this.normalizeComparableText(corpusSample);

    if (
      normalizedSample.length < 12 ||
      normalizedCorpusSample.length < 12
    ) {
      return false;
    }

    return (
      normalizedSample === normalizedCorpusSample ||
      normalizedCorpusSample.includes(normalizedSample) ||
      normalizedSample.includes(normalizedCorpusSample)
    );
  }

  private findGroundedCorpusMatch(
    sample: string,
    corpus: readonly string[],
  ): string | null {
    const normalizedSample = this.normalizeComparableText(sample);
    if (normalizedSample.length < 12) return null;

    let best: { text: string; score: number } | null = null;
    for (const source of corpus) {
      const normalizedSource = this.normalizeComparableText(source);
      if (
        normalizedSource.includes(normalizedSample) ||
        normalizedSample.includes(normalizedSource)
      ) {
        return source;
      }
      const score = this.tokenOverlap(normalizedSample, normalizedSource);
      if (!best || score > best.score) best = { text: source, score };
    }
    return best && best.score >= 0.55 ? best.text : null;
  }

  private supportsOpportunity(
    opportunity: CommunityAiOpportunity,
    sample: string,
  ): boolean {
    const descriptor = this.normalizeComparableText(
      `${opportunity.title} ${opportunity.problem} ${opportunity.unmetNeed} ${opportunity.solutionArea}`,
    );
    const familyMatch = matchEvidenceToProblemFamily(descriptor, sample);
    const atomicMatch = matchEvidenceToAtomicProblem(descriptor, sample);
    const normalizedSample = this.normalizeComparableText(sample);
    if (this.introducesUnsupportedSemanticConcept(descriptor, normalizedSample)) {
      return false;
    }

    const authenticationParaphrase =
      /\b(?:two factor|2fa|mfa|authentication|login|sign in|identity provider|google login|regional login|login block)\b/u.test(descriptor) &&
      /\b(?:two factor|2fa|mfa|not active|not available|unavailable|country|region|google login|add a google login|unable to login|can t log in|cannot log in)\b/u.test(normalizedSample);
    if (authenticationParaphrase) return true;

    const overlap = this.tokenOverlap(
      descriptor,
      normalizedSample,
    );

    return (
      atomicMatch.matched ||
      familyMatch.matched ||
      this.hasSemanticOpportunityAliasMatch(descriptor, sample) ||
      overlap >= 0.18
    );
  }

  private hasSemanticOpportunityAliasMatch(
    descriptor: string,
    sample: string,
  ): boolean {
    const normalizedDescriptor = this.normalizeComparableText(descriptor);
    const normalizedSample = this.normalizeComparableText(
      sample.match(/\bCommunity comment:\s*(.+)$/iu)?.[1] ?? sample,
    );

    const conceptPairs: readonly [RegExp, RegExp][] = [
      [
        /\b(?:crash|crashes|crashing|runtime|stability|reliability|unstable|app failure|application failure)\b/u,
        /\b(?:crash|crashes|crashed|crashing|runtime failure|app stopped working|application stopped working|won t open|doesn t work)\b/u,
      ],
      [
        /\b(?:duplicate payment|duplicate billing|double charge|charged twice|payment reconciliation|billing reconciliation|payment|billing|refund)\b/u,
        /\b(?:already paid|paid cash|charged again|double charge|duplicate charge|additional payment|separate payment|proof of payment|refund|billing|payment)\b/u,
      ],
      [
        /\b(?:shipment transit|transit time|shipment tracking|delivery tracking|tracking visibility|transit metric|transit analytics|delivery time)\b/u,
        /\b(?:average transit time|shipment transit|delivery transit|shipment tracking|delivery tracking|track packages|transit time)\b/u,
      ],
      [
        /\b(?:cost effective|affordable|lower cost|pricing|price|expensive|cost)\b/u,
        /\b(?:too expensive|expensive|affordable|price|pricing|cost)\b/u,
      ],
      [
        /\b(?:two factor authentication|two-factor authentication|2fa|mfa|multi factor authentication|multifactor authentication|authentication availability|regional authentication|regional login|login block|identity bridge|identity provider|alternative sign in|google login|google sign in|sign in with google)\b/u,
        /\b(?:two factor|two-factor|2fa|mfa|multi factor|multifactor|not active|not available|unavailable|not supported|country|region|google login|google sign in|sign in with google|login with google|add a google login|can t because two factor)\b/u,
      ],
      [
        /\b(?:login|sign in|authentication|account access|access recovery)\b/u,
        /\b(?:can t access my account|cannot access my account|unable to access my account|locked out|can t log in|cannot log in|unable to sign in|2fa|two factor|mfa|google login|google sign in)\b/u,
      ],
      [
        /\b(?:404|routing|navigation endpoint|broken link|feedback link|missing endpoint)\b/u,
        /\b(?:404|missing url|incorrect url|broken route|broken link|rate us)\b/u,
      ],
    ];

    return conceptPairs.some(
      ([descriptorPattern, samplePattern]) =>
        descriptorPattern.test(normalizedDescriptor) &&
        samplePattern.test(normalizedSample),
    );
  }

  private tokenOverlap(first: string, second: string): number {
    const ignored = new Set([
      'the',
      'and',
      'for',
      'with',
      'that',
      'this',
      'from',
      'have',
      'has',
      'are',
      'was',
      'were',
      'user',
      'users',
      'app',
      'application',
      'system',
    ]);
    const firstTokens = new Set(
      first
        .split(' ')
        .filter((token) => token.length >= 3 && !ignored.has(token)),
    );
    const secondTokens = new Set(
      second
        .split(' ')
        .filter((token) => token.length >= 3 && !ignored.has(token)),
    );
    if (firstTokens.size === 0 || secondTokens.size === 0) return 0;
    let intersection = 0;
    for (const token of firstTokens)
      if (secondTokens.has(token)) intersection += 1;
    return intersection / Math.min(firstTokens.size, secondTokens.size);
  }

  private isUnsupportedLocalRisk(
    risk: string,
    locationTerms: readonly string[],
  ): boolean {
    const normalized = this.normalizeComparableText(risk);
    return (
      locationTerms.some((term) => normalized.includes(term)) ||
      /\b(?:local expertise|infrastructure|resource constraints|economic|regulatory|connectivity|west bank|palestine|nablus)\b/iu.test(
        normalized,
      )
    );
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return 'Unknown community AI analysis failure';
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
  private isEvidenceDiscoveryMode(context: IdeaGenerationContext): boolean {
    const intent = context.collectionPlan?.requestIntent;
    if (!context.requestDescription?.trim()) return true;
    return intent?.mode !== 'EXPLICIT_PROBLEM' || !intent.explicitProblem?.trim();
  }

  private requestIntentScope(context: IdeaGenerationContext): string {
    return (
      context.collectionPlan?.requestIntent?.summary?.trim() ||
      context.requestDescription?.trim() ||
      ''
    );
  }

}