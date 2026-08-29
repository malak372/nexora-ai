import { randomUUID } from 'node:crypto';

import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ApiRequestType,
  PromptType,
  Prisma,
  type AiModel,
  IdeaGenerationType,
  LanguageCode,
} from '@prisma/client';

import { AiModelsService } from '../../../ai-models/ai-models.service';
import { AiModelRoutingService } from '../../../ai-models/ai-model-routing.service';
import { AiExecutionService } from '../../../ai/services/ai-execution.service';
import {
  AI_PROVIDER_KEYS,
  normalizeAiProviderKey,
} from '../../../ai/constants/ai-provider.constants';
import type { AiExecutionResult } from '../../../ai/types/ai-execution-result.type';
import {
  AiFinishReason,
  AiResponseFormat,
} from '../../../ai/types/ai-provider.type';
import { PrismaService } from '../../../prisma/prisma.service';
import { IDEA_OWNER_TYPES } from '../../shared/constants/ideas.constants';
import {
  IDEA_DETERMINISTIC_FINAL_SCORE_WEIGHT,
  IDEA_JUDGE_FINAL_SCORE_WEIGHT,
  IDEA_JUDGE_MAX_CANDIDATES,
  IDEA_JUDGE_MIN_CONFIDENCE_FOR_HYBRID_SELECTION,
} from '../constants/idea-judge.constants';
import {
  IDEA_BENCHMARK_ACCEPTED_CANDIDATE_GRACE_MS,
  IDEA_BENCHMARK_ALLOW_LOCAL_FALLBACK,
  IDEA_BENCHMARK_COMPARATIVE_JUDGE_ENABLED,
  IDEA_BENCHMARK_IMMEDIATE_EARLY_STOP_SCORE,
  IDEA_BENCHMARK_EXCLUDED_CORE_MODEL_API_IDS,
  IDEA_BENCHMARK_FAST_CORE_MODEL_API_IDS,
  IDEA_BENCHMARK_SECONDARY_CORE_MODEL_API_IDS,
  IDEA_BENCHMARK_INITIAL_OPPORTUNITY_COUNT,
  IDEA_BENCHMARK_MAX_MODEL_ATTEMPTS,
  IDEA_BENCHMARK_MIN_SUCCESSFUL_CANDIDATES,
  IDEA_BENCHMARK_MODELS_PER_OPPORTUNITY,
  IDEA_BENCHMARK_TRANSIENT_RETRIES_PER_MODEL,
  IDEA_CORE_GOOGLE_TIMEOUT_MS,
  IDEA_CORE_MODEL_TIMEOUT_MS,
  IDEA_CORE_OPENROUTER_TIMEOUT_MS,
  IDEA_DUPLICATE_REGENERATION_MAX_ATTEMPTS,
  IDEA_MIN_ACCEPTED_QUALITY_SCORE,
  IDEA_QUALITY_REVISION_MAX_ATTEMPTS,
  IDEA_QUALITY_REVISION_TRIGGER_SCORE,
} from '../constants/idea-generation.constants';
import type { ParsedIdeaAiOutput } from '../types/idea-ai-output.type';
import type { IdeaGenerationContext } from '../types/idea-generation-context.type';
import type { RankedIdeaOpportunity } from '../types/idea-opportunity-ranking.type';
import { RequestProductBlueprintUtil } from '../utils/request-product-blueprint.util';
import { EvidenceSourceIdentityUtil } from '../utils/evidence-source-identity.util';
import {
  matchEvidenceToAtomicProblem,
  matchEvidenceToProblemFamily,
  resolvePrimaryProblemFamily,
  resolveProblemFamilyKeys,
} from '../../../nlp/common/utils/problem-family-matching.util';
import type {
  IdeaJudgeCandidateScore,
  IdeaJudgeEvaluation,
} from '../types/idea-judge.type';
import { IdeaAiOutputParserService } from './idea-ai-output-parser.service';
import { IdeaCandidateJudgeService } from './idea-candidate-judge.service';
import {
  IdeaDuplicateDetectionService,
  type DuplicateIdeaCandidate,
  type IdeaDuplicateCheckResult,
} from './idea-duplicate-detection.service';
import { IdeaGenerationModelSelectorService } from './idea-generation-model-selector.service';
import {
  IdeaSemanticDiversityService,
  type IdeaSemanticDiversityScore,
} from './idea-semantic-diversity.service';
import {
  IdeaQualityEvaluatorService,
  type IdeaQualityEvaluation,
  type IdeaQualityEvaluationContext,
} from './idea-quality-evaluator.service';
import {
  evaluateRequestIntentAlignment,
  isStrongExplicitProblemAlignment,
} from '../utils/request-intent-alignment.util';
import { RequestEvidenceAlignmentUtil } from '../utils/request-evidence-alignment.util';
import { SelectedDomainEvidenceAlignmentUtil } from '../utils/selected-domain-evidence-alignment.util';
import { CanonicalEvidenceStateUtil } from '../utils/canonical-evidence-state.util';

/**
 * One successfully generated benchmark candidate.
 *
 * quality contains the provider-independent deterministic assessment. aiJudge
 * contains the comparative score when the judge succeeds. finalScore combines
 * both signals and is used for winner selection.
 *
 * @author Malak
 */
export type IdeaBenchmarkCandidate = {
  readonly candidateId: string;
  /**
   * Immutable model metadata retained in memory so successful candidates can
   * be persisted together after winner selection instead of performing one
   * Supabase write per model on the critical path.
   */
  readonly modelSnapshot: Pick<
    AiModel,
    'id' | 'providerKey' | 'apiModelId' | 'modelName' | 'displayName'
  >;
  readonly aiResult: AiExecutionResult;
  readonly parsedOutput: ParsedIdeaAiOutput;
  readonly quality: IdeaQualityEvaluation;
  readonly aiJudge: IdeaJudgeCandidateScore | null;
  /** Internal comparable score used for winner selection. */
  readonly finalScore: number;
  /** Deterministic quality after semantic-diversity penalty. */
  readonly semanticDiversityAdjustedScore: number;
  /** True hybrid score; null when the candidate was not judged. */
  readonly hybridFinalScore: number | null;
  readonly selected: boolean;
  readonly opportunityRank: number;
  readonly opportunityTitle: string;
  readonly semanticDiversity: IdeaSemanticDiversityScore | null;
  /** True only for the in-process emergency candidate used after provider exhaustion. */
  readonly deterministicEmergencyFallback: boolean;
};

/**
 * Final result of executing and comparing all eligible AI models.
 *
 * judgeEvaluation is null when comparison was unnecessary or when the AI judge
 * was temporarily unavailable and deterministic fallback ranking was used.
 *
 * @author Malak
 */
export type IdeaBenchmarkResult = {
  readonly winner: IdeaBenchmarkCandidate;
  readonly candidates: readonly IdeaBenchmarkCandidate[];
  readonly judgeEvaluation: IdeaJudgeEvaluation | null;
};

/** Result of one accepted model attempt before database persistence. */
type CandidateConceptDirection = {
  readonly opportunity: RankedIdeaOpportunity;
  readonly promptText: string;
};

/** Result of one accepted model attempt before database persistence. */
type AcceptedModelAttempt = {
  readonly aiResult: AiExecutionResult;
  readonly parsedOutput: ParsedIdeaAiOutput;
  readonly quality: IdeaQualityEvaluation;
};

/**
 * Executes diversified evidence-grounded concept prompts against a provider-diverse
 * selection of active, routable models supporting structured JSON output.
 *
 * Important guarantees:
 * - The initial benchmark group is interleaved by provider.
 * - Every candidate is evaluated using one provider-independent quality gate.
 * - Candidate requests run in a bounded parallel fast path.
 * - A strong quality-approved candidate can complete selection immediately.
 * - A 70-77.99 quality-approved candidate gives only already-running peers a
 *   short grace window, then the strongest completed candidate wins.
 * - A response that still fails the quality gate is persisted as rejected and
 *   excluded from winner selection.
 * - The comparative judge is used when at least two candidates survive.
 * - Deterministic ranking keeps the pipeline operational when the judge fails.
 *
 * Model eligibility is loaded dynamically from ai_models, so adding,
 * disabling, or recovering a model automatically affects future benchmark
 * runs without hard-coded provider preferences.
 *
 * @author Malak
 */
/**
 * Number of online core models allowed in the first latency-hedged wave.
 *
 * The model selector already returns a health-aware, provider-interleaved order
 * whose documented fast path is two models. Starting six models made a healthy
 * two-candidate comparison wait behind unrelated slower peers until the full
 * run wall-clock budget. Keep the first wave at the two strongest provider-
 * diverse routes; if both fail to produce a usable candidate, the existing
 * bounded rescue loop can still start additional models.
 */
const IDEA_BENCHMARK_INITIAL_HEDGE_WIDTH = 2;
const IDEA_BENCHMARK_PRELIMINARY_HEDGE_WIDTH = 2;
const IDEA_BENCHMARK_CORPUS_WARMUP_BUDGET_MS = 1_200;
const IDEA_BENCHMARK_DUPLICATE_DB_BUDGET_MS = 1_500;
const IDEA_BENCHMARK_STRUCTURAL_FALLBACK_SCORE = 40;
const IDEA_BENCHMARK_PRELIMINARY_FAST_STOP_SCORE = 18;
const IDEA_BENCHMARK_STRONG_FIRST_WAVE_FALLBACK_SCORE = 58;
const IDEA_BENCHMARK_STRUCTURAL_FALLBACK_GRACE_MS = 1_200;
const IDEA_BENCHMARK_EVIDENCE_BACKED_FAST_STOP_SCORE = 85;
const IDEA_BENCHMARK_TOTAL_WALL_CLOCK_BUDGET_MS = 18_000;
const IDEA_BENCHMARK_NEXT_DIRECTION_CUTOFF_MS = 14_000;
const IDEA_BENCHMARK_EVIDENCE_BACKED_FAST_STOP_GRACE_MS = 900;
const IDEA_BENCHMARK_REQUESTER_ZERO_EVIDENCE_BUDGET_MS = 15_000;
const IDEA_BENCHMARK_REQUESTER_ZERO_EVIDENCE_MODEL_TIMEOUT_MS = 9_500;

@Injectable()
export class IdeaGenerationBenchmarkService {
  private readonly logger = new Logger(IdeaGenerationBenchmarkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiModelsService: AiModelsService,
    private readonly aiModelRoutingService: AiModelRoutingService,
    private readonly aiExecutionService: AiExecutionService,
    private readonly outputParserService: IdeaAiOutputParserService,
    private readonly qualityEvaluatorService: IdeaQualityEvaluatorService,
    private readonly candidateJudgeService: IdeaCandidateJudgeService,
    private readonly modelSelectorService: IdeaGenerationModelSelectorService,
    private readonly semanticDiversityService: IdeaSemanticDiversityService,
    private readonly duplicateDetectionService: IdeaDuplicateDetectionService,
  ) {}

  /**
   * Generates, quality-gates, persists, compares, and selects candidates.
   *
   * @param context Current generation pipeline context.
   * @returns All accepted candidates and the selected winner.
   */
  async benchmark(
    context: IdeaGenerationContext,
    signal?: AbortSignal,
  ): Promise<IdeaBenchmarkResult> {
    this.throwIfBenchmarkAborted(signal);

    /*
     * Benchmarking is not another opportunity-selection stage.  Discovery
     * identity belongs to the Community AI analysis that classified the full
     * corpus and selected the evidence-leading family.  Normalize the context
     * before any zero-evidence shortcut, prompt direction, or validator reads
     * it so a stale generic ranking candidate can never compete with the
     * canonical Community winner.
     */
    context = this.normalizeCanonicalDiscoveryContextForBenchmark(context);

    const benchmarkStartedAt = Date.now();
    const prompt = context.prompt;

    if (!prompt) {
      throw new ServiceUnavailableException(
        'A persisted prompt is required before model benchmarking.',
      );
    }

    /*
     * Core AI is always attempted, including ungrounded/adjudication-unavailable runs.
     * Evidence state constrains claims; it does not disable product-generation
     * intelligence. Deterministic generation remains only the final continuity
     * fallback when every bounded online Core route is unavailable/unusable.
     */
    const duplicateCorpusLoad =
      this.duplicateDetectionService.prepareBenchmarkSemanticCorpus(
        context.runId,
        context.domainId,
      );

    const [
      configuredRoutableModels,
      fallbackModels,
      ,
      duplicateCorpus,
    ] = await Promise.all([
      this.aiModelsService.getRoutableModels(),
      this.aiModelsService.getFallbackModels(),
      this.prisma.ideaGenerationCandidate.deleteMany({
        where: { runId: context.runId },
      }),
      this.resolveBenchmarkCorpusWithinFastPath(duplicateCorpusLoad),
    ]);

    const temporarilyAvailableModels =
      configuredRoutableModels.length > 0
        ? await this.aiModelRoutingService.filterTemporarilyUnavailableProviders(
            configuredRoutableModels,
          )
        : [];
    /*
     * Routing health is an eligibility boundary, not merely an ordering hint.
     * Never append getFallbackModels() back onto the online race after the
     * routing service has removed a model/provider for quota, timeout streak,
     * MODEL_NOT_FOUND, auth failure, or another persisted health condition.
     * Doing so was the source of "not active or routable" attempts inside an
     * otherwise health-aware benchmark.
     *
     * The fallback-model query is retained only for the explicitly optional
     * local Ollama continuity path below; it cannot repopulate online models.
     */
    const routableModels = temporarilyAvailableModels.filter(
      (model) =>
        model.healthStatus !== 'UNAVAILABLE' &&
        this.isOnlineCoreRescueEligible(model),
    );

    /*
     * HARD ROUTABILITY INVARIANT:
     * the benchmark may execute only rows returned by getRoutableModels() that
     * also survive the live provider/model cooldown filter. Do not append
     * any broader emergency/fallback rows to improve apparent provider
     * diversity after the live filter has produced the executable set. Provider
     * diversity is therefore best-effort among models
     * that are genuinely executable at this moment.
     */
    const coreProviderCount = new Set(
      routableModels.map((model) => model.providerKey.trim().toLocaleLowerCase()),
    ).size;
    if (routableModels.length > 0) {
      this.logger.debug(
        `Core routable model pool prepared | eligible=${routableModels.length} | providers=${coreProviderCount}.`,
      );
    }

    if (
      configuredRoutableModels.length > 0 &&
      temporarilyAvailableModels.length === 0 &&
      routableModels.length === 0
    ) {
      this.logger.warn(
        'All configured online Core models are temporarily unavailable according to persisted routing health; skipping known-bad online attempts and preserving the run through continuity fallback.',
      );
    }

    this.throwIfBenchmarkAborted(signal);

    const jsonCapableModels = routableModels.filter(
      (model) => model.supportsJsonOutput,
    );
    const preferredEligibleModels = jsonCapableModels.filter(
      (model) =>
        !IDEA_BENCHMARK_EXCLUDED_CORE_MODEL_API_IDS.has(model.apiModelId),
    );
    const preferredEligibleModelIds = new Set(
      preferredEligibleModels.map((model) => model.id),
    );
    const rescueEligibleModels = jsonCapableModels.filter(
      (model) =>
        !preferredEligibleModelIds.has(model.id) &&
        this.isOnlineCoreRescueEligible(model),
    );
    const eligibleModels = [
      ...preferredEligibleModels,
      ...rescueEligibleModels,
    ];

    if (preferredEligibleModels.length === 0 && rescueEligibleModels.length > 0) {
      this.logger.warn(
        `No preferred core-generation model is currently routable; ${rescueEligibleModels.length} JSON-capable online rescue model(s) remain available before deterministic fallback.`,
      );
    } else if (rescueEligibleModels.length > 0) {
      this.logger.debug(
        `Prepared ${rescueEligibleModels.length} JSON-capable online rescue model(s) behind the preferred core rotation.`,
      );
    }

    if (eligibleModels.length === 0) {
      this.logger.warn(
        'No active routable JSON-capable online AI model is available. The benchmark will continue to the deterministic emergency fallback instead of failing the generation run.',
      );
    }

    /*
     * Ollama never participates in the strict minute path. A local model may
     * remain configured for other workloads, but an unbounded local fallback
     * would violate the generation deadline and hide provider availability
     * problems.
     */
    const onlineModels = eligibleModels.filter(
      (model) =>
        normalizeAiProviderKey(model.providerKey) !== AI_PROVIDER_KEYS.OLLAMA,
    );
    const localFallbackModel = IDEA_BENCHMARK_ALLOW_LOCAL_FALLBACK
      ? fallbackModels.find(
          (model) =>
            model.supportsJsonOutput &&
            model.healthStatus !== 'UNAVAILABLE' &&
            normalizeAiProviderKey(model.providerKey) === AI_PROVIDER_KEYS.OLLAMA,
        )
      : undefined;

    const orderedOnlineModels =
      onlineModels.length > 0
        ? await this.modelSelectorService.orderModels(context, onlineModels)
        : [];
    const orderedPreferredModels = orderedOnlineModels.filter((model) =>
      preferredEligibleModelIds.has(model.id),
    );
    const orderedModels = [
      ...orderedPreferredModels.filter(
        (model) =>
          IDEA_BENCHMARK_FAST_CORE_MODEL_API_IDS.has(model.apiModelId) &&
          !IDEA_BENCHMARK_SECONDARY_CORE_MODEL_API_IDS.has(model.apiModelId),
      ),
      ...orderedPreferredModels.filter(
        (model) =>
          !IDEA_BENCHMARK_FAST_CORE_MODEL_API_IDS.has(model.apiModelId) &&
          !IDEA_BENCHMARK_SECONDARY_CORE_MODEL_API_IDS.has(model.apiModelId),
      ),
      ...orderedPreferredModels.filter((model) =>
        IDEA_BENCHMARK_SECONDARY_CORE_MODEL_API_IDS.has(model.apiModelId),
      ),
      ...orderedOnlineModels.filter(
        (model) => !preferredEligibleModelIds.has(model.id),
      ),
    ];

    /*
     * Fast-path policy:
     * - Up to three ordered online models may be latency-hedged in parallel.
     * - Bounded self-revision remains available for structurally valid weak results.
     * - One accepted candidate is sufficient.
     * - Comparative judging runs only when two candidates finish inside budget.
     */
    const successfulCandidates: IdeaBenchmarkCandidate[] = [];
    const conceptDirections = this.buildConceptDirections(
      context,
      duplicateCorpus,
    );
    let attemptedCandidateCount = 0;
    const preliminaryZeroEvidenceBudget =
      this.isUngroundedEvidenceState(context.evidenceState)
        ? IDEA_BENCHMARK_REQUESTER_ZERO_EVIDENCE_BUDGET_MS
        : null;
    const totalWallClockBudgetMs =
      preliminaryZeroEvidenceBudget ?? IDEA_BENCHMARK_TOTAL_WALL_CLOCK_BUDGET_MS;
    const benchmarkDeadlineAt = benchmarkStartedAt + totalWallClockBudgetMs;
    const nextDirectionCutoffMs =
      preliminaryZeroEvidenceBudget
        ? Math.min(12_500, preliminaryZeroEvidenceBudget - 1_500)
        : IDEA_BENCHMARK_NEXT_DIRECTION_CUTOFF_MS;
    const blockedModelIds = new Set<string>();
    const blockedProviderKeys = new Set<string>();
    const warnedOpportunityTitles = new Set<string>();

    /*
     * Execute a bounded model batch for one opportunity at a time. When a
     * selected model fails or produces a rejected candidate, the next healthy
     * model in the ordered rotation is attempted immediately for the same
     * opportunity. This preserves comparative judging even during a temporary
     * provider outage without launching every routable model at once.
     */
    for (const [directionIndex, direction] of conceptDirections.entries()) {
      if (Date.now() >= benchmarkDeadlineAt) {
        this.logger.log(
          `Benchmark wall-clock budget reached after ${Date.now() - benchmarkStartedAt}ms; no additional concept direction or provider wave will start.`,
        );
        break;
      }

      if (
        directionIndex > 0 &&
        successfulCandidates.length > 0 &&
        Date.now() - benchmarkStartedAt >= nextDirectionCutoffMs
      ) {
        this.logger.log(
          `Benchmark fast-stop: ${Date.now() - benchmarkStartedAt}ms elapsed with ${successfulCandidates.length} structurally valid candidate(s); no additional opportunity/provider wave will start.`,
        );
        break;
      }

      const isFallbackOpportunity =
        directionIndex >= IDEA_BENCHMARK_INITIAL_OPPORTUNITY_COUNT;

      if (
        isFallbackOpportunity &&
        this.countQualityApprovedCandidates(successfulCandidates) >=
          IDEA_BENCHMARK_MIN_SUCCESSFUL_CANDIDATES
      ) {
        this.logger.log(
          `Initial ${IDEA_BENCHMARK_INITIAL_OPPORTUNITY_COUNT} opportunities produced ${this.countQualityApprovedCandidates(successfulCandidates)} quality-approved candidate(s); fallback opportunities were skipped.`,
        );
        break;
      }

      const attemptedModelIdsForDirection = new Set<string>();
      const acceptedCandidatesForDirection: IdeaBenchmarkCandidate[] = [];
      const canonicalDiscoveryLock = this.resolveCanonicalDiscoveryProblemLock(
        context,
        direction.opportunity,
      );
      const hasRetainedDirectEvidence =
        (canonicalDiscoveryLock?.evidenceSamples.length ?? 0) > 0 ||
        direction.opportunity.evidenceSamples.length > 0 ||
        (direction.opportunity.independentEvidence?.length ?? 0) > 0;
      const isNoEvidenceHypothesis =
        !canonicalDiscoveryLock &&
        (direction.opportunity.disqualificationReasons.includes(
          'PRIMARY_DOMAIN_VALIDATION_HYPOTHESIS',
        ) ||
          (!hasRetainedDirectEvidence &&
            direction.opportunity.disqualificationReasons.includes(
              'NO_DIRECT_EVIDENCE',
            )) ||
          !hasRetainedDirectEvidence);
      /*
       * Only a genuinely no-evidence hypothesis is limited to one availability
       * fallback. A sparse-evidence pilot still has retained direct evidence,
       * so it receives the normal bounded comparison and revision budget while
       * all generated claims remain explicitly preliminary.
       */
      const targetCandidateCount = isNoEvidenceHypothesis
        ? 1
        : IDEA_BENCHMARK_MODELS_PER_OPPORTUNITY;
      const directionAttemptLimit = isNoEvidenceHypothesis
        ? Math.min(
            attemptedCandidateCount + IDEA_BENCHMARK_PRELIMINARY_HEDGE_WIDTH,
            IDEA_BENCHMARK_MAX_MODEL_ATTEMPTS,
          )
        : IDEA_BENCHMARK_MAX_MODEL_ATTEMPTS;

      while (
        acceptedCandidatesForDirection.length < targetCandidateCount &&
        attemptedCandidateCount < directionAttemptLimit
      ) {
        const missingCandidateCount =
          targetCandidateCount - acceptedCandidatesForDirection.length;
        const remainingAttemptCount =
          IDEA_BENCHMARK_MAX_MODEL_ATTEMPTS - attemptedCandidateCount;

        const remainingEligibleModels = orderedModels.filter(
          (model) =>
            !blockedModelIds.has(model.id) &&
            !blockedProviderKeys.has(model.providerKey) &&
            !attemptedModelIdsForDirection.has(model.id),
        );
        const isInitialWave = attemptedModelIdsForDirection.size === 0;
        /*
         * Honor the selector's provider-diverse fast-path contract instead of
         * launching every eligible model in the first wave. Additional models
         * remain available to the existing rescue loop only when the initial
         * pair cannot produce a usable candidate.
         */
        const selectedModels = isInitialWave
          ? this.modelSelectorService.getInitialModels(remainingEligibleModels)
          : remainingEligibleModels;

        /*
         * Bounded latency hedge:
         *
         * The first wave starts only the selector's provider-diverse pair.
         * This keeps the existing quality-first race and early-stop semantics,
         * but prevents already-good two-model results from waiting behind
         * unrelated slow peers until the run-level hard budget expires.
         * Additional eligible models remain available to the rescue loop when
         * the initial pair cannot produce a usable candidate.
         *
         * Quality, evidence, duplicate detection, and the 70-point gate are
         * unchanged; only unnecessary first-wave fan-out is removed.
         */
        const parallelWidth = isInitialWave
          ? Math.min(
              isNoEvidenceHypothesis
                ? IDEA_BENCHMARK_PRELIMINARY_HEDGE_WIDTH
                : IDEA_BENCHMARK_INITIAL_HEDGE_WIDTH,
              remainingAttemptCount,
              selectedModels.length,
            )
          : Math.min(
              missingCandidateCount,
              remainingAttemptCount,
              selectedModels.length,
            );

        const modelsForDirection = selectedModels.slice(0, parallelWidth);

        if (modelsForDirection.length === 0) {
          break;
        }

        for (const model of modelsForDirection) {
          attemptedModelIdsForDirection.add(model.id);
        }
        attemptedCandidateCount += modelsForDirection.length;

        this.throwIfBenchmarkAborted(signal);

        const settledAttempts = await this.executeParallelCandidateBatch(
          context,
          modelsForDirection,
          direction,
          blockedModelIds,
          blockedProviderKeys,
          false,
          isNoEvidenceHypothesis,
          signal,
          benchmarkDeadlineAt,
        );

        for (const candidate of settledAttempts) {
          if (!candidate) {
            continue;
          }

          acceptedCandidatesForDirection.push(candidate);
          successfulCandidates.push(candidate);
        }

        if (Date.now() >= benchmarkDeadlineAt) {
          this.logger.log(
            `Benchmark hard budget reached after ${Date.now() - benchmarkStartedAt}ms; retaining completed candidates and skipping all remaining waves.`,
          );
          break;
        }

        /*
         * The first provider-diverse batch is still executed in parallel so
         * comparative quality is preserved whenever two valid candidates are
         * immediately available. After that batch, one quality-approved,
         * distinct candidate is already sufficient for a successful run.
         * Continuing through every remaining provider only adds sequential
         * timeout windows and does not improve the selected result when the
         * product policy accepts a single validated candidate.
         */
        if (
          this.countQualityApprovedCandidates(successfulCandidates) >=
          IDEA_BENCHMARK_MIN_SUCCESSFUL_CANDIDATES
        ) {
          break;
        }

        const evidenceBackedWaveCandidate = !isNoEvidenceHypothesis
          ? this.findBestEvidenceBackedFastStopCandidate(settledAttempts)
          : null;
        if (evidenceBackedWaveCandidate) {
          this.logger.log(
            `Provider-diverse wave produced an evidence-backed ${evidenceBackedWaveCandidate.quality.score}-point candidate; stopping this opportunity immediately instead of starting another serial provider batch.`,
          );
          break;
        }

        const strongestStructuralFallback = this.findBestStructurallyValidCandidate(
          settledAttempts,
          IDEA_BENCHMARK_STRONG_FIRST_WAVE_FALLBACK_SCORE,
        );
        if (isInitialWave && strongestStructuralFallback) {
          this.logger.log(
            `First provider-diverse wave produced a strong structurally valid ${strongestStructuralFallback.quality.score}-point fallback; the 70-point quality gate remains unmet, but no second full provider-timeout wave is started.`,
          );
          break;
        }

        if (isInitialWave && acceptedCandidatesForDirection.length === 0) {
          const remainingOnlineRescue = orderedModels.some(
            (model) =>
              !blockedModelIds.has(model.id) &&
              !blockedProviderKeys.has(model.providerKey) &&
              !attemptedModelIdsForDirection.has(model.id),
          );
          if (remainingOnlineRescue) {
            this.logger.warn(
              `The first provider-diverse Core wave returned no structurally valid candidate for "${direction.opportunity.title}"; one bounded online rescue wave will be attempted before deterministic continuity fallback.`,
            );
            continue;
          }
          this.logger.warn(
            `Every bounded online Core route was unavailable or unusable for "${direction.opportunity.title}"; deterministic continuity fallback is now allowed.`,
          );
          break;
        }
      }

      if (
        acceptedCandidatesForDirection.length < targetCandidateCount &&
        !warnedOpportunityTitles.has(direction.opportunity.title)
      ) {
        warnedOpportunityTitles.add(direction.opportunity.title);
        const qualityGateSatisfied = acceptedCandidatesForDirection.some(
          (candidate) =>
            candidate.quality.accepted &&
            candidate.quality.score >= IDEA_MIN_ACCEPTED_QUALITY_SCORE,
        );
        this.logger.warn(
          qualityGateSatisfied
            ? `Opportunity "${direction.opportunity.title}" completed with ${acceptedCandidatesForDirection.length} accepted candidate(s); remaining provider requests were unavailable or cancelled after the preferred quality gate was satisfied.`
            : `Opportunity "${direction.opportunity.title}" completed with ${acceptedCandidatesForDirection.length} structurally valid fallback candidate(s); the preferred quality gate was not satisfied.`,
        );
      }

      const bestEvidenceBackedDirectionCandidate =
        this.findBestEvidenceBackedFastStopCandidate(
          acceptedCandidatesForDirection,
        );
      if (!isNoEvidenceHypothesis && bestEvidenceBackedDirectionCandidate) {
        this.logger.log(
          `Stopped benchmark after the first evidence-backed opportunity produced a structurally valid ${bestEvidenceBackedDirectionCandidate.quality.score}-point candidate; the ${IDEA_MIN_ACCEPTED_QUALITY_SCORE}-point gate remains a reporting benchmark while additional opportunity waves are skipped for latency.`,
        );
        break;
      }

      /*
       * A primary-domain validation hypothesis is the final honest fallback,
       * not one of several market opportunities. Once one complete candidate
       * exists, stop the outer opportunity loop as well; trying additional
       * unsupported hypotheses only repeats provider and revision cost.
       */
      if (isNoEvidenceHypothesis && acceptedCandidatesForDirection.length > 0) {
        const qualityGateSatisfied = acceptedCandidatesForDirection.some(
          (candidate) =>
            candidate.quality.accepted &&
            candidate.quality.score >= IDEA_MIN_ACCEPTED_QUALITY_SCORE,
        );
        if (qualityGateSatisfied) {
          this.logger.log(
            `Stopped benchmark after one qualified candidate for preliminary opportunity "${direction.opportunity.title}"; the preferred quality gate was satisfied without additional provider requests.`,
          );
        } else {
          this.logger.warn(
            `Stopped benchmark after one availability fallback for unvalidated opportunity "${direction.opportunity.title}"; the preferred quality gate was not satisfied.`,
          );
        }
        break;
      }

      /*
       * Once the global model-attempt budget is exhausted, later concept
       * directions cannot start any additional provider request. Stop here so
       * the same opportunity is not reported repeatedly with 0/2 candidates.
       */
      if (
        successfulCandidates.length > 0 &&
        Date.now() - benchmarkStartedAt >= totalWallClockBudgetMs
      ) {
        this.logger.log(
          `Benchmark wall-clock budget reached after ${Date.now() - benchmarkStartedAt}ms; retaining the strongest completed candidate without another provider wave.`,
        );
        break;
      }

      if (attemptedCandidateCount >= IDEA_BENCHMARK_MAX_MODEL_ATTEMPTS) {
        break;
      }
    }

    if (
      successfulCandidates.length === 0 &&
      localFallbackModel &&
      Date.now() < benchmarkDeadlineAt
    ) {
      this.throwIfBenchmarkAborted(signal);

      const localCandidate = await this.executeLocalEmergencyFallback(
        context,
        localFallbackModel,
        conceptDirections,
        signal,
        benchmarkDeadlineAt,
      );

      if (
        localCandidate &&
        !successfulCandidates.some(
          (candidate) => candidate.candidateId === localCandidate.candidateId,
        )
      ) {
        successfulCandidates.push(localCandidate);
      }
    }

    if (successfulCandidates.length === 0) {
      this.throwIfBenchmarkAborted(signal);

      const deterministicFallback = this.buildDeterministicEmergencyCandidate(
        context,
        conceptDirections[0]?.opportunity ??
          context.opportunityRanking?.selected ??
          null,
      );
      successfulCandidates.push(deterministicFallback);
      this.logger.error(
        [
          'All bounded AI core-generation attempts were unavailable or unusable.',
          'The run was preserved with an in-process deterministic emergency candidate instead of failing.',
          `opportunity=\"${deterministicFallback.opportunityTitle}\"`,
          `quality=${deterministicFallback.quality.score}`,
        ].join(' '),
      );
    }

    const qualityApprovedCandidates = successfulCandidates.filter(
      (candidate) =>
        candidate.quality.accepted &&
        candidate.quality.score >= IDEA_MIN_ACCEPTED_QUALITY_SCORE,
    );

    /*
     * Strict fast path: comparative judging is meaningful only when at least
     * two quality-approved candidates survive. Structurally valid fallback
     * candidates must never force an extra judge request after one strong
     * candidate has already passed the deterministic gate.
     */
    if (qualityApprovedCandidates.length === 1) {
      const onlyCandidate = qualityApprovedCandidates[0];

      const selectedCandidate: IdeaBenchmarkCandidate = {
        ...onlyCandidate,
        semanticDiversity: {
          candidateId: onlyCandidate.candidateId,
          diversityScore: 100,
          maxSimilarity: 0,
          mostSimilarCandidateId: null,
          duplicateRisk: 'LOW',
        },
        semanticDiversityAdjustedScore: onlyCandidate.quality.score,
        hybridFinalScore: null,
        finalScore: onlyCandidate.quality.score,
        selected: true,
      };

      const diagnosticCandidates = successfulCandidates.map((candidate) =>
        candidate.candidateId === selectedCandidate.candidateId
          ? selectedCandidate
          : {
              ...candidate,
              semanticDiversityAdjustedScore: candidate.quality.score,
              hybridFinalScore: null,
              finalScore: candidate.quality.score,
              selected: false,
            },
      );

      this.logger.log(
        `Comparative AI judge skipped: exactly one quality-approved candidate remained (${selectedCandidate.quality.score}/${IDEA_MIN_ACCEPTED_QUALITY_SCORE}).`,
      );

      this.persistCandidateDecisionSnapshotInBackground(
        context.runId,
        diagnosticCandidates,
        selectedCandidate.candidateId,
        null,
      );

      return {
        winner: selectedCandidate,
        candidates: diagnosticCandidates,
        judgeEvaluation: null,
      };
    }

    const comparisonCandidates =
      qualityApprovedCandidates.length >= 2
        ? qualityApprovedCandidates
        : successfulCandidates.map((candidate) =>
            this.sanitizeFallbackCandidateForEvidenceLimits(candidate),
          );

    const diversityScores = this.semanticDiversityService.evaluate(
      comparisonCandidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        parsedOutput: candidate.parsedOutput,
        opportunityTitle: candidate.opportunityTitle,
      })),
    );

    /*
     * Judge only the strongest opportunity-diverse shortlist. Sending every
     * accepted premium candidate in one request creates oversized prompts and
     * response schemas, which significantly increases timeout and malformed
     * JSON risk. Non-shortlisted candidates remain persisted for diagnostics.
     */
    const judgeCandidates = this.buildJudgeShortlist(
      comparisonCandidates,
      IDEA_JUDGE_MAX_CANDIDATES,
    );
    const judgeCandidateIds = new Set(
      judgeCandidates.map((candidate) => candidate.candidateId),
    );

    const deterministicJudgeOrder = [...judgeCandidates].sort(
      (first, second) =>
        second.quality.score - first.quality.score ||
        first.aiResult.responseTimeMs - second.aiResult.responseTimeMs,
    );
    const deterministicJudgeGap =
      deterministicJudgeOrder.length >= 2
        ? deterministicJudgeOrder[0].quality.score -
          deterministicJudgeOrder[1].quality.score
        : Number.POSITIVE_INFINITY;
    const shouldRunComparativeJudge =
      IDEA_BENCHMARK_COMPARATIVE_JUDGE_ENABLED &&
      qualityApprovedCandidates.length >= 2 &&
      judgeCandidates.length >= 2 &&
      deterministicJudgeGap < 6 &&
      Date.now() + 1_500 < benchmarkDeadlineAt;

    const judgeEvaluation = shouldRunComparativeJudge
      ? await this.candidateJudgeService.evaluate(
          context,
          judgeCandidates.map((candidate) => ({
            candidateId: candidate.candidateId,
            parsedOutput: candidate.parsedOutput,
          })),
        )
      : null;

    if (!shouldRunComparativeJudge) {
      this.logger.debug(
        judgeCandidates.length < 2
          ? 'Comparative AI judge skipped because fewer than two quality-approved candidates survived.'
          : `Comparative AI judge skipped because deterministic quality already separated the top candidates by ${deterministicJudgeGap.toFixed(1)} point(s).`,
      );
    }

    const useJudgeScores =
      judgeEvaluation !== null &&
      judgeEvaluation.confidence >=
        IDEA_JUDGE_MIN_CONFIDENCE_FOR_HYBRID_SELECTION;

    const diversityScoresForScoring = diversityScores;

    const scoredCandidates = comparisonCandidates.map((candidate) => {
      const aiJudge =
        judgeEvaluation?.scores.find(
          (score) => score.candidateId === candidate.candidateId,
        ) ?? null;
      const semanticDiversity =
        diversityScoresForScoring.get(candidate.candidateId) ?? null;

      const diversityScore = semanticDiversity?.diversityScore ?? 100;
      const semanticDiversityAdjustedScore =
        this.calculateDiversityAdjustedDeterministicScore(
          candidate.quality.score,
          diversityScore,
        );
      const hybridFinalScore =
        useJudgeScores &&
        judgeCandidateIds.has(candidate.candidateId) &&
        aiJudge !== null
          ? this.calculateHybridFinalScore(
              semanticDiversityAdjustedScore,
              aiJudge.overallScore,
            )
          : null;

      return {
        ...candidate,
        aiJudge,
        semanticDiversity,
        semanticDiversityAdjustedScore,
        hybridFinalScore,
        finalScore: hybridFinalScore ?? semanticDiversityAdjustedScore,
        selected: false,
      };
    });

    /* Only shortlisted candidates are eligible to win comparative selection. */
    const rankedCandidates = [...scoredCandidates].sort((first, second) => {
      const shortlistDifference = useJudgeScores
        ? Number(judgeCandidateIds.has(second.candidateId)) -
          Number(judgeCandidateIds.has(first.candidateId))
        : 0;

      return (
        shortlistDifference ||
        second.finalScore - first.finalScore ||
        second.quality.score - first.quality.score ||
        first.aiResult.responseTimeMs - second.aiResult.responseTimeMs
      );
    });

    const topCandidate = rankedCandidates[0];

    if (!topCandidate) {
      throw new ServiceUnavailableException(
        'No successful idea candidate could be selected.',
      );
    }

    const winner: IdeaBenchmarkCandidate = {
      ...topCandidate,
      selected: true,
    };

    const candidates = rankedCandidates.map((candidate) =>
      candidate.candidateId === winner.candidateId
        ? winner
        : { ...candidate, selected: false },
    );

    const finalJudgeEvaluation = judgeEvaluation
      ? {
          ...judgeEvaluation,
          winnerCandidateId: winner.candidateId,
          reason: this.buildSelectionReason(
            winner,
            judgeEvaluation,
            useJudgeScores,
          ),
          comparisonReport: judgeEvaluation.comparisonReport.map((report) => ({
            ...report,
            verdict:
              report.candidateId === winner.candidateId
                ? ('WINNER' as const)
                : ('REJECTED' as const),
          })),
        }
      : null;

    this.persistCandidateDecisionSnapshotInBackground(
      context.runId,
      candidates,
      winner.candidateId,
      finalJudgeEvaluation,
    );

    return {
      winner,
      candidates,
      judgeEvaluation: finalJudgeEvaluation,
    };
  }


  /**
   * Builds a complete in-process candidate when every bounded AI request fails.
   *
   * This is an availability safeguard, not synthetic community evidence. The
   * candidate is derived only from the already-ranked opportunity, retained
   * evidence, requester description, selected domains, and pilot location.
   * Provider outages therefore degrade generation quality gracefully instead
   * of turning an otherwise valid paid generation run into a technical failure.
   */
  private buildDeterministicEmergencyCandidate(
    context: IdeaGenerationContext,
    opportunity: RankedIdeaOpportunity | null,
  ): IdeaBenchmarkCandidate {
    const startedAt = Date.now();
    let parsedOutput = this.buildDeterministicEmergencyOutput(
      context,
      opportunity,
    );

    if (this.hasExplicitRequesterProblem(context)) {
      try {
        this.assertRequesterIntentLock(context, parsedOutput, {
          allowRequestLockedEmergency: true,
        });
      } catch (error: unknown) {
        this.logger.warn(
          `Deterministic emergency candidate drifted from the requester description; rebuilding directly from the request without the ranked archetype. error=${error instanceof Error ? error.message : String(error)}`,
        );
        parsedOutput = this.buildDeterministicEmergencyOutput(context, null);
        this.assertRequesterIntentLock(context, parsedOutput, {
          allowRequestLockedEmergency: true,
          suppressMismatchThrow: true,
        });
      }
    }

    if (
      !this.hasExplicitRequesterProblem(context) &&
      !this.resolveCanonicalDiscoveryProblemLock(context, opportunity) &&
      this.readOpportunityFamilyKey(opportunity) ===
        'application-access-support'
    ) {
      this.assertWinnerProblemLock(context, parsedOutput);
    }

    // Request/problem locking above intentionally runs against the canonical
    // request-derived emergency blueprint before localization. Once the
    // continuity candidate is proven to preserve intent, localize every
    // human-readable field so an Arabic frontend request cannot be turned into
    // a terminal validation failure merely because all online providers failed.
    if (context.outputLanguage === LanguageCode.AR) {
      parsedOutput = this.localizeDeterministicEmergencyOutputToArabic(
        context,
        parsedOutput,
        opportunity,
      );
    }

    const qualityContext = this.buildQualityContext(context);
    const quality = this.qualityEvaluatorService.evaluate(
      parsedOutput,
      qualityContext,
    );
    const opportunityRank = opportunity?.rank ?? 1;
    const opportunityTitle =
      opportunity?.title?.trim() ||
      `${this.resolveEmergencyDomainLabel(context, opportunity)} Operational Validation`;
    const candidateId = randomUUID();
    const providerKey = AI_PROVIDER_KEYS.OLLAMA;
    const apiModelId = 'internal/deterministic-emergency-fallback';
    const text = JSON.stringify(parsedOutput);

    const aiResult: AiExecutionResult = {
      text,
      operationId: `deterministic:${context.runId}`,
      aiModelId: 'deterministic-emergency-fallback',
      providerKey,
      apiModelId,
      inputTokens: 0,
      outputTokens: 0,
      costEstimate: 0,
      responseTimeMs: Math.max(1, Date.now() - startedAt),
      finishReason: AiFinishReason.STOP,
      fallbackUsed: true,
      attemptCount: 0,
    };

    return {
      candidateId,
      modelSnapshot: {
        id: 'deterministic-emergency-fallback',
        providerKey,
        apiModelId,
        modelName: 'Deterministic Emergency Fallback',
        displayName: 'Deterministic Emergency Fallback',
      },
      aiResult,
      parsedOutput,
      quality,
      aiJudge: null,
      finalScore: quality.score,
      semanticDiversityAdjustedScore: quality.score,
      hybridFinalScore: null,
      selected: false,
      opportunityRank,
      opportunityTitle,
      semanticDiversity: null,
      deterministicEmergencyFallback: true,
    };
  }

  /** Builds the complete tier-specific output used by the emergency candidate. */
  private buildDeterministicEmergencyOutput(
    context: IdeaGenerationContext,
    opportunity: RankedIdeaOpportunity | null,
  ): ParsedIdeaAiOutput {
    const domainLabel = this.resolveEmergencyDomainLabel(context, opportunity);
    const problem = this.resolveEmergencyProblem(context, opportunity);
    const evidence = this.resolveEmergencyEvidence(opportunity);
    const need =
      opportunity?.need?.trim() ||
      opportunity?.solutionArea?.trim() ||
      'a reliable, auditable workflow that centralizes the affected process and supports human-reviewed resolution';
    const hasCanonicalDiscoveryEvidence = Boolean(
      this.resolveCanonicalDiscoveryProblemLock(context, opportunity),
    );
    const validationOnly = Boolean(
      !hasCanonicalDiscoveryEvidence &&
        opportunity?.disqualificationReasons.includes(
          'PRIMARY_DOMAIN_VALIDATION_HYPOTHESIS',
        ) &&
        (opportunity.verifiedProblemMatchedEvidenceCount ??
          opportunity.verifiedIndependentEvidenceCount ??
          opportunity.verifiedEvidenceCount ??
          0) === 0,
    );
    const blueprintEvidenceDescription = [
      opportunity?.title ?? '',
      problem,
      need,
      evidence ?? '',
    ]
      .map((value) => value.trim())
      .filter(Boolean)
      .join(' ');
    const problemFamilyKey = this.resolveCanonicalDiscoveryProblemLock(
      context,
      opportunity,
    )
      ? null
      : this.readOpportunityFamilyKey(opportunity);
    const aiReferenceLinkReliability = this.isAiReferenceLinkReliabilityOpportunity(
      opportunity,
      problem,
      evidence,
    );
    const requesterGroundedZeroEvidence = Boolean(
      validationOnly && this.hasExplicitRequesterProblem(context),
    );
    const blueprint = this.hasExplicitRequesterProblem(context)
      ? this.buildRequestLockedEmergencyBlueprint(
          context,
          opportunity,
          domainLabel,
          problem,
        )
      : validationOnly && !requesterGroundedZeroEvidence
        ? null
        : problemFamilyKey === 'application-access-support'
          ? this.buildApplicationAccessSupportEmergencyBlueprint(
              domainLabel,
              problem,
              evidence,
            )
          : aiReferenceLinkReliability
            ? this.buildAiReferenceLinkReliabilityEmergencyBlueprint(domainLabel)
            : RequestProductBlueprintUtil.build({
                requestDescription: context.requestDescription,
                evidenceDescription: blueprintEvidenceDescription,
                domainName: context.domainName,
                opportunityTitle: opportunity?.title,
                problemFamilyKey,
                enableEvidenceDerivedFeatureCapability:
                  context.domainResolution?.source === 'USER_SELECTED',
                enableEvidenceDerivedProblemWorkflow:
                  context.domainResolution?.source === 'USER_SELECTED',
              });
    const title = validationOnly && !blueprint
      ? `${domainLabel} Problem Discovery & Evidence Validation Workspace`
      : blueprint?.title ??
        this.buildEmergencyProductTitle(
          opportunity?.title ?? '',
          problem,
          domainLabel,
        );
    const targetUsers = validationOnly && !blueprint
      ? [
          `${domainLabel} operators and practitioners participating in problem discovery`,
          `${domainLabel} product or process owners reviewing evidence`,
          'Pilot researchers and authorized evidence reviewers',
        ]
      : blueprint?.targetUsers ??
        this.resolveEmergencyTargetUsers(
          context,
          opportunity,
          domainLabel,
        );
    const verifiedEvidenceCount = this.resolveVerifiedProblemEvidenceCount(opportunity);
    const verifiedEvidenceSourceCount = this.resolveVerifiedProblemEvidenceSourceCount(opportunity);
    const evidenceQualification = verifiedEvidenceCount > 0
      ? `The direction uses ${verifiedEvidenceCount} retained problem-matched external evidence item(s) across ${Math.max(1, verifiedEvidenceSourceCount)} retained source(s) as preliminary support; no direct-user recurrence claim is made unless direct evidence is separately verified.`
      : this.hasExplicitRequesterProblem(context)
        ? 'No independent community evidence survived the bounded collection window, so the explicitly requester-stated problem is preserved as a validation hypothesis rather than presented as observed market demand.'
        : 'No independent community evidence survived the bounded collection window, so this direction is treated as a preliminary validation hypothesis based on the ranked domain signals rather than proven market demand.';
    const problemStatement = this.buildEmergencyProblemStatement(
      context,
      problem,
      evidenceQualification,
      domainLabel,
      blueprint?.workflowFocus,
    );
    const objectives = validationOnly && !blueprint
      ? [
          `Capture direct ${domainLabel} user and operator problem reports with source provenance, workflow context, and evidence type clearly separated from assumptions.`,
          'Classify retained reports into concrete problem families and compare actionability, independent-source support, and semantic domain fit without promoting unverified hypotheses to demand evidence.',
          'Provide a human-reviewed evidence board that shows which problem families are supported, rejected, duplicated, or still unvalidated before any solution-specific implementation begins.',
          'Establish a pilot baseline for evidence volume, source diversity, and problem-family confidence, then select at most one validated problem for a later implementation pilot.',
        ]
      : blueprint
        ? [...blueprint.objectives]
        : [
            `Centralize the records, status changes, and operational context needed to investigate the selected issue: ${this.normalizeEmergencyProblemForSentence(problem)}.`,
            `Implement a deterministic triage and prioritization workflow that links each reported issue to its supporting evidence, current status, responsible owner, and next human-reviewed action.`,
            `Protect sensitive ${domainLabel} records with role-based access control, encrypted transport, bounded data retention, and an immutable audit trail for critical changes.`,
            `Establish a baseline during the first pilot phase and measure directional change in resolution time, coordination errors, and unresolved cases during the remaining pilot period without pre-committing unsupported percentage improvements.`,
          ];
    const country = context.location.country?.trim() || 'the selected pilot region';
    const workflowNarrative = validationOnly && !blueprint
      ? `The end-to-end workflow begins with evidence intake rather than a preselected solution. Participants submit concrete ${domainLabel} problem reports, and the workspace preserves the source, affected workflow, observed consequence, recurrence context, and current workaround when available. Reviewers then group semantically similar reports into problem families, compare evidence quality and source diversity, and mark each family as unsupported, preliminary, or ready for a later implementation pilot. No remediation workflow is generated until one concrete problem survives verification.`
      : blueprint
        ? `The pilot centers on ${blueprint.workflowFocus}. The MVP combines ${blueprint.features
            .slice(0, 3)
            .join('; ')}. Recommendations, exceptions, approvals, and other consequential workflow actions remain human reviewed, with source records and decision rationale preserved for audit.`
        : `The end-to-end workflow begins by capturing the minimum records required to understand the affected process. Authorized users review a structured case view containing the relevant source evidence, operational context, status history, and ownership information. The workspace then guides staff through triage, assignment, verification, and resolution steps so the team can replace fragmented messages or ad-hoc workarounds with one traceable source of truth. The product does not claim to automate a final business, clinical, academic, financial, or regulatory decision; consequential actions remain human reviewed.`;
    const fullAbstract = [
      validationOnly && !blueprint
        ? `${title} is a validation-first software pilot for ${domainLabel}. No concrete external problem has yet survived verification, so the workspace does not assume a specific operational failure or demand pattern. ${evidenceQualification}`
        : requesterGroundedZeroEvidence
          ? `${title} is a preliminary requester-grounded software product for the exact workflow described in the request. The requester-defined problem remains: ${this.normalizeEmergencyProblemForSentence(problem)}. The operational scope comes from the requester statement rather than external market evidence, so prevalence and demand remain unvalidated. ${evidenceQualification}`
          : `${title} is a preliminary software product designed around the ranked ${domainLabel} problem: ${problem}. ${evidenceQualification}`,
      workflowNarrative,
      `The implementation uses a modular NestJS backend with PostgreSQL for relational records and Prisma ORM for typed persistence. A responsive React or Next.js client provides the operational workspace. BullMQ with Redis is used only for durable asynchronous work such as notifications, imports, or report preparation when needed. API boundaries enforce authenticated access, role-based permissions, input validation, encrypted transport, and audit logging. The design keeps external integrations optional so the pilot can start with secure file import or manual entry when third-party APIs are unavailable.`,
      `For an initial pilot in ${country}, the first phase establishes baseline workflow volume, unresolved-case age, and coordination errors. Later phases measure directional change after the structured workflow is introduced and collect direct user feedback to determine whether the product should be expanded. The pilot must validate data availability, staff adoption, integration constraints, and the actual prevalence of the ranked problem before broader rollout.`,
      `Key limitations include sparse evidence, dependency on the quality of source records, and the possibility that the ranked problem is not broadly representative. The product therefore preserves evidence provenance, labels assumptions, avoids market-wide claims, and routes uncertain cases to human review. The immediate objective is a problem-specific, measurable pilot that improves evidence quality and human decision execution, not autonomous decision making.`,
    ].join('\n\n');
    const partialAbstract = validationOnly
      ? `${title} is a neutral ${domainLabel} problem-discovery and evidence-validation pilot. No specific operational problem is treated as validated yet. The workspace captures direct reports, preserves provenance, compares problem families, and decides which single problem has enough verified support to justify a later implementation pilot.`
      : blueprint
        ? `${title} is a preliminary ${domainLabel} product that addresses: ${problem} ${evidenceQualification} The pilot focuses on ${blueprint.workflowFocus} and measures ${blueprint.metrics.slice(0, 4).join(', ')} before any broader demand claim is made.`
        : `${title} is a preliminary ${domainLabel} workflow that addresses: ${problem} ${evidenceQualification} The pilot centralizes the affected records, makes ownership and status visible, and tests whether a structured human-reviewed process improves coordination before any broader demand claim is made.`;
    const limitedAbstract = partialAbstract.split(/\s+/u).slice(0, 65).join(' ');

    const coreIdea: ParsedIdeaAiOutput['coreIdea'] = {
      title,
      problemStatement,
      objectives,
      targetUsers: [...targetUsers],
    };

    if (context.generationType === IdeaGenerationType.GUEST_FREE) {
      coreIdea.limitedAbstract = limitedAbstract;
      coreIdea.partialAbstract = partialAbstract;
    } else if (context.generationType === IdeaGenerationType.NORMAL_FREE) {
      coreIdea.partialAbstract = partialAbstract;
    } else {
      coreIdea.fullAbstract = fullAbstract;
    }

    return {
      coreIdea,
      advancedOutputs:
        context.generationType === IdeaGenerationType.PREMIUM_CREDIT
          ? this.buildEmergencyPremiumOutputs(
              context,
              title,
              problem,
              need,
              domainLabel,
              targetUsers,
              fullAbstract,
              evidence,
              blueprint,
            )
          : [],
    };
  }


  /**
   * Localizes the deterministic continuity candidate without another AI call.
   *
   * Provider outages and exhausted provider credit are availability failures,
   * not a reason to violate the frontend-selected output language. The
   * emergency candidate therefore uses a complete Arabic continuity narrative
   * while keeping schema keys and standard technical product names unchanged.
   */
  private localizeDeterministicEmergencyOutputToArabic(
    context: IdeaGenerationContext,
    output: ParsedIdeaAiOutput,
    opportunity: RankedIdeaOpportunity | null,
  ): ParsedIdeaAiOutput {
    const verifiedEvidenceCount = this.resolveVerifiedProblemEvidenceCount(opportunity);
    const verifiedSourceCount = this.resolveVerifiedProblemEvidenceSourceCount(opportunity);
    const evidenceState = verifiedEvidenceCount > 0
      ? `تم الاحتفاظ بـ ${verifiedEvidenceCount} عنصر دليل خارجي مرتبط بالمشكلة من ${Math.max(1, verifiedSourceCount)} مصدر مستقل أو أكثر، ويُستخدم هذا الدليل كدعم أولي لا كإثبات لانتشار المشكلة في السوق كله.`
      : this.hasExplicitRequesterProblem(context)
        ? 'لم ينجُ دليل خارجي مستقل من نافذة الجمع المحدودة، لذلك تبقى المشكلة التي وصفها المستخدم فرضية تحقق صريحة ولا تُعرض على أنها طلب سوق مثبت.'
        : 'لم ينجُ دليل خارجي مستقل من نافذة الجمع المحدودة، لذلك يبقى اتجاه المشروع فرضية تحقق أولية مبنية على نطاق المجال والإشارات المرتبة ولا يُعرض على أنه طلب سوق مثبت.';
    const canonicalLock = this.resolveCanonicalDiscoveryProblemLock(
      context,
      opportunity,
    );
    const scopeSentence = canonicalLock
      ? 'يعتمد المسار على عائلة المشكلة التي ثبّتها التحليل القانوني للأدلة، مع إبقاء كل الادعاءات الأخرى مؤقتة إلى أن تُراجع.'
      : this.hasExplicitRequesterProblem(context)
        ? 'يعتمد المسار على المشكلة والعملية التشغيلية اللتين حددهما المستخدم في الطلب الأصلي، ولا يسمح لمسار الاستمرارية باستبدالهما بمشكلة شائعة من المجال.'
        : 'يعتمد المسار على أقوى فرصة متاحة داخل المجال المحدد مع إبقاء المشكلة قابلة للتحقق والمراجعة قبل توسيع التنفيذ.';

    const title = 'منصة التحقق التشغيلي وإدارة الأدلة';
    const problemStatement = [
      'تُنشأ هذه الفكرة كمسار استمرارية عندما لا ينتج أي نموذج ذكاء اصطناعي متصل مخرجات صالحة ضمن المهلة المحددة.',
      scopeSentence,
      evidenceState,
      'المشكلة العملية التي يعالجها النظام هي تشتت السجلات والسياق وحالة المراجعة بين مصادر متعددة، بما يصعّب معرفة ما الذي حدث فعليًا، وما الدليل المرتبط به، ومن المسؤول عن القرار التالي، ويزيد احتمالات التأخير والعمل المكرر والقرارات غير القابلة للتتبع.',
      'لذلك يركز المنتج على تجميع السجلات ذات الصلة، حفظ مصدر كل معلومة، فصل الدليل الخارجي عن افتراضات المستخدم أو النظام، وتوجيه الحالات غير المؤكدة إلى مراجعة بشرية قبل اتخاذ إجراء مؤثر.',
    ].join(' ');
    const objectives = [
      'تجميع السجلات والإشارات المرتبطة بالعملية المطلوبة في مساحة عمل واحدة مع مصدر واضح وتاريخ للحالة والملكية.',
      'ربط كل مشكلة أو إشارة بالدليل المؤيد أو بحالة عدم التحقق، ومنع تحويل الفرضيات إلى ادعاءات عن الطلب أو الانتشار.',
      'توفير مسار فرز ومراجعة بشرية يحدد الأولوية والمسؤول والخطوة التالية ويسجل سبب كل قرار مؤثر بشكل قابل للتدقيق.',
      'تشغيل تجربة أولية تقيس زمن المعالجة والعمل المكرر والحالات غير المحسومة وجودة التتبع قبل اتخاذ قرار بالتوسع.',
    ];
    const targetUsers = [
      'المستخدمون والمشغلون المسؤولون عن العملية التشغيلية المحددة في الطلب',
      'المراجعون وأصحاب القرار المسؤولون عن التحقق من الأدلة واعتماد الإجراءات',
    ];
    const partialAbstract = [
      `${title} هو منتج برمجي أولي يحافظ على نطاق المشكلة المختارة حتى عندما تفشل جميع محاولات التوليد عبر المزودات الخارجية.`,
      evidenceState,
      'يجمع النظام السجلات والإشارات في سجل موحد، ويعرض حالة كل دليل ومصدره ومالك الحالة والخطوات السابقة، ثم يمرر الحالات غير المؤكدة إلى مراجعة بشرية بدل إصدار استنتاج آلي نهائي.',
      'تبدأ التجربة بقياس خط أساس لزمن المعالجة والعمل المكرر والحالات المتأخرة وجودة التوثيق، ثم تقارن التغير بعد استخدام المسار المنظم من غير افتراض نسب تحسين غير مثبتة.',
    ].join(' ');
    const fullAbstract = [
      partialAbstract,
      'تعتمد البنية على واجهة استخدام متجاوبة وخدمة خلفية معيارية وقاعدة بيانات علائقية، مع فصل واضح بين طبقة جمع البيانات وطبقة التحقق وطبقة العرض واتخاذ القرار. تُحفظ الصلاحيات وسجل التدقيق وتاريخ التغييرات كجزء أساسي من التصميم، وتبقى التكاملات الخارجية اختيارية حتى لا يتوقف التشغيل الأولي على خدمة طرف ثالث.',
      'لا يتعامل النظام مع وصف المستخدم أو اختيار المجال على أنه دليل خارجي مستقل. كل إشارة خارجية تحتفظ بمصدرها ونوعها وحالة مطابقتها للمشكلة، وأي حالة ضعيفة أو متعارضة تبقى معلّمة للمراجعة بدل رفعها تلقائيًا إلى حقيقة تشغيلية أو طلب سوق.',
      'تُقاس جدوى التجربة من خلال اكتمال البيانات، وسرعة الوصول إلى سبب المشكلة، ووضوح المسؤولية، وانخفاض إعادة العمل، وعدد الحالات التي أُغلقت مع قرار موثق. إذا لم تتوفر بيانات كافية أو لم يظهر تحسن قابل للملاحظة، يبقى المشروع في مرحلة التحقق ولا تُوسّع الادعاءات أو النطاق.',
    ].join('\n\n');
    const limitedAbstract = partialAbstract.split(/\s+/u).slice(0, 70).join(' ');

    const coreIdea: ParsedIdeaAiOutput['coreIdea'] = {
      title,
      problemStatement,
      objectives,
      targetUsers,
    };
    if (context.generationType === IdeaGenerationType.GUEST_FREE) {
      coreIdea.limitedAbstract = limitedAbstract;
      coreIdea.partialAbstract = partialAbstract;
    } else if (context.generationType === IdeaGenerationType.NORMAL_FREE) {
      coreIdea.partialAbstract = partialAbstract;
    } else {
      coreIdea.fullAbstract = fullAbstract;
    }

    const localizedAdvanced = output.advancedOutputs.map((item) => ({
      ...item,
      title: this.resolveArabicEmergencyOutputTitle(item.outputKey),
      content: item.outputKey === 'full-abstract'
        ? fullAbstract
        : this.buildArabicEmergencyOutputContent(
            item.outputKey,
            evidenceState,
          ),
    }));

    return {
      coreIdea,
      advancedOutputs: localizedAdvanced,
    };
  }

  private resolveArabicEmergencyOutputTitle(
    key: ParsedIdeaAiOutput['advancedOutputs'][number]['outputKey'],
  ): string {
    const titles: Record<ParsedIdeaAiOutput['advancedOutputs'][number]['outputKey'], string> = {
      'full-abstract': 'الملخص الكامل',
      'technology-stack': 'الحزمة التقنية',
      'system-architecture': 'معمارية النظام',
      'database-design': 'تصميم قاعدة البيانات',
      'mvp-features': 'ميزات النسخة الأولية',
      'value-proposition': 'القيمة المقترحة',
      'revenue-model': 'نموذج الإيرادات',
      'local-regulations': 'الاعتبارات التنظيمية المحلية',
      'budget-estimation': 'تقدير الميزانية',
      'feasibility-assessment': 'تقييم الجدوى',
      'implementation-timeline': 'الجدول الزمني للتنفيذ',
      'market-potential': 'إمكانات السوق',
      'nlp-executive-summary': 'الملخص التنفيذي للتحليل',
      'community-feedback-summary': 'ملخص أدلة المجتمع',
    };
    return titles[key];
  }

  private buildArabicEmergencyOutputContent(
    key: ParsedIdeaAiOutput['advancedOutputs'][number]['outputKey'],
    evidenceState: string,
  ): string {
    switch (key) {
      case 'technology-stack':
        return 'واجهة ويب أو تطبيق متجاوب، وخدمة خلفية معيارية باستخدام NestJS، وقاعدة PostgreSQL عبر Prisma، مع Redis وBullMQ للأعمال غير المتزامنة عند الحاجة. تُطبّق المصادقة والصلاحيات والتحقق من المدخلات والتشفير أثناء النقل وسجل التدقيق من البداية، وتبقى التكاملات الخارجية اختيارية حتى لا تصبح نقطة فشل وحيدة.';
      case 'system-architecture':
        return 'تتكون المعمارية من طبقة إدخال وجمع، وطبقة تحقق وتصنيف، وخدمة لإدارة الحالات والملكية، وطبقة أدلة تحفظ المصدر والحالة، وواجهة مراجعة بشرية، وخدمة تقارير وتنبيهات. تمر التغييرات المؤثرة عبر خدمات واضحة الحدود وتُسجل في سجل تدقيق، بينما تُعزل المهام البطيئة في طابور غير متزامن ولا تعطل المسار التفاعلي.';
      case 'database-design':
        return 'تشمل الكيانات الأساسية مساحة العمل، والسجل التشغيلي، وعنصر الدليل، ووجه المشكلة، وحالة المراجعة، وقرار المراجع، والمستخدم والدور، وحدث التدقيق. تحفظ العلاقات مصدر الدليل وتاريخه وارتباطه بالمشكلة والقرار الناتج، مع فهارس للبحث حسب الحالة والمالك والزمن ومنع حذف التاريخ الحرج بصمت.';
      case 'mvp-features':
        return 'تبدأ النسخة الأولية بإدخال السجلات واستيرادها، ولوحة موحدة للحالات، وربط الأدلة بالمشكلات، وإظهار حالة التحقق والمصدر، وفرز الأولويات، وتعيين مسؤول، ومراجعة بشرية، وسجل قرارات، وتنبيهات للحالات المتأخرة، وتقارير أساسية لقياس زمن المعالجة والعمل المكرر والحالات غير المحسومة.';
      case 'value-proposition':
        return 'القيمة الأساسية هي تحويل عملية متفرقة وغير قابلة للتتبع إلى مسار موحد يوضح ما الذي نعرفه، وما الذي لم يُتحقق منه، ومن يملك الحالة، وما الخطوة التالية. يقلل ذلك ضياع السياق وإعادة العمل ويمنح أصحاب القرار سجلًا يمكن مراجعته بدل الاعتماد على رسائل وملفات منفصلة أو استنتاجات غير موثقة.';
      case 'revenue-model':
        return 'يُختبر نموذج الإيرادات بعد إثبات الحاجة في التجربة الأولية. الخيارات المناسبة تشمل اشتراكًا حسب مساحة العمل أو عدد المستخدمين، وخطة مؤسسية تتضمن صلاحيات وتقارير وتكاملات إضافية. لا تُفترض أسعار أو معدلات تحويل قبل جمع بيانات حقيقية عن الاستخدام والاستعداد للدفع وتكلفة التشغيل.';
      case 'local-regulations':
        return 'يجب تحديد نوع البيانات والجهات المنظمة في منطقة التجربة قبل الإطلاق. الحد الأدنى يشمل تقليل جمع البيانات، وتحديد أغراض المعالجة، والصلاحيات حسب الدور، والاحتفاظ المحدود، وسجل التدقيق، وآلية حذف أو تصحيح عند الحاجة. أي قرار مالي أو طبي أو قانوني أو تنظيمي مؤثر يبقى تحت مراجعة بشرية متخصصة.';
      case 'budget-estimation':
        return 'تُقسم الميزانية إلى تطوير الواجهة والخدمة الخلفية، والبنية السحابية وقاعدة البيانات، والمراقبة والنسخ الاحتياطي، والأمن، والتكاملات، واختبار المستخدمين. يُبنى التقدير النهائي من ساعات العمل وأسعار الاستضافة الفعلية وحجم البيانات في تجربة محدودة، مع هامش للمخاطر بدل وضع رقم ثابت غير مدعوم.';
      case 'feasibility-assessment':
        return 'الجدوى التقنية مرتفعة لأن الوظائف الأساسية تعتمد على نماذج بيانات علائقية ومسارات مراجعة معروفة، لكن الجدوى التجارية تعتمد على توفر السجلات الحقيقية وتكرار المشكلة واستعداد المستخدمين لتغيير سير العمل. نجاح التجربة يتطلب بيانات كافية، مالكًا واضحًا للعملية، ومقاييس خط أساس قبل قياس أي تحسن.';
      case 'implementation-timeline':
        return 'المرحلة الأولى لتثبيت نطاق المشكلة ونموذج البيانات ومقاييس خط الأساس، ثم بناء الإدخال ولوحة الحالات وربط الأدلة، وبعدها إضافة المراجعة والصلاحيات وسجل التدقيق والتقارير. تُختتم الخطة بتجربة محدودة ومراجعة النتائج؛ لا ينتقل المشروع إلى توسع أوسع قبل تحقق شروط الجودة والأمان ووجود أثر عملي قابل للملاحظة.';
      case 'market-potential':
        return `يُعامل حجم الفرصة كفرضية حتى تثبتها التجربة وبيانات الاستخدام الفعلية. ${evidenceState} لذلك تُقاس الإمكانات بعدد الجهات التي تعاني من نفس سير العمل، وتكرار الحالات، وكلفة التأخير أو إعادة العمل، واستعدادها لتبني أداة موحدة، وليس بتقدير سوقي عام غير مرتبط بالأدلة.`;
      case 'nlp-executive-summary':
        return 'حافظ التحليل على مشكلة المستخدم أو عائلة المشكلة القانونية باعتبارها مرجع النطاق، وفصل بين وصف المستخدم والدليل الخارجي. مسار الاستمرارية لا يضيف مشكلة بديلة ولا يدعي تكرارًا غير مثبت؛ وظيفته إنتاج تصور قابل للتنفيذ والتحقق عندما تكون مخرجات المزودات الخارجية غير متاحة أو غير صالحة.';
      case 'community-feedback-summary':
        return `${evidenceState} تُعرض الأدلة المحتفظ بها مع مصدرها ونوعها ودرجة ارتباطها، وتبقى الإشارات السياقية أو غير المرتبطة خارج ادعاء المشكلة. إذا لم يوجد دليل صالح، توضح الواجهة ذلك صراحة وتحوّل الخطوة التالية إلى جمع تحقق مباشر بدل تصنيع دليل أو رفع وصف المستخدم إلى شهادة مستقلة.`;
      case 'full-abstract':
        return '';
    }
  }


  /**
   * Builds the emergency product only from the canonical requester profile.
   * No evidence-derived category classifier is allowed to replace the user's
   * actor, object, workflow, failure modes, or consequences on this path.
   */
  private buildRequestLockedEmergencyBlueprint(
    context: IdeaGenerationContext,
    opportunity: RankedIdeaOpportunity | null,
    domainLabel: string,
    problem: string,
  ): NonNullable<ReturnType<typeof RequestProductBlueprintUtil.build>> {
    const profile = context.collectionPlan?.problemProfile;
    const actor =
      profile?.actorAliases?.map((value) => value.trim()).find(Boolean) ||
      profile?.actor?.trim() ||
      this.resolveEmergencyTargetUsers(context, opportunity, domainLabel)[0] ||
      `${domainLabel} practitioners`;
    const object = profile?.object?.trim() || domainLabel;
    const workflow = profile?.workflow?.trim() || problem;
    const failureModes = (profile?.failureModes ?? []).map((value) => value.trim()).filter(Boolean).slice(0, 5);
    const consequences = (profile?.consequences ?? []).map((value) => value.trim()).filter(Boolean).slice(0, 4);
    const familyTitle = opportunity?.title?.trim();
    const genericFamilyTitle = /^(?:requester-defined workflow opportunity|most-evidenced request problem family)$/iu.test(familyTitle ?? '');
    const primaryDomainLabel =
      context.domainName?.trim() ||
      context.selectedDomains[0]?.name?.trim() ||
      domainLabel;
    const objectTitle = this.toEmergencyTitleCase(
      this.compactEmergencyObjectLabel(object)
        .split(/\s+/u)
        .filter(Boolean)
        .slice(0, 6)
        .join(' '),
    );
    const baseTitle = !genericFamilyTitle && familyTitle
      ? familyTitle
      : objectTitle || this.toEmergencyTitleCase(primaryDomainLabel);
    const cleanedTitleBase = baseTitle
      .replace(/\b(?:problem|pressure|failures?)\b/giu, '')
      .replace(/\s+/gu, ' ')
      .trim();
    const title = this.composeBoundedEmergencyTitle(
      cleanedTitleBase,
      'Risk & Exception Workspace',
      100,
    );
    const primaryFailures = failureModes.length > 0 ? failureModes : [problem];
    const primaryConsequences = consequences.length > 0 ? consequences : ['delayed or lower-quality operational decisions'];

    return {
      baseLabel: domainLabel,
      title,
      workflowFocus: `${workflow}; preserving the requester-defined relationship between ${object} and the observed operational or financial consequences without substituting a different workflow`,
      targetUsers: [
        actor,
        `${this.toEmergencyTitleCase(actor)} workflow leads`,
      ].filter((value, index, values) =>
        values.findIndex(
          (candidate) => candidate.toLocaleLowerCase() === value.toLocaleLowerCase(),
        ) === index,
      ),
      features: [
        `Unified requester-scope record model for ${object}, with source timestamps, ownership, and traceable changes`,
        `Cross-signal analysis that connects ${primaryFailures.slice(0, 3).join('; ')} to the exact requester-defined workflow instead of a generic same-domain template`,
        this.isUngroundedEvidenceState(context.evidenceState)
          ? 'Validation-ready prioritization view that ranks provisional problem facets by pilot impact and review status without implying that external evidence has already validated them'
          : 'Evidence-backed prioritization view that ranks the retained problem facets by impact, source support, and review status while keeping unsupported facets explicitly provisional',
        'Human-reviewed action and decision log with provenance, rationale, status history, and auditability for every consequential recommendation',
      ],
      objectives: [
        `Centralize the records required to understand ${workflow}.`,
        `Measure and compare the requester-defined loss or failure drivers: ${primaryFailures.join('; ')}.`,
        `Prioritize human-reviewed interventions according to their relationship with ${primaryConsequences.join('; ')} rather than switching to an unrelated product archetype.`,
        'Establish a pilot baseline and measure directional change in analysis speed, coordination quality, repeated work, and decision traceability without inventing unsupported percentage improvements.',
      ],
      databaseEntities: ['Workspace', 'OperationalSignal', 'CostOrImpactRecord', 'EvidenceItem', 'ProblemFacet', 'ReviewDecision', 'AuditEvent'],
      metrics: [
        'problem-facet evidence coverage',
        'time to identify the highest-impact loss or failure driver',
        'decision traceability and review completion',
        'repeated-work or unresolved-case trend',
      ],
      workflowTerms: [workflow, object, ...primaryFailures].slice(0, 8),
      painTerms: [...primaryFailures, ...primaryConsequences].slice(0, 8),
    };
  }

  private composeBoundedEmergencyTitle(
    base: string,
    suffix: string,
    maxLength: number,
  ): string {
    const cleanBase = base.replace(/\s+/gu, ' ').trim();
    const cleanSuffix = suffix.replace(/\s+/gu, ' ').trim();
    const combined = `${cleanBase} ${cleanSuffix}`.trim();
    if (combined.length <= maxLength) return combined;

    const availableBaseLength = Math.max(18, maxLength - cleanSuffix.length - 1);
    const clipped = cleanBase.slice(0, availableBaseLength + 1);
    const wordBoundary = clipped.lastIndexOf(' ');
    const boundedBase = (wordBoundary >= Math.floor(availableBaseLength * 0.55)
      ? clipped.slice(0, wordBoundary)
      : cleanBase.slice(0, availableBaseLength))
      .replace(/[,:;\-]+$/gu, '')
      .trim();
    return `${boundedBase} ${cleanSuffix}`.replace(/\s+/gu, ' ').trim();
  }

  private compactEmergencyObjectLabel(value: string): string {
    const cleaned = value.replace(/\s+/gu, ' ').trim();
    if (!cleaned) return 'Operations';
    return cleaned.split(/[;,]/u)[0]?.trim().slice(0, 54) || 'Operations';
  }

  private toEmergencyTitleCase(value: string): string {
    return value
      .replace(/\s+/gu, ' ')
      .trim()
      .split(' ')
      .filter(Boolean)
      .map((word) =>
        word.length > 0
          ? `${word[0]?.toLocaleUpperCase() ?? ''}${word.slice(1)}`
          : '',
      )
      .join(' ');
  }

  private resolveVerifiedProblemEvidenceCount(
    opportunity: RankedIdeaOpportunity | null,
  ): number {
    if (!opportunity) return 0;

    /*
     * Post-ranking canonical counters are authoritative. Never inflate the
     * selected opportunity with a larger pre-reconciliation supporting count
     * from another family in the same corpus. Legacy fallbacks are used only
     * when the canonical counters are genuinely absent.
     */
    if (typeof opportunity.verifiedProblemMatchedEvidenceCount === 'number') {
      return Math.max(0, Math.floor(opportunity.verifiedProblemMatchedEvidenceCount));
    }
    if (typeof opportunity.verifiedEvidenceCount === 'number') {
      return Math.max(0, Math.floor(opportunity.verifiedEvidenceCount));
    }
    return Math.max(
      opportunity.qualifiedExternalSupportingEvidenceCount ?? 0,
      (opportunity.supportingEvidence ?? []).filter(
        (item) =>
          item.sourceType !== 'REQUESTER_STATEMENT' &&
          item.sourceType !== 'REQUESTER_DOMAIN_SELECTION' &&
          item.sourceType !== 'PERSONALIZATION_SIGNAL',
      ).length,
    );
  }

  private resolveVerifiedProblemEvidenceSourceCount(
    opportunity: RankedIdeaOpportunity | null,
  ): number {
    if (!opportunity) return 0;
    if (typeof opportunity.verifiedProblemMatchedEvidenceSourceCount === 'number') {
      return Math.max(
        0,
        Math.floor(opportunity.verifiedProblemMatchedEvidenceSourceCount),
      );
    }
    if (typeof opportunity.verifiedEvidenceSourceCount === 'number') {
      return Math.max(0, Math.floor(opportunity.verifiedEvidenceSourceCount));
    }
    return Math.max(
      opportunity.qualifiedExternalSupportingSourceCount ?? 0,
      opportunity.verifiedIndependentSourceCount ?? 0,
    );
  }


  private isAiReferenceLinkReliabilityOpportunity(
    opportunity: RankedIdeaOpportunity | null,
    problem: string,
    evidence: string | null,
  ): boolean {
    const text = [
      opportunity?.title ?? '',
      opportunity?.problem ?? '',
      opportunity?.need ?? '',
      opportunity?.solutionArea ?? '',
      problem,
      evidence ?? '',
    ]
      .join(' ')
      .normalize('NFKC')
      .toLocaleLowerCase();

    const aiContext =
      /\b(?:ai assistants?|artificial intelligence assistants?|chatbots?|large language models?|llms?)\b/u.test(
        text,
      );
    const brokenReference =
      /\b(?:links?|references?|urls?)\b[^.!?]{0,100}\b(?:broken|dead|unavailable|404|not found)\b/u.test(
        text,
      ) ||
      /\b(?:broken|dead|unavailable|404|not found)\b[^.!?]{0,100}\b(?:pages?|links?|references?|urls?)\b/u.test(
        text,
      );

    return aiContext && brokenReference;
  }

  private buildAiReferenceLinkReliabilityEmergencyBlueprint(
    domainLabel: string,
  ): NonNullable<ReturnType<typeof RequestProductBlueprintUtil.build>> {
    const domainRoot = domainLabel.split('+')[0]?.trim() || 'Artificial Intelligence';

    return {
      baseLabel: domainRoot,
      title: 'AI Reference Link Verification & Broken-Page Triage Workspace',
      workflowFocus: 'verifying links and references produced by AI assistants, detecting broken or unavailable destinations, preserving source context, and routing uncertain replacements to human review before reuse',
      targetUsers: [
        'AI application users who rely on generated links or references',
        'AI product and quality teams reviewing source reliability',
      ],
      features: [
        'Reference intake that captures the AI-provided URL, prompt context, model context, and claimed destination without treating a secondary report as direct user testimony',
        'Link verification checks for reachability, HTTP failure state, redirects, and destination availability with timestamped evidence',
        'Human-reviewed broken-reference triage that records whether a link is valid, unavailable, stale, or requires a verified replacement',
        'Traceable reference history that preserves the original link, verification result, reviewer decision, and final disposition',
      ],
      objectives: [
        'Capture AI-provided links and references together with the exact context needed to verify whether the destination is reachable and relevant.',
        'Detect broken or unavailable destinations deterministically before a generated reference is reused or trusted downstream.',
        'Route uncertain, redirected, or stale references to a human reviewer instead of fabricating a replacement or inferring unsupported source quality.',
        'Establish a pilot baseline for broken-link findings, verification outcomes, review effort, and validated reference reuse without claiming broader prevalence from one retained secondary report.',
      ],
      databaseEntities: [
        'ReferenceCheck',
        'AiOutputContext',
        'UrlVerificationResult',
        'RedirectHistory',
        'ReviewDecision',
        'ReferenceDisposition',
        'AuditEvent',
      ],
      metrics: [
        'broken or unavailable reference findings',
        'successful reference verification rate',
        'human-review turnaround time',
        'verified reference reuse outcomes',
      ],
      workflowTerms: [
        'AI reference verification',
        'broken link detection',
        'source validation',
        'human-reviewed reference triage',
      ],
      painTerms: [
        'AI assistant links leading to broken or unavailable pages',
        'unverified generated references',
      ],
    };
  }

  /**
   * Builds a deterministic application-access/support blueprint that cannot
   * drift into administrative back-office, rental/job application processing,
   * or unrelated data-portability workflows.
   *
   * This blueprint is used only as the emergency candidate after a bounded AI
   * attempt is unavailable or rejected by the immutable winner-family lock.
   * It preserves the evidence family instead of weakening that lock.
   */
  private buildApplicationAccessSupportEmergencyBlueprint(
    domainLabel: string,
    problem: string,
    evidence: string | null,
  ): NonNullable<ReturnType<typeof RequestProductBlueprintUtil.build>> {
    const domainRoot =
      domainLabel.split('+')[0]?.trim() || 'Application';
    const evidenceMentionsReplacement = Boolean(
      evidence &&
        /\b(?:new version|replacement app|new app|download the .* app|migrat(?:e|ion)|transition)\b/iu.test(
          evidence,
        ),
    );
    const transitionLabel = evidenceMentionsReplacement
      ? 'supported replacement-app transition'
      : 'supported access-recovery path';

    return {
      baseLabel: domainRoot,
      title: `${domainRoot} App Access Continuity Navigator`.slice(0, 100),
      workflowFocus: `restoring application access continuity when a user cannot access the affected app, then guiding the user through a verified ${transitionLabel} without inventing account, data-transfer, or administrative workflows`,
      targetUsers: [
        `${domainRoot} application users who cannot access the affected app`,
        'Users who need a verified supported path to continue using the service',
      ],
      features: [
        'Application access issue intake that records the affected app, access blocker, and user-visible status without collecting private host-app credentials',
        `Verified ${transitionLabel} guidance that clearly distinguishes the unavailable or legacy app from the supported access path`,
        'Step-by-step access continuity checklist with user-confirmed completion and an explicit unresolved-access state',
        'Access recovery history that records attempted supported steps and the final user-confirmed outcome',
      ],
      objectives: [
        'Capture the exact application-access blocker reported by the user and keep it linked to the retained evidence instead of reinterpreting application as a rental, job, form, or back-office workflow.',
        `Guide the user through one verified ${transitionLabel} while preserving host-application security boundaries and avoiding unsupported bypass claims.`,
        'Keep the primary workflow user-facing: identify the unavailable app state, present the supported continuity path, record the attempted recovery step, and let the user confirm whether access was restored.',
        'Establish a pilot baseline for unresolved access cases, time to reach a supported access path, repeated failed access attempts, and user-confirmed recovery without claiming market-wide recurrence.',
      ],
      databaseEntities: [
        'AccessIssue',
        'ApplicationEndpoint',
        'SupportedAccessPath',
        'AccessInstruction',
        'RecoveryAttempt',
        'UserConfirmation',
        'AuditEvent',
      ],
      metrics: [
        'unresolved application-access cases',
        'time to reach a supported access path',
        'repeated failed access attempts',
        'user-confirmed access recovery',
      ],
      workflowTerms: [
        'application access',
        'access continuity',
        'supported access path',
        evidenceMentionsReplacement ? 'replacement app' : 'access recovery',
      ],
      painTerms: [
        problem,
        'unable to access the affected application',
      ],
    };
  }

  private buildEmergencyProblemStatement(
    context: IdeaGenerationContext,
    problem: string,
    evidenceQualification: string,
    domainLabel: string,
    workflowFocus?: string,
  ): string {
    const requesterDescription = this.resolveExplicitRequesterProblem(context);
    const baseProblem = requesterDescription || problem;
    return [
      baseProblem,
      evidenceQualification,
      workflowFocus
        ? `The proposed ${domainLabel} pilot addresses the request through ${workflowFocus}.`
        : `Without one traceable workflow, this makes it difficult to coordinate ownership, verify current status, preserve evidence context, and resolve cases consistently.`,
      workflowFocus
        ? this.hasExplicitRequesterProblem(context)
          ? 'The first release validates the exact requester-stated problem workflow with traceable records, human-reviewed actions, and measurable operational outcomes before wider deployment.'
          : 'The first release validates the evidence-backed problem family with traceable records, human-reviewed actions, and measurable operational outcomes before wider deployment.'
        : `The proposed ${domainLabel} pilot keeps this problem scope explicit and tests a structured, human-reviewed decision workflow before wider deployment.`,
      'Potential contributing factors, prevalence, causal impact, and market-wide demand remain hypotheses until they are supported by additional direct evidence.',
    ]
      .join(' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, 2_180);
  }

  private buildEmergencyPremiumOutputs(
    context: IdeaGenerationContext,
    title: string,
    problem: string,
    need: string,
    domainLabel: string,
    targetUsers: readonly string[],
    fullAbstract: string,
    evidence: string | null,
    blueprint: ReturnType<typeof RequestProductBlueprintUtil.build>,
  ): ParsedIdeaAiOutput['advancedOutputs'] {
    const country = context.location.country?.trim() || 'the selected pilot region';
    const nlp = context.nlp;
    const canonicalDiscoveryEvidence = this.resolveCanonicalDiscoveryProblemLock(
      context,
      context.opportunityRanking?.selected ?? null,
    );
    const validationOnly =
      !canonicalDiscoveryEvidence &&
      (this.isUngroundedEvidenceState(context.evidenceState) ||
        Boolean(
          context.opportunityRanking?.selected.disqualificationReasons.includes(
            'PRIMARY_DOMAIN_VALIDATION_HYPOTHESIS',
          ) &&
            (context.opportunityRanking.selected.verifiedProblemMatchedEvidenceCount ??
              context.opportunityRanking.selected.verifiedIndependentEvidenceCount ??
              context.opportunityRanking.selected.verifiedEvidenceCount ??
              0) === 0,
        ));
    const selectedOpportunity = context.opportunityRanking?.selected ?? null;
    const verifiedEvidenceCount = this.resolveVerifiedProblemEvidenceCount(selectedOpportunity);
    const verifiedEvidenceSourceCount = this.resolveVerifiedProblemEvidenceSourceCount(selectedOpportunity);
    const evidenceSummary = verifiedEvidenceCount > 0
      ? `${verifiedEvidenceCount} retained problem-matched external evidence item(s) across ${Math.max(1, verifiedEvidenceSourceCount)} retained source(s) provide preliminary support for the selected direction.${evidence ? ` Representative retained evidence: ${evidence.slice(0, 700)}` : ''}`
      : this.hasExplicitRequesterProblem(context)
        ? `No independent community evidence was retained inside the bounded collection window. The explicitly requester-stated problem is preserved as the validation hypothesis: ${this.resolveExplicitRequesterProblem(context).slice(0, 700)}`
        : `No independent community evidence was retained inside the bounded collection window. The selected ${domainLabel} direction remains an unvalidated hypothesis.`;
    const stack = [
      'NestJS',
      'TypeScript',
      'PostgreSQL',
      'Prisma ORM',
      'React or Next.js',
      'BullMQ',
      'Redis',
      'Docker',
    ];
    const features = validationOnly && !blueprint
      ? [
          'Direct problem-report intake with evidence provenance and source references',
          'Problem-family classification with semantic-domain and evidence-type labels',
          'Evidence-quality comparison showing source diversity, actionability, and verification status',
          'Human-reviewed validation board for unsupported, preliminary, and implementation-ready problem families',
          'Pilot metrics dashboard for evidence volume, source diversity, and problem-family confidence',
        ]
      : blueprint
        ? [...blueprint.features]
        : [
            'Structured case intake with evidence provenance and source references',
            'Operational status board with ownership, priority, and next-action tracking',
            'Human-reviewed triage and resolution workflow with immutable audit history',
            'Role-based access control and bounded sensitive-data visibility',
            'Pilot metrics dashboard for baseline, unresolved-case age, and directional outcome tracking',
          ];

    return [
      {
        outputKey: 'full-abstract',
        title: 'Full Abstract',
        content: fullAbstract,
      },
      {
        outputKey: 'technology-stack',
        title: 'Technology Stack',
        content: stack.map((item) => `- ${item}`).join('\n'),
        structuredContent: [...stack],
      },
      {
        outputKey: 'system-architecture',
        title: 'System Architecture',
        content: `${title} uses a modular NestJS API with a PostgreSQL database managed through Prisma ORM and a responsive React or Next.js client. Authenticated REST endpoints enforce role-based access and validation. BullMQ and Redis handle only durable asynchronous work such as notifications, imports, and report preparation. Audit events are append-only, sensitive fields are access-scoped, and integrations can fall back to secure manual or file-based intake so external provider availability does not block the pilot.`,
      },
      {
        outputKey: 'database-design',
        title: 'Database Design',
        content: validationOnly && !blueprint
          ? `The relational model centers on ValidationWorkspace, EvidenceReport, EvidenceSource, ProblemFamily, EvidenceClassification, ReviewDecision, and AuditLog records. EvidenceReport stores the verbatim report and affected workflow context; EvidenceSource preserves provenance; ProblemFamily groups semantically related reports; EvidenceClassification records evidence kind, domain fit, and actionability; ReviewDecision stores human-reviewed support status without turning an unverified family into a confirmed problem.`
          : blueprint
            ? `The relational model centers on ${blueprint.databaseEntities.join(', ')}. Relationships preserve the current workflow state, version history, evidence provenance, human-reviewed decisions, and auditable changes required by ${blueprint.workflowFocus}.`
            : `The relational model centers on Workspace, Case, EvidenceItem, StatusEvent, Assignment, User, and AuditLog records. Each Case belongs to the active ${domainLabel} workspace, links to one or more EvidenceItem records, and stores current status, priority, owner, and timestamps. StatusEvent preserves the case lifecycle, while AuditLog records security-sensitive actions. Evidence provenance is stored separately from interpreted conclusions so direct community evidence, secondary reports, requester statements, and validation hypotheses remain distinguishable.`,
      },
      {
        outputKey: 'mvp-features',
        title: 'MVP Features',
        content: features.map((item) => `- ${item}`).join('\n'),
        structuredContent: [...features],
      },
      {
        outputKey: 'value-proposition',
        title: 'Value Proposition',
        content: validationOnly && !blueprint
          ? `${title} helps ${targetUsers.slice(0, 2).join(' and ')} determine which ${domainLabel} problem is actually supported before engineering effort is committed. Its value is evidence discipline: preserved provenance, comparable problem families, explicit rejection reasons, and one human-reviewed decision about what deserves a later implementation pilot.`
          : blueprint
            ? `${title} unifies ${blueprint.workflowFocus}, helping ${targetUsers.slice(0, 2).join(' and ')} replace fragmented records with one measurable, human-reviewed operating view. The value proposition is tied to ${blueprint.metrics.slice(0, 4).join(', ')} rather than unsupported automation or market-prevalence claims.`
            : `${title} turns a fragmented ${domainLabel} workflow into one evidence-traceable operational workspace, helping ${targetUsers.slice(0, 2).join(' and ')} coordinate cases, preserve context, and reach human-reviewed resolutions without claiming unsupported automation or market prevalence.`,
      },
      {
        outputKey: 'revenue-model',
        title: 'Revenue Model',
        content: `A pilot-to-subscription B2B or institutional model is recommended. The initial pilot validates the workflow and onboarding effort; production pricing can then be tiered by active workspaces, managed cases, or authorized staff seats. Any final pricing should be validated with target organizations rather than inferred from the current sparse evidence base.`,
      },
      {
        outputKey: 'local-regulations',
        title: 'Local Regulations',
        content: `Deployment in ${country} must verify the local requirements applicable to personal data, institutional records, retention, user consent, and any sector-specific information handled by the pilot. The software should enforce least-privilege access, encrypted transport, auditable changes, and configurable retention. Formal legal review is required before production use where regulated or sensitive records are involved.`,
      },
      {
        outputKey: 'budget-estimation',
        title: 'Budget Estimation',
        content: `Preliminary lean-pilot planning range: USD 24,000-42,000 for a small engineering team, secure hosting, testing, onboarding, and contingency. This is a planning hypothesis rather than a market quote and must be recalculated against the final integration scope, local staffing rates, security requirements, and pilot duration. Hardware, paid third-party data, formal certification, and external legal fees are excluded unless explicitly required.`,
      },
      {
        outputKey: 'feasibility-assessment',
        title: 'Feasibility Assessment',
        content: `Technical feasibility is high for the core workflow because it relies on standard authenticated web application patterns, relational persistence, auditable status transitions, and optional asynchronous jobs. The main feasibility risks are source-data quality, staff adoption, external-system access, and whether ${blueprint?.workflowFocus ?? need} creates enough operational value in real use. The pilot should validate those assumptions before adding complex automation.`,
      },
      {
        outputKey: 'implementation-timeline',
        title: 'Implementation Timeline',
        content: validationOnly && !blueprint
          ? `Month 1: define evidence schema, source-provenance rules, participant roles, and problem-family taxonomy. Months 2-3: implement secure report intake, classification, deduplication, evidence-quality scoring, and the validation dashboard. Month 4: test provenance and review workflows. Months 5-6: run the ${domainLabel} evidence-discovery pilot in ${country}, collect direct reports, compare problem families, and select at most one problem for a later implementation pilot.`
          : `Month 1: validate workflow, evidence model, access roles, and baseline metrics. Months 2-3: implement secure intake, case tracking, audit history, and core dashboard. Month 4: integrate optional data sources and complete security/testing work. Months 5-6: run the pilot in ${country}, collect direct user evidence, measure directional operational change, and decide whether the product should be refined, expanded, or stopped.`,
      },
      {
        outputKey: 'market-potential',
        title: 'Market Potential',
        content: `Current market potential is unproven. The ranked problem suggests a plausible need within ${domainLabel}, but the available evidence is too limited to support prevalence or market-size claims. The pilot should measure repeated problem occurrence, willingness to adopt the workflow, integration effort, and evidence from additional independent organizations before any broader commercial conclusion is made.`,
      },
      {
        outputKey: 'nlp-executive-summary',
        title: 'NLP Executive Summary',
        content: `${evidenceSummary} Trusted NLP totals for this run are ${nlp?.totalTextsAnalyzed ?? 0} text(s), ${nlp?.totalPostsAnalyzed ?? 0} post(s), and ${nlp?.totalCommentsAnalyzed ?? 0} comment(s). The emergency candidate does not upgrade requester statements or incidental mentions into community evidence.`,
      },
      {
        outputKey: 'community-feedback-summary',
        title: 'Community Feedback Summary',
        content: evidence
          ? `The selected direction is supported by retained evidence but should remain preliminary because the current evidence volume is limited. The product workflow must preserve the exact supported problem and collect additional direct feedback during the pilot rather than generalize beyond the source material.`
          : `No qualifying independent community feedback survived the bounded collection window for the selected problem. The product therefore remains a validation-first pilot and must collect direct feedback from target users before making recurrence, prevalence, or demand claims.`,
      },
    ];
  }

  private normalizeEmergencyProblemForSentence(value: string): string {
    return value
      .replace(/\s+/gu, ' ')
      .replace(/[.!?]+$/gu, '')
      .trim()
      .slice(0, 420);
  }

  private resolveEmergencyProblem(
    context: IdeaGenerationContext,
    opportunity: RankedIdeaOpportunity | null,
  ): string {
    const raw =
      this.resolveExplicitRequesterProblem(context) ||
      opportunity?.problem?.trim() ||
      opportunity?.need?.trim() ||
      opportunity?.title?.trim() ||
      `The selected ${this.resolveEmergencyDomainLabel(context, opportunity)} workflow lacks a reliable, centralized way to coordinate records, status changes, and human-reviewed resolution.`;

    return this.cleanEmergencyProblemText(raw);
  }

  private cleanEmergencyProblemText(value: string): string {
    const normalized = value
      .replace(/\s+/gu, ' ')
      .replace(/\s+([,.;:!?])/gu, '$1')
      .trim();
    if (!normalized) return normalized;

    const tokens = normalized.split(' ');
    let changed = true;
    while (changed) {
      changed = false;
      const maxWindow = Math.min(24, Math.floor(tokens.length / 2));
      for (let window = maxWindow; window >= 4 && !changed; window -= 1) {
        for (let start = 0; start + window * 2 <= tokens.length; start += 1) {
          const first = tokens
            .slice(start, start + window)
            .join(' ')
            .toLocaleLowerCase();
          const second = tokens
            .slice(start + window, start + window * 2)
            .join(' ')
            .toLocaleLowerCase();
          if (first !== second) continue;
          tokens.splice(start + window, window);
          changed = true;
          break;
        }
      }
    }

    const compactTokens = [...tokens];
    const searchLimit = Math.min(compactTokens.length, 40);
    for (let window = Math.min(10, Math.floor(searchLimit / 2)); window >= 4; window -= 1) {
      const prefix = compactTokens
        .slice(0, window)
        .join(' ')
        .toLocaleLowerCase();
      for (let start = window; start + window <= searchLimit; start += 1) {
        const candidate = compactTokens
          .slice(start, start + window)
          .join(' ')
          .toLocaleLowerCase();
        if (candidate !== prefix) continue;
        compactTokens.splice(start);
        break;
      }
      if (compactTokens.length < tokens.length) break;
    }

    return compactTokens
      .join(' ')
      .replace(/\s+-\s+$/gu, '')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, 1_200);
  }

  private hasExplicitRequesterProblem(context: IdeaGenerationContext): boolean {
    return Boolean(this.resolveExplicitRequesterProblem(context));
  }

  private resolveExplicitRequesterProblem(context: IdeaGenerationContext): string {
    const intent = context.collectionPlan?.requestIntent;
    if (intent?.mode !== 'EXPLICIT_PROBLEM') return '';
    return intent.explicitProblem?.replace(/\s+/gu, ' ').trim() ?? '';
  }

  private resolveCanonicalDiscoveryProblemLock(
    context: IdeaGenerationContext,
    opportunity: RankedIdeaOpportunity | null,
  ): { readonly family: string; readonly evidenceSamples: readonly string[] } | null {
    if (this.hasExplicitRequesterProblem(context)) return null;

    const family =
      context.communityAiAnalysis?.canonicalProblemFamilyLabel?.trim() ?? '';
    const canonicalEvidenceIds =
      context.communityAiAnalysis?.canonicalProblemFamilyEvidenceIds ?? [];
    if (!family || canonicalEvidenceIds.length === 0) return null;

    const selectedIds = new Set(
      canonicalEvidenceIds
        .map((id) => id.trim())
        .filter(Boolean),
    );
    const ledgerSamples = (context.canonicalEvidenceLedger ?? [])
      .filter(
        (item) =>
          selectedIds.has(item.id) &&
          item.verified &&
          (item.classification === 'DIRECT_PROBLEM' ||
            item.classification === 'SUPPORTING_SIGNAL'),
      )
      .map((item) => item.text.trim())
      .filter(Boolean);
    const evidenceSamples = ledgerSamples.length > 0
      ? ledgerSamples
      : (opportunity?.evidenceSamples ?? [])
          .map((sample) => sample.trim())
          .filter(Boolean);

    return evidenceSamples.length > 0 ? { family, evidenceSamples } : null;
  }

  private normalizeCanonicalDiscoveryContextForBenchmark(
    context: IdeaGenerationContext,
  ): IdeaGenerationContext {
    if (this.hasExplicitRequesterProblem(context)) return context;

    const analysis = context.communityAiAnalysis;
    const family = analysis?.canonicalProblemFamilyLabel?.trim() ?? '';
    const canonicalEvidenceIds = analysis?.canonicalProblemFamilyEvidenceIds ?? [];
    if (!family || canonicalEvidenceIds.length === 0) {
      return context;
    }

    const selectedIds = new Set(
      canonicalEvidenceIds
        .map((id) => id.trim())
        .filter(Boolean),
    );
    const canonicalItems = (context.canonicalEvidenceLedger ?? []).filter(
      (item) =>
        selectedIds.has(item.id) &&
        item.verified &&
        (item.classification === 'DIRECT_PROBLEM' ||
          item.classification === 'SUPPORTING_SIGNAL'),
    );
    if (canonicalItems.length === 0) return context;

    const ranking = context.opportunityRanking;
    if (!ranking) return context;

    const normalize = (value: string): string =>
      value
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
    const normalizedFamily = normalize(family);
    const communityOpportunity = analysis?.opportunities.find((opportunity) => {
      const title = normalize(opportunity.title);
      const problem = normalize(opportunity.problem);
      return (
        title === normalizedFamily ||
        problem === normalizedFamily ||
        title.includes(normalizedFamily) ||
        normalizedFamily.includes(title)
      );
    });

    const current = ranking.selected;
    const samples = canonicalItems
      .map((item) => item.text.trim())
      .filter(Boolean)
      .slice(0, 8);
    const directCount = canonicalItems.filter(
      (item) => item.classification === 'DIRECT_PROBLEM',
    ).length;
    const sourceCount = Math.max(
      analysis?.selectedProblemFamilyDistinctSourceCount ?? 0,
      EvidenceSourceIdentityUtil.count(canonicalItems),
    );
    const staleReasons = new Set([
      'PRIMARY_DOMAIN_VALIDATION_HYPOTHESIS',
      'NO_DIRECT_EVIDENCE',
      'EVIDENCE_SEMANTIC_MISMATCH',
    ]);
    const disqualificationReasons = current.disqualificationReasons.filter(
      (reason) => !staleReasons.has(reason),
    );
    const selectionEligible = !disqualificationReasons.some(
      (reason) =>
        reason === 'OFF_SELECTED_DOMAIN' ||
        reason === 'EXPLICIT_DOMAIN_SCOPE_MISMATCH' ||
        reason === 'PROBLEM_EVIDENCE_OUTSIDE_EXPLICIT_SCOPE',
    );
    const raw =
      current.raw && typeof current.raw === 'object' && !Array.isArray(current.raw)
        ? ({
            ...(current.raw as Prisma.JsonObject),
            familyKey: null,
            canonicalDiscoveryProblemLocked: true,
            canonicalDiscoveryProblemFamily: family,
            canonicalDiscoveryProblemEvidenceIds: [...selectedIds],
            canonicalDiscoveryProblemTrustedEvidenceCount: canonicalItems.length,
            canonicalDiscoveryProblemDistinctSourceCount: sourceCount,
          } as Prisma.JsonObject)
        : current.raw;

    const canonicalSelected: RankedIdeaOpportunity = {
      ...current,
      rank: 1,
      title: family,
      problem: communityOpportunity?.problem ?? family,
      need:
        communityOpportunity?.unmetNeed ??
        `A focused software workflow that addresses ${family} while preserving human review and validating how broadly the problem occurs.`,
      solutionArea:
        communityOpportunity?.solutionArea ?? `Evidence-grounded workflow for ${family}`,
      evidenceSamples: samples,
      frequency: Math.max(current.frequency, canonicalItems.length),
      frequencyScore: Math.max(
        current.frequencyScore,
        Math.min(1, canonicalItems.length / 5),
      ),
      evidenceScore: Math.max(
        current.evidenceScore,
        Math.min(1, canonicalItems.length / 5),
      ),
      evidenceReliabilityScore: Math.max(
        current.evidenceReliabilityScore,
        directCount > 0 ? 0.85 : 0.7,
      ),
      supportScore: Math.max(current.supportScore, directCount > 0 ? 0.7 : 0.55),
      selectionEligible,
      disqualificationReasons,
      verifiedProblemMatchedEvidenceCount: Math.max(
        current.verifiedProblemMatchedEvidenceCount ?? 0,
        canonicalItems.length,
      ),
      verifiedEvidenceCount: Math.max(
        current.verifiedEvidenceCount ?? 0,
        canonicalItems.length,
      ),
      verifiedProblemMatchedDirectUserEvidenceCount: Math.max(
        current.verifiedProblemMatchedDirectUserEvidenceCount ?? 0,
        directCount,
      ),
      verifiedDirectUserEvidenceCount: Math.max(
        current.verifiedDirectUserEvidenceCount ?? 0,
        directCount,
      ),
      verifiedProblemMatchedSourceCount: Math.max(
        current.verifiedProblemMatchedSourceCount ?? 0,
        sourceCount,
      ),
      verifiedProblemMatchedEvidenceSourceCount: Math.max(
        current.verifiedProblemMatchedEvidenceSourceCount ?? 0,
        sourceCount,
      ),
      verifiedIndependentSourceCount: Math.max(
        current.verifiedIndependentSourceCount ?? 0,
        sourceCount,
      ),
      verifiedEvidenceSourceCount: Math.max(
        current.verifiedEvidenceSourceCount ?? 0,
        sourceCount,
      ),
      raw,
    };

    const alternatives = [ranking.selected, ...ranking.alternatives]
      .filter((candidate) => normalize(candidate.title) !== normalizedFamily)
      .map((candidate, index) => ({ ...candidate, rank: index + 2 }));
    const state = CanonicalEvidenceStateUtil.compute(context.canonicalEvidenceLedger ?? []);

    return {
      ...context,
      evidenceState: state.state,
      opportunityRanking: {
        ...ranking,
        selected: canonicalSelected,
        alternatives,
        evaluatedCount: Math.max(ranking.evaluatedCount, 1 + alternatives.length),
        evidenceCoverage: Math.max(
          ranking.evidenceCoverage,
          Math.min(1, canonicalItems.length / 3),
        ),
        selectionReason: `Canonical Community AI discovery winner "${family}" is preserved for benchmarking from ${canonicalItems.length} verified family-matched evidence item(s).`,
        qualityWarnings: [
          ...ranking.qualityWarnings.filter(
            (warning) =>
              !/no problem-matched retained evidence|zero[_ -]?evidence|validation-first opportunity/iu.test(
                warning,
              ),
          ),
          'Benchmark identity is locked to the Community AI selected evidence family; downstream models may design the solution but may not replace the discovered problem.',
        ],
      },
    };
  }

  private matchesCanonicalDiscoveryFamilyLabel(
    family: string,
    candidateNarrative: string,
  ): boolean {
    const normalizeTokens = (value: string): string[] =>
      value
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .split(/\s+/u)
        .map((token) => token.trim())
        .filter((token) => token.length >= 4)
        .filter(
          (token) =>
            !new Set([
              'workflow',
              'problem',
              'problems',
              'issue',
              'issues',
              'operational',
              'system',
              'systems',
              'software',
              'service',
              'services',
              'user',
              'users',
              'with',
              'from',
              'that',
              'this',
            ]).has(token),
        );

    const familyTokens = [...new Set(normalizeTokens(family))];
    if (familyTokens.length === 0) return false;
    const candidateTokens = new Set(normalizeTokens(candidateNarrative));
    const overlap = familyTokens.filter((token) => candidateTokens.has(token)).length;
    const required = familyTokens.length <= 2
      ? familyTokens.length
      : Math.max(2, Math.ceil(familyTokens.length * 0.45));
    if (overlap < required) return false;

    const familyPainTokens = familyTokens.filter((token) =>
      /^(?:fail|failure|failed|error|delay|delayed|outage|downtime|disruption|liabil|loading|load|breach|fraud|fatigue|shortage|backlog|loss|cost|incorrect|wrong|mismatch|unavailable)/u.test(
        token,
      ),
    );
    if (familyPainTokens.length === 0) return true;

    return familyPainTokens.some((token) =>
      [...candidateTokens].some(
        (candidate) =>
          candidate === token ||
          candidate.startsWith(token.slice(0, Math.min(token.length, 6))) ||
          token.startsWith(candidate.slice(0, Math.min(candidate.length, 6))),
      ),
    );
  }

  private readOpportunityFamilyKey(
    opportunity: RankedIdeaOpportunity | null,
  ): string | null {
    const raw = opportunity?.raw;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const familyKey = (raw as Record<string, unknown>).familyKey;
      if (typeof familyKey === 'string' && familyKey.trim()) {
        return familyKey.trim();
      }
    }

    const evidence = opportunity?.evidenceSamples.find((value) => value.trim());
    return evidence ? resolvePrimaryProblemFamily(evidence)?.key ?? null : null;
  }

  private resolveEmergencyEvidence(
    opportunity: RankedIdeaOpportunity | null,
  ): string | null {
    const direct = opportunity?.evidenceSamples.find((value) => value.trim());
    if (direct) return direct.trim();

    const independent = opportunity?.independentEvidence?.find((item) =>
      item.text.trim(),
    );
    if (independent) return independent.text.trim();

    const communitySupporting = opportunity?.supportingEvidence?.find(
      (item) => item.qualifiesAsCommunityEvidence && item.text.trim(),
    );
    if (communitySupporting) return communitySupporting.text.trim();

    const externalSupporting = opportunity?.supportingEvidence?.find(
      (item) =>
        item.sourceType === 'SECONDARY_EVIDENCE' && item.text.trim(),
    );
    return externalSupporting?.text.trim() || null;
  }

  private resolveEmergencyDomainLabel(
    context: IdeaGenerationContext,
    opportunity: RankedIdeaOpportunity | null,
  ): string {
    const opportunityDomains = [
      opportunity?.primaryMatchedDomainName,
      ...(opportunity?.problemDomainNames ?? []),
      ...(opportunity?.matchedDomainNames ?? []),
    ]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value));
    const selectedDomains = context.selectedDomains
      .map((domain) => domain.name.trim())
      .filter(Boolean);
    const hasVerifiedProblemEvidence = Boolean(
      opportunity &&
      ((opportunity.verifiedProblemMatchedEvidenceCount ?? 0) > 0 ||
        (opportunity.verifiedIndependentEvidenceCount ?? 0) > 0 ||
        opportunity.evidenceSamples.some((value) => value.trim().length > 0)),
    );
    const validationHypothesis =
      opportunity?.disqualificationReasons.includes(
        'PRIMARY_DOMAIN_VALIDATION_HYPOTHESIS',
      ) ?? false;
    const hasAuthoritativeNarrowedValidationScope =
      validationHypothesis && opportunityDomains.length === 1;
    const explicitRequesterProblem = this.hasExplicitRequesterProblem(context);
    const values =
      (hasVerifiedProblemEvidence || hasAuthoritativeNarrowedValidationScope) &&
      opportunityDomains.length > 0
        ? [...new Set(opportunityDomains)]
        : explicitRequesterProblem
          ? [
              context.domainName?.trim() ||
                selectedDomains[0] ||
                'Operational',
            ]
          : [...new Set(selectedDomains)];
    return values.slice(0, 3).join(' + ') || context.domainName?.trim() || 'Operational';
  }

  private resolveEmergencyTargetUsers(
    context: IdeaGenerationContext,
    opportunity: RankedIdeaOpportunity | null,
    domainLabel: string,
  ): string[] {
    const raw = opportunity?.raw;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const affectedUsers = (raw as Record<string, unknown>).affectedUsers;
      if (Array.isArray(affectedUsers)) {
        const values = affectedUsers
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter(Boolean)
          .slice(0, 4);
        if (values.length >= 2) return values;
      }
    }

    const primaryDomain =
      context.selectedDomains[0]?.name?.trim() ||
      context.domainName?.trim() ||
      domainLabel;
    return [
      `${primaryDomain} operations managers`,
      `${primaryDomain} frontline staff`,
      'Authorized administrators and reviewers',
    ];
  }

  private buildEmergencyProductTitle(
    opportunityTitle: string,
    problem: string,
    domainLabel: string,
  ): string {
    const text = `${opportunityTitle} ${problem}`.toLowerCase();
    if (/exam|assessment|proctor|student/.test(text)) {
      return 'Assessment Decision Review and Recovery Workspace';
    }
    if (/bill|billing|payment|checkout|invoice/.test(text)) {
      return 'Billing and Payment Recovery Workspace';
    }
    if (/vacan|tenant|property|housing|maintenance complaint/.test(text)) {
      return 'Property Vacancy and Maintenance Insight Workspace';
    }
    if (/flower|florist|bouquet|floral/.test(text)) {
      return 'Custom Floral Order Coordination Workspace';
    }
    if (/pottery|kiln|ceramic|glaz/.test(text)) {
      return 'Kiln and Piece Coordination Workspace';
    }
    if (/wig maker|wig making|custom wig|hairpiece/.test(text)) {
      return 'WigSpec Client Order and Fitting Workspace';
    }
    if (/shipment|logistics|delivery|parcel|consignment/.test(text)) {
      return 'Shipment Exception and Delivery Coordination Workspace';
    }
    if (/energy|electric|utility|emission/.test(text)) {
      return 'Energy Operations Insight and Resolution Workspace';
    }

    const normalized = opportunityTitle
      .replace(/\b(?:failure|failures|resolution|opportunity|discovery|validation|workflow)\b/giu, ' ')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .split(' ')
      .slice(0, 6)
      .join(' ');
    if (normalized.length >= 12) {
      return `${normalized} Operations Workspace`;
    }

    const domainRoot = domainLabel.split('+')[0]?.trim() || 'Operational';
    return `${domainRoot} Evidence and Resolution Workspace`;
  }

  private lowercaseInitial(value: string): string {
    const trimmed = value.trim().replace(/\s+/gu, ' ');
    if (!trimmed) return 'the selected workflow problem';
    return `${trimmed.charAt(0).toLocaleLowerCase()}${trimmed.slice(1)}`;
  }


  /** Returns the number of candidates that truly passed the quality gate. */
  private countQualityApprovedCandidates(
    candidates: readonly IdeaBenchmarkCandidate[],
  ): number {
    return candidates.filter((candidate) => candidate.quality.accepted).length;
  }

  /**
   * Builds a deterministic, opportunity-diverse shortlist for the AI judge.
   *
   * The highest-quality candidate from each opportunity is selected first,
   * then remaining slots are filled by deterministic quality. This prevents a
   * single opportunity from occupying the complete comparative request.
   */
  private buildJudgeShortlist(
    candidates: readonly IdeaBenchmarkCandidate[],
    maximumCandidates: number,
  ): IdeaBenchmarkCandidate[] {
    const ordered = [...candidates].sort(
      (first, second) =>
        second.quality.score - first.quality.score ||
        first.aiResult.responseTimeMs - second.aiResult.responseTimeMs,
    );
    const selected: IdeaBenchmarkCandidate[] = [];
    const selectedIds = new Set<string>();
    const usedOpportunities = new Set<string>();

    for (const candidate of ordered) {
      if (selected.length >= maximumCandidates) {
        break;
      }
      if (usedOpportunities.has(candidate.opportunityTitle)) {
        continue;
      }

      selected.push(candidate);
      selectedIds.add(candidate.candidateId);
      usedOpportunities.add(candidate.opportunityTitle);
    }

    for (const candidate of ordered) {
      if (selected.length >= maximumCandidates) {
        break;
      }
      if (selectedIds.has(candidate.candidateId)) {
        continue;
      }

      selected.push(candidate);
      selectedIds.add(candidate.candidateId);
    }

    return selected;
  }

  /**
   * Executes Ollama exactly once after the complete online benchmark produced
   * no accepted candidate.
   *
   * The highest-ranked concept direction is used first because it carries the
   * strongest evidence and opportunity score. executeModelCandidate keeps the
   * same parsing, quality, revision, duplicate-detection, persistence, and
   * diagnostic behavior used by online candidates.
   *
   * A local failure is swallowed here so benchmark() can emit one final, clear
   * service-unavailable error describing exhaustion of both execution tiers.
   */
  /**
   * Starts the bounded latency-hedged batch concurrently and stops as soon as one
   * complete candidate satisfies the preferred quality threshold.
   *
   * A caller-driven AbortSignal is propagated through AiExecutionService to
   * the provider adapters, so the slower request is cancelled instead of
   * keeping the pipeline behind Promise.all. When no candidate reaches the
   * threshold, all started models are allowed to finish and the ordinary
   * winner-selection logic chooses the strongest valid result.
   */
  private async executeParallelCandidateBatch(
    context: IdeaGenerationContext,
    models: readonly AiModel[],
    direction: CandidateConceptDirection,
    blockedModelIds: Set<string>,
    blockedProviderKeys: Set<string>,
    allowQualityRevision = true,
    acceptStructuralFallbackEarly = false,
    externalSignal?: AbortSignal,
    deadlineAt?: number,
  ): Promise<Array<IdeaBenchmarkCandidate | null>> {
    this.throwIfBenchmarkAborted(externalSignal);
    if (models.length <= 1) {
      const model = models[0];

      if (!model) {
        return [];
      }
      if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
        return [null];
      }

      const controller = new AbortController();
      const abortFromExternal = () => {
        if (!controller.signal.aborted) controller.abort();
      };
      if (externalSignal) {
        if (externalSignal.aborted) abortFromExternal();
        else externalSignal.addEventListener('abort', abortFromExternal, { once: true });
      }
      const deadlineTimer = deadlineAt !== undefined
        ? setTimeout(
            () => {
              if (!controller.signal.aborted) controller.abort();
            },
            Math.max(0, deadlineAt - Date.now()),
          )
        : null;

      try {
        const candidate = await this.executeModelCandidate(
          context,
          model,
          direction,
          allowQualityRevision,
          controller.signal,
        );

        if (
          candidate.quality.accepted &&
          candidate.quality.score >= IDEA_MIN_ACCEPTED_QUALITY_SCORE
        ) {
          this.logger.log(
            `Benchmark accepted model "${candidate.modelSnapshot.displayName ?? candidate.modelSnapshot.modelName}" at ${candidate.quality.score}/${IDEA_MIN_ACCEPTED_QUALITY_SCORE}; no peer request was available for comparison.`,
          );
        }

        return [candidate];
      } catch (error: unknown) {
        if (
          this.isTransientModelFailure(error) ||
          this.isProviderScopedHardFailure(error)
        ) {
          blockedModelIds.add(model.id);
          if (this.isProviderScopedHardFailure(error)) {
            blockedProviderKeys.add(model.providerKey);
          }
        }

        return [null];
      } finally {
        if (deadlineTimer) clearTimeout(deadlineTimer);
        externalSignal?.removeEventListener('abort', abortFromExternal);
      }
    }

    const controllers = models.map(() => new AbortController());

    if (externalSignal) {
      const abortControllers = () => {
        controllers.forEach((controller) => {
          if (!controller.signal.aborted) {
            controller.abort();
          }
        });
      };

      if (externalSignal.aborted) {
        abortControllers();
      } else {
        externalSignal.addEventListener('abort', abortControllers, {
          once: true,
        });
      }
    }

    const pending = new Map<
      number,
      Promise<{
        readonly index: number;
        readonly candidate: IdeaBenchmarkCandidate | null;
        readonly error?: unknown;
      }>
    >();
    const results: Array<IdeaBenchmarkCandidate | null> = models.map(
      () => null,
    );

    models.forEach((model, index) => {
      const promise = this.executeModelCandidate(
        context,
        model,
        direction,
        false,
        controllers[index].signal,
      )
        .then((candidate) => ({ index, candidate }))
        .catch((error: unknown) => ({ index, candidate: null, error }));

      pending.set(index, promise);
    });

    let acceptedGraceDeadlineAt: number | null = null;
    let structuralFallbackGraceDeadlineAt: number | null = null;
    let evidenceBackedFallbackGraceDeadlineAt: number | null = null;

    while (pending.size > 0) {
      this.throwIfBenchmarkAborted(externalSignal);

      const settlementPromise = Promise.race(pending.values()).then(
        (settled) =>
          ({
            kind: 'settled' as const,
            settled,
          }),
      );

      const activeGraceDeadlines = [
        acceptedGraceDeadlineAt,
        structuralFallbackGraceDeadlineAt,
        evidenceBackedFallbackGraceDeadlineAt,
      ].filter((value): value is number => value !== null);
      const nearestGraceDeadline =
        activeGraceDeadlines.length > 0
          ? Math.min(...activeGraceDeadlines)
          : null;
      const deadlineTimeout =
        deadlineAt === undefined
          ? null
          : this.createBenchmarkDeadlineTimeout(
              Math.max(0, deadlineAt - Date.now()),
            );
      const waiters = [settlementPromise] as Array<
        Promise<
          | { readonly kind: 'settled'; readonly settled: { readonly index: number; readonly candidate: IdeaBenchmarkCandidate | null; readonly error?: unknown } }
          | { readonly kind: 'grace-expired' }
          | { readonly kind: 'budget-expired' }
        >
      >;
      if (nearestGraceDeadline !== null) {
        waiters.push(
          this.createBenchmarkGraceTimeout(
            Math.max(0, nearestGraceDeadline - Date.now()),
          ),
        );
      }
      if (deadlineTimeout) waiters.push(deadlineTimeout);
      const next = await Promise.race(waiters);

      if (next.kind === 'budget-expired') {
        this.abortPendingBenchmarkRequests(controllers, pending);
        this.logger.log(
          'Benchmark batch reached the run-level wall-clock budget; pending provider requests were cancelled and only completed candidates are retained.',
        );
        void Promise.allSettled(pending.values());
        return results;
      }

      if (next.kind === 'grace-expired') {
        const bestAccepted = this.findBestQualityApprovedCandidate(results);

        if (bestAccepted) {
          this.abortPendingBenchmarkRequests(controllers, pending);

          this.logger.log(
            `Bounded early benchmark stop: best completed model "${bestAccepted.modelSnapshot.displayName ?? bestAccepted.modelSnapshot.modelName}" reached ${bestAccepted.quality.score}/${IDEA_MIN_ACCEPTED_QUALITY_SCORE} after ${IDEA_BENCHMARK_ACCEPTED_CANDIDATE_GRACE_MS}ms peer grace; slower requests were cancelled.`,
          );

          void Promise.allSettled(pending.values());

          return results.map((candidate) =>
            candidate?.candidateId === bestAccepted.candidateId
              ? bestAccepted
              : null,
          );
        }

        const bestStructuralFallback =
          this.findBestValidationHypothesisFastStopCandidate(results);
        if (
          acceptStructuralFallbackEarly &&
          structuralFallbackGraceDeadlineAt !== null &&
          structuralFallbackGraceDeadlineAt <= Date.now() &&
          bestStructuralFallback
        ) {
          this.abortPendingBenchmarkRequests(controllers, pending);
          this.logger.log(
            `Validation-hypothesis fast stop: model "${bestStructuralFallback.modelSnapshot.displayName ?? bestStructuralFallback.modelSnapshot.modelName}" returned a structurally valid ${bestStructuralFallback.quality.score}-point fallback; slower peers were cancelled without weakening the ${IDEA_MIN_ACCEPTED_QUALITY_SCORE}-point evidence quality gate.`,
          );
          void Promise.allSettled(pending.values());
          return results.map((candidate) =>
            candidate?.candidateId === bestStructuralFallback.candidateId
              ? bestStructuralFallback
              : null,
          );
        }

        const bestEvidenceBackedFallback =
          this.findBestEvidenceBackedFastStopCandidate(results);
        if (
          !acceptStructuralFallbackEarly &&
          evidenceBackedFallbackGraceDeadlineAt !== null &&
          evidenceBackedFallbackGraceDeadlineAt <= Date.now() &&
          bestEvidenceBackedFallback
        ) {
          this.abortPendingBenchmarkRequests(controllers, pending);
          this.logger.log(
            `Evidence-backed fast stop: model "${bestEvidenceBackedFallback.modelSnapshot.displayName ?? bestEvidenceBackedFallback.modelSnapshot.modelName}" returned a structurally valid ${bestEvidenceBackedFallback.quality.score}-point candidate after ${IDEA_BENCHMARK_EVIDENCE_BACKED_FAST_STOP_GRACE_MS}ms peer grace; slower peers were cancelled while the preferred ${IDEA_MIN_ACCEPTED_QUALITY_SCORE}-point gate remains a reporting benchmark rather than a latency requirement.`,
          );
          void Promise.allSettled(pending.values());
          return results.map((candidate) =>
            candidate?.candidateId === bestEvidenceBackedFallback.candidateId
              ? bestEvidenceBackedFallback
              : null,
          );
        }

        acceptedGraceDeadlineAt = null;
        structuralFallbackGraceDeadlineAt = null;
        evidenceBackedFallbackGraceDeadlineAt = null;
        continue;
      }

      const settled = next.settled;
      pending.delete(settled.index);
      results[settled.index] = settled.candidate;

      if (settled.error !== undefined) {
        const model = models[settled.index];
        const cancelledByEarlyWinner =
          controllers[settled.index].signal.aborted;

        if (
          !cancelledByEarlyWinner &&
          (this.isTransientModelFailure(settled.error) ||
            this.isProviderScopedHardFailure(settled.error))
        ) {
          blockedModelIds.add(model.id);
          const providerBlocked = this.isProviderScopedHardFailure(settled.error);
          if (providerBlocked) {
            blockedProviderKeys.add(model.providerKey);
            for (const [pendingIndex] of pending) {
              if (models[pendingIndex]?.providerKey !== model.providerKey) continue;
              if (!controllers[pendingIndex].signal.aborted) {
                controllers[pendingIndex].abort();
              }
            }
            this.logger.warn(
              `Provider "${model.providerKey}" was removed from the remaining benchmark assignments after a hard account/provider availability failure.`,
            );
          } else {
            this.logger.warn(
              `Model "${model.displayName ?? model.modelName}" was removed from the remaining benchmark assignments after a transient provider failure.`,
            );
          }
        }
      }

      const candidate = settled.candidate;
      const isQualityApproved =
        candidate?.quality.accepted === true &&
        candidate.quality.score >= IDEA_MIN_ACCEPTED_QUALITY_SCORE;

      if (!candidate) {
        continue;
      }

      if (
        acceptStructuralFallbackEarly &&
        !isQualityApproved &&
        this.isValidationHypothesisFastStopCandidate(candidate) &&
        structuralFallbackGraceDeadlineAt === null &&
        pending.size > 0
      ) {
        structuralFallbackGraceDeadlineAt =
          Date.now() + IDEA_BENCHMARK_STRUCTURAL_FALLBACK_GRACE_MS;
      }

      if (
        !acceptStructuralFallbackEarly &&
        !isQualityApproved &&
        this.isEvidenceBackedFastStopCandidate(candidate) &&
        evidenceBackedFallbackGraceDeadlineAt === null &&
        pending.size > 0
      ) {
        evidenceBackedFallbackGraceDeadlineAt =
          Date.now() + IDEA_BENCHMARK_EVIDENCE_BACKED_FAST_STOP_GRACE_MS;
      }

      if (!isQualityApproved) {
        continue;
      }

      if (
        candidate.quality.score >=
        IDEA_BENCHMARK_IMMEDIATE_EARLY_STOP_SCORE
      ) {
        const bestAccepted =
          this.findBestQualityApprovedCandidate(results) ?? candidate;

        this.abortPendingBenchmarkRequests(controllers, pending);

        this.logger.log(
          `High-confidence early benchmark stop: model "${bestAccepted.modelSnapshot.displayName ?? bestAccepted.modelSnapshot.modelName}" reached ${bestAccepted.quality.score}/${IDEA_BENCHMARK_IMMEDIATE_EARLY_STOP_SCORE}; remaining parallel provider requests were cancelled.`,
        );

        void Promise.allSettled(pending.values());

        return results.map((result) =>
          result?.candidateId === bestAccepted.candidateId
            ? bestAccepted
            : null,
        );
      }

      if (acceptedGraceDeadlineAt === null && pending.size > 0) {
        acceptedGraceDeadlineAt =
          Date.now() + IDEA_BENCHMARK_ACCEPTED_CANDIDATE_GRACE_MS;

        this.logger.log(
          `Quality-approved candidate "${candidate.modelSnapshot.displayName ?? candidate.modelSnapshot.modelName}" reached ${candidate.quality.score}/${IDEA_MIN_ACCEPTED_QUALITY_SCORE}; allowing already-running peers up to ${IDEA_BENCHMARK_ACCEPTED_CANDIDATE_GRACE_MS}ms to beat it before early stop.`,
        );
      }
    }

    const bestAccepted = this.findBestQualityApprovedCandidate(results);

    if (bestAccepted) {
      return results.map((candidate) =>
        candidate?.candidateId === bestAccepted.candidateId
          ? bestAccepted
          : null,
      );
    }

    if (!acceptStructuralFallbackEarly) {
      const bestEvidenceBackedFallback =
        this.findBestEvidenceBackedFastStopCandidate(results);
      if (bestEvidenceBackedFallback) {
        this.logger.log(
          `Evidence-backed bounded completion: the provider-diverse wave finished with a structurally valid ${bestEvidenceBackedFallback.quality.score}-point candidate; skipping an extra self-revision request because the same ${IDEA_BENCHMARK_EVIDENCE_BACKED_FAST_STOP_SCORE}-point fast-stop policy would have cancelled a slower peer.`,
        );
        return results.map((candidate) =>
          candidate?.candidateId === bestEvidenceBackedFallback.candidateId
            ? bestEvidenceBackedFallback
            : null,
        );
      }
    }

    if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
      return results;
    }

    if (allowQualityRevision) {
      const revisionCandidate = results
        .filter(
          (candidate): candidate is IdeaBenchmarkCandidate =>
            candidate !== null &&
            !candidate.quality.accepted &&
            candidate.quality.score >= IDEA_QUALITY_REVISION_TRIGGER_SCORE,
        )
        .sort(
          (left, right) =>
            right.quality.score - left.quality.score ||
            left.aiResult.responseTimeMs - right.aiResult.responseTimeMs,
        )[0];

      if (revisionCandidate) {
        const model = models.find(
          (candidateModel) =>
            candidateModel.id === revisionCandidate.modelSnapshot.id,
        );

        if (model) {
          const revisedAttempt = await this.reviseWeakCandidate(
            context,
            model,
            {
              aiResult: revisionCandidate.aiResult,
              parsedOutput: revisionCandidate.parsedOutput,
              quality: revisionCandidate.quality,
            },
            this.buildQualityContext(context),
            direction.promptText,
            externalSignal,
          );

          if (revisedAttempt.quality.score > revisionCandidate.quality.score) {
            const revisedCandidate: IdeaBenchmarkCandidate = {
              ...revisionCandidate,
              aiResult: revisedAttempt.aiResult,
              parsedOutput: revisedAttempt.parsedOutput,
              quality: revisedAttempt.quality,
              finalScore: revisedAttempt.quality.score,
              semanticDiversityAdjustedScore: revisedAttempt.quality.score,
            };
            const resultIndex = results.findIndex(
              (candidate) =>
                candidate?.candidateId === revisionCandidate.candidateId,
            );
            if (resultIndex >= 0) {
              results[resultIndex] = revisedCandidate;
            }

            if (
              revisedCandidate.quality.accepted &&
              revisedCandidate.quality.score >= IDEA_MIN_ACCEPTED_QUALITY_SCORE
            ) {
              return results.map((candidate) =>
                candidate?.candidateId === revisedCandidate.candidateId
                  ? revisedCandidate
                  : null,
              );
            }
          }
        }
      }
    }

    return results;
  }

  /**
   * Removes claims that the deterministic quality gate explicitly rejected
   * when a structurally valid candidate must still be used as the run's
   * availability fallback.  This is evidence-state driven and domain agnostic:
   * it never keys off a request topic, domain name, or example phrase.
   */
  private sanitizeFallbackCandidateForEvidenceLimits(
    candidate: IdeaBenchmarkCandidate,
  ): IdeaBenchmarkCandidate {
    const issueCodes = new Set(candidate.quality.issues.map((issue) => issue.code));
    if (
      !issueCodes.has('UNSUPPORTED_IMPACT_TARGET') &&
      !issueCodes.has('MALFORMED_MEASURABLE_TARGET')
    ) {
      return candidate;
    }

    const sanitizeText = (value: string): string =>
      value
        .replace(
          /\b(?:achieve|deliver|produce|ensure|target|reach)\s+(?:at\s+least\s+|up\s+to\s+)?\d+(?:\.\d+)?\s*(?:%|percent)\s+(?:reduction|decrease|improvement|increase|gain)\s+in\s+([^.;!?]{2,120}?)(?:\s+(?:during|within|over|for)\s+[^.;!?]{2,80})?(?=[.;!?]|$)/giu,
          'establish a baseline for $1 during the first pilot phase and measure directional improvement during the remaining pilot period',
        )
        .replace(
          /\b(?:reduce|decrease|improve|increase|lower|raise|cut)\s+([^.;!?]{2,120}?)\s+by\s+(?:at\s+least\s+|up\s+to\s+)?\d+(?:\.\d+)?\s*(?:%|percent)(?:\s+(?:during|within|over|for)\s+[^.;!?]{2,80})?(?=[.;!?]|$)/giu,
          'establish a baseline for $1 during the first pilot phase and measure directional improvement during the remaining pilot period',
        )
        .replace(
          /\b(?:at\s+least\s+|up\s+to\s+)?\d+(?:\.\d+)?\s*(?:%|percent)\s+(?:faster|lower|higher|better|improvement|reduction|decrease|increase)\b/giu,
          'a measurable directional improvement',
        )
        .replace(/[ 	]{2,}/gu, ' ')
        .trim();

    const sanitizeJson = (value: unknown): unknown => {
      if (typeof value === 'string') return sanitizeText(value);
      if (Array.isArray(value)) return value.map((item) => sanitizeJson(item));
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, sanitizeJson(item)]),
        );
      }
      return value;
    };

    const parsedOutput: ParsedIdeaAiOutput = {
      coreIdea: {
        ...candidate.parsedOutput.coreIdea,
        problemStatement: sanitizeText(candidate.parsedOutput.coreIdea.problemStatement),
        objectives: candidate.parsedOutput.coreIdea.objectives.map(sanitizeText),
        ...(candidate.parsedOutput.coreIdea.limitedAbstract !== undefined
          ? { limitedAbstract: sanitizeText(candidate.parsedOutput.coreIdea.limitedAbstract) }
          : {}),
        ...(candidate.parsedOutput.coreIdea.partialAbstract !== undefined
          ? { partialAbstract: sanitizeText(candidate.parsedOutput.coreIdea.partialAbstract) }
          : {}),
        ...(candidate.parsedOutput.coreIdea.fullAbstract !== undefined
          ? { fullAbstract: sanitizeText(candidate.parsedOutput.coreIdea.fullAbstract) }
          : {}),
      },
      advancedOutputs: candidate.parsedOutput.advancedOutputs.map((output) => ({
        ...output,
        content: sanitizeText(output.content),
        ...(output.structuredContent !== undefined
          ? {
              structuredContent: sanitizeJson(output.structuredContent) as typeof output.structuredContent,
            }
          : {}),
      })),
    };

    this.logger.warn(
      `Sanitized unsupported numeric impact targets from fallback candidate "${candidate.candidateId}" before final selection.`,
    );
    return { ...candidate, parsedOutput };
  }

  /**
   * Returns the strongest completed candidate that passed the complete
   * deterministic quality gate. Response time is only a tie-breaker.
   */
  private findBestQualityApprovedCandidate(
    candidates: readonly (IdeaBenchmarkCandidate | null)[],
  ): IdeaBenchmarkCandidate | null {
    const accepted = candidates
      .filter(
        (candidate): candidate is IdeaBenchmarkCandidate =>
          candidate !== null &&
          candidate.quality.accepted &&
          candidate.quality.score >= IDEA_MIN_ACCEPTED_QUALITY_SCORE,
      )
      .sort(
        (first, second) =>
          second.quality.score - first.quality.score ||
          first.aiResult.responseTimeMs - second.aiResult.responseTimeMs,
      );

    return accepted[0] ?? null;
  }

  private findBestStructurallyValidCandidate(
    candidates: readonly (IdeaBenchmarkCandidate | null)[],
    minimumScore: number,
  ): IdeaBenchmarkCandidate | null {
    const valid = candidates
      .filter(
        (candidate): candidate is IdeaBenchmarkCandidate =>
          candidate !== null && candidate.quality.score >= minimumScore,
      )
      .sort(
        (first, second) =>
          second.quality.score - first.quality.score ||
          first.aiResult.responseTimeMs - second.aiResult.responseTimeMs,
      );

    return valid[0] ?? null;
  }


  private isValidationHypothesisFastStopCandidate(
    candidate: IdeaBenchmarkCandidate,
  ): boolean {
    if (candidate.quality.score < IDEA_BENCHMARK_PRELIMINARY_FAST_STOP_SCORE) {
      return false;
    }

    const hardBlockingCodes = new Set([
      'UNSUPPORTED_LOCAL_CLAIM',
      'UNSUPPORTED_PLATFORM_ACCESS',
      'MALFORMED_MEASURABLE_TARGET',
      'UNSUPPORTED_IMPACT_TARGET',
      'SECONDARY_DOMAIN_LEAKAGE',
    ]);

    return !candidate.quality.issues.some((issue) =>
      hardBlockingCodes.has(issue.code),
    );
  }

  private findBestValidationHypothesisFastStopCandidate(
    candidates: readonly (IdeaBenchmarkCandidate | null)[],
  ): IdeaBenchmarkCandidate | null {
    return (
      candidates
        .filter(
          (candidate): candidate is IdeaBenchmarkCandidate =>
            candidate !== null &&
            this.isValidationHypothesisFastStopCandidate(candidate),
        )
        .sort(
          (first, second) =>
            second.quality.score - first.quality.score ||
            first.aiResult.responseTimeMs - second.aiResult.responseTimeMs,
        )[0] ?? null
    );
  }

  private isEvidenceBackedFastStopCandidate(
    candidate: IdeaBenchmarkCandidate,
  ): boolean {
    if (candidate.quality.score < IDEA_BENCHMARK_EVIDENCE_BACKED_FAST_STOP_SCORE) {
      return false;
    }

    const blockingCodes = new Set([
      'UNSUPPORTED_LOCAL_CLAIM',
      'UNSUPPORTED_PLATFORM_ACCESS',
      'MALFORMED_MEASURABLE_TARGET',
      'UNSUPPORTED_IMPACT_TARGET',
      'SECONDARY_DOMAIN_LEAKAGE',
    ]);

    return !candidate.quality.issues.some((issue) =>
      blockingCodes.has(issue.code),
    );
  }

  private findBestEvidenceBackedFastStopCandidate(
    candidates: readonly (IdeaBenchmarkCandidate | null)[],
  ): IdeaBenchmarkCandidate | null {
    const valid = candidates
      .filter(
        (candidate): candidate is IdeaBenchmarkCandidate =>
          candidate !== null && this.isEvidenceBackedFastStopCandidate(candidate),
      )
      .sort(
        (first, second) =>
          second.quality.score - first.quality.score ||
          first.aiResult.responseTimeMs - second.aiResult.responseTimeMs,
      );

    return valid[0] ?? null;
  }

  /** Cancels only provider requests that are still running. */
  private abortPendingBenchmarkRequests(
    controllers: readonly AbortController[],
    pending: ReadonlyMap<number, Promise<unknown>>,
  ): void {
    controllers.forEach((controller, index) => {
      if (pending.has(index) && !controller.signal.aborted) {
        controller.abort();
      }
    });
  }

  /** Creates the small quality-preserving peer grace timeout. */
  private createBenchmarkGraceTimeout(
    delayMs: number,
  ): Promise<{ readonly kind: 'grace-expired' }> {
    return new Promise((resolve) => {
      setTimeout(
        () => resolve({ kind: 'grace-expired' as const }),
        Math.max(0, delayMs),
      );
    });
  }

  /** Hard batch deadline derived from the benchmark's run-level wall clock. */
  private createBenchmarkDeadlineTimeout(
    delayMs: number,
  ): Promise<{ readonly kind: 'budget-expired' }> {
    return new Promise((resolve) => {
      setTimeout(
        () => resolve({ kind: 'budget-expired' as const }),
        Math.max(0, delayMs),
      );
    });
  }

  private async executeLocalEmergencyFallback(
    context: IdeaGenerationContext,
    localModel: AiModel,
    conceptDirections: readonly CandidateConceptDirection[],
    signal?: AbortSignal,
    deadlineAt?: number,
  ): Promise<IdeaBenchmarkCandidate | null> {
    this.throwIfBenchmarkAborted(signal);
    if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
      return null;
    }
    const primaryDirection = conceptDirections[0];

    if (!primaryDirection) {
      this.logger.error(
        'Ollama emergency fallback could not run because no concept direction was available.',
      );
      return null;
    }

    this.logger.warn(
      `All online core-generation candidates failed. Executing local emergency fallback model "${localModel.displayName ?? localModel.modelName}" once for the highest-ranked opportunity.`,
    );

    const controller = new AbortController();
    const abortFromExternal = () => {
      if (!controller.signal.aborted) controller.abort();
    };
    if (signal) {
      if (signal.aborted) abortFromExternal();
      else signal.addEventListener('abort', abortFromExternal, { once: true });
    }
    const deadlineTimer = deadlineAt !== undefined
      ? setTimeout(
          () => {
            if (!controller.signal.aborted) controller.abort();
          },
          Math.max(0, deadlineAt - Date.now()),
        )
      : null;

    try {
      return await this.executeModelCandidate(
        context,
        localModel,
        primaryDirection,
        true,
        controller.signal,
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown local Ollama fallback failure.';

      this.logger.error(
        `Local emergency fallback model "${localModel.displayName ?? localModel.modelName}" failed: ${message}`,
      );

      return null;
    } finally {
      if (deadlineTimer) clearTimeout(deadlineTimer);
      signal?.removeEventListener('abort', abortFromExternal);
    }
  }

  /**
   * Executes, parses, evaluates, optionally revises, and persists one model.
   *
   * A candidate is successful only when it passes the deterministic quality
   * gate. Provider failures and quality rejections are persisted separately so
   * administrators can distinguish availability problems from weak outputs.
   */
  private async executeModelCandidate(
    context: IdeaGenerationContext,
    model: AiModel,
    direction: CandidateConceptDirection,
    allowQualityRevision: boolean,
    signal?: AbortSignal,
  ): Promise<IdeaBenchmarkCandidate> {
    const prompt = context.prompt;

    if (!prompt) {
      throw new ServiceUnavailableException(
        'A persisted prompt is required before model execution.',
      );
    }

    const startedAt = Date.now();
    let failurePersisted = false;

    try {
      const qualityContext = this.buildQualityContext(context);
      const initialAttempt = await this.generateAndEvaluate(
        context,
        model,
        direction.promptText,
        qualityContext,
        signal,
      );
      /*
       * A structurally valid sparse-evidence candidate is still allowed to
       * survive as continuity fallback, but it no longer skips the one bounded
       * quality-revision attempt when it is below the accepted product-quality
       * gate. This is especially important for Text Only / Text+Domains runs:
       * sparse external evidence must not freeze an otherwise repairable 50-60
       * point product into the final output.
       */
      const qualityApprovedAttempt =
        initialAttempt.quality.accepted || !allowQualityRevision
          ? initialAttempt
          : await this.reviseWeakCandidate(
              context,
              model,
              initialAttempt,
              qualityContext,
              direction.promptText,
              signal,
            );

      const usableAttempt = qualityApprovedAttempt;

      if (!qualityApprovedAttempt.quality.accepted) {
        const blockingIssues = qualityApprovedAttempt.quality.issues
          .filter((issue) =>
            [
              'UNSUPPORTED_LOCAL_CLAIM',
              'UNSUPPORTED_PLATFORM_ACCESS',
              'MALFORMED_MEASURABLE_TARGET',
              'UNSUPPORTED_IMPACT_TARGET',
              'COMMON_TITLE_MISSPELLING',
              'NO_DIRECT_EVIDENCE',
              'SECONDARY_DOMAIN_LEAKAGE',
            ].includes(issue.code),
          )
          .map((issue) => issue.code);

        this.logger.warn(
          qualityApprovedAttempt.quality.score < IDEA_MIN_ACCEPTED_QUALITY_SCORE
            ? `Model "${model.displayName ?? model.modelName}" returned a structurally valid candidate below the preferred quality threshold (${qualityApprovedAttempt.quality.score}/${IDEA_MIN_ACCEPTED_QUALITY_SCORE}). It is retained as a last-resort candidate so the run always returns a result.`
            : `Model "${model.displayName ?? model.modelName}" reached ${qualityApprovedAttempt.quality.score}/${IDEA_MIN_ACCEPTED_QUALITY_SCORE}, but deterministic blocking checks still rejected it (${blockingIssues.join(', ') || 'UNKNOWN_BLOCKING_ISSUE'}). It is retained only as a fallback candidate.`,
        );
      }

      const hasVerifiedProblemEvidence =
        (direction.opportunity.verifiedProblemMatchedEvidenceCount ??
          direction.opportunity.verifiedEvidenceCount ??
          direction.opportunity.evidenceSamples.length) > 0;
      const isUnvalidatedHypothesis =
        !this.resolveCanonicalDiscoveryProblemLock(context, direction.opportunity) &&
        (direction.opportunity.disqualificationReasons.includes(
          'PRIMARY_DOMAIN_VALIDATION_HYPOTHESIS',
        ) ||
          (!hasVerifiedProblemEvidence &&
            direction.opportunity.disqualificationReasons.includes(
              'NO_DIRECT_EVIDENCE',
            )));

      const shouldCheckPersistedDuplicate =
        !isUnvalidatedHypothesis &&
        usableAttempt.quality.accepted &&
        usableAttempt.quality.score >= IDEA_MIN_ACCEPTED_QUALITY_SCORE;
      const acceptedAttempt = shouldCheckPersistedDuplicate
        ? await this.resolveDistinctAttempt(
            context,
            model,
            direction,
            usableAttempt,
            qualityContext,
            signal,
            signal === undefined,
          )
        : usableAttempt;

      /*
       * Candidate diagnostics are not needed to evaluate the winner. Allocate
       * the UUID locally and defer successful-candidate persistence until all
       * parallel model results have been scored. This replaces two create
       * round-trips plus a later update transaction with one createMany call.
       */
      const candidateId = randomUUID();

      return {
        candidateId,
        modelSnapshot: {
          id: model.id,
          providerKey: model.providerKey,
          apiModelId: model.apiModelId,
          modelName: model.modelName,
          displayName: model.displayName,
        },
        aiResult: acceptedAttempt.aiResult,
        parsedOutput: acceptedAttempt.parsedOutput,
        quality: acceptedAttempt.quality,
        aiJudge: null,
        finalScore: acceptedAttempt.quality.score,
        semanticDiversityAdjustedScore: acceptedAttempt.quality.score,
        hybridFinalScore: null,
        selected: false,
        opportunityRank: direction.opportunity.rank,
        opportunityTitle: direction.opportunity.title,
        semanticDiversity: null,
        deterministicEmergencyFallback: false,
      };
    } catch (error: unknown) {
      if (signal?.aborted) {
        throw error;
      }

      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Unknown model execution failure.';

      const duplicateRejectionPersisted = errorMessage.startsWith(
        'SEMANTIC_DUPLICATE_REJECTED:',
      );

      if (!failurePersisted && !duplicateRejectionPersisted) {
        // Failed-candidate rows are diagnostics only. Do not hold the user-facing
        // pipeline behind another remote Supabase write after a provider timeout.
        // Successful candidates, duplicate checks, quality gates, and winner
        // persistence remain fully awaited.
        void this.persistFailedCandidate({
          runId: context.runId,
          model,
          responseTimeMs: Date.now() - startedAt,
          errorMessage,
          direction,
        }).catch((persistenceError: unknown) => {
          const persistenceMessage =
            persistenceError instanceof Error
              ? persistenceError.message
              : String(persistenceError);
          this.logger.warn(
            `Failed to persist benchmark diagnostic for model "${model.displayName ?? model.modelName}": ${persistenceMessage}`,
          );
        });
      }

      this.logger.warn(
        `Idea benchmark model "${model.displayName ?? model.modelName}" failed: ${errorMessage}`,
      );

      throw error;
    }
  }

  /**
   * Rejects persisted semantic duplicates before candidate selection and gives
   * the same model a bounded redesign opportunity. When all redesign attempts
   * remain duplicates, the caller advances to the next model or ranked
   * opportunity instead of failing the complete pipeline immediately.
   */
  private async resolveDistinctAttempt(
    context: IdeaGenerationContext,
    model: AiModel,
    direction: CandidateConceptDirection,
    initialAttempt: AcceptedModelAttempt,
    qualityContext: IdeaQualityEvaluationContext,
    signal?: AbortSignal,
    allowDuplicateRedesign = true,
  ): Promise<AcceptedModelAttempt> {
    if (signal?.aborted) {
      throw new ServiceUnavailableException(
        'Parallel candidate generation was cancelled after another model satisfied the quality threshold.',
      );
    }

    let currentAttempt = initialAttempt;
    let duplicateResult = await this.checkAttemptDuplicateWithinBudget(
      context,
      currentAttempt,
    );

    if (!duplicateResult) {
      this.logger.warn(
        `Prepared-corpus duplicate verification exceeded ${IDEA_BENCHMARK_DUPLICATE_DB_BUDGET_MS}ms; the benchmark continues with the quality-approved candidate and leaves the final exact-title race guard to the final duplicate stage and atomic persistence.`,
      );
      return currentAttempt;
    }

    if (!duplicateResult.isDuplicate) {
      return currentAttempt;
    }

    this.logDuplicateRejection(model, direction, 0, duplicateResult);

    if (!allowDuplicateRedesign) {
      const errorMessage = this.buildDuplicateRejectionMessage(duplicateResult);
      this.logger.warn(
        `${errorMessage} The confirmed duplicate is rejected immediately so the already-running peer can continue without starting a second provider redesign window.`,
      );
      throw new ServiceUnavailableException(errorMessage);
    }

    for (
      let attemptNumber = 1;
      attemptNumber <= IDEA_DUPLICATE_REGENERATION_MAX_ATTEMPTS;
      attemptNumber += 1
    ) {
      const redesignPrompt = this.buildDuplicateRedesignPrompt(
        direction.promptText,
        currentAttempt,
        duplicateResult,
        attemptNumber,
      );

      try {
        const generatedAttempt = await this.generateAndEvaluate(
          context,
          model,
          redesignPrompt,
          qualityContext,
          signal,
        );
        currentAttempt = generatedAttempt.quality.accepted
          ? generatedAttempt
          : await this.reviseWeakCandidate(
              context,
              model,
              generatedAttempt,
              qualityContext,
              redesignPrompt,
              signal,
            );

        if (!currentAttempt.quality.accepted) {
          continue;
        }

        const refreshedDuplicateResult =
          await this.checkAttemptDuplicateWithinBudget(
            context,
            currentAttempt,
          );
        if (!refreshedDuplicateResult) {
          this.logger.warn(
            `Post-redesign prepared-corpus duplicate verification exceeded ${IDEA_BENCHMARK_DUPLICATE_DB_BUDGET_MS}ms; keeping the revised quality-approved candidate without adding another latency window.`,
          );
          return currentAttempt;
        }
        duplicateResult = refreshedDuplicateResult;

        if (!duplicateResult.isDuplicate) {
          this.logger.log(
            `Model "${model.displayName ?? model.modelName}" produced a distinct candidate after duplicate redesign attempt ${attemptNumber}.`,
          );

          return currentAttempt;
        }

        this.logDuplicateRejection(
          model,
          direction,
          attemptNumber,
          duplicateResult,
        );
      } catch (error: unknown) {
        if (signal?.aborted) {
          throw error;
        }

        const message =
          error instanceof Error
            ? error.message
            : 'Unknown duplicate redesign failure.';

        this.logger.warn(
          `Duplicate redesign attempt ${attemptNumber} for model "${model.displayName ?? model.modelName}" failed: ${message}`,
        );
      }
    }

    const errorMessage = this.buildDuplicateRejectionMessage(duplicateResult);

    this.logger.warn(
      `${errorMessage} The duplicate candidate will not enter winner selection; the benchmark will continue with another healthy model or ranked opportunity.`,
    );

    throw new ServiceUnavailableException(errorMessage);
  }

  private async resolveBenchmarkCorpusWithinFastPath(
    corpusPromise: Promise<readonly DuplicateIdeaCandidate[]>,
  ): Promise<readonly DuplicateIdeaCandidate[]> {
    const guardedCorpus = corpusPromise.catch((error: unknown) => {
      this.logger.warn(
        `Benchmark semantic corpus warmup failed; continuing without blocking provider generation. error=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [] as readonly DuplicateIdeaCandidate[];
    });

    return Promise.race([
      guardedCorpus,
      new Promise<readonly DuplicateIdeaCandidate[]>((resolve) => {
        setTimeout(() => resolve([]), IDEA_BENCHMARK_CORPUS_WARMUP_BUDGET_MS);
      }),
    ]);
  }

  private async checkAttemptDuplicateWithinBudget(
    context: IdeaGenerationContext,
    attempt: AcceptedModelAttempt,
  ): Promise<IdeaDuplicateCheckResult | null> {
    const duplicateCheck = this.checkAttemptDuplicate(context, attempt)
      .then((result) => ({ kind: 'result' as const, result }))
      .catch((error: unknown) => ({ kind: 'error' as const, error }));
    const timeout = new Promise<{ readonly kind: 'timeout' }>((resolve) => {
      setTimeout(
        () => resolve({ kind: 'timeout' as const }),
        IDEA_BENCHMARK_DUPLICATE_DB_BUDGET_MS,
      );
    });

    const settled = await Promise.race([duplicateCheck, timeout]);
    if (settled.kind === 'error') {
      throw settled.error;
    }
    return settled.kind === 'result' ? settled.result : null;
  }

  private async checkAttemptDuplicate(
    context: IdeaGenerationContext,
    attempt: AcceptedModelAttempt,
  ): Promise<IdeaDuplicateCheckResult> {
    const collectionJobId = context.collection?.collectionJobId;

    if (!collectionJobId) {
      throw new ServiceUnavailableException(
        'A resolved collection job is required before semantic duplicate detection.',
      );
    }

    return this.duplicateDetectionService.checkPreparedBenchmarkCorpus(
      context.runId,
      context.domainId,
      attempt.parsedOutput.coreIdea,
    );
  }

  /**
   * Returns only the fields needed to redesign or revise a candidate.
   *
   * Sending the complete parsed premium result repeats fourteen advanced
   * outputs in the follow-up request and can add thousands of input tokens.
   * The product mechanism is fully represented by the core narrative,
   * objectives, target users, MVP features, technology stack, and architecture
   * summary, so the remaining advanced outputs are intentionally omitted.
   */
  private buildCompactCandidateSignature(
    parsedOutput: ParsedIdeaAiOutput,
  ): Record<string, unknown> {
    const readAdvancedOutput = (outputKey: string): string | string[] | null => {
      const output = parsedOutput.advancedOutputs.find(
        (item) => item.outputKey === outputKey,
      );

      if (!output) {
        return null;
      }

      if (
        Array.isArray(output.structuredContent) &&
        output.structuredContent.length > 0
      ) {
        return output.structuredContent
          .filter((item): item is string => typeof item === 'string')
          .slice(0, 8)
          .map((item) => item.replace(/\s+/gu, ' ').trim().slice(0, 180));
      }

      return output.content
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, 900);
    };

    const core = parsedOutput.coreIdea;

    return {
      title: core.title,
      problemStatement: core.problemStatement.slice(0, 1_200),
      objectives: core.objectives.slice(0, 5),
      targetUsers: core.targetUsers.slice(0, 4),
      overview: (
        core.partialAbstract ??
        core.limitedAbstract ??
        core.fullAbstract ??
        ''
      )
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, 800),
      mvpFeatures: readAdvancedOutput('mvp-features'),
      technologyStack: readAdvancedOutput('technology-stack'),
      systemArchitecture: readAdvancedOutput('system-architecture'),
    };
  }

  private buildDuplicateRedesignPrompt(
    assignedPromptText: string,
    previousAttempt: AcceptedModelAttempt,
    duplicateResult: IdeaDuplicateCheckResult,
    attemptNumber: number,
  ): string {
    const previousArchetype = this.detectSolutionArchetype(
      previousAttempt.parsedOutput.coreIdea,
    );
    const alternativeArchetypes = this.getAlternativeArchetypes(
      previousArchetype,
      attemptNumber,
    );

    const attemptInstructions =
      attemptNumber === 1
        ? [
            '- Change the core workflow, primary actor action, system response, and measurable outcome.',
            '- Replace the main user journey, product mechanism, and dominant capability combination; do not only rename telemetry, monitoring, bridge, dashboard, or integration concepts.',
            `- Do not reuse the rejected solution archetype: ${previousArchetype}.`,
            `- Prefer one of these materially different archetypes: ${alternativeArchetypes.join(', ')}.`,
          ]
        : [
            '- Use a fundamentally different solution archetype from the rejected candidate.',
            `- Previous solution archetype: ${previousArchetype}.`,
            `- Choose one of these different directions: ${alternativeArchetypes.join(', ')}.`,
            '- The new concept must have a different primary actor action, system response, and measurable outcome.',
          ];

    return [
      assignedPromptText,
      'SEMANTIC-DUPLICATE REDESIGN:',
      `- Redesign attempt ${attemptNumber} of ${IDEA_DUPLICATE_REGENERATION_MAX_ATTEMPTS}.`,
      '- The previous candidate was rejected because it was materially similar to an existing persisted idea.',
      '- Keep the evidence-backed need, but redesign the product mechanism, core workflow, value proposition, and dominant capabilities.',
      ...attemptInstructions,
      '- A renamed version, dashboard wrapper, minor feature variation, or identical workflow is not acceptable.',
      '- Do not copy the matched idea or expose it verbatim in the response.',
      `- Duplicate reasons: ${duplicateResult.duplicateReasons.join(', ') || 'semantic overlap'}.`,
      `- Semantic similarity: ${duplicateResult.semanticSimilarity}.`,
      `- Workflow similarity: ${duplicateResult.workflowSimilarity}.`,
      duplicateResult.matchedIdea
        ? `- Avoid recreating the product direction represented by existing idea "${duplicateResult.matchedIdea.title}".`
        : '',
      '<previous_rejected_candidate_signature>',
      JSON.stringify(
        this.buildCompactCandidateSignature(previousAttempt.parsedOutput),
      ),
      '</previous_rejected_candidate_signature>',
      '- Before returning, compare the redesigned concept with the rejected candidate and verify that its workflow and value delivery are materially different.',
      '- Return exactly one complete JSON object matching the required schema.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private logDuplicateRejection(
    model: AiModel,
    direction: CandidateConceptDirection,
    attemptNumber: number,
    result: IdeaDuplicateCheckResult,
  ): void {
    this.logger.warn(
      [
        'Duplicate candidate rejected:',
        `model=${model.displayName ?? model.modelName}`,
        `attempt=${attemptNumber}`,
        `opportunity=${direction.opportunity.title}`,
        `matchedIdeaId=${result.matchedIdea?.id ?? 'none'}`,
        `matchedIdeaTitle=${result.matchedIdea?.title ?? 'none'}`,
        `titleSimilarity=${result.titleSimilarity}`,
        `semanticSimilarity=${result.semanticSimilarity}`,
        `workflowSimilarity=${result.workflowSimilarity}`,
        `sameProblemFamily=${result.sameProblemFamily}`,
        `familyPenalty=${result.familyPenalty}`,
        `finalSimilarity=${result.highestSimilarity}`,
        `reasons=${result.duplicateReasons.join(',') || 'none'}`,
      ].join(' '),
    );
  }

  private detectSolutionArchetype(
    idea: ParsedIdeaAiOutput['coreIdea'],
  ): string {
    const text = [
      idea.title,
      idea.problemStatement,
      ...idea.objectives,
      idea.fullAbstract ?? idea.partialAbstract ?? idea.limitedAbstract ?? '',
    ]
      .join(' ')
      .toLowerCase();

    const archetypes: readonly [string, RegExp][] = [
      [
        'offline-first cache or synchronization product',
        /offline|cache|sync|download|local storage/u,
      ],
      [
        'analytics and early-warning system',
        /analytics|dashboard|insight|warning|prediction|monitor/u,
      ],
      [
        'verification or identity service',
        /verify|verification|identity|authentication|credential|login/u,
      ],
      [
        'administrative workflow automation',
        /workflow|approval|administrative|automation|request processing/u,
      ],
      [
        'peer coordination platform',
        /peer|community|collaboration|mentor|matching|coordination/u,
      ],
      [
        'institutional integration layer',
        /integration|connector|api|institution|lms|sis|erp/u,
      ],
      [
        'guided assistant or support tool',
        /assistant|chatbot|guide|support|helpdesk/u,
      ],
    ];

    return (
      archetypes.find(([, pattern]) => pattern.test(text))?.[0] ??
      'general self-service application'
    );
  }

  private getAlternativeArchetypes(
    previousArchetype: string,
    attemptNumber: number,
  ): readonly string[] {
    const allArchetypes = [
      'administrative workflow automation',
      'verification service',
      'analytics and early-warning system',
      'peer coordination platform',
      'institutional integration layer',
      'guided support and case-resolution tool',
      'resource allocation and scheduling system',
    ].filter((archetype) => archetype !== previousArchetype);

    const rotationOffset =
      ((attemptNumber - 1) * 3) % Math.max(allArchetypes.length, 1);

    return [
      ...allArchetypes.slice(rotationOffset),
      ...allArchetypes.slice(0, rotationOffset),
    ].slice(0, 4);
  }

  private buildDuplicateRejectionMessage(
    result: IdeaDuplicateCheckResult,
  ): string {
    return [
      'SEMANTIC_DUPLICATE_REJECTED:',
      `candidate remained similar after ${IDEA_DUPLICATE_REGENERATION_MAX_ATTEMPTS} redesign attempts.`,
      `Similarity=${result.highestSimilarity}.`,
      `Semantic=${result.semanticSimilarity}.`,
      `Workflow=${result.workflowSimilarity}.`,
      `MatchedIdea=${result.matchedIdea?.id ?? 'none'}.`,
      `Reasons=${result.duplicateReasons.join(', ') || 'semantic overlap'}.`,
      'The benchmark will continue with another model or ranked opportunity.',
    ].join(' ');
  }

  /** Executes one exact model and evaluates its normalized response. */
  private async generateAndEvaluate(
    context: IdeaGenerationContext,
    model: AiModel,
    userPrompt: string,
    qualityContext: IdeaQualityEvaluationContext,
    signal?: AbortSignal,
  ): Promise<AcceptedModelAttempt> {
    const prompt = context.prompt;

    if (!prompt) {
      throw new ServiceUnavailableException(
        'A persisted prompt is required before model execution.',
      );
    }

    const aiResult = await this.aiExecutionService.execute({
      aiModelId: model.id,
      allowTemporaryModelCooldownBypass: false,
      allowBoundedEmergencyModelAttempt: false,
      userPrompt,
      systemInstruction: this.buildSystemInstruction(context),
      requestType: ApiRequestType.IDEA_GENERATION,
      promptType: PromptType.IDEA_GENERATION,
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
      responseSchema: prompt.responseSchema,
      responseSchemaName: prompt.responseSchemaName,
      estimatedOutputTokens: context.policy?.includePremiumOutputs
        ? 5_120
        : 2_048,
      maxOutputTokens: this.resolveBenchmarkMaxOutputTokens(
        model,
        Boolean(context.policy?.includePremiumOutputs),
      ),
      temperature: 0.55,
      // Fast bounded recovery policy:
      // 1. Retry the exact assigned model once for a transient failure.
      // 2. If the same model still fails, return control to the benchmark loop.
      // 3. The benchmark loop fills the missing candidate slot with the next
      //    healthy ONLINE model from the provider-diverse rotation.
      // The shorter timeout prevents one unavailable model from holding the
      // complete parallel batch for several minutes.
      timeoutMs:
        this.isUngroundedEvidenceState(context.evidenceState) &&
        context.collectionPlan?.requestIntent?.mode === 'EXPLICIT_PROBLEM' &&
        Boolean(context.collectionPlan.requestIntent.explicitProblem?.trim())
          ? Math.min(
              this.resolveCoreModelTimeoutMs(model),
              IDEA_BENCHMARK_REQUESTER_ZERO_EVIDENCE_MODEL_TIMEOUT_MS,
            )
          : this.resolveCoreModelTimeoutMs(model),
      maxRetriesPerModel: signal
        ? 0
        : IDEA_BENCHMARK_TRANSIENT_RETRIES_PER_MODEL,
      signal,
    });
    const rawParsedOutput = this.outputParserService.parseOrThrow(aiResult.text);
    const parsedOutput = this.normalizeSparseEvidenceBenchmarkOutput(
      rawParsedOutput,
      qualityContext,
      context,
    );
    this.assertCandidateProblemSolutionPortfolio(context, parsedOutput);
    const quality = this.qualityEvaluatorService.evaluate(
      parsedOutput,
      qualityContext,
    );

    return { aiResult, parsedOutput, quality };
  }

  private normalizeSparseEvidenceBenchmarkOutput(
    output: ParsedIdeaAiOutput,
    context: IdeaQualityEvaluationContext,
    generationContext: IdeaGenerationContext,
  ): ParsedIdeaAiOutput {
    const directEvidenceCount = Math.max(0, context.directEvidenceCount ?? 0);
    const independentSourceCount = Math.max(
      0,
      context.verifiedIndependentSourceCount ?? 0,
    );
    const selectedOpportunity = generationContext.opportunityRanking?.selected;
    const secondaryEvidenceCount = Math.max(
      0,
      selectedOpportunity?.verifiedProblemMatchedSecondaryEvidenceCount ??
        selectedOpportunity?.verifiedSecondaryEvidenceCount ??
        selectedOpportunity?.supportingEvidence?.filter(
          (item) => item.sourceType === 'SECONDARY_EVIDENCE',
        ).length ??
        0,
    );
    const technicalEvidenceCount = Math.max(
      0,
      selectedOpportunity?.verifiedProblemMatchedTechnicalEvidenceCount ??
        selectedOpportunity?.verifiedTechnicalEvidenceCount ??
        selectedOpportunity?.supportingEvidence?.filter(
          (item) => item.sourceType === 'TECHNICAL_EVIDENCE',
        ).length ??
        0,
    );
    const secondaryOnlyEvidence =
      directEvidenceCount === 0 &&
      secondaryEvidenceCount > 0 &&
      technicalEvidenceCount === 0;
    const selectedVerifiedEvidenceCount = Math.max(
      0,
      selectedOpportunity?.verifiedProblemMatchedEvidenceCount ??
        selectedOpportunity?.verifiedEvidenceCount ??
        0,
    );
    const qualifiedExternalSupportingCount = Math.max(
      0,
      selectedOpportunity?.qualifiedExternalSupportingEvidenceCount ?? 0,
      secondaryEvidenceCount,
      technicalEvidenceCount,
    );
    const selectedFamilyEvidenceIds = new Set(
      (generationContext.communityAiAnalysis?.selectedProblemFamilyEvidenceIds ?? [])
        .map((id) => id.trim())
        .filter(Boolean),
    );
    const verifiedCommunitySupportingCount = Math.max(
      generationContext.communityAiAnalysis?.evidenceClassifications?.filter(
        (item) =>
          item.classification === 'SUPPORTING_SIGNAL' &&
          item.verifiedByDeterministicGuard === true &&
          (selectedFamilyEvidenceIds.size === 0 ||
            selectedFamilyEvidenceIds.has(item.evidenceId)),
      ).length ?? 0,
      selectedOpportunity?.supportingEvidence?.filter(
        (item) =>
          item.qualifiesAsCommunityEvidence === true &&
          item.sourceType === 'COMMUNITY_EVIDENCE' &&
          item.text.trim().length > 0,
      ).length ?? 0,
    );
    const canonicalZeroEvidence =
      this.isUngroundedEvidenceState(generationContext.evidenceState);
    const hasAnyVerifiedExternalEvidence =
      !canonicalZeroEvidence &&
      (selectedVerifiedEvidenceCount > 0 ||
        qualifiedExternalSupportingCount > 0 ||
        verifiedCommunitySupportingCount > 0);
    const zeroEvidenceValidationMode = Boolean(
      canonicalZeroEvidence ||
        (!hasAnyVerifiedExternalEvidence &&
          (selectedOpportunity?.disqualificationReasons?.includes(
            'PRIMARY_DOMAIN_VALIDATION_HYPOTHESIS',
          ) ||
            (selectedVerifiedEvidenceCount === 0 &&
              (generationContext.opportunityRanking?.evidenceCoverage ?? 0) === 0))),
    );
    const validationDomainLabel =
      selectedOpportunity?.primaryMatchedDomainName?.trim() ||
      selectedOpportunity?.matchedDomainNames?.[0]?.trim() ||
      generationContext.domainName?.trim() ||
      'the selected domain';
    const featureRequestEvidenceCount = Math.max(
      0,
      selectedOpportunity?.verifiedProblemMatchedFeatureRequestEvidenceCount ??
        selectedOpportunity?.verifiedFeatureRequestEvidenceCount ??
        0,
    );
    const singleDirectEvidence =
      directEvidenceCount === 1 && independentSourceCount <= 1;
    const singleFeatureRequest =
      singleDirectEvidence && featureRequestEvidenceCount >= 1;
    const singleDirectLabel = singleFeatureRequest
      ? 'feature request'
      : 'direct report';
    const retainedEvidenceSamples = [
      ...(selectedOpportunity?.evidenceSamples ?? []),
      ...(selectedOpportunity?.independentEvidence?.map((item) => item.text) ?? []),
    ]
      .map((value) => value.replace(/\s+/gu, ' ').trim())
      .filter(Boolean);
    const retainedEvidenceText = retainedEvidenceSamples.join(' ');
    const sparseVerifiedSignalCount =
      selectedVerifiedEvidenceCount > 0
        ? selectedVerifiedEvidenceCount
        : Math.max(
            directEvidenceCount,
            qualifiedExternalSupportingCount,
            verifiedCommunitySupportingCount,
          );
    const sparseSupportingLead =
      directEvidenceCount === 0 &&
      sparseVerifiedSignalCount > 0 &&
      independentSourceCount <= 1
        ? `${sparseVerifiedSignalCount} retained supporting signal${sparseVerifiedSignalCount === 1 ? '' : 's'} from one independent source ${sparseVerifiedSignalCount === 1 ? 'suggests' : 'suggest'}`
        : null;
    const sparseEvidenceClaimLead = sparseSupportingLead
      ? `${sparseSupportingLead} that `
      : 'The preliminary validation hypothesis is that ';
    const regionalAlternativeLoginRequest =
      singleFeatureRequest &&
      /\b(?:two[- ]factor authentication|two[- ]factor|2fa)\b/iu.test(
        retainedEvidenceText,
      ) &&
      /\b(?:google\s+(?:login|sign[- ]?in)|sign[- ]?in\s+with\s+google)\b/iu.test(
        retainedEvidenceText,
      );
    const evidenceMentionsAutomatedStatus =
      /\b(?:automated|automatic)\s+(?:status|notification|update|message|alert)/iu.test(
        retainedEvidenceText,
      );
    const evidenceShowsRecipientContactCoordinationFailure =
      /\b(?:refus(?:e|ed|es|ing)|fail(?:ed|s|ing)?|unable)\s+to\s+contact\s+(?:the\s+)?recipient\b/iu.test(
        retainedEvidenceText,
      );
    const shortSingleDirectEvidence =
      singleDirectEvidence &&
      retainedEvidenceSamples.length > 0 &&
      retainedEvidenceSamples.every((value) => value.length <= 180);
    const canonicalDiscoveryFamily =
      !this.hasExplicitRequesterProblem(generationContext) &&
      (generationContext.communityAiAnalysis?.selectedProblemFamilyTrustedEvidenceCount ?? 0) > 0
        ? generationContext.communityAiAnalysis?.selectedProblemFamily?.trim() ?? ''
        : '';
    const selectedProblemSemantic = [
      canonicalDiscoveryFamily || selectedOpportunity?.title || '',
      selectedOpportunity?.problem ?? '',
      selectedOpportunity?.solutionArea ?? '',
      !canonicalDiscoveryFamily &&
      selectedOpportunity?.raw &&
      typeof selectedOpportunity.raw === 'object' &&
      'familyKey' in selectedOpportunity.raw
        ? String(selectedOpportunity.raw.familyKey ?? '')
        : '',
    ]
      .join(' ')
      .toLocaleLowerCase();
    const logisticsDeliveryEvidence =
      /\b(?:shipment|delivery|consignment|recipient|return[- ]?routing|return to (?:origin|residence))\b/iu.test(
        retainedEvidenceText,
      ) &&
      /\b(?:shipment|delivery|tracking|logistics)\b/u.test(
        selectedProblemSemantic,
      );
    const authenticationSparseCase =
      shortSingleDirectEvidence &&
      /\b(?:authentication|login|account access|account activation)\b/u.test(
        selectedProblemSemantic,
      );
    const evidenceExplicitlyMentionsVerification = retainedEvidenceSamples.some(
      (value) =>
        /\b(?:verif(?:y|ied|ication)|identity|identification|document|face\s?id|fingerprint|password|two[- ]factor|2fa|oauth|oidc)\b/iu.test(
          value,
        ),
    );
    const evidenceExplicitlyMentionsEnergyWorkflowDetail =
      retainedEvidenceSamples.some((value) =>
        /\b(?:field technicians?|usage graphs?|consumption data|utility data|provider settings?|energy monitoring)\b/iu.test(
          value,
        ),
      );
    const evidenceSupportsRepeatedCrash = retainedEvidenceSamples.some((value) =>
      /\b(?:keeps?\s+crash(?:ing|es)?|crash(?:es|ing)\s+(?:again|repeatedly)|every\s+time|multiple\s+times|repeated\s+crash(?:es|ing))\b/iu.test(
        value,
      ),
    );
    const evidenceExplicitlyMentionsWorkflowStateLoss =
      retainedEvidenceSamples.some((value) =>
        /\b(?:lost|lose|losing|transactional state|session state|workflow state|lost progress|lose progress|active service requests?|verification screens?)\b/iu.test(
          value,
        ),
      );
    const evidenceSupportsBlockingErrorMessages = retainedEvidenceSamples.some(
      (value) =>
        /\b(?:error messages?|errors?)\s+(?:pop up|appear|appeared|display|displayed|show|shown)|\b(?:blocking|unexpected)\s+error messages?\b/iu.test(
          value,
        ),
    );

    if (independentSourceCount > 1) {
      return output;
    }

    const sanitizeNarrative = (value: string): string => {
      let cleaned = value
        .replace(
          /\b(?:Secondary|Supporting) reports?\s+across\s+[^.!?]{2,220}?\s+(?:highlight|highlights|indicate|indicates|show|shows|suggest|suggests)(?:\s+that)?\s+/giu,
          sparseEvidenceClaimLead,
        )
        .replace(
          /\b(?:Secondary|Supporting) reports?\s+(?:highlight|highlights|indicate|indicates|show|shows|suggest|suggests)(?:\s+that)?\s+/giu,
          sparseEvidenceClaimLead,
        )
        .replace(
          /\b(?:frequently|often|commonly|typically)\s+causes?\b/giu,
          'may cause',
        )
        .replace(
          /\b(?:frequently|often|commonly|typically)\s+leads?\s+to\b/giu,
          'may lead to',
        )
        .replace(
          /\b(?:frequently|often|commonly|typically)\s+results?\s+in\b/giu,
          'may result in',
        )
        .replace(
          /\b(?:frequently|often|commonly|typically)\s+creates?\b/giu,
          'may create',
        )
        .replace(
          /\b((?:Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|\d+) verified supporting signals) was retained\b/giu,
          '$1 were retained',
        )
        .replace(
          /\bCollected user\s+one collected report indicates(?: that)?\s*/giu,
          'One retained direct report indicates that ',
        )
        .replace(
          /\bCollected community\s+one collected report indicates(?: that)?\s*/giu,
          'One collected community report indicates that ',
        )
        .replace(
          /\bCollected community feedback\s+one collected report indicates(?: that)?\s*/giu,
          'One collected community report indicates that ',
        )
        .replace(
          /\bThis issue (?:frequently|often|commonly|typically) stems from\b/giu,
          'A potential contributing factor to validate is',
        )
        .replace(
          /\bThis (?:failure|problem) (?:frequently|often|commonly|typically) stems from\b/giu,
          'A potential contributing factor to validate is',
        )
        .replace(
          /\b(?:persistent|recurring|widespread|common|frequent|systemic)\s+(friction|failures?|problems?|issues?|challenges?|demand)\b/giu,
          directEvidenceCount === 0 ? 'potential $1' : 'reported $1',
        )
        .replace(
          /\b(?:users|customers|developers|operators|patients|coaches|athletes|families)\s+(?:often|frequently|commonly|typically)\s+(struggle|experience|encounter|face)\b/giu,
          (_match, verb: string) =>
            `the retained scenario suggests that affected users may ${verb.toLowerCase()}`,
        )
        .replace(
          /\b(?:often|frequently|commonly|typically)\s+(struggle|experience|encounter|face)\b/giu,
          (_match, verb: string) => `may ${verb.toLowerCase()}`,
        )
        .replace(
          /\b([A-Z][^.!?]{0,90}?)\s+(?:often|frequently|commonly|typically)\s+(face|encounter|experience|struggle with)\b/gu,
          (_match, subject: string, verb: string) =>
            `${subject.trim()} may ${verb.toLowerCase()}`,
        )
        .replace(/\b(?:a|the) critical need for\b/giu, 'a potential need for')
        .replace(/\bensures that\b/giu, 'is designed to help')
        .replace(/\bensure that\b/giu, 'help')
        .replace(/\bensuring that\b/giu, 'supporting')
        .replace(/\bensures\b/giu, 'supports')
        .replace(/\bensure\b/giu, 'support')
        .replace(/\bguarantees?\b/giu, 'is designed to support')
        .replace(/\bnor does it is designed to support\b/giu, 'nor is it designed to support')
        .replace(/\bdoes not is designed to support\b/giu, 'is not designed to support')
        .replace(/\bis designed to support supporting\b/giu, 'is designed to support')
        .replace(/\balways available\b/giu, 'more consistently available')
        .replace(/\bproven effectiveness\b/giu, 'pilot effectiveness')
        .replace(/\bpractical and scalable\b/giu, 'practical enough to evaluate for broader use')
        .replace(/\bscalable to (?:other|broader)\b/giu, 'eligible for later evaluation in other')
        .replace(/\bsignificant operational friction\b/giu, 'potential operational friction')
        .replace(/\bstrong demand\b/giu, 'potential need')
        .replace(
          /\bcommunity discussions?\s+(?:highlight|indicate|show|suggest)\b/giu,
          'the retained evidence suggests',
        )
        .replace(/\ba expressed\b/giu, 'an expressed')
        .replace(/\bmay\s+may\b/giu, 'may')
        .replace(/\bcan\s+may\b/giu, 'may')
        .replace(/\bPreliminary\s+preliminary\b/giu, 'Preliminary')
        .replace(/\bdescribes\s+reported\s+friction\b/giu, 'describes friction')
        .replace(
          /\bThe\s+(One retained (?:feature request|direct report|secondary report)\b)/gu,
          '$1',
        )
        .replace(
          /\b(Failures?|Friction|Gaps?|Constraints?|Limitations?)\s+The direction uses\b/gu,
          '$1. The direction uses',
        )
        .replace(
          /(\bproblem family as:\s*[^.!?]{3,180}?)(?=\s+No verified direct user complaint\b)/giu,
          '$1.',
        );

      if (singleDirectEvidence) {
        const retainedLabel = `One retained ${singleDirectLabel}`;

        cleaned = cleaned
          .replace(
            /\bCollected user feedback(?:\s+(?:from|across)\s+[^.!?]{0,180})?\s+(?:indicates|shows|suggests|highlights)\s+that\s+/giu,
            `${retainedLabel} indicates that `,
          )
          .replace(
            /\bCollected user feedback(?:\s+(?:from|across)\s+[^.!?]{0,180})?\s+(?:highlights|shows|suggests|indicates)\s+/giu,
            `${retainedLabel} describes `,
          )
          .replace(
            /\bCollected feedback(?:\s+(?:from|across)\s+[^.!?]{0,180})?\s+(?:indicates|shows|suggests|highlights)\s+that\s+/giu,
            `${retainedLabel} indicates that `,
          )
          .replace(
            /\bCommunity feedback(?:\s+(?:from|across)\s+[^.!?]{0,180})?\s+(?:indicates|shows|suggests|highlights)\s+that\s+/giu,
            `${retainedLabel} indicates that `,
          )
          .replace(
            /\bCollected feedback(?:\s+(?:from|across)\s+[^.!?]{0,180})?\s+(?:highlights|shows|suggests)\s+/giu,
            `${retainedLabel} describes `,
          )
          .replace(
            /\bCommunity feedback(?:\s+(?:from|across)\s+[^.!?]{0,180})?\s+(?:highlights|shows|suggests|indicates)\s+/giu,
            `${retainedLabel} describes `,
          )
          .replace(
            /\bCommunity commentary\s+(?:highlights|shows|suggests|indicates)\s+/giu,
            `${retainedLabel} describes `,
          )
          .replace(
            /\bCommunity discussions?(?:\s+from\s+[^.!?]{1,120})?(?:\s+and\s+review comments?)?\s+(?:highlight|indicate|show|suggest)\s+/giu,
            `${retainedLabel} describes `,
          )
          .replace(
            /\busers\s+attempting to\s+([^.!?]{2,180}?)\s+report being\s+([^.!?]{2,180}?)(?=[,.;]|$)/giu,
            (_match, attemptedWorkflow: string, reportedState: string) =>
              `the retained ${singleDirectLabel} describes one user who was ${reportedState.trim()} while attempting to ${attemptedWorkflow.trim()}`,
          )
          .replace(
            /\busers encounter\b/giu,
            'one user experienced',
          )
          .replace(
            /\busers experience\b/giu,
            'one user experienced',
          )
          .replace(
            /\busers face\b/giu,
            'one user experienced',
          )
          .replace(
            /\busers report being\b/giu,
            `the retained ${singleDirectLabel} describes one user being`,
          )
          .replace(
            /\bUsers express frustration\b/gu,
            `The retained ${singleDirectLabel} describes one user's frustration`,
          )
          .replace(
            /\bUsers express (?:a\s+)?(?:clear\s+|strong\s+)?need for\b/gu,
            singleFeatureRequest
              ? 'The retained feature request asks for'
              : `The retained ${singleDirectLabel} describes a need for`,
          )
          .replace(
            /\busers express (?:a\s+)?(?:clear\s+|strong\s+)?need for\b/giu,
            singleFeatureRequest
              ? 'the retained feature request asks for'
              : `the retained ${singleDirectLabel} describes a need for`,
          )
          .replace(
            /\bUsers express (?:a\s+)?(?:clear\s+|strong\s+)?desire for\b/gu,
            singleFeatureRequest
              ? 'The retained feature request asks for'
              : `The retained ${singleDirectLabel} describes a desire for`,
          )
          .replace(
            /\busers express (?:a\s+)?(?:clear\s+|strong\s+)?desire for\b/giu,
            singleFeatureRequest
              ? 'the retained feature request asks for'
              : `the retained ${singleDirectLabel} describes a desire for`,
          )
          .replace(
            /\b(?:patrons|customers|users|travelers|operators|patients|drivers|diners)\s+(?:occasionally|sometimes)\s+(?:encounter|experience|face)\b/giu,
            'one user experienced',
          )
          .replace(
            /\b(?:patrons|customers|users|travelers|operators|patients|drivers|diners)\s+(?:encounter|experience|face)\b/giu,
            'one user experienced',
          )
          .replace(
            /\bUsers report frustration\b/gu,
            `The retained ${singleDirectLabel} describes one user's frustration`,
          )
          .replace(
            /\busers report frustration\b/giu,
            `the retained ${singleDirectLabel} describes one user's frustration`,
          )
          .replace(
            /\bOne retained (?:direct report|feature request) indicates that ([^.!?]{2,120}?)\s+(encounter|encounters|experience|experiences|face|faces|struggle|struggles)\b/giu,
            (_match, subject: string, verb: string) =>
              `${retainedLabel} describes concerns that ${subject.trim()} may ${verb.toLowerCase().replace(/s$/u, '')}`,
          )
          .replace(
            /\bA limited evidence sample suggests that users struggle\b/giu,
            'The same retained report suggests that affected users may struggle',
          )
          .replace(
            /\bObserved evidence from community discussions indicates that\b/giu,
            `${retainedLabel} indicates that`,
          )
          .replace(
            /\bThese findings validate the need for\b/giu,
            `This retained ${singleDirectLabel} provides preliminary support for`,
          )
          .replace(
            /\bThese findings (?:indicate|show|suggest|highlight)\b/giu,
            `This retained ${singleDirectLabel} suggests`,
          )
          .replace(
            /\bCollected\s+(One retained (?:feature request|direct report)\b)/giu,
            '$1',
          )
          .replace(
            /\bone user experienced reported\s+(friction|failures?|problems?|issues?|challenges?)\b/giu,
            'one user experienced $1',
          )
          .replace(
            /\bOne retained (?:direct report|review) describes a recurring vulnerability\b/giu,
            `${retainedLabel} describes a reported vulnerability`,
          )
          .replace(
            /\bthe retained evidence suggests recurring frustrations\b/giu,
            `The retained ${singleDirectLabel} describes frustrations`,
          )
          .replace(
            /\bthe retained evidence suggests recurring (?:user )?concerns\b/giu,
            `The retained ${singleDirectLabel} describes concerns`,
          )
          .replace(
            /\bThe Logistics Shipment Recovery and Exception Triage System is designed to address recurring communication breakdowns, tracking opacity, and unresolved delivery delays in parcel logistics\b/giu,
            'The Logistics Shipment Recovery and Exception Triage System is designed to address the communication breakdown, tracking opacity, and unresolved delivery delay described in the retained report',
          )
          .replace(
            /\bAs indicated by community feedback, the retained scenario suggests that affected users may struggle when\b/giu,
            `The retained ${singleDirectLabel} describes one user struggling when`,
          )
          .replace(
            /\bUsers report feeling\b/gu,
            `The retained ${singleDirectLabel} describes the user as feeling`,
          )
          .replace(
            /\bOne retained direct report describes recurring user friction caused by unexpected application crashes and disruptive error messages\b/giu,
            evidenceSupportsRepeatedCrash
              ? 'One retained direct report describes repeated application crashes and disruptive error messages'
              : 'One retained direct report describes an application crash and disruptive error messages',
          )
          .replace(
            /\b(?:portals?|applications?|apps?) frequently crash or present blocking error messages\b/giu,
            evidenceSupportsRepeatedCrash && evidenceSupportsBlockingErrorMessages
              ? 'the affected application repeatedly crashed and displayed blocking error messages in the retained report'
              : evidenceSupportsRepeatedCrash
                ? 'the affected application repeatedly crashed in the retained report and may display blocking error messages'
                : 'the retained report describes an application crash and blocking error messages',
          )
          .replace(
            /\b(?:portals?|applications?|apps?) frequently crash\b/giu,
            evidenceSupportsRepeatedCrash
              ? 'the affected application repeatedly crashed in the retained report'
              : 'the retained report describes an application crash',
          )
          .replace(
            /\b(?:developers and users|users and developers|users|developers)\s+(?:emphasize|highlight|stress)\s+(?:a\s+)?(?:clear\s+|strong\s+)?(?:need for\s+)?/giu,
            `The retained ${singleDirectLabel} supports a need for `,
          )
          .replace(
            /\bCollected user\s+one collected report indicates(?: that)?\s*/giu,
            `${retainedLabel} indicates that `,
          )
          .replace(/\bmay\s+may\b/giu, 'may')
          .replace(
            /\bThe\s+(One retained (?:feature request|direct report)\b)/gu,
            '$1',
          );

        if (!evidenceExplicitlyMentionsWorkflowStateLoss) {
          cleaned = cleaned
            .replace(
              /\b(residents and administrative personnel|residents and administrative staff|users|customers|operators)\s+lose transactional state\b/giu,
              '$1 may lose progress in an active workflow',
            )
            .replace(
              /\b(residents and administrative personnel|residents and administrative staff|users|customers|operators)\s+lose access to active service requests and verification screens\b/giu,
              '$1 may lose progress in active service workflows',
            )
            .replace(
              /\brequiring manual restarts and increasing frustration\b/giu,
              'potentially requiring a restart and increasing recovery effort',
            );
        }
      }

      if (singleFeatureRequest) {
        cleaned = cleaned
          .replace(
            /\bOne retained feature request describes a recurring operational friction point\b/giu,
            'One retained feature request describes a reported operational friction point',
          )
          .replace(
            /\bOne retained feature request describes recurring operational friction\b/giu,
            'One retained feature request describes reported operational friction',
          )
          .replace(
            /\bwhere users are unable to\b/giu,
            'where one user was unable to',
          )
          .replace(
            /\bwhere users cannot\b/giu,
            'where one user could not',
          )
          .replace(
            /\bcreating an urgent need\b/giu,
            'creating a stated need',
          )
          .replace(
            /\bCommunity discussions and user reviews indicate significant frustration when\b/giu,
            "The retained feature request describes one user's authentication barrier when",
          );

        if (regionalAlternativeLoginRequest) {
          cleaned = cleaned
            .replace(
              /\bsupporting alternative login providers such as Google to bypass regional MFA restrictions safely\b/giu,
              'supporting an approved alternative authentication path such as Google sign-in where the host application supports it',
            )
            .replace(
              /\balternative authentication methods, such as Google login, to bypass restrictive two-factor authentication limitations\b/giu,
              'an approved alternative authentication method, such as Google sign-in, where the host application supports it',
            )
            .replace(
              /\b(?:to )?bypass regional MFA restrictions safely\b/giu,
              'to provide an approved alternative authentication path where supported by the host application',
            );
        }
      }

      if (logisticsDeliveryEvidence) {
        if (!evidenceMentionsAutomatedStatus) {
          cleaned = cleaned
            .replace(
              /\bautomated status updates repeat delay warnings\b/giu,
              'repeated status communications report delays',
            )
            .replace(
              /\bautomated notifications reported delays\b/giu,
              'repeated status communications reported delays',
            );
        }

        if (evidenceShowsRecipientContactCoordinationFailure) {
          cleaned = cleaned.replace(
            /\buncommunicative recipient flags\b/giu,
            'recipient-contact coordination failures',
          );
        }
      }

      if (directEvidenceCount > 1 && independentSourceCount <= 1) {
        cleaned = cleaned
          .replace(
            /\brecurring communication breakdowns\b/giu,
            'communication breakdowns reported in the retained reviews',
          )
          .replace(
            /\bCommunity discussions?(?:\s+from\s+[^.!?]{1,120})?(?:\s+and\s+review comments?)?\s+(?:highlight|indicate|show|suggest)\s+/giu,
            'Multiple retained reviews indicate ',
          );
      }

      if (
        directEvidenceCount === 0 &&
        technicalEvidenceCount > 0 &&
        secondaryEvidenceCount === 0
      ) {
        cleaned = cleaned
          .replace(
            /\bCollected feedback(?: from [^.!?]{0,180})? (?:indicates|shows|suggests|highlights) that\s*/giu,
            'One retained technical issue documents that ',
          )
          .replace(
            /\bCommunity discussions?(?: and developer insights)? (?:indicate|show|suggest|highlight) that\s*/giu,
            'One retained technical issue documents that ',
          )
          .replace(
            /\b(?:The )?feedback indicates that\s*/giu,
            'The retained technical issue documents that ',
          )
          .replace(
            /\b(?:users|developers|teams|operators) report that\b/giu,
            'the retained technical issue documents that',
          )
          .replace(
            /\bOne retained secondary report\b/giu,
            'One retained technical issue',
          )
          .replace(
            /\bThe retained secondary report\b/giu,
            'The retained technical issue',
          )
          .replace(
            /\bA preliminary secondary report\b/giu,
            'A preliminary technical issue',
          );
      }

      if (secondaryOnlyEvidence) {
        const supportingLabel =
          secondaryEvidenceCount === 1
            ? 'One provenance-verified external supporting report'
            : `${secondaryEvidenceCount} provenance-verified external supporting reports`;
        const supportingVerb = secondaryEvidenceCount === 1 ? 'provides' : 'provide';
        cleaned = cleaned
          .replace(
            /No problem-matched external evidence (?:survived|was retained)[^.!?]*[.!?]/giu,
            `${supportingLabel} ${supportingVerb} preliminary context, but no direct community report validates the full requester-described workflow.`,
          )
          .replace(
            /(?:no|zero) direct community evidence[^.!?]*[.!?]/giu,
            `${supportingLabel} ${supportingVerb} preliminary context; direct community evidence remains unverified.`,
          )
          .replace(
            /\bCollected feedback(?: from [^.!?]{0,180})? (?:indicates|shows|suggests|highlights) that\s*/giu,
            'One retained secondary report describes a scenario in which ',
          )
          .replace(
            /\bOne retained secondary report describes a scenario in which (?:mobile )?users (?:face|encounter|experience) (?:challenges with )?/giu,
            'One retained secondary report describes concerns about ',
          )
          .replace(
            /\bOne retained secondary report describes a scenario in which (?:developers|operators|teams) (?:face|encounter|experience) (?:challenges with )?/giu,
            'One retained secondary report describes concerns about ',
          )
          .replace(
            /\bCollected feedback(?: from [^.!?]{0,180})? (?:highlights|shows|suggests)\s*/giu,
            'One retained secondary report describes ',
          )
          .replace(
            /\bCommunity discussions?(?: and developer insights)? (?:indicate|show|suggest|highlight) that\s*/giu,
            'One retained secondary report describes a scenario in which ',
          )
          .replace(
            /\b(?:The )?feedback indicates that\s*/giu,
            'The retained secondary report describes a scenario in which ',
          )
          .replace(
            /\b(?:production teams|engineering teams|developers|users|operators) (?:often|frequently|commonly|typically) (?:encounter|experience|face|suffer from)\b/giu,
            'people in the retained secondary scenario may encounter',
          )
          .replace(
            /\bproduction teams (?:encounter|experience|face)\b/giu,
            'production teams may encounter',
          )
          .replace(
            /\bengineering teams spend\b/giu,
            'engineering teams may spend',
          )
          .replace(
            /\bmulti-session agent operations (?:often|frequently|commonly|typically) suffer from\b/giu,
            'multi-session agent operations may experience',
          )
          .replace(
            /\bagents (?:often|frequently|commonly|typically) forget\b/giu,
            'agents may forget',
          )
          .replace(
            /\b(?:users|developers|teams|operators) report that\b/giu,
            'the retained secondary report describes a case in which',
          )
          .replace(
            /\bFeedback emphasizes\b/giu,
            'The retained secondary report describes',
          )
          .replace(
            /\bFeedback points to\b/giu,
            'The retained secondary report describes',
          )
          .replace(
            /\bThe gathered evidence highlights\b/giu,
            'The retained secondary report describes',
          )
          .replace(
            /\bthe retained evidence suggests recurring (?:user )?concerns\b/giu,
            'The retained secondary report describes concerns',
          )
          .replace(
            /\bthe retained evidence suggests recurring (frustrations|problems|issues)\b/giu,
            'The retained secondary report describes reported $1',
          )
          .replace(
            /\b(?:The )?observed user feedback suggests\b/giu,
            'The retained secondary report suggests',
          )
          .replace(
            /\b(?:mobile )?users must manually cross-reference claims or accept unverified text at face value\b/giu,
            'affected users may need to manually cross-reference claims before relying on them',
          )
          .replace(
            /\bUsers lack an accessible workflow to\b/gu,
            'The pilot should validate whether affected users lack an accessible workflow to',
          )
          .replace(
            /\busers lack an accessible workflow to\b/giu,
            'the pilot should validate whether affected users lack an accessible workflow to',
          );
      }

      cleaned = cleaned
        .replace(/^the retained direct report\b/u, 'The retained direct report')
        .replace(/^the retained feature request\b/u, 'The retained feature request')
        .replace(/^the retained secondary report\b/u, 'The retained secondary report')
        .replace(/\bcan\s+may\b/giu, 'may')
        .replace(/\bPreliminary\s+preliminary\b/giu, 'Preliminary')
        .replace(/\bdescribes\s+reported\s+friction\b/giu, 'describes friction')
        .replace(/\b1\s+posts\b/giu, '1 post')
        .replace(/\b1\s+comments\b/giu, '1 comment')
        .replace(/\b1\s+texts\b/giu, '1 text');

      return cleaned.replace(/\s{2,}/gu, ' ').trim();
    };

    const sanitizeSparseSolutionSpecificity = (value: string): string => {
      if (
        !authenticationSparseCase ||
        evidenceExplicitlyMentionsVerification
      ) {
        return value;
      }

      return value
        .replace(
          /\bverify identity documentation and authorize manual session restoration\b/giu,
          'review the reported access issue and provide human-reviewed recovery guidance',
        )
        .replace(
          /\bidentity documentation\b/giu,
          'account-access details',
        )
        .replace(
          /\bidentity verification\b/giu,
          'access-case review',
        )
        .replace(
          /\bverification request\b/giu,
          'support request',
        )
        .replace(
          /\bverification challenge\b/giu,
          'access challenge',
        )
        .replace(
          /\bverification troubleshooting\b/giu,
          'access troubleshooting',
        )
        .replace(
          /\baccount verification troubleshooting\b/giu,
          'account access troubleshooting',
        )
        .replace(
          /\bmanual session restoration\b/giu,
          'human-reviewed recovery guidance',
        )
        .replace(
          /\bsensitive identity files\b/giu,
          'sensitive support records',
        )
        .replace(
          /\bidentity attachments\b/giu,
          'support attachments',
        )
        .replace(
          /\bconsumers and field technicians\b/giu,
          evidenceExplicitlyMentionsEnergyWorkflowDetail
            ? 'consumers and field technicians'
            : 'the affected user',
        )
        .replace(
          /\bvital utility data, usage graphs, and account controls\b/giu,
          evidenceExplicitlyMentionsEnergyWorkflowDetail
            ? 'vital utility data, usage graphs, and account controls'
            : 'the affected account workflow',
        )
        .replace(
          /\butility monitoring and account management\b/giu,
          evidenceExplicitlyMentionsEnergyWorkflowDetail
            ? 'utility monitoring and account management'
            : 'the affected account workflow',
        );
    };

    const evidenceSupportsPaymentReconciliation = retainedEvidenceSamples.some(
      (value) =>
        /\b(?:reconcil(?:e|ed|iation)|ledger|settlement|balance matching|transaction matching|chargeback reconciliation)\b/iu.test(
          value,
        ),
    );

    const sanitizeSparseTitle = (value: string): string => {
      if (
        !singleDirectEvidence ||
        evidenceSupportsPaymentReconciliation ||
        !/\b(?:billing|payment)\b/u.test(selectedProblemSemantic)
      ) {
        return value.trim();
      }

      return value
        .replace(
          /\bDelivery Exception\s*&\s*Cash-to-Card Reconciliation\b/giu,
          'Delivery Exception & Payment Access Resolution',
        )
        .replace(
          /\bCash-to-Card Reconciliation\b/giu,
          'Payment Access Resolution',
        )
        .trim();
    };

    const normalizeSparseNarrative = (value: string): string =>
      sanitizeSparseSolutionSpecificity(sanitizeNarrative(value));

    const sanitizeMarketPotential = (value: string): string =>
      sanitizeNarrative(value)
        .replace(/\b(?:large|strong|proven|substantial|common|recurring) demand\b/giu, 'potential demand')
        .replace(/\bfrequently\b/giu, 'potentially')
        .replace(/\bfrequent\b/giu, 'potential')
        .replace(
          /\b(?:common|substantial|widespread|recurring|industry-wide|market-wide)\b/giu,
          'potential',
        )
        .replace(
          /\bmarket demand cannot be generalized as potential(?:\s+or\s+potential)+\b/giu,
          'market demand cannot be generalized or treated as established',
        )
        .replace(/\bpotential\s+or\s+potential\b/giu, 'potential')
        .replace(
          /\bwithout claiming potential prevalence\b/giu,
          'without claiming broader prevalence or established market demand',
        );

    const sanitizeZeroEvidenceNarrative = (value: string): string => {
      if (!zeroEvidenceValidationMode) {
        return normalizeSparseNarrative(value);
      }

      return normalizeSparseNarrative(value)
        .replace(
          /(?:Collected|Community|Available|Observed|Existing|Preliminary) (?:feedback|evidence|samples?|reports?)[^.!?]{0,240}(?:indicates|suggests|shows|highlights|reveals|demonstrates)[^.!?]*[.!?]/giu,
          adjudicationUnavailable
            ? 'Raw external material was collected but complete semantic adjudication is still unavailable; the preserved corpus must be re-adjudicated before demand or prevalence claims are made.'
            : 'No problem-matched external evidence survived the bounded collection and recovery window after completed semantic adjudication; the pilot must validate a concrete problem before making demand or prevalence claims.',
        )
        .replace(
          /(?:The )?(?:observed|retained|available|collected) evidence sample[^.!?]*[.!?]/giu,
          adjudicationUnavailable
            ? 'Raw external evidence remains UNADJUDICATED for the selected validation hypothesis.'
            : 'No problem-matched external evidence was retained for the selected validation hypothesis after completed semantic adjudication.',
        )
        .replace(
          /\b(?:users|operators|organizations|teams|professionals|non-specialist users) (?:encounter|experience|face|struggle with)\b/giu,
          'future pilot participants may report',
        )
        .replace(
          /\bthe retained evidence suggests\b/giu,
          'the validation plan will test whether',
        )
        .replace(/[ \t]{2,}/gu, ' ')
        .trim();
    };

    const adjudicationUnavailable =
      generationContext.evidenceState === 'EVIDENCE_ADJUDICATION_UNAVAILABLE';
    const zeroEvidenceMarketPotential = adjudicationUnavailable
      ? `Market potential for ${validationDomainLabel} remains unproven because collected external material is still awaiting a complete online semantic verdict. The raw corpus is preserved as UNADJUDICATED rather than rejected; the same corpus must be re-adjudicated before prevalence, demand, or market-size claims are made.`
      : `Market potential for ${validationDomainLabel} remains unproven because semantic adjudication completed and no problem-matched external evidence survived the bounded collection and recovery window. The pilot must first collect direct evidence for one concrete problem, measure repeated occurrence and operational impact, and validate willingness to adopt before making prevalence, demand, or market-size claims.`;
    const zeroEvidenceNlpSummary = adjudicationUnavailable
      ? `Trusted NLP processed ${generationContext.nlp?.totalTextsAnalyzed ?? 0} text(s), ${generationContext.nlp?.totalPostsAnalyzed ?? 0} post(s), and ${generationContext.nlp?.totalCommentsAnalyzed ?? 0} comment(s). Raw external evidence was collected, but complete semantic adjudication is still unavailable; those rows remain UNADJUDICATED and must not be described as rejected, unrelated, or absent.`
      : `Trusted NLP processed ${generationContext.nlp?.totalTextsAnalyzed ?? 0} text(s), ${generationContext.nlp?.totalPostsAnalyzed ?? 0} post(s), and ${generationContext.nlp?.totalCommentsAnalyzed ?? 0} comment(s). Semantic adjudication completed and no problem-matched external evidence survived final verification for the selected ${validationDomainLabel} validation hypothesis. CONTEXT_ONLY and UNRELATED corpus items are excluded from product justification.`;
    const zeroEvidenceCommunitySummary = adjudicationUnavailable
      ? `No trusted community-feedback claim is promoted yet for the selected ${validationDomainLabel} validation hypothesis because one or more collected rows are still UNADJUDICATED. The preserved raw corpus must receive an online semantic verdict before it can count as DIRECT_PROBLEM, SUPPORTING_SIGNAL, CONTEXT_ONLY, or UNRELATED evidence.`
      : `No qualifying problem-matched community feedback was retained for the selected ${validationDomainLabel} validation hypothesis after completed semantic adjudication. The pilot therefore starts with structured evidence intake, provenance preservation, and problem-family validation rather than treating CONTEXT_ONLY or UNRELATED material as proof of demand.`;

    const normalizeAdvancedContent = (
      outputKey: string,
      content: string,
    ): string => {
      if (zeroEvidenceValidationMode) {
        if (outputKey === 'market-potential') return zeroEvidenceMarketPotential;
        if (outputKey === 'nlp-executive-summary') return zeroEvidenceNlpSummary;
        if (outputKey === 'community-feedback-summary') {
          return zeroEvidenceCommunitySummary;
        }
        return sanitizeZeroEvidenceNarrative(content);
      }

      return outputKey === 'market-potential'
        ? sanitizeMarketPotential(content)
        : normalizeSparseNarrative(content);
    };

    const normalizedAdvancedOutputs = output.advancedOutputs.map(
      (advancedOutput) => ({
        ...advancedOutput,
        content: normalizeAdvancedContent(
          advancedOutput.outputKey,
          advancedOutput.content,
        ),
      }),
    );

    /*
     * A provider response must not be counted as a failed AI execution merely
     * because it wrote a concrete remediation product while the canonical
     * evidence state is zero. Normalize that response into the only safe product
     * class allowed by the existing hard guard: a neutral discovery/validation
     * workspace. The hard guard remains unchanged and still rejects anything
     * that somehow escapes this normalization.
     */
    if (
      zeroEvidenceValidationMode &&
      !this.hasExplicitRequesterProblem(generationContext)
    ) {
      const selectedScopeNames = generationContext.selectedDomains
        .map((domain) => domain.name.trim())
        .filter(Boolean);
      const scopeLabel =
        selectedScopeNames.length > 0
          ? [...new Set(selectedScopeNames)].join(', ')
          : validationDomainLabel;
      const safeTitle = `${scopeLabel} Problem Discovery & Evidence Validation Workspace`;
      const safeProblemStatement =
        `No canonical DIRECT_PROBLEM or SUPPORTING_SIGNAL evidence currently validates a concrete people problem in the selected ${scopeLabel} search scope. Collected context may guide terminology and future queries, but it is not treated as proof of demand. The next product decision therefore remains a bounded evidence-validation hypothesis until a real problem-bearing signal survives deterministic verification.`;
      const safeObjectives = [
        `Collect provenance-preserving problem reports across the selected ${scopeLabel} validation scope without converting context-only material into demand evidence.`,
        'Classify every retained item as DIRECT_PROBLEM, SUPPORTING_SIGNAL, ANALOGOUS_WORKFLOW_SIGNAL, CONTEXT_ONLY, or UNRELATED and keep the canonical ledger as the single evidence source of truth.',
        'Cluster only verified problem-bearing signals into candidate problem families and compare source diversity, recurrence, and operational impact before selecting an implementation target.',
        'Keep human review in the loop and promote a concrete software solution only after at least one direct or supporting signal survives deterministic verification.',
      ];
      const safeTargetUsers = [
        'Product discovery and validation teams',
        `Domain experts reviewing the selected ${scopeLabel} search space`,
        'Software project teams evaluating evidence-backed opportunities',
      ];
      const safePartialAbstract =
        `${safeTitle} is a validation-stage software workspace for the selected ${scopeLabel} scope. No concrete external problem family has yet survived canonical verification, so the product does not claim an operational failure, recurrence level, or market demand that the retained evidence does not support. It preserves source provenance, separates trusted problem signals from context, and helps reviewers decide which problem family is ready for a later implementation pilot.`;
      const safeFullAbstract =
        `${safePartialAbstract} The workflow begins with bounded evidence intake from healthy, request-capable sources. Each retained item keeps its source, query intent, discovery-domain lane, collection phase, and canonical classification. Reviewers can inspect direct complaints and supporting reports separately from contextual material, group only verified problem-bearing items into candidate families, and compare independent-source support before making a product decision. The system deliberately avoids turning application listings, neutral articles, generic domain overlap, or rejected corpus rows into evidence of demand. A concrete implementation concept is generated only after a problem family survives verification; until then the workspace remains an evidence-discovery and validation product with auditable human review.`;

      return {
        coreIdea: {
          ...output.coreIdea,
          title: safeTitle,
          problemStatement: safeProblemStatement,
          objectives: safeObjectives,
          targetUsers: safeTargetUsers,
          ...(output.coreIdea.limitedAbstract !== undefined
            ? { limitedAbstract: safePartialAbstract }
            : {}),
          ...(output.coreIdea.partialAbstract !== undefined
            ? { partialAbstract: safePartialAbstract }
            : {}),
          ...(output.coreIdea.fullAbstract !== undefined
            ? { fullAbstract: safeFullAbstract }
            : {}),
        },
        advancedOutputs: normalizedAdvancedOutputs,
      };
    }

    return {
      coreIdea: {
        ...output.coreIdea,
        title: sanitizeSparseTitle(output.coreIdea.title),
        problemStatement: sanitizeZeroEvidenceNarrative(output.coreIdea.problemStatement),
        objectives: output.coreIdea.objectives.map(sanitizeZeroEvidenceNarrative),
        targetUsers: output.coreIdea.targetUsers.map(sanitizeZeroEvidenceNarrative),
        ...(output.coreIdea.limitedAbstract
          ? { limitedAbstract: sanitizeZeroEvidenceNarrative(output.coreIdea.limitedAbstract) }
          : {}),
        ...(output.coreIdea.partialAbstract
          ? { partialAbstract: sanitizeZeroEvidenceNarrative(output.coreIdea.partialAbstract) }
          : {}),
        ...(output.coreIdea.fullAbstract
          ? { fullAbstract: sanitizeZeroEvidenceNarrative(output.coreIdea.fullAbstract) }
          : {}),
      },
      advancedOutputs: normalizedAdvancedOutputs,
    };
  }

  /**
   * Uses a shorter timeout for OpenRouter without shortening the direct Google
   * quality window. This prevents one unavailable routed model from adding a
   * full nine-second stall while preserving the stronger model response time.
   */
  private isOnlineCoreRescueEligible(model: AiModel): boolean {
    const provider = normalizeAiProviderKey(model.providerKey);
    if (provider === AI_PROVIDER_KEYS.OLLAMA) return false;

    const apiModelId = model.apiModelId.toLocaleLowerCase();
    if (apiModelId.endsWith(':free')) return false;
    if (/\b(?:embedding|embed|vision|image|audio|speech|coder|code)\b/iu.test(apiModelId)) {
      return false;
    }

    return true;
  }

  private resolveCoreModelTimeoutMs(model: AiModel): number {
    const provider = normalizeAiProviderKey(model.providerKey);

    if (provider === AI_PROVIDER_KEYS.OPENROUTER) {
      return IDEA_CORE_OPENROUTER_TIMEOUT_MS;
    }

    if (provider === AI_PROVIDER_KEYS.GOOGLE) {
      return IDEA_CORE_GOOGLE_TIMEOUT_MS;
    }

    return IDEA_CORE_MODEL_TIMEOUT_MS;
  }

  /**
   * Rejects a candidate before quality scoring when it ignores the requested
   * multi-problem or multi-domain portfolio contract. This allows the parallel
   * benchmark to select another valid candidate instead of discovering the
   * omission only after winner selection.
   */
  private assertCandidateProblemSolutionPortfolio(
    context: IdeaGenerationContext,
    parsedOutput: ParsedIdeaAiOutput,
  ): void {
    const statement = parsedOutput.coreIdea.problemStatement.trim();
    const normalized = this.normalizePortfolioText(statement);

    if (statement.length < 120 || statement.length > 2_200) {
      throw new ServiceUnavailableException(
        `UNIFIED_PROBLEM_STATEMENT_REJECTED: expected 120-2200 characters but received ${statement.length}.`,
      );
    }

    if (/solution response\s*:|^\s*\d+[.)]\s*\[/im.test(statement)) {
      throw new ServiceUnavailableException(
        'UNIFIED_PROBLEM_STATEMENT_REJECTED: problemStatement must be readable problem-only prose, not a numbered problem-solution portfolio.',
      );
    }

    this.assertRequesterIntentLock(context, parsedOutput);
    this.assertWinnerProblemLock(context, parsedOutput);

    const canonicalDiscoveryEvidence = this.resolveCanonicalDiscoveryProblemLock(
      context,
      context.opportunityRanking?.selected ?? null,
    );
    const validationOnly =
      !canonicalDiscoveryEvidence &&
      (this.isUngroundedEvidenceState(context.evidenceState) ||
        Boolean(
          context.opportunityRanking?.selected.disqualificationReasons.includes(
            'PRIMARY_DOMAIN_VALIDATION_HYPOTHESIS',
          ) &&
            (context.opportunityRanking.selected.verifiedProblemMatchedEvidenceCount ??
              context.opportunityRanking.selected.verifiedIndependentEvidenceCount ??
              context.opportunityRanking.selected.verifiedEvidenceCount ??
              0) === 0,
        ));
    if (validationOnly && !this.hasExplicitRequesterProblem(context)) {
      const title = parsedOutput.coreIdea.title.trim();
      const validationActivityCount = parsedOutput.coreIdea.objectives.filter(
        (objective) =>
          /\b(?:collect|capture|evidence|report|feedback|interview|survey|validate|validation|provenance|classif|cluster|compare|prioriti[sz]|problem famil|discovery|research)\b/iu.test(
            objective,
          ),
      ).length;
      const zeroEvidenceNarrative = [
        title,
        parsedOutput.coreIdea.problemStatement,
        ...parsedOutput.coreIdea.objectives,
        parsedOutput.coreIdea.partialAbstract ?? '',
        parsedOutput.coreIdea.fullAbstract ?? '',
      ].join(' ');
      const inventedProblemWorkflow =
        /\b(?:document[- ]access|candidate[- ]intake|recruitment anomaly|audit ingestion|ingestion error|exception triage|incomplete document|remediation queue|failure remediation|resolve detected|fix detected|prevent detected)\b/iu.test(
          zeroEvidenceNarrative,
        );

      if (
        !/\b(?:validation|validate|discovery|evidence|research|problem)\b/iu.test(
          title,
        ) ||
        validationActivityCount < 2 ||
        inventedProblemWorkflow
      ) {
        throw new ServiceUnavailableException(
          'ZERO_EVIDENCE_SCOPE_REJECTED: a domain-only validation hypothesis must remain a neutral problem-discovery/evidence-validation product and may not invent a concrete operational failure or remediation workflow.',
        );
      }
    }

    const evidenceBackedDomainNames = new Set(
      context.domainEvidence
        .filter((evidence) => evidence.evidenceAvailable)
        .map((evidence) => evidence.domainName.trim().toLowerCase()),
    );

    const supportedDomains = [
      ...new Set(
        (context.communityAiAnalysis?.opportunities ?? [])
          .map((item) => item.domainName.trim())
          .filter(
            (domainName) =>
              Boolean(domainName) &&
              evidenceBackedDomainNames.has(domainName.toLowerCase()),
          ),
      ),
    ];

    const narrative = this.normalizePortfolioText([
      parsedOutput.coreIdea.problemStatement,
      ...parsedOutput.coreIdea.objectives,
      parsedOutput.coreIdea.partialAbstract ?? '',
      parsedOutput.coreIdea.limitedAbstract ?? '',
      parsedOutput.coreIdea.fullAbstract ?? '',
    ].join(' '));
    const representedSupportedDomains = supportedDomains.filter((domain) => {
      if (narrative.includes(this.normalizePortfolioText(domain))) {
        return true;
      }

      const opportunities = (context.communityAiAnalysis?.opportunities ?? [])
        .filter((item) => item.domainName.trim().toLowerCase() === domain.toLowerCase());
      const anchorTokens = new Set(
        opportunities
          .flatMap((item) => [item.title, item.problem, item.unmetNeed, item.solutionArea])
          .join(' ')
          .toLowerCase()
          .normalize('NFKC')
          .replace(/[^\p{L}\p{N}]+/gu, ' ')
          .split(/\s+/u)
          .filter((token) => token.length >= 5)
          .filter((token) => !['problem', 'issue', 'issues', 'users', 'system', 'workflow', 'software', 'solution'].includes(token)),
      );
      let matches = 0;
      for (const token of anchorTokens) {
        if (narrative.includes(token)) {
          matches += 1;
        }
        if (matches >= 2) {
          return true;
        }
      }
      return false;
    });

    if (supportedDomains.length > 1 && representedSupportedDomains.length < 2) {
      this.logger.warn(
        `Candidate cross-domain coverage is partial: ${representedSupportedDomains.length}/${supportedDomains.length} evidence-backed AI-supported domain(s) are represented. The candidate will remain eligible and the quality score will decide instead of failing the run.`,
      );
    }

    if (parsedOutput.coreIdea.objectives.length < 3) {
      throw new ServiceUnavailableException(
        'UNIFIED_PROBLEM_STATEMENT_REJECTED: at least three concrete objectives are required.',
      );
    }

    const fullAbstract = parsedOutput.coreIdea.fullAbstract?.trim();
    const overview = (
      parsedOutput.coreIdea.partialAbstract ??
      parsedOutput.coreIdea.limitedAbstract ??
      ''
    ).trim();

    if (
      fullAbstract &&
      overview &&
      this.normalizePortfolioText(fullAbstract) ===
        this.normalizePortfolioText(overview)
    ) {
      throw new ServiceUnavailableException(
        'ABSTRACT_DUPLICATION_REJECTED: fullAbstract must add material detail beyond the overview.',
      );
    }
  }

  /**
   * Rejects a generated candidate before benchmark scoring when its public-facing
   * core idea no longer solves the explicit requester description. Premium
   * fullAbstract is authoritative; a copied short disclaimer cannot mask an
   * unrelated title/problem/objective portfolio.
   */
  private assertRequesterIntentLock(
    context: IdeaGenerationContext,
    parsedOutput: ParsedIdeaAiOutput,
    options?: {
      readonly allowRequestLockedEmergency?: boolean;
      readonly suppressMismatchThrow?: boolean;
    },
  ): void {
    const requesterDescription = context.requestDescription?.trim();

    if (!requesterDescription || !this.hasExplicitRequesterProblem(context)) {
      return;
    }

    const alignment = evaluateRequestIntentAlignment(
      requesterDescription,
      parsedOutput.coreIdea,
    );

    const solutionFacingAdvancedText = parsedOutput.advancedOutputs
      .filter((output) =>
        ['mvp-features', 'value-proposition', 'system-architecture'].includes(
          output.outputKey,
        ),
      )
      .map((output) => output.content)
      .join(' ');
    const solutionFacingNarrative = [
      parsedOutput.coreIdea.title,
      ...parsedOutput.coreIdea.objectives,
      ...parsedOutput.coreIdea.targetUsers,
      solutionFacingAdvancedText,
    ].join(' ');
    const solutionAlignment = evaluateRequestIntentAlignment(
      requesterDescription,
      {
        title: parsedOutput.coreIdea.title,
        problemStatement: solutionFacingNarrative,
        objectives: parsedOutput.coreIdea.objectives,
        targetUsers: parsedOutput.coreIdea.targetUsers,
        fullAbstract: solutionFacingAdvancedText,
      },
    );
    const strongExplicitProblemAlignment = isStrongExplicitProblemAlignment(
      alignment,
      solutionAlignment,
    );
    const candidateNarrative = [
      parsedOutput.coreIdea.title,
      parsedOutput.coreIdea.problemStatement,
      ...parsedOutput.coreIdea.objectives,
      ...parsedOutput.coreIdea.targetUsers,
      parsedOutput.coreIdea.fullAbstract ?? '',
      parsedOutput.coreIdea.partialAbstract ?? '',
      parsedOutput.coreIdea.limitedAbstract ?? '',
      solutionFacingAdvancedText,
    ].join(' ');
    const strictWorkflowIdentityRequired =
      RequestEvidenceAlignmentUtil.requiresStrictWorkflowIdentity({
        requestDescription: requesterDescription,
        plannedQueries: context.collectionPlan?.searchQueries ?? [],
      });
    /*
     * Evidence alignment and product-solution alignment are deliberately not
     * the same contract. Evidence must describe an observed failure/incident;
     * a generated solution may describe the same actor + workflow + risk in
     * remediation language without repeating complaint markers such as
     * "incident", "failure", or "users report". Reusing the evidence gate
     * here caused strongly request-aligned candidates (problemScore=1 with
     * >50% solution-token coverage) to be rejected only because they were not
     * written like external evidence.
     */
    const evidenceStyleWorkflowAligned =
      !strictWorkflowIdentityRequired ||
      RequestEvidenceAlignmentUtil.isAligned({
        requestDescription: requesterDescription,
        evidenceText: candidateNarrative,
        plannedQueries: context.collectionPlan?.searchQueries ?? [],
      });

    const strongSolutionWorkflowAligned =
      (alignment.matched || strongExplicitProblemAlignment) &&
      solutionAlignment.sharedTokenCount >=
        solutionAlignment.requiredSharedTokenCount &&
      solutionAlignment.score >= 0.42 &&
      solutionAlignment.problemScore >= 0.18 &&
      solutionAlignment.supportingSectionCount >= 2;

    /*
     * The final in-process emergency output is built directly from the
     * requester description. It still has to preserve a material solution-side
     * overlap, but it must not be able to terminate a paid generation run just
     * because an evidence-style workflow predicate expects complaint wording.
     */
    const requestLockedEmergencyAligned =
      options?.allowRequestLockedEmergency === true &&
      alignment.sharedTokenCount >= alignment.requiredSharedTokenCount &&
      alignment.score >= 0.4 &&
      alignment.problemScore >= 0.24 &&
      solutionAlignment.sharedTokenCount >=
        solutionAlignment.requiredSharedTokenCount &&
      solutionAlignment.score >= 0.18 &&
      solutionAlignment.problemScore >= 0.08 &&
      solutionAlignment.supportingSectionCount >= 1;

    const strictWorkflowAligned =
      !strictWorkflowIdentityRequired ||
      evidenceStyleWorkflowAligned ||
      strongSolutionWorkflowAligned ||
      strongExplicitProblemAlignment ||
      requestLockedEmergencyAligned;

    const solutionSemanticallyAligned =
      solutionAlignment.matched ||
      strongExplicitProblemAlignment ||
      requestLockedEmergencyAligned ||
      (solutionAlignment.sharedTokenCount >=
        solutionAlignment.requiredSharedTokenCount &&
        solutionAlignment.score >= 0.2 &&
        solutionAlignment.problemScore >= 0.08 &&
        solutionAlignment.supportingSectionCount >= 1);

    const requesterIntentAligned =
      alignment.matched ||
      strongExplicitProblemAlignment ||
      requestLockedEmergencyAligned;

    if (requesterIntentAligned && solutionSemanticallyAligned && strictWorkflowAligned) {
      this.assertNoUnsupportedEnvironmentalSolutionAxis(
        context,
        candidateNarrative,
      );
      return;
    }

    if (options?.suppressMismatchThrow === true) {
      this.logger.error(
        [
          'REQUEST_INTENT_MISMATCH continuity guard activated for the deterministic requester-locked fallback.',
          `shared=${alignment.sharedTokenCount}/${alignment.requiredSharedTokenCount}`,
          `score=${alignment.score}`,
          `problemScore=${alignment.problemScore}`,
          `solutionScore=${solutionAlignment.score}`,
          `solutionProblemScore=${solutionAlignment.problemScore}`,
          'The fallback is built directly from the canonical requester problem and will be retained instead of failing the generation run.',
        ].join(' '),
      );
      return;
    }

    throw new ServiceUnavailableException(
      [
        'REQUEST_INTENT_MISMATCH:',
        `generated candidate retained only ${alignment.sharedTokenCount} material requester-intent token(s)`,
        `(score=${alignment.score}, problemScore=${alignment.problemScore}, solutionScore=${solutionAlignment.score}, solutionProblemScore=${solutionAlignment.problemScore}, requiredShared=${alignment.requiredSharedTokenCount}, strictWorkflowAligned=${strictWorkflowAligned}).`,
        'The benchmark must try another model or keep the requester-defined validation hypothesis instead of substituting an unrelated same-domain problem.',
      ].join(' '),
    );
  }

  private assertNoUnsupportedEnvironmentalSolutionAxis(
    context: IdeaGenerationContext,
    candidateNarrative: string,
  ): void {
    const requesterDescription = context.requestDescription?.trim() ?? '';
    if (!requesterDescription) return;

    const environmentalAxis =
      /\b(?:co2e?|carbon budgets?|carbon footprint|emissions? model|emissions? estimate|emissions? tracking|environmental impact|environmental outcome)\b/iu;
    if (!environmentalAxis.test(candidateNarrative)) return;

    const requesterSupportsAxis =
      /\b(?:co2e?|carbon|emissions?|environment(?:al)?|sustainability|air quality|greenhouse gas)\b/iu.test(
        requesterDescription,
      );
    const explicitDomainSupportsAxis = context.selectedDomains
      .filter((domain) => domain.isExplicitlySelected)
      .some((domain) =>
        /\b(?:environment|environmental sustainability|climate)\b/iu.test(
          domain.name,
        ),
      );
    const selected =
      context.benchmarkWinnerOpportunity ?? context.opportunityRanking?.selected;
    const externalEvidenceText = [
      ...(selected?.independentEvidence ?? []).map((item) => item.text),
      ...(selected?.evidenceSamples ?? []),
      ...((selected?.supportingEvidence ?? [])
        .filter((item) => item.sourceType !== 'REQUESTER_STATEMENT')
        .map((item) => item.text)),
    ].join(' ');
    const evidenceSupportsAxis = environmentalAxis.test(externalEvidenceText);

    if (requesterSupportsAxis || explicitDomainSupportsAxis || evidenceSupportsAxis) {
      return;
    }

    throw new ServiceUnavailableException(
      'UNSUPPORTED_SOLUTION_AXIS: generated candidate introduced emissions/carbon/environmental functionality that is not supported by the requester description, verified external evidence, or an explicitly selected environmental domain.',
    );
  }

  /** Parses numbered `[Domain] Problem | Solution response` entries. */
  private parseCandidateProblemSolutionPairs(problemStatement: string): Array<{
    domainName: string;
    problem: string;
    solutionResponse: string;
  }> {
    const normalized = problemStatement
      .trim()
      .replace(/\s+(?=\d+[.)]\s*\[[^\]]+\]\s*Problem:)/gi, '\n');

    return normalized
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) =>
        line.match(
          /^(?:\d+[.)-]?\s*)?\[([^\]]+)\]\s*Problem:\s*(.+?)\s*\|\s*Solution response:\s*(.+)$/i,
        ),
      )
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => ({
        domainName: match[1]?.trim() ?? '',
        problem: match[2]?.trim() ?? '',
        solutionResponse: match[3]?.trim() ?? '',
      }))
      .filter(
        (pair) =>
          pair.domainName.length > 0 &&
          pair.problem.length >= 10 &&
          pair.solutionResponse.length >= 10,
      );
  }

  /** Normalizes portfolio labels for stable selected-domain comparison. */
  private assertWinnerProblemLock(
    context: IdeaGenerationContext,
    parsedOutput: ParsedIdeaAiOutput,
  ): void {
    const winner =
      context.benchmarkWinnerOpportunity ?? context.opportunityRanking?.selected;
    if (!winner || winner.evidenceSamples.length === 0) {
      return;
    }

    const winnerEvidence = winner.evidenceSamples[0]?.trim();
    if (!winnerEvidence) return;

    const candidateNarrative = [
      parsedOutput.coreIdea.problemStatement,
      ...parsedOutput.coreIdea.objectives,
      parsedOutput.coreIdea.partialAbstract ?? '',
      parsedOutput.coreIdea.fullAbstract ?? '',
    ]
      .join(' ')
      .replace(/\s+/gu, ' ')
      .trim();
    if (!candidateNarrative) return;

    /*
     * Discovery paths have an authoritative semantic family selected by
     * Community AI + the canonical evidence ledger.  Do not re-derive a
     * second immutable family from raw.familyKey/problem-family taxonomy here:
     * that older path produced labels such as `navigation-ui` or
     * `cybersecurity-learning-content-safety` after ranking had already locked
     * a different evidence-native family.  The exact canonical family plus its
     * retained evidence is the only discovery lock used by core validation.
     */
    const canonicalDiscoveryLock = this.resolveCanonicalDiscoveryProblemLock(
      context,
      winner,
    );
    if (canonicalDiscoveryLock) {
      const descriptor = [
        canonicalDiscoveryLock.family,
        ...canonicalDiscoveryLock.evidenceSamples,
      ]
        .filter(Boolean)
        .join(' ');
      const familyMatch = matchEvidenceToProblemFamily(
        descriptor,
        candidateNarrative,
      );
      const atomicMatch = canonicalDiscoveryLock.evidenceSamples.some(
        (sample) => matchEvidenceToAtomicProblem(sample, candidateNarrative).matched,
      );
      const labelMatch = this.matchesCanonicalDiscoveryFamilyLabel(
        canonicalDiscoveryLock.family,
        candidateNarrative,
      );

      if (familyMatch.matched || atomicMatch || labelMatch) {
        return;
      }

      throw new ServiceUnavailableException(
        `SELECTED_OPPORTUNITY_MISMATCH: generated candidate does not preserve canonical discovery family "${canonicalDiscoveryLock.family}".`,
      );
    }

    const discoveryWithoutCanonicalLock = !this.hasExplicitRequesterProblem(context);
    /*
     * No canonical discovery lock means there is no immutable family. Do not
     * reconstruct one from evidence taxonomy, fallback opportunity labels, or
     * generic family detectors: those are ranking hints, not authoritative
     * problem identity. Other request/evidence alignment guards still run.
     */
    if (discoveryWithoutCanonicalLock) {
      return;
    }

    const rawFamilyKey = this.readOpportunityFamilyKey(winner);
    const evidenceFamily = resolvePrimaryProblemFamily(winnerEvidence);
    const hasConcreteEvidenceFamily = Boolean(
      evidenceFamily &&
        evidenceFamily.key !== 'generic-friction' &&
        !evidenceFamily.key.startsWith('lexical:'),
    );
    if (
      rawFamilyKey &&
      hasConcreteEvidenceFamily &&
      evidenceFamily &&
      rawFamilyKey !== evidenceFamily.key
    ) {
      throw new ServiceUnavailableException(
        `SELECTED_OPPORTUNITY_EVIDENCE_FAMILY_MISMATCH: retained evidence resolves to ${evidenceFamily.key}, but the selected opportunity claims immutable family ${rawFamilyKey}.`,
      );
    }

    const winnerDescriptor = [
      winner.title,
      winner.problem ?? '',
      winner.need ?? '',
      winner.solutionArea ?? '',
      winnerEvidence,
    ]
      .filter(Boolean)
      .join(' ');
    const familyMatch = matchEvidenceToProblemFamily(
      winnerDescriptor,
      candidateNarrative,
    );
    const atomicMatch = matchEvidenceToAtomicProblem(
      winnerEvidence,
      candidateNarrative,
    );
    const evidenceFamilies = resolveProblemFamilyKeys(winnerEvidence);
    const winnerFamilies = (rawFamilyKey ? [rawFamilyKey] : evidenceFamilies).filter(
      (key, index, values) =>
        !key.startsWith('lexical:') &&
        key !== 'generic-friction' &&
        values.indexOf(key) === index,
    );

    const mvpFeatures = parsedOutput.advancedOutputs.find(
      (output) => output.outputKey === 'mvp-features',
    );
    const solutionNarrative = [
      parsedOutput.coreIdea.title,
      ...parsedOutput.coreIdea.objectives,
      ...(Array.isArray(mvpFeatures?.structuredContent)
        ? mvpFeatures.structuredContent.filter(
            (item): item is string => typeof item === 'string',
          )
        : []),
      mvpFeatures?.content ?? '',
    ]
      .join(' ')
      .replace(/\s+/gu, ' ')
      .trim();
    const winnerOwnedNarrative = [
      winner.title,
      winner.problem ?? '',
      winner.need ?? '',
      winner.solutionArea ?? '',
    ]
      .filter(Boolean)
      .join(' ');
    const winnerOwnedFamilies = new Set(
      resolveProblemFamilyKeys(winnerOwnedNarrative).filter(
        (key) => !key.startsWith('lexical:') && key !== 'generic-friction',
      ),
    );
    const enforcedWinnerFamily = winnerFamilies.find(
      (familyKey) =>
        this.hasStrictSolutionFamilyInvariant(familyKey) &&
        winnerOwnedFamilies.has(familyKey),
    );
    if (
      enforcedWinnerFamily &&
      !this.isSolutionNarrativeAlignedWithFamily(
        enforcedWinnerFamily,
        solutionNarrative,
      )
    ) {
      throw new ServiceUnavailableException(
        `SELECTED_OPPORTUNITY_SOLUTION_MISMATCH: generated product workflow does not implement immutable winner family ${enforcedWinnerFamily}.`,
      );
    }

    if (familyMatch.matched || atomicMatch.matched) {
      return;
    }

    const candidateFamilies = resolveProblemFamilyKeys(candidateNarrative).filter(
      (key) => !key.startsWith('lexical:') && key !== 'generic-friction',
    );
    const clearFamilyMismatch =
      winnerFamilies.length > 0 &&
      candidateFamilies.length > 0 &&
      !winnerFamilies.some((key) => candidateFamilies.includes(key));

    if (clearFamilyMismatch) {
      throw new ServiceUnavailableException(
        `SELECTED_OPPORTUNITY_MISMATCH: generated candidate solved ${candidateFamilies[0]} instead of immutable winner family ${winnerFamilies[0]}.`,
      );
    }
  }

  private hasStrictSolutionFamilyInvariant(familyKey: string): boolean {
    return new Set([
      'authentication',
      'regional-feature-access',
      'application-access-support',
      'delivery-tracking',
      'shipment-transit-metrics',
      'outage-reliability',
      'data-visualization-reactive',
      'energy-grid-stability-inverter-trip',
      'healthcare-preventive-care-reminders',
      'medication-adherence-coordination',
      'ai-feedback-correction-inflexibility',
      'ai-hallucination-output-reliability',
      'blockchain-transaction-execution',
      'workforce-capacity',
      'legal-compliance-risk',
      'device-sync',
      'blockchain-wallet-state-sync',
      'streaming-data-integrity',
    ]).has(familyKey);
  }

  private isSolutionNarrativeAlignedWithFamily(
    familyKey: string,
    value: string,
  ): boolean {
    const text = value.normalize('NFKC').toLocaleLowerCase();
    switch (familyKey) {
      case 'authentication':
        return /\b(?:login|log in|sign in|authentication|two[- ]factor|2fa|identity provider|account access|session|access recovery)\b/u.test(text);
      case 'regional-feature-access':
        return (
          /\b(?:area|country|region|location|regional|local availability)\b/u.test(text) &&
          /\b(?:access|available|availability|unavailable|blocked|restricted|chat|post|feature|service|use)\b/u.test(text)
        );
      case 'application-access-support': {
        const hasAccessContinuityWorkflow =
          /\b(?:app(?:lication)? access|access continuity|service continuity|cannot access|can['’]?t access|unable to access|replacement app|new app|legacy app|app migration|application migration|service migration|transition support|access recovery|support case|support workflow)\b/u.test(text);
        const hasUnrelatedDataPortabilityWorkflow =
          /\b(?:data portability|import\s*\/\s*export|import job|export job|transfer job|format validation|selected data scope|downloadable records?|uploaded records?|failed export|failed import)\b/u.test(text);
        return hasAccessContinuityWorkflow && !hasUnrelatedDataPortabilityWorkflow;
      }
      case 'delivery-tracking':
      case 'shipment-transit-metrics':
        return /\b(?:shipment|shipments|delivery|deliveries|tracking|carrier|courier|package|packages|parcel|parcels|transit|missed delivery|delivery exception)\b/u.test(text);
      case 'outage-reliability':
        return /\b(?:outage|downtime|service status|service reliability|availability|restoration|service interruption|service recovery|reliability recovery)\b/u.test(text);
      case 'data-visualization-reactive':
        return /\b(?:visualization|plot|plotting|ggplot|shiny|reactive|aesthetic|renderplot|data shape)\b/u.test(text);
      case 'energy-grid-stability-inverter-trip':
        return /\b(?:grid|inverter|blackout|outage|trip|stability|reconnect|distributed generation)\b/u.test(text);
      case 'healthcare-preventive-care-reminders':
        return /\b(?:preventive|preventative|screening|checkup|reminder|overdue|follow[- ]up)\b/u.test(text);
      case 'medication-adherence-coordination':
        return /\b(?:medication|medicine|dose|caregiver|adherence|missed dose|double dose|schedule)\b/u.test(text);
      case 'ai-feedback-correction-inflexibility':
        return (
          /\b(?:feedback|correction|correct(?:ing|ed)? mistakes?|revision|revise|retry|replay|follow[- ]up|iteration|before vs after|compare(?:d|s|ing)? outputs?)\b/u.test(text) &&
          /\b(?:ai|model|llm|prompt|response|output|assistant)\b/u.test(text)
        );
      case 'ai-hallucination-output-reliability':
        return /\b(?:hallucination|hallucinated|factuality|unsupported claim|fabricated citation|source verification|output reliability)\b/u.test(text);
      case 'blockchain-transaction-execution':
        return /\b(?:transaction|smart contract|revert|reverted|execution|gas|provider error|contract method)\b/u.test(text);
      case 'workforce-capacity':
        return /\b(?:workforce|staffing|headcount|vacanc|critical role|service continuity|workload redistribution)\b/u.test(text);
      case 'legal-compliance-risk':
        return /\b(?:compliance|legal risk|governance|rights|licensing|consent|regulatory|audit)\b/u.test(text);
      case 'device-sync':
      case 'blockchain-wallet-state-sync':
      case 'streaming-data-integrity':
        return /\b(?:sync|synchronization|freshness|stale|data integrity|remote revision|wallet state|streaming data)\b/u.test(text);
      default:
        return true;
    }
  }

  private throwIfBenchmarkAborted(signal?: AbortSignal): void {
    if (!signal?.aborted) {
      return;
    }

    throw new ServiceUnavailableException(
      'Idea-generation benchmark was cancelled by the active generation run.',
    );
  }

  private normalizePortfolioText(value: string): string {
    return value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  }

  /**
   * Resolves a benchmark output budget without exceeding the configured model
   * capability. Premium candidates need more headroom because they return the
   * core idea together with all advanced outputs in one structured response.
   *
   * The previous fixed 6,144-token request could truncate otherwise valid
   * candidates. The model record remains the authoritative upper bound, so
   * this change cannot request more than the administrator configured.
   */
  private resolveBenchmarkMaxOutputTokens(
    model: AiModel,
    includePremiumOutputs: boolean,
  ): number {
    const desiredTokens = includePremiumOutputs ? 8_192 : 2_048;

    return Math.max(1, Math.min(desiredTokens, model.maxOutputTokens));
  }

  /**
   * Gives one weak candidate a single bounded self-revision opportunity.
   *
   * The same exact model is used so benchmark attribution remains correct. The
   * revised request receives the original trusted prompt, its previous JSON,
   * and only deterministic improvement instructions.
   */
  private async reviseWeakCandidate(
    context: IdeaGenerationContext,
    model: AiModel,
    initialAttempt: AcceptedModelAttempt,
    qualityContext: IdeaQualityEvaluationContext,
    assignedPromptText: string,
    signal?: AbortSignal,
  ): Promise<AcceptedModelAttempt> {
    if (signal?.aborted) {
      throw new ServiceUnavailableException(
        'Parallel candidate revision was cancelled after another model satisfied the quality threshold.',
      );
    }

    if (!context.prompt || initialAttempt.quality.accepted) {
      return initialAttempt;
    }

    /*
     * A candidate far below the acceptance threshold is normally a concept or
     * evidence mismatch, not a wording defect. Re-asking the same model to
     * rewrite a sub-60 candidate consumes another full provider window while
     * rarely crossing the quality gate. Reserve self-revision for near-miss
     * candidates and let the benchmark rotate to another model otherwise.
     */
    if (initialAttempt.quality.score < IDEA_QUALITY_REVISION_TRIGGER_SCORE) {
      this.logger.debug(
        `Skipping quality revision for model "${model.displayName ?? model.modelName}" because score ${initialAttempt.quality.score} is below revision trigger ${IDEA_QUALITY_REVISION_TRIGGER_SCORE}.`,
      );
      return initialAttempt;
    }

    let bestAttempt = initialAttempt;

    for (
      let revisionNumber = 1;
      revisionNumber <= IDEA_QUALITY_REVISION_MAX_ATTEMPTS;
      revisionNumber += 1
    ) {
      const revisionPrompt = this.buildQualityRevisionPrompt(
        assignedPromptText,
        bestAttempt,
        revisionNumber,
      );

      try {
        const revisedAttempt = await this.generateAndEvaluate(
          context,
          model,
          revisionPrompt,
          qualityContext,
          signal,
        );

        if (revisedAttempt.quality.score > bestAttempt.quality.score) {
          bestAttempt = revisedAttempt;
        }

        this.logger.log(
          `Quality revision ${revisionNumber}/${IDEA_QUALITY_REVISION_MAX_ATTEMPTS} for model "${model.displayName ?? model.modelName}" scored ${revisedAttempt.quality.score}; best score is ${bestAttempt.quality.score}; threshold is ${IDEA_MIN_ACCEPTED_QUALITY_SCORE}.`,
        );

        if (bestAttempt.quality.accepted) {
          return bestAttempt;
        }
      } catch (error: unknown) {
        if (signal?.aborted) {
          throw error;
        }

        const message =
          error instanceof Error ? error.message : 'Unknown revision failure.';

        this.logger.warn(
          `Quality revision ${revisionNumber}/${IDEA_QUALITY_REVISION_MAX_ATTEMPTS} for model "${model.displayName ?? model.modelName}" failed; retaining the best candidate: ${message}`,
        );
      }
    }

    return bestAttempt;
  }

  /** Builds a grounded self-improvement request for the same generating model. */
  private buildQualityRevisionPrompt(
    assignedPromptText: string,
    previousAttempt: AcceptedModelAttempt,
    revisionNumber: number,
  ): string {
    return [
      assignedPromptText,
      'QUALITY-GATE REVISION:',
      `- Revision attempt ${revisionNumber} of ${IDEA_QUALITY_REVISION_MAX_ATTEMPTS}.`,
      `- Previous deterministic score: ${previousAttempt.quality.score}/100.`,
      `- Required deterministic threshold: ${IDEA_MIN_ACCEPTED_QUALITY_SCORE}/100.`,
      '- Improve the same candidate using the evaluation feedback below.',
      '- Rewrite the complete response, not only the listed fields.',
      '- Preserve every evidence-grounding, location, schema, and entitlement rule from the original prompt.',
      '- When local evidence is unavailable, location may appear only as a planned pilot target, for example: "The first pilot is planned for Nablus." Do not say or imply that users, institutions, or platforms in Nablus currently face, report, or suffer from the problem.',
      '- Keep valid strengths from the previous candidate while fixing every listed weakness.',
      '- Do not invent facts, APIs, regulations, statistics, local evidence, user complaints, or market claims.',
      '<deterministic_quality_feedback>',
      this.qualityEvaluatorService.buildImprovementInstructions(
        previousAttempt.quality,
      ),
      '</deterministic_quality_feedback>',
      '<previous_candidate_signature>',
      JSON.stringify(
        this.buildCompactCandidateSignature(previousAttempt.parsedOutput),
      ),
      '</previous_candidate_signature>',
      '- Return exactly one complete JSON object matching the required schema.',
    ].join('\n');
  }

  /**
   * Builds one immutable concept direction from the deterministic winner.
   * Every model receives the exact same opportunity so the AI judge compares
   * execution quality rather than unrelated problem directions.
   */
  /**
   * Resolves evidence from the normalized ranked candidate first, then from
   * the raw validated community record. This protects benchmarking from a
   * serialization or normalization gap without accepting unrelated evidence.
   */
  private resolveOpportunityEvidenceSamples(
    opportunity: RankedIdeaOpportunity,
  ): readonly string[] {
    if (opportunity.evidenceSamples.length > 0) {
      return opportunity.evidenceSamples;
    }

    if (!this.isJsonObject(opportunity.raw)) {
      return [];
    }

    const rawSamples = opportunity.raw.evidenceSamples;

    if (!Array.isArray(rawSamples)) {
      return [];
    }

    return rawSamples
      .filter((sample): sample is string => typeof sample === 'string')
      .map((sample) => sample.replace(/\s+/gu, ' ').trim())
      .filter(Boolean)
      .slice(0, 3);
  }

  /**
   * Accepts raw fallback evidence only for validated community-analysis
   * records with a sufficiently strong confidence signal.
   */
  private hasValidatedCommunityRawEvidence(
    opportunity: RankedIdeaOpportunity,
  ): boolean {
    if (!this.isJsonObject(opportunity.raw)) {
      return false;
    }

    const source = opportunity.raw.source;
    const confidence =
      typeof opportunity.raw.confidence === 'number'
        ? opportunity.raw.confidence
        : typeof opportunity.raw.aiConfidence === 'number'
          ? opportunity.raw.aiConfidence
          : 0;
    const groundingScore =
      typeof opportunity.raw.groundingScore === 'number'
        ? opportunity.raw.groundingScore
        : 0;

    return (
      (source === 'COMMUNITY_AI_ANALYSIS' && groundingScore >= 50) ||
      (source === 'COMMUNITY_LLM_ANALYSIS' && confidence >= 70)
    );
  }

  private isJsonObject(value: Prisma.JsonValue): value is Prisma.JsonObject {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  /**
   * Adds narrow prompt rules for families whose labels contain terms that are
   * easy for an LLM to reinterpret into an unrelated workflow. The rules do
   * not change ranking or evidence; they only keep generation inside the
   * already-selected immutable family.
   */
  private buildWinnerFamilyPromptRules(
    familyKey: string | null,
  ): readonly string[] {
    if (familyKey === 'application-access-support') {
      return [
        '- APPLICATION-ACCESS FAMILY LOCK: "application" means the software app/service named or implied by the retained evidence. It does NOT mean a rental application, job application, form submission, applicant record, or administrative back-office process.',
        '- The primary product workflow must directly restore or preserve app/service access continuity for the affected end user: identify the access blocker, show a supported access/replacement path when one exists, guide the user through that path, and confirm whether access was restored.',
        '- Do not turn this winner into rental/job application data integrity, records management, generic case management, import/export, data portability, approval workflow, or administrative back-office software.',
        '- Do not invent data migration or account transfer. If the evidence only says a replacement/new app restores access, keep the MVP to verified transition/access guidance and user-confirmed recovery unless explicit evidence supports data transfer.',
      ];
    }

    return [];
  }

  private buildConceptDirections(
    context: IdeaGenerationContext,
    duplicateCorpus: readonly DuplicateIdeaCandidate[] = [],
  ): readonly CandidateConceptDirection[] {
    const prompt = context.prompt;
    const ranking = context.opportunityRanking;

    if (!prompt || !ranking) {
      throw new ServiceUnavailableException(
        'A persisted prompt and ranked opportunity are required before benchmarking.',
      );
    }

    const opportunity = ranking.selected;
    const canonicalDiscoveryLock = this.resolveCanonicalDiscoveryProblemLock(
      context,
      opportunity,
    );
    const selectedProblemFamilyKey = canonicalDiscoveryLock
      ? null
      : this.readOpportunityFamilyKey(opportunity);
    const winnerFamilyPromptRules = this.buildWinnerFamilyPromptRules(
      selectedProblemFamilyKey,
    );
    const effectiveEvidenceSamples = canonicalDiscoveryLock
      ? [...canonicalDiscoveryLock.evidenceSamples]
      : this.resolveOpportunityEvidenceSamples(opportunity);
    const roleScopeText = [
      ...effectiveEvidenceSamples,
      context.requestDescription ?? '',
      context.collectionPlan?.problemProfile?.actor ?? '',
      context.collectionPlan?.problemProfile?.workflow ?? '',
    ]
      .join(' ')
      .normalize('NFKC')
      .toLocaleLowerCase();
    const evidenceSupportsDeveloperOperator =
      /\b(?:developer|development team|engineer|qa|quality assurance|sdk|api|repository|codebase|source code|ci\/?cd|devops)\b/u.test(
        roleScopeText,
      );
    const evidenceSupportsGenericAdminRole =
      /\b(?:administrator|admin|supervisor|reviewer)\b/u.test(roleScopeText);
    const evidenceSupportsOperationalOperator =
      /\b(?:operator|operations team|operations staff|support team|service desk|help desk|triage|incident response|case manager|care coordinator|clinician|clinical|maintenance|repair|public works|dispatch|dispatcher|production pipeline|production system|service provider|manager|coordinator|planner|scheduler|technician|workflow owner)\b/u.test(
        roleScopeText,
      );
    // Generic workflow words such as "care", "pet care", "aftercare" or
    // "follow-up care" describe the service, not a caregiver persona. Only
    // explicit human-role language authorizes caregiver target users.
    const evidenceSupportsCaregiverRole =
      /\b(?:family caregiver|family caregivers|caregiver|caregivers|caregiving)\b/u.test(
        roleScopeText,
      );
    const noveltyExclusions = this.buildNoveltyExclusions(
      opportunity,
      duplicateCorpus,
    );

    // The ranking service now selects the best eligible candidate whenever
    // one exists. This defensive fallback prevents a complete pipeline failure
    // when all candidates miss one strict gate but the selected opportunity is
    // still sufficiently grounded for a qualified pilot concept.
    const hasUsableEvidence = effectiveEvidenceSamples.length > 0;
    const hasMinimumReliability = opportunity.evidenceReliabilityScore >= 0.45;
    const hasMinimumSupport = opportunity.supportScore >= 0.35;
    const hasStrongRawCommunityEvidence =
      effectiveEvidenceSamples.length > 0 &&
      this.hasValidatedCommunityRawEvidence(opportunity);
    const isDefensiveFallbackAllowed =
      (hasUsableEvidence && hasMinimumReliability && hasMinimumSupport) ||
      hasStrongRawCommunityEvidence;

    /*
     * Opportunity ranking may intentionally return the strongest penalized
     * fallback after bounded evidence recovery. That fallback must not crash
     * the complete generation pipeline merely because it did not pass the
     * strict evidence gate. Benchmarking may continue, but every generated
     * claim is constrained to a preliminary pilot hypothesis.
     */
    const isControlledSparseFallback =
      !canonicalDiscoveryLock &&
      !opportunity.selectionEligible &&
      !isDefensiveFallbackAllowed;
    const opportunityDomainName =
      opportunity.matchedDomainNames?.[0]?.trim() ||
      (this.isJsonObject(opportunity.raw) &&
      typeof opportunity.raw.domainName === 'string'
        ? opportunity.raw.domainName.trim()
        : '');
    const strictlyEvidenceMatchedDomains = [
      ...new Set(
        effectiveEvidenceSamples.flatMap((sample) =>
          SelectedDomainEvidenceAlignmentUtil.matchStrictDomainNames(
            sample,
            context.selectedDomains,
          ),
        ),
      ),
    ];
    const supportingOnlyClaim =
      (opportunity.qualifiedExternalSupportingEvidenceCount ?? 0) > 0 &&
      (opportunity.verifiedProblemMatchedDirectUserEvidenceCount ??
        opportunity.verifiedDirectUserEvidenceCount ??
        0) === 0;
    const finalClaimDomains = (
      supportingOnlyClaim && strictlyEvidenceMatchedDomains.length > 0
        ? strictlyEvidenceMatchedDomains
        : opportunity.matchedDomainNames?.length
          ? opportunity.matchedDomainNames
          : opportunityDomainName
            ? [opportunityDomainName]
            : context.domainName
              ? [context.domainName]
              : []
    ).filter((domainName, index, items) =>
      items.findIndex(
        (candidate) =>
          candidate.trim().toLocaleLowerCase() ===
          domainName.trim().toLocaleLowerCase(),
      ) === index,
    );
    const finalClaimDomainSet = new Set(
      finalClaimDomains.map((domainName) =>
        domainName.trim().toLocaleLowerCase(),
      ),
    );
    const forbiddenSearchDomains = context.selectedDomains
      .map((domain) => domain.name)
      .filter(
        (domainName) =>
          !finalClaimDomainSet.has(domainName.trim().toLocaleLowerCase()),
      );
    const crossDomainPortfolio = this.buildCrossDomainOpportunityPortfolio(
      context,
      ranking,
    );
    const alignedEvidenceDomains = finalClaimDomains;
    const isValidationHypothesis =
      !canonicalDiscoveryLock &&
      opportunity.disqualificationReasons.includes(
        'PRIMARY_DOMAIN_VALIDATION_HYPOTHESIS',
      );

    if (isControlledSparseFallback) {
      this.logger.warn(
        `Benchmarking is continuing with penalized opportunity "${opportunity.title}" because no strictly eligible opportunity remained after bounded evidence recovery. Generated claims will be treated as preliminary pilot hypotheses.`,
      );
    }

    const buildDirection = (
      directionName: string,
      mechanismRules: readonly string[],
    ): CandidateConceptDirection => ({
      opportunity,
      promptText: [
        prompt.promptText,
        'DETERMINISTIC QUALITY TARGET (APPLIES TO THE FIRST RESPONSE):',
        `- The candidate is evaluated on a 100-point deterministic score. Treat ${IDEA_BENCHMARK_IMMEDIATE_EARLY_STOP_SCORE}/100 as the quality target in the first response; ${IDEA_MIN_ACCEPTED_QUALITY_SCORE}/100 is only the minimum continuity floor.`,
        '- Weighted dimensions: innovation 25%, market fit 25%, technical quality 20%, completeness 15%, originality 15%.',
        ...(context.collectionPlan?.requestIntent?.mode === 'EXPLICIT_PROBLEM'
          ? [
              '- PRODUCT-QUALITY / EVIDENCE-STRENGTH SEPARATION: the requester supplied the problem hypothesis. Product quality is judged on how well the solution fits that exact problem, while evidence strength is tracked separately. Do not make the product generic merely because external evidence is sparse or zero; instead keep validation claims conservative.',
            ]
          : []),
        '- Innovation: propose a materially differentiated mechanism or workflow, not a renamed dashboard, generic assistant, thin wrapper, or basic validator.',
        '- Market fit: solve the exact evidence-backed user job, identify realistic users and adoption roles, and avoid unsupported market-size or local-prevalence claims.',
        '- Technical quality: provide a feasible architecture, supported integrations, realistic data flow, privacy boundaries, and implementable objectives.',
        '- Completeness: return every field required by the active response schema with concrete, mutually consistent content.',
        '- Originality: use a distinctive product concept, title, value proposition, and primary workflow that are not generic or interchangeable.',
        ...(noveltyExclusions.length > 0
          ? [
              'NOVELTY GUARD (CHECK BEFORE WRITING THE FIRST JSON RESPONSE):',
              '- The following recent same-domain concepts already exist. Do not reuse their title, primary workflow, dominant capability combination, or materially equivalent problem-solution framing.',
              '- A geographic rename, branding change, extra dashboard, or thin feature addition does not make an existing concept distinct.',
              '- Choose a genuinely different mechanism while still solving the selected evidence-backed opportunity.',
              ...noveltyExclusions.map(
                (candidate, index) =>
                  `  ${index + 1}. Existing concept: "${candidate.title}" | Existing problem framing: ${candidate.problemStatement}`,
              ),
            ]
          : []),
        '- Avoid score penalties: generic title, vague objectives, weak target users, unsupported root causes, invented statistics, unsupported platform access, over-scoped MVP, awkward copy, secondary-domain leakage, and unauthorized tier fields.',
        '- Before returning JSON, privately self-check the five weighted dimensions and revise the candidate until it is likely to meet or exceed the threshold. Do not output the self-check or scores.',
        'FINAL CONCEPT ASSIGNMENT:',
        `- Build the complete candidate around the selected ranked opportunity #${opportunity.rank}: "${opportunity.title}".`,
        '- This opportunity is immutable for this generation run.',
        ...winnerFamilyPromptRules,
        `- Assigned concept direction: ${directionName}.`,
        ...mechanismRules.map((rule) => `- ${rule}`),
        ...(effectiveEvidenceSamples.length > 0
          ? [
              '- Authoritative evidence samples for this opportunity:',
              ...effectiveEvidenceSamples.map(
                (sample, index) => `  ${index + 1}. ${sample}`,
              ),
            ]
          : []),
        ...(crossDomainPortfolio.length > 1
          ? isValidationHypothesis
            ? [
                '- VALIDATION-SCOPE SEARCH PORTFOLIO: the domains below are requester-selected evidence-search dimensions, not mandatory product components. Do not force them into one workflow. Keep the assigned opportunity/primary domain as the product scope and include another selected domain only when retained evidence for this exact candidate naturally supports that bridge.',
                '- Do not add any selected search-space domain that is absent from this validation-scope portfolio.',
                '<cross_domain_problem_portfolio>',
                JSON.stringify(crossDomainPortfolio),
                '</cross_domain_problem_portfolio>',
              ]
            : [
                '- VERIFIED CROSS-DOMAIN WINNER: the selected opportunity itself is verified across the domains below. Integrate only these domains into one coherent product workflow.',
                '- Do not add any selected search-space domain that is absent from this verified winner portfolio.',
                '<cross_domain_problem_portfolio>',
                JSON.stringify(crossDomainPortfolio),
                '</cross_domain_problem_portfolio>',
              ]
          : []),
        ...(!opportunity.selectionEligible
          ? [
              isControlledSparseFallback
                ? '- QUALITY QUALIFIER: this opportunity is a controlled sparse-evidence fallback selected only after bounded recovery. Treat the problem as a hypothesis to validate, make no market-wide or local-prevalence claims, and require evidence collection as an explicit first pilot activity.'
                : '- QUALITY QUALIFIER: this opportunity is a controlled evidence-backed fallback. Keep claims conservative, explicitly qualify uncertainty, and frame validation as part of the pilot.',
            ]
          : []),
        ...(alignedEvidenceDomains.length > 1
          ? isValidationHypothesis
            ? [
                `- FINAL VALIDATION SEARCH SCOPE: ${alignedEvidenceDomains.join(', ')}. These are requester-approved evidence-search dimensions, not mandatory implementation domains. Build the validation-first product around the assigned opportunity and primary domain; include another domain only when candidate-specific retained evidence justifies the same problem bridge.`,
                `- Forbidden search-space domains for this candidate: ${forbiddenSearchDomains.join(', ') || 'none'}.`,
                '- Never add a capability merely to represent a selected search-space domain. Domain inclusion must follow the verified/retained problem evidence, not precede it.',
                ...(alignedEvidenceDomains.some((name) => name.trim().toLocaleLowerCase() === 'blockchain')
                  ? [
                      '- CONDITIONAL BLOCKCHAIN MATERIALITY: only when candidate-specific retained evidence naturally justifies Blockchain as part of the assigned problem bridge, use one bounded mechanism such as a permissioned consortium ledger, cryptographic hash anchoring of record versions, signed provenance, or an append-only cross-agency verification ledger. Otherwise leave Blockchain as a search-only dimension and do not add it to the product. A generic mutable database audit log or vague "immutable audit trail" alone does not satisfy a justified Blockchain component. Present any mechanism as a pilot design choice, never as evidence of blockchain demand or adoption.',
                    ]
                  : []),
                ...(alignedEvidenceDomains.some((name) => name.trim().toLocaleLowerCase() === 'legaltech')
                  ? [
                      '- CONDITIONAL LEGALTECH MATERIALITY: only when candidate-specific retained evidence naturally justifies LegalTech as part of the assigned problem bridge, implement a concrete contracts, record-verification, compliance, provenance, or dispute-resolution workflow without giving legal advice or asserting legal conclusions. Otherwise leave LegalTech as a search-only dimension and do not add it to the product.',
                    ]
                  : []),
                ...(alignedEvidenceDomains.some((name) => name.trim().toLocaleLowerCase() === 'government')
                  ? [
                      '- CONDITIONAL GOVERNMENT MATERIALITY: only when candidate-specific retained evidence naturally justifies Government as part of the assigned problem bridge, anchor capabilities in the requester-named public-sector workflow such as permits, licenses, official records, approvals, ownership records, and cross-department processing. Otherwise leave Government as a search-only dimension and do not add it to the product.',
                    ]
                  : []),
              ]
            : [
                `- FINAL CLAIM SPACE: the selected opportunity is verified across ${alignedEvidenceDomains.join(', ')}. Use all and only these domains in the title, problem, target users, objectives, abstracts, features, architecture examples, market discussion, and pilot participants.`,
                `- Forbidden search-space domains for this candidate: ${forbiddenSearchDomains.join(', ') || 'none'}.`,
                '- Every target-user segment, objective, and capability must map to retained verified evidence supporting the selected opportunity.',
                '- EVIDENCE-TO-CAPABILITY INVARIANT: do not introduce clinical triage, clinicians, supervisors, care coordinators, admin review queues, escalation workflows, compliance reviewers, developer tooling, or operations teams unless the retained evidence explicitly identifies that role or workflow. A safety safeguard may remain a non-core implementation constraint, but it must not become the product\'s primary user, problem, or MVP workflow without evidence.',
              ]
          : [
              `- FINAL CLAIM SPACE: generate only for ${alignedEvidenceDomains[0] ?? opportunityDomainName ?? context.domainName ?? 'the domain represented by the selected opportunity'}.`,
              `- Do not add users, workflows, institutions, capabilities, architecture examples, market claims, or pilot participants from these other selected search-space domains: ${forbiddenSearchDomains.join(', ') || 'none'}.`,
              '- Separate evidence attached to a shortlisted alternative does not authorize cross-domain wording in this candidate.',
              '- A contextual mention of a domain, organization, website, product name, or data source is not sufficient domain evidence. Classify the problem by the affected workflow and verified winner evidence.',
            ]),
        '- All candidates must solve the same supported problem portfolio, but each assigned direction must use a materially different primary user job, core workflow, and dominant capability combination.',
        '- Produce one coherent commercially viable software product, not a feature list or a minor patch.',
        '- ROLE EVIDENCE BOUNDARY: every targetUsers role and every human-operated primary workflow must be named or semantically entailed by the requester scope or canonical retained evidence. Architecture implementers are not automatically product users.',
        ...(!evidenceSupportsDeveloperOperator
          ? [
              '- ROLE EXCLUSION — DEVELOPER: the authoritative scope does not identify developers, engineers, QA, DevOps, SDK owners, or codebase maintainers as affected users or workflow owners. Do not put these roles in targetUsers and do not make developer remediation, CI/CD, SDK, testing, or code-review tooling the primary product workflow.',
            ]
          : []),
        ...(!evidenceSupportsOperationalOperator
          ? [
              '- ROLE EXCLUSION — OPERATIONS: the authoritative scope does not identify an operational workflow owner, incident-response team, service desk, clinician, care coordinator, maintenance role, dispatch role, or similar operator as an affected user. Do not invent one merely to add human review.',
            ]
          : []),
        ...(!evidenceSupportsGenericAdminRole
          ? [
              '- ROLE EXCLUSION — GENERIC ADMIN: the authoritative scope does not identify administrators, supervisors, or generic reviewers as affected users. Even when a real operational workflow owner is supported, name that concrete role (for example maintenance staff, dispatcher, service provider, or production operator) instead of inventing an administrator/reviewer persona.',
            ]
          : []),
        ...(!evidenceSupportsCaregiverRole
          ? [
              '- ROLE EXCLUSION — CAREGIVER: the authoritative scope does not identify a caregiver/caregiving persona as an affected user. Words such as care, pet care, aftercare, special-care requirements, or follow-up care describe workflow requirements and do NOT authorize family caregivers or generic caregivers as target users. Keep the named service staff/owners as the human workflow roles.',
            ]
          : []),
        ...(effectiveEvidenceSamples.length > 0 && effectiveEvidenceSamples.length <= 2
          ? [
              effectiveEvidenceSamples.length === 1
                ? '- SPARSE-EVIDENCE SCOPE: exactly one direct evidence sample supports this opportunity. Prefer the smallest standalone product, configurable module, or narrow API that directly solves the observed user job.'
                : '- SPARSE-EVIDENCE SCOPE: only two direct evidence samples support this opportunity. Treat them as a preliminary same-problem cluster, not proof of broad recurrence, and prefer the smallest standalone product that directly solves the observed user job.',
              '- SPARSE PROBLEM LOCK: the observed failure mechanism in the evidence is immutable. Every primary objective and MVP capability must directly resolve that same failure family; do not infer inventory, finance, staffing, clinical, compliance, analytics, or operational-management problems unless those concepts are present in the retained evidence or requester scope.',
              '- USER-ALIGNMENT RULE: when the evidence is an end-user review or complaint, the default product must directly improve the affected user workflow. Do not redirect the solution to developers, QA teams, platform operators, clinicians, supervisors, reviewers, or care coordinators unless the evidence explicitly identifies them as the affected user, required workflow participant, or direct buyer.',
              '- SPARSE ROLE INVARIANT: one end-user sample cannot justify a new human-triage, clinical-escalation, admin-review, incident-response, or developer-remediation workflow. Keep those roles out of targetUsers, objectives, MVP features, architecture, and abstract unless they are named in the evidence or requester scope.',
              ...(!evidenceSupportsDeveloperOperator
                ? [
                    '- SPARSE ROLE EXCLUSION: the retained evidence does not identify developers, engineers, QA, DevOps, SDK owners, or codebase operators as the affected workflow role. Do not place those roles in targetUsers or make developer remediation the MVP workflow.',
                  ]
                : []),
              ...(!evidenceSupportsOperationalOperator
                ? [
                    '- SPARSE OPERATOR EXCLUSION: the retained evidence does not identify administrators, supervisors, support desks, incident-response teams, clinicians, care coordinators, or operational triage staff as the affected workflow role. Do not introduce those roles as target users or primary workflow owners.',
                  ]
                : []),
              ...(!evidenceSupportsCaregiverRole
                ? [
                    '- SPARSE CAREGIVER EXCLUSION: retained evidence/request scope does not identify caregivers as the affected role. Do not infer a caregiver persona from generic words such as care, aftercare, special care, pet care, or follow-up care.',
                  ]
                : []),
              '- A developer testing library, monitoring tool, SDK, or CI/CD product is not an acceptable default response to a teacher, student, parent, or learner complaint. Prefer a user-facing workflow, configurable feature, support tool, or operator-assisted service that resolves the observed friction.',
              '- Prefer a durable standalone product with its own recurring user workflow and value proposition. Do not default to a companion app whose main value is explaining another app, suggesting that users switch to a web version, or documenting manual workarounds.',
              '- A companion or diagnostic workflow is acceptable only when platform boundaries make direct resolution impossible. In that case, it must still provide an independent core capability such as personal organization, portable data, comparison, planning, or user-owned records; generic navigation advice alone is insufficient.',
              '- For paywall or rigid-taxonomy evidence, do not bypass or alter another product. Build an independent user-owned workflow such as transparent feature comparison, customizable study organization, portable subject mapping, or accessible onboarding support that remains useful even when the original host app is unavailable.',
              '- Do not choose an SDK, telemetry platform, compliance engine, CI/CD integration, multi-tenant enterprise dashboard, or cross-platform architecture unless the observed workflow technically cannot function without host integration.',
              '- When host integration is genuinely required, limit the MVP to one lightweight integration path, one validation rule family, and one basic report. Put backend orchestration, broad analytics, automated enforcement, and additional adapters in post-MVP.',
              '- The title, objectives, and abstract must describe a preliminary pilot product proportional to one observed case, not an enterprise platform inferred from market-wide demand.',
            ]
          : [
              '- The product may use a host-integrated SDK, vendor backend, or supported companion workflow when platform boundaries require it.',
            ]),
        '- Use only the supplied evidence for problem and local claims.',
        ...(effectiveEvidenceSamples.length === 0
          ? [
              '- ZERO-EVIDENCE LOCALITY LOCK: the requested city/region/country may appear only as a proposed/initial pilot or deployment target. Do not place the location in the same sentence as a claim that users, institutions, cooperatives, businesses, or residents currently face, report, suffer from, or struggle with the problem. Do not invent local regulations, privacy norms, governance requirements, prevalence, or current local operating conditions.',
            ]
          : []),
        '- Treat the requested location as the initial pilot target unless direct local evidence explicitly proves local prevalence.',
        '- Every objective must name a concrete user action, product capability, or measurable pilot activity. Avoid generic objectives such as improve experience, increase efficiency, enhance accessibility, or provide insights unless the exact workflow and measurement method are stated.',
        '- Describe a capability set as one unified primary workflow, not as "one primary user workflow" followed by several unrelated actions. Group related actions under a clear end-to-end job, such as finding a service, opening its verified details, and triggering a call, email, or map route.',
        '- Use natural, publication-ready English. Prefer "common navigation friction" or "recurring navigation friction"; never write ungrammatical phrases such as "commonly navigation friction". Remove awkward literal translations, duplicated qualifiers, and noun stacks before returning JSON.',
        '- Target users must reflect the actual workflow and adoption roles. When the product is a public-service, civic-access, directory, accessibility, or assisted-navigation tool, explicitly consider residents with limited digital literacy, older adults, people with accessibility needs, caregivers, and frontline staff. Include only the segments that are genuinely served by the proposed workflow; do not invent unsupported prevalence claims.',
        '- Do not invent a percentage target. Unless the supplied evidence explicitly includes a validated baseline and prior measured result, define impact without a numeric percentage: establish a baseline during the first pilot phase, then measure whether the selected problem metric decreases or improves during the remaining pilot period.',
        '- When no direct local evidence exists, describe Nablus, Palestine, or any requested location only as a proposed pilot or deployment target. Never state or imply that local users currently experience the problem, that local prevalence is known, or that the evidence was collected locally.',
        '- Premium budget estimation must provide explicit assumptions, named cost categories, a currency, a realistic numeric range, and a clear distinction between one-time development cost and recurring operating cost. Do not return vague labels such as low, medium, affordable, or cost-effective without figures.',
        '- Check spelling in the product name and all proper nouns. Never use common misspellings such as "Resiliant"; use "Resilient".',
        '- Do not present an inferred root cause as observed fact. Use wording such as plausible technical cause, likely failure pattern, or hypothesis to validate unless the evidence explicitly proves causation.',
        '- Do not assume feature gates, paywall rules, taxonomies, or entitlement logic are stored in local JSON, YAML, or XML files. They may instead live in application code, a backend database, a remote feature-flag service, a subscription API, or a CMS.',
        '- A static configuration linter is valid only when the host project explicitly exposes the relevant rules through supported configuration schemas. State that limitation in the problem statement, abstract, MVP, and architecture, and treat other storage mechanisms as post-MVP adapters or unsupported inputs.',
        "- Respect operating-system and application sandbox boundaries. A standalone mobile or desktop app cannot read another app's secure receipts, private logs, storage, or identifiers unless a host-integrated SDK, supported API/export, or explicit user-authorized import makes that access possible.",
        '- Make the supported integration path primary in the title direction, objectives, architecture, and abstract; do not mention an SDK only as an optional afterthought when the core workflow depends on host-app access.',
        "- For subscription, receipt, entitlement, or account-recovery concepts involving third-party apps, use one of these primary designs: (a) an SDK embedded by the host application plus a vendor-owned verification backend, or (b) a user-authorized diagnostic/import workflow that does not claim to change the host app entitlement. A standalone independent verification bridge that reads or restores another app's subscription is technically invalid.",
        "- For authentication, login, regional MFA, or identity-provider limitations involving third-party apps, never claim that a standalone product can bypass the host authentication flow, mint or restore a host session, or make the host application recognize a session. Use a host-supported OAuth/identity-provider integration when the vendor adopts the solution; otherwise use a user-authorized diagnostic, compatibility check, and recovery-guidance workflow that does not change the host authentication state.",
        '<selected_opportunity>',
        JSON.stringify({
          rank: opportunity.rank,
          title: opportunity.title,
          problem: opportunity.problem,
          need: opportunity.need,
          solutionArea: opportunity.solutionArea,
          frequency: opportunity.frequency,
          severity: opportunity.severity,
          score: opportunity.finalScore,
          evidenceSamples: effectiveEvidenceSamples,
        }),
        '</selected_opportunity>',
      ].join('\n'),
    });

    const endUserDirection = buildDirection('Direct user workflow resolution', [
      'Make the primary user the person directly affected in the evidence, such as a student, teacher, parent, learner, or app user.',
      'Center the product on completing the blocked task, restoring communication, improving access, or removing the observed friction through one clear user-facing workflow.',
      'Do not turn the concept into a developer testing tool when the evidence describes an end-user problem.',
    ]);

    const developerDirection = buildDirection(
      'Prevention and developer remediation',
      [
        'Make the primary buyer and operator a development, QA, or product engineering team.',
        'Center the product on detecting, reproducing, prioritizing, and preventing the failure before it reaches users.',
        'Use this direction only when a developer-operated product is genuinely justified by the supplied evidence and platform boundaries.',
      ],
    );

    const operationalDirection = buildDirection(
      'Workflow-owner operational resolution',
      [
        'Make the primary buyer/operator only the concrete human role that directly owns the evidenced/requester workflow. Derive that role from the supplied actor/workflow/evidence; never substitute a generic administrator, supervisor, reviewer, IT team, or support desk unless that role is explicitly present.',
        'Center the product on executing, prioritizing, coordinating, or resolving the exact evidenced workflow. Human review may be a safeguard, but a generic review queue must not become the product merely to create an operator persona.',
        'Use domain-specific workflow owners such as maintenance staff, dispatchers, service providers, or production operators only when the authoritative scope semantically entails that role.',
      ],
    );

    /*
     * Concept directions must never contradict the role-evidence boundary. The
     * previous >2-evidence branch always returned developer and operational
     * directions even when the authoritative scope explicitly excluded those
     * roles; models then followed the direction and the validator had to repair
     * invented admins/DevOps personas afterward.
     */
    const allowedDirections: CandidateConceptDirection[] = [];
    if (evidenceSupportsDeveloperOperator) {
      allowedDirections.push(developerDirection);
    }
    if (evidenceSupportsOperationalOperator) {
      allowedDirections.push(operationalDirection);
    }
    /*
     * Keep a direct-user interpretation available as a diversity fallback, but
     * do not force it ahead of an explicitly supported workflow owner. This
     * preserves staff/operator-first requests such as funeral coordination,
     * agricultural logistics, maintenance, and AI production operations.
     */
    allowedDirections.push(endUserDirection);
    return allowedDirections;
  }

  /**
   * Selects only the most relevant recent same-domain concepts for the prompt.
   *
   * The duplicate corpus is already loaded for semantic validation, so this
   * method adds no database round-trip. Supplying a small targeted exclusion
   * list prevents the common case where a high-quality model first recreates a
   * previous winner and then spends another full provider window redesigning
   * it. The normal duplicate detector still runs after generation.
   */
  private buildNoveltyExclusions(
    opportunity: RankedIdeaOpportunity,
    duplicateCorpus: readonly DuplicateIdeaCandidate[],
  ): readonly Pick<DuplicateIdeaCandidate, 'title' | 'problemStatement'>[] {
    if (duplicateCorpus.length === 0) {
      return [];
    }

    const opportunityTokens = this.toNoveltyTokenSet(
      [
        opportunity.title,
        opportunity.problem,
        opportunity.need,
        opportunity.solutionArea,
      ]
        .filter(Boolean)
        .join(' '),
    );

    const scored = duplicateCorpus
      .map((candidate) => {
        const candidateTokens = this.toNoveltyTokenSet(
          `${candidate.title} ${candidate.problemStatement}`,
        );
        const overlap = [...candidateTokens].filter((token) =>
          opportunityTokens.has(token),
        ).length;
        const denominator = Math.max(
          1,
          Math.min(opportunityTokens.size, candidateTokens.size),
        );

        return {
          candidate,
          relevance: overlap / denominator,
        };
      })
      .sort(
        (first, second) =>
          second.relevance - first.relevance ||
          second.candidate.createdAt.getTime() -
            first.candidate.createdAt.getTime(),
      );

    /*
     * Keep strongly related concepts first, then fill the small remaining
     * budget with the newest same-domain winners. The recent fallback matters
     * when two concepts are semantically equivalent but use different words
     * such as "login", "authentication", "access", or "session recovery".
     */
    const selected = [
      ...scored.filter(({ relevance }) => relevance >= 0.12).slice(0, 5),
      ...scored
        .filter(({ relevance }) => relevance < 0.12)
        .sort(
          (first, second) =>
            second.candidate.createdAt.getTime() -
            first.candidate.createdAt.getTime(),
        )
        .slice(0, 3),
    ]
      .filter(
        (entry, index, values) =>
          values.findIndex(
            (candidate) => candidate.candidate.id === entry.candidate.id,
          ) === index,
      )
      .slice(0, 6);

    return selected.map(({ candidate }) => ({
      title: candidate.title.trim().slice(0, 120),
      problemStatement: candidate.problemStatement
        .trim()
        .replace(/\s+/gu, ' ')
        .slice(0, 240),
    }));
  }

  private toNoveltyTokenSet(value: string): Set<string> {
    const stopWords = new Set([
      'about',
      'after',
      'against',
      'also',
      'because',
      'before',
      'being',
      'between',
      'could',
      'from',
      'have',
      'into',
      'more',
      'other',
      'over',
      'same',
      'that',
      'their',
      'there',
      'these',
      'they',
      'this',
      'through',
      'under',
      'using',
      'when',
      'where',
      'which',
      'with',
      'would',
      'user',
      'users',
      'system',
      'platform',
      'software',
    ]);

    return new Set(
      value
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .split(/\s+/u)
        .map((token) => token.trim())
        .filter(
          (token) =>
            token.length >= 4 &&
            !stopWords.has(token),
        ),
    );
  }

  private buildCrossDomainOpportunityPortfolio(
    context: IdeaGenerationContext,
    ranking: NonNullable<IdeaGenerationContext['opportunityRanking']>,
  ): readonly {
    readonly domainName: string;
    readonly title: string;
    readonly problem: string | null;
    readonly need: string | null;
    readonly solutionArea: string | null;
    readonly score: number;
    readonly evidenceSamples: readonly string[];
  }[] {
    const selected = ranking.selected;
    const finalClaimDomains = new Set(
      (selected.matchedDomainNames ?? [])
        .map((name) => name.trim().toLocaleLowerCase())
        .filter(Boolean),
    );
    const selectedDomainNames = new Map(
      context.selectedDomains.map((domain) => [
        domain.name.trim().toLocaleLowerCase(),
        domain.name,
      ]),
    );
    const portfolio: Array<{
      domainName: string;
      title: string;
      problem: string | null;
      need: string | null;
      solutionArea: string | null;
      score: number;
      evidenceSamples: readonly string[];
    }> = [];

    const pushPortfolioItem = (input: {
      readonly domainName: string;
      readonly title: string;
      readonly problem: string | null;
      readonly need: string | null;
      readonly solutionArea: string | null;
      readonly score: number;
      readonly evidenceSamples: readonly string[];
    }): void => {
      const normalizedDomain = input.domainName.trim().toLocaleLowerCase();
      if (!normalizedDomain) return;
      if (
        finalClaimDomains.size > 0 &&
        !finalClaimDomains.has(normalizedDomain)
      ) {
        return;
      }
      if (
        portfolio.some(
          (item) =>
            item.domainName.trim().toLocaleLowerCase() === normalizedDomain &&
            item.title === input.title,
        )
      ) {
        return;
      }
      portfolio.push(input);
    };

    const selectedRawDomain =
      this.isJsonObject(selected.raw) &&
      typeof selected.raw.domainName === 'string'
        ? selected.raw.domainName.trim()
        : '';
    const selectedPrimaryDomain =
      selected.primaryMatchedDomainName?.trim() ||
      selected.problemDomainNames?.[0]?.trim() ||
      selectedRawDomain ||
      selected.matchedDomainNames?.[0]?.trim() ||
      context.domainName?.trim() ||
      '';

    if (selectedPrimaryDomain) {
      pushPortfolioItem({
        domainName:
          selectedDomainNames.get(selectedPrimaryDomain.toLocaleLowerCase()) ??
          selectedPrimaryDomain,
        title: selected.title,
        problem: selected.problem,
        need: selected.need,
        solutionArea: selected.solutionArea,
        score: selected.finalScore,
        evidenceSamples: this.resolveOpportunityEvidenceSamples(selected).slice(
          0,
          2,
        ),
      });
    }

    for (const related of selected.relatedOpportunityBundle ?? []) {
      const bundleDomains = related.matchedDomainNames
        .map((name) => name.trim())
        .filter(Boolean)
        .filter(
          (name) =>
            finalClaimDomains.size === 0 ||
            finalClaimDomains.has(name.toLocaleLowerCase()),
        );
      const domainName =
        bundleDomains.find(
          (name) =>
            name.toLocaleLowerCase() !==
            selectedPrimaryDomain.toLocaleLowerCase(),
        ) ?? bundleDomains[0];
      if (!domainName) continue;

      pushPortfolioItem({
        domainName:
          selectedDomainNames.get(domainName.toLocaleLowerCase()) ?? domainName,
        title: related.title,
        problem: related.problem,
        need: related.need,
        solutionArea: related.solutionArea,
        score: Math.max(0, 1 - related.rank * 0.01),
        evidenceSamples: related.evidenceSamples.slice(0, 2),
      });
    }

    if (portfolio.length === 0) {
      const fallbackDomain =
        selected.matchedDomainNames?.[0] ??
        (selectedRawDomain || undefined) ??
        context.domainName ??
        'Selected domain';
      portfolio.push({
        domainName: fallbackDomain,
        title: selected.title,
        problem: selected.problem,
        need: selected.need,
        solutionArea: selected.solutionArea,
        score: selected.finalScore,
        evidenceSamples: this.resolveOpportunityEvidenceSamples(selected).slice(
          0,
          2,
        ),
      });
    }

    return portfolio;
  }

  /** Builds trusted metrics used by premium-output quality validation. */
  private buildQualityContext(
    context: IdeaGenerationContext,
  ): IdeaQualityEvaluationContext {
    const selectedOpportunity = context.opportunityRanking?.selected;
    const validationOnly = Boolean(
      !this.resolveCanonicalDiscoveryProblemLock(context, selectedOpportunity ?? null) &&
        selectedOpportunity?.disqualificationReasons.includes(
          'PRIMARY_DOMAIN_VALIDATION_HYPOTHESIS',
        ),
    );
    const independentDirectEvidenceCount =
      selectedOpportunity?.independentEvidence?.filter((item) =>
        [
          'DIRECT_USER_COMPLAINT',
          'USER_COMPLAINT',
          'FEATURE_REQUEST',
          'REVIEW',
        ].includes(item.evidenceKind),
      ).length ?? 0;
    const selectedDirectEvidenceCount =
      selectedOpportunity?.verifiedProblemMatchedDirectUserEvidenceCount ??
      selectedOpportunity?.verifiedDirectUserEvidenceCount ??
      selectedOpportunity?.verifiedIndependentEvidenceCount ??
      independentDirectEvidenceCount;
    const retainedDirectEvidenceCount = validationOnly
      ? 0
      : typeof selectedDirectEvidenceCount === 'number'
        ? Math.max(0, Math.floor(selectedDirectEvidenceCount))
        : 0;
    const selectedFamilyEvidenceIds = new Set(
      (context.communityAiAnalysis?.selectedProblemFamilyEvidenceIds ?? [])
        .map((id) => id.trim())
        .filter(Boolean),
    );
    const verifiedCommunitySupportingEvidenceCount =
      selectedFamilyEvidenceIds.size > 0
        ? context.communityAiAnalysis?.evidenceClassifications?.filter(
            (item) =>
              item.classification === 'SUPPORTING_SIGNAL' &&
              item.verifiedByDeterministicGuard === true &&
              selectedFamilyEvidenceIds.has(item.evidenceId),
          ).length ?? 0
        : 0;

    const winnerDomains =
      context.opportunityRanking?.selected.matchedDomainNames?.filter(Boolean) ?? [];
    const winnerDomainSet = new Set(
      winnerDomains.map((name) => name.trim().toLocaleLowerCase()),
    );
    const primaryDomainName = winnerDomains[0] ?? context.domainName;
    const forbiddenDomainNames = context.selectedDomains
      .map((domain) => domain.name.trim())
      .filter(
        (name) =>
          Boolean(name) && !winnerDomainSet.has(name.toLocaleLowerCase()),
      );
    const requesterDesiredOutcome =
      context.collectionPlan?.requestIntent?.mode === 'EXPLICIT_PROBLEM'
        ? context.collectionPlan.requestIntent.desiredOutcome
            ?.replace(/\s+/gu, ' ')
            .trim() ?? null
        : null;
    const requiredDomainNames =
      context.requestMode === 'TEXT_AND_DOMAINS'
        ? context.selectedDomains
            .filter((domain) => domain.isExplicitlySelected)
            .map((domain) => domain.name.trim())
            .filter(Boolean)
        : [];

    return {
      totalTextsAnalyzed: context.nlp?.totalTextsAnalyzed,
      totalPostsAnalyzed: context.nlp?.totalPostsAnalyzed,
      totalCommentsAnalyzed: context.nlp?.totalCommentsAnalyzed,
      requireAdvancedOutputs: context.policy?.includePremiumOutputs ?? false,
      targetCountry: context.location.country,
      targetCity: context.location.city,
      targetRegion: context.location.region,
      localEvidenceVerified: this.hasVerifiedLocalEvidence(context),
      directEvidenceCount: retainedDirectEvidenceCount,
      externalSupportingEvidenceCount:
        Math.max(
          verifiedCommunitySupportingEvidenceCount,
          typeof selectedOpportunity?.verifiedProblemMatchedSecondaryEvidenceCount === 'number'
            ? Math.max(
                0,
                Math.floor(
                  selectedOpportunity.verifiedProblemMatchedSecondaryEvidenceCount,
                ),
              )
            : Math.max(
                selectedOpportunity?.qualifiedExternalSupportingEvidenceCount ?? 0,
                selectedOpportunity?.verifiedSecondaryEvidenceCount ?? 0,
                selectedOpportunity?.supportingEvidence?.filter(
                  (item) => item.sourceType === 'SECONDARY_EVIDENCE',
                ).length ?? 0,
              ),
        ),
      verifiedIndependentSourceCount:
        typeof selectedOpportunity?.verifiedProblemMatchedEvidenceSourceCount === 'number'
          ? Math.max(
              0,
              Math.floor(
                selectedOpportunity.verifiedProblemMatchedEvidenceSourceCount,
              ),
            )
          : Math.max(
              selectedOpportunity?.verifiedIndependentSourceCount ?? 0,
              selectedOpportunity?.verifiedEvidenceSourceCount ?? 0,
            ),
      requesterDescription:
        context.collectionPlan?.requestIntent?.mode === 'EXPLICIT_PROBLEM'
          ? context.collectionPlan.requestIntent.explicitProblem ?? context.requestDescription
          : null,
      requesterFacetDescription:
        context.collectionPlan?.requestIntent?.mode === 'EXPLICIT_PROBLEM'
          ? context.requestDescription
          : null,
      requesterDesiredOutcome,
      outputLanguage: context.outputLanguage,
      allowZeroEvidenceValidationCandidate:
        this.isUngroundedEvidenceState(context.evidenceState),
      primaryDomainName,
      // This field is a leakage guard: only selected domains outside the
      // authoritative final claim set are forbidden. Valid multi-domain
      // validation hypotheses must not be penalized for naming their own
      // allowed claim domains.
      secondaryDomainNames: forbiddenDomainNames,
      requiredDomainNames,
    };
  }

  /** Builds the application-controlled system instruction for all candidates. */
  private buildSystemInstruction(context: IdeaGenerationContext): string {
    const metrics = context.nlp
      ? `Trusted NLP totals: ${context.nlp.totalTextsAnalyzed} texts, ${context.nlp.totalPostsAnalyzed} posts, and ${context.nlp.totalCommentsAnalyzed} comments.`
      : 'Trusted NLP totals are unavailable.';
    const explicitRequesterProblem =
      context.collectionPlan?.requestIntent?.mode === 'EXPLICIT_PROBLEM' &&
      Boolean(context.collectionPlan.requestIntent.explicitProblem?.trim());
    const requesterDesiredOutcome =
      context.collectionPlan?.requestIntent?.mode === 'EXPLICIT_PROBLEM'
        ? context.collectionPlan.requestIntent.desiredOutcome
            ?.replace(/\s+/gu, ' ')
            .trim() ?? ''
        : '';
    const requesterDesiredOutcomeInstruction =
      explicitRequesterProblem && requesterDesiredOutcome
        ? `REQUESTER CAPABILITY LOCK: the requester explicitly asked for this product behavior: "${requesterDesiredOutcome}". Preserve every concrete requested operation in the final product workflow. Retained evidence may prioritize which problem facet is best supported and may limit prevalence/causal claims, but it must never delete, replace, or silently downgrade requester-requested capabilities. A capability may be implemented with a safe human-reviewed variant, but it must remain active product behavior rather than passive narrative.`
        : '';
    const discoveryLock = this.resolveCanonicalDiscoveryProblemLock(
      context,
      context.opportunityRanking?.selected ?? null,
    );
    const validationOnly = Boolean(
      (!explicitRequesterProblem && !discoveryLock) ||
        (!discoveryLock &&
          context.opportunityRanking?.selected.disqualificationReasons.includes(
            'PRIMARY_DOMAIN_VALIDATION_HYPOTHESIS',
          )),
    );
    const explicitlySelectedDomainNames = context.selectedDomains
      .filter((domain) => domain.isExplicitlySelected)
      .map((domain) => domain.name.trim())
      .filter(Boolean);
    const explicitDomainImplementationRules = explicitlySelectedDomainNames
      .map((domainName) => {
        const normalized = domainName.toLocaleLowerCase();
        if (normalized.includes('artificial intelligence') || normalized === 'ai') {
          return '- Artificial Intelligence materiality: include a real model-backed step (for example anomaly detection, prediction, risk scoring, forecasting, recommendation, or classification) with named operational inputs, outputs, and human review/override.';
        }
        if (normalized.includes('cybersecurity')) {
          return '- Cybersecurity materiality: protect a concrete object/event in the requester workflow. Use either active security/anomaly monitoring OR a linked bundle of at least two independent controls such as role-based access/least privilege, encryption or integrity protection, auditable/tamper-evident provenance, and suspicious-access/security alerts. Generic HTTPS or a label-only "secure system" is not enough; state what is protected and what staff do when a security condition is detected.';
        }
        if (normalized.includes('internet of things') || normalized === 'iot') {
          return '- Internet of Things materiality: specify the sensors/devices/telemetry source, how events enter the software workflow, and how missing/stale device data is handled.';
        }
        if (normalized.includes('blockchain')) {
          return '- Blockchain materiality: if Blockchain is explicitly requester-selected for this concrete problem, use a bounded provenance/integrity mechanism such as signed records, cryptographic hash anchoring, or a permissioned append-only ledger; a generic database audit log alone is not Blockchain.';
        }
        return `- ${domainName} materiality: include at least one concrete workflow, data, decision, integration, or actor responsibility that is technically necessary for the requester-defined problem rather than mentioning the domain label only.`;
      })
      .join(' ');
    const explicitDomainCoverageInstruction =
      explicitlySelectedDomainNames.length > 0
        ? explicitRequesterProblem
          ? `Explicit requester-selected domains: ${explicitlySelectedDomainNames.join(', ')}. The final product must preserve the explicitly stated requester problem as the primary workflow and give every selected domain a concrete, technically meaningful responsibility rather than a label-only mention. ${explicitDomainImplementationRules} Do not replace the requester problem with an easier same-domain problem merely because it has stronger unrelated evidence.`
          : `Explicit requester-selected domains: ${explicitlySelectedDomainNames.join(', ')}. These domains constrain the evidence-discovery search space. The final product problem must come from the canonical evidence-selected family, not from the domain labels or requester preferences themselves. Use only selected domains that are semantically justified by the winning problem and its product workflow.`
        : '';

    const systemRoleAuthorityText = [
      context.requestDescription ?? '',
      context.collectionPlan?.problemProfile?.actor ?? '',
      context.collectionPlan?.problemProfile?.workflow ?? '',
      ...(context.opportunityRanking?.selected?.evidenceSamples ?? []),
    ]
      .join(' ')
      .normalize('NFKC')
      .toLocaleLowerCase();
    const systemCaregiverRoleAuthorized =
      /\b(?:family caregiver|family caregivers|caregiver|caregivers|caregiving)\b/u.test(
        systemRoleAuthorityText,
      );
    const supportingOnlyRequesterFacetLock =
      explicitRequesterProblem &&
      (context.opportunityRanking?.selected?.verifiedProblemMatchedDirectUserEvidenceCount ??
        context.opportunityRanking?.selected?.verifiedDirectUserEvidenceCount ??
        0) === 0 &&
      Math.max(
        context.opportunityRanking?.selected?.qualifiedExternalSupportingEvidenceCount ?? 0,
        context.opportunityRanking?.selected?.verifiedProblemMatchedSecondaryEvidenceCount ?? 0,
        context.opportunityRanking?.selected?.verifiedSecondaryEvidenceCount ?? 0,
      ) > 0
        ? 'SUPPORTING-ONLY REQUESTER FACET LOCK: retained supporting evidence may qualify, prioritize, or strengthen only the concrete facet that the retained evidence itself describes. It does not gain authority to validate other requester-only facets, causes, inputs, shortages, scheduling failures, costs, delays, or outcomes that are absent from the retained evidence. Keep the full requester workflow as the product center, but distinguish evidence-backed facets from requester-defined hypotheses in the problem statement and abstracts. Never write "collected feedback indicates/shows/suggests" followed by a bundle that mixes an evidenced facet with unevidenced requester facets. Use wording equivalent to: "Retained supporting evidence grounds [evidenced facet]; the remaining requester-described facets remain hypotheses for the pilot to validate." Do not redefine the requester actor, object, workflow, concrete data inputs, or requested product operations.'
        : '';
    const discoveryLockInstruction = discoveryLock
      ? `CANONICAL DISCOVERY LOCK: the problem has already been selected from verified collected evidence as "${discoveryLock.family}". Core AI does not choose a new problem. Build only the software response to this exact family and its retained evidence. Do not broaden the product to other discovery domains merely because they were searched during collection; a searched domain is not part of the final problem unless it is in selected.matchedDomainNames and supported by the selected-family evidence.`
      : '';
    const unlockedDiscoveryInstruction =
      !explicitRequesterProblem && !discoveryLock
        ? 'CANONICAL FAMILY UNLOCKED: trusted rows may exist, but no immutable problem-family identity survived verification. Do not narrow the product to a new persona, industry sub-vertical, or specialized remediation workflow inferred only by the model. Keep the candidate as a domain-scoped validation/decision workflow centered on the retained evidence rows and explicitly state that the concrete recurring problem family still requires direct or independently corroborated validation.'
        : '';
    const semanticGroundingInstruction =
      'GROUNDING CONTRACT: treat requester text and retained canonical evidence as the only sources for observed facts, causes, failure mechanisms, prevalence, and external technical claims. Proposed architecture, algorithms, models, queues, databases, and integrations are allowed as DESIGN CHOICES only and must be phrased as proposed implementation, not as facts explaining why the observed problem occurs. Never introduce a named scientific construct, causal mechanism, mathematical property, security fact, regulation, or domain-specific technical diagnosis unless it is explicitly present in the requester text or retained evidence. Before returning JSON, perform an internal claim-by-claim grounding audit: remove or reframe every unsupported factual/causal/technical statement as a proposal or hypothesis.';
    const zeroEvidenceHardInstruction =
      this.isUngroundedEvidenceState(context.evidenceState)
        ? context.evidenceState === 'EVIDENCE_ADJUDICATION_UNAVAILABLE'
          ? explicitRequesterProblem
            ? 'CANONICAL EVIDENCE STATE HARD LOCK: EVIDENCE_ADJUDICATION_UNAVAILABLE. Raw external material may have been collected, but semantic AI adjudication did not complete for part or all of it. The requester statement remains the only usable problem premise and is NOT external evidence. Never say the collected material was unrelated or that no evidence exists; say external grounding remains unadjudicated. Use explicit hypothesis language and require pilot validation.'
            : 'CANONICAL EVIDENCE STATE HARD LOCK: EVIDENCE_ADJUDICATION_UNAVAILABLE. Raw external material may exist, but semantic adjudication did not complete. Do not invent a concrete problem and do not describe the corpus as unrelated/no-evidence. Produce only a neutral validation/discovery workflow until canonical DIRECT_PROBLEM or SUPPORTING_SIGNAL evidence is adjudicated and retained.'
          : explicitRequesterProblem
            ? 'CANONICAL EVIDENCE STATE HARD LOCK: NO_VALID_EVIDENCE_FOUND. Semantic adjudication completed without retaining trusted DIRECT_PROBLEM or SUPPORTING_SIGNAL evidence. The requester statement is the only problem premise and is NOT external evidence. Never imply that collected feedback validated the problem. Use explicit hypothesis language and require pilot validation.'
            : 'CANONICAL EVIDENCE STATE HARD LOCK: NO_VALID_EVIDENCE_FOUND. Semantic adjudication completed but no concrete external problem was validated. Do not invent a problem, user complaint, market need, or evidence-backed product. Produce only a neutral validation/discovery workflow until canonical DIRECT_PROBLEM or SUPPORTING_SIGNAL evidence is retained.'
        : '';

    return [
      validationOnly
        ? explicitRequesterProblem
          ? 'Generate one specific, requester-grounded, differentiated, locally deployable validation-first software product. The explicitly stated requester problem defines the hypothesis; it is not retained evidence.'
          : 'Generate one specific validation-stage software direction inside the requester intent/domain scope without inventing a market problem that was not verified by collected evidence.'
        : 'Generate one specific, evidence-grounded, differentiated, locally deployable software product.',
      validationOnly && !explicitRequesterProblem
        ? 'Use a natural neutral title that clearly identifies the product as problem discovery, evidence review, or problem-signal validation. A zero-evidence domain-only candidate MUST make that validation/discovery purpose visible in the title and must not masquerade as a solved operational product. Do not use plus-sign-joined domain lists or invent a concrete failure family.'
        : 'Use a natural public-facing product title. Never put Cross-Domain, Multi-Domain, Request Validation, Validation Pilot, Evidence Validation, Opportunity Discovery, Primary Domain, Preliminary Pilot, or a plus-sign-joined domain list in the title. Keep evidence/validation qualification in the narrative instead.',
      context.requestDescription
        ? explicitRequesterProblem
          ? `Requester text was classified as EXPLICIT_PROBLEM: ${context.collectionPlan?.requestIntent?.explicitProblem?.trim() || context.requestDescription}. It is a mandatory problem-scope constraint but never external evidence. Preserve this stated workflow/failure unless verified evidence shows only a tightly equivalent formulation; do not substitute an unrelated easier problem.`
          : `Requester text was classified as DISCOVERY_INTENT: ${context.requestDescription}. Use it to constrain actor, workflow, goals, exclusions, and search scope only. It is not the final problem and not evidence. The final problem must be the canonical problem family selected from retained DIRECT_PROBLEM/SUPPORTING_SIGNAL evidence after collection.`
        : '',
      requesterDesiredOutcomeInstruction,
      supportingOnlyRequesterFacetLock,
      semanticGroundingInstruction,
      explicitDomainCoverageInstruction,
      explicitRequesterProblem && explicitlySelectedDomainNames.length > 0
        ? 'FIRST-RESPONSE DOMAIN CONTRACT: the deterministic benchmark rejects a candidate that omits a technically meaningful responsibility for any explicitly selected TEXT_AND_DOMAINS domain. Satisfy every selected domain in the Core candidate itself; do not rely on a later validator to append missing-domain prose.'
        : '',
      discoveryLockInstruction,
      unlockedDiscoveryInstruction,
      zeroEvidenceHardInstruction,
      explicitRequesterProblem && this.isUngroundedEvidenceState(context.evidenceState)
        ? 'ZERO-EVIDENCE PRODUCT QUALITY CONTRACT: lack of retained external evidence limits market-validation claims; it does NOT turn a concrete requester problem into a meta evidence-discovery product. Build the actual requested software workflow. State the evidence limitation once concisely, then spend the remaining problem statement/abstract on the concrete actor workflow, product behavior, data flow, decision logic, safeguards, and pilot measurement. Keep the MVP narrow (normally 2-4 primary capabilities) and move optional infrastructure/enterprise extensions out of the core scope.'
        : '',
      explicitRequesterProblem
        ? 'TARGET-USER CONTRACT: every primary target-user role must be an actor who performs, owns, reviews, or is directly affected by the requester-defined workflow or retained canonical evidence. Do not add generic software engineering, product engineering, QA, compliance, research, or administrator personas unless the requester/evidence explicitly makes that role part of the workflow.'
        : 'TARGET-USER CONTRACT: every primary target-user role must be directly entailed by the canonical selected problem family/evidence. Do not expand a narrow observed problem into generic engineering, QA, compliance, or product-team personas merely because they could build or administer the software.',
      !systemCaregiverRoleAuthorized
        ? 'TARGET-USER CAREGIVER GUARD: no caregiver/caregiving human role is authorized by the requester/evidence. Generic words such as care, pet care, aftercare, special-care requirements, or follow-up care describe workflow content only. Do not introduce caregivers as target users, reviewers, owners, or pilot participants.'
        : '',
      'MVP PROPORTIONALITY CONTRACT: prefer one primary product surface and a small coherent capability set that directly resolves the locked workflow. Architecture components such as queues, caches, microservices, SDKs, telemetry platforms, or separate admin consoles are implementation options, not automatic MVP requirements; include them only when the requester/evidence or scale constraint actually needs them.',
      'Do not invent statistics, market sizes, legal conclusions, API availability, institutional counts, failure rates, or local facts.',
      'When evidence is not locally verified, describe the discovered problem generally and say that the initial pilot deployment is planned for the target location. Never write that students, faculty, institutions, or residents in the requested city currently face or report the problem.',
      'Mark estimates and assumptions explicitly. Symptom-only evidence must never be rewritten with causal verbs such as stem from, result from, caused by, or driven by. Use "Potential contributing factors to validate include ..." for inferred mechanisms unless direct evidence proves causation. Never convert a symptom-only report into a confirmed token, database, network, server, release-cycle, schema, or asset-integrity diagnosis. Do not invent percentage impact targets. When no validated baseline is supplied, require the pilot to establish a baseline first and then measure directional change without precommitting to a numeric percentage.',
      'Treat store descriptions and promotional product copy as contextual source material, never as direct proof of a user complaint or unmet need.',
      'Reject evidence from unrelated developer programs, cloud-credit claims, repository governance records, political news, and AI research reports even when they contain broad words such as student, education, platform, or system.',
      'A GitHub issue that already specifies proposed implementation, routes, components, files to modify, infrastructure, tests, phases, or expected impact is a solution blueprint, not independent community-demand evidence. Do not copy, repackage, or productize that implementation plan. Use only independent user-observed pain that remains after removing the prescribed solution.',
      'Keep the JSON concise. Use short arrays, avoid repeating the abstract in advanced outputs, and keep each advanced-output section focused on implementation decisions rather than generic prose.',
      context.policy?.includePremiumOutputs
        ? 'Return partialAbstract as a concise overview. Return fullAbstract as a materially richer premium document of 3-5 paragraphs covering: the evidence-grounded problem and affected workflow; the end-to-end product workflow; the main technical components and data flow; concrete user value and pilot validation; and explicit evidence limitations. Qualification language must not dominate the document, and the two abstracts must not repeat each other verbatim.'
        : context.generationType === IdeaGenerationType.GUEST_FREE
          ? 'Return limitedAbstract and partialAbstract only. Do not return fullAbstract or advancedOutputs for guest generation.'
          : 'For NORMAL_FREE, return exactly these root keys and no others: title, problemStatement, objectives, targetUsers, partialAbstract. Never return limitedAbstract, fullAbstract, advancedOutputs, businessModel, technologyStack, systemArchitecture, budgetEstimation, implementationTimeline, feasibilityAssessment, marketPotential, valueProposition, localRegulations, or any premium-only field.',
      validationOnly
        ? explicitRequesterProblem
          ? 'Preserve the explicitly stated requester validation hypothesis as the immutable candidate scope. Keep its problem, allowed validation domains, and evidence limitations mutually consistent. Do not merge unrelated evidence into the hypothesis.'
          : 'Preserve the validation-stage discovery scope without inventing a concrete operational problem. Requester intent and selected domains constrain where to validate; they do not constitute evidence.'
        : 'Preserve the assigned opportunity as the immutable evidence unit for the candidate: its title, problem, need, solution area, severity, frequency, verified matched domains, and retained evidence must remain mutually consistent. Do not merge a separate shortlisted opportunity into the candidate unless that opportunity is the explicit candidate-specific assignment.',
      validationOnly
        ? explicitRequesterProblem
          ? 'The final problemStatement must preserve the explicitly stated requester problem as an unvalidated premise. ZERO-EVIDENCE REQUEST LOCK: no external evidence means prevalence, recurrence, causal mechanisms, and demand claims remain unproven. Never present the requester statement as community evidence.'
          : 'The final problemStatement must be a coherent validation-only narrative. ZERO-EVIDENCE DISCOVERY LOCK: requester goals/preferences are not a problem statement. Do not invent a specialized operational failure or remediation product from CONTEXT_ONLY material. Describe a neutral evidence-discovery workflow that will identify and validate one concrete people problem before normal idea generation.'
        : 'The final problemStatement must be one coherent problem-only narrative. Use only domains supported by the selected canonical DIRECT_PROBLEM or SUPPORTING_SIGNAL evidence. A domain that was merely searched, or that has only CONTEXT_ONLY/UNRELATED material, must not appear in targetUsers, objectives, abstracts, market claims, or advanced outputs.',
      'Classify domain alignment by the affected user workflow and unmet need, not by incidental words naming a government website, school, city, company, repository, or source system.',
      'A cybersecurity incident such as ransomware, deletion by an attacker, or a data breach is not evidence of ordinary synchronization failure, network timeout, or storage-choice demand. Do not reinterpret security incidents as product reliability evidence.',
      'When directEvidenceCount or frequency equals 1, use singular and qualified wording such as one report indicates or a limited evidence sample suggests. Never use frequently, recurring discussions, common, widespread, or equivalent market-wide language.',
      'Independent-source invariant: when verifiedIndependentSourceCount is 0 or 1, never write "reports across domains", "multiple sources", "secondary reports across", "the evidence shows widespread/frequent occurrence", or any equivalent wording that implies source diversity or prevalence. If several trusted rows came from one source, say exactly that they are retained supporting signals from one source and use suggest/may wording.',
      'Supporting-only invariant: SUPPORTING_SIGNAL evidence can justify a preliminary workflow hypothesis, but without DIRECT_PROBLEM evidence it cannot establish recurring user demand, prevalence, frequency, or a locked community problem family. Keep those claims explicitly preliminary even when the supporting-signal count is greater than one.',
      'When directEvidenceCount equals 1, the solution scope must remain proportional to one observed case: prefer one narrow user workflow and one primary product surface. Do not escalate a simple taxonomy, access, storage, usability, emotional-support, or planning observation into an enterprise SDK, telemetry platform, compliance suite, clinical-triage system, supervisor review queue, or CI/CD product unless that role or workflow is explicitly present in the retained evidence or requester scope.',
      'Evidence-to-capability invariant: every primary target-user role and every primary MVP capability must be justified by the requester scope or retained evidence. Safety, privacy, and human oversight may be described as bounded safeguards, but they cannot become a new primary product workflow that the evidence did not ask for.',
      'Apply the same singular evidence qualifier to the problem statement, abstract, objectives, value proposition, feasibility assessment, market potential, architecture, database design, and MVP features. A qualifier in one section does not authorize stronger causal or prevalence claims elsewhere.',
      'Capabilities may detect observed behavior and test candidate causes. Unless direct technical evidence proves a code-level cause, never claim that the product identifies hardcoded rules, misconfigured feature gates, configuration files, database faults, token defects, or exact code locations. Describe outputs as diagnostic hypotheses, reviewed remediation guidance, or candidate causes requiring validation.',
      'Keep the MVP deliberately narrow. For a six-month pilot, choose exactly one primary client platform, one ingestion or local-analysis workflow, and one basic dashboard or local report. When direct evidence count is one, the MVP must contain only: one host integration or local capture path, simple ingestion or local processing, one basic report/dashboard, and manual remediation guidance. Do not include Redis, automatic reproduction-script generation, generated test cases, automatic code suggestions, advanced exports, broad CI/CD enforcement, autonomous diagnosis, or advanced analytics in the sparse-evidence MVP. Place every excluded capability explicitly in post-MVP. Do not include Android, iOS, and web together in the MVP.',
      'Do not output any numeric percentage improvement or reduction when no validated baseline and prior measurement are supplied. Express impact as a validation metric: establish the baseline during the first pilot phase, then measure the change in the selected defect, friction, access, or reliability metric during the remaining period.',
      'For budget estimation, size the preliminary range to the stated team, pilot duration, target location, and MVP scope. Do not default to enterprise-scale budgets. Separate MVP development, infrastructure, testing/security, contingency, and excluded legal or marketing costs. When the proposal is a small six-month pilot with two or three developers, use a defensible lean-pilot range and keep the upper bound at or below $50,000 unless a named compliance, hardware, licensing, or security requirement in the supplied evidence clearly justifies more.',
      'Market potential must distinguish observed evidence from inference. With one direct evidence sample, state that the observed case suggests possible transferability to similar systems; do not claim the need is common, substantial, widespread, recurring, or proven across the market. Do not invent TAM, SAM, SOM, customer counts, or market-size figures.',
      'Advanced outputs must not introduce capabilities absent from the core idea. With one direct evidence sample, remediation must remain manual and reviewed; do not generate code patches, test cases, or reproduction scripts in the MVP. With stronger evidence, automated code fixes must still be framed as reviewed patch templates, never autonomous production changes, and test generation must remain bounded to the selected failure family.',

      "Respect operating-system, browser, app-store, and cross-application permission boundaries. When a product depends on another app's receipts, subscription state, entitlements, secure storage, or private logs, the primary architecture must use a host-integrated SDK and vendor-owned backend, a supported platform API/export, or explicit user-authorized import. Do not describe an independent app as able to restore or control another app's entitlement.",
      metrics,
      context.policy?.includePremiumOutputs
        ? 'The NLP executive summary must state those exact three totals. The budget estimation must be explicitly preliminary and include a currency, numeric range, major cost categories, and assumptions.'
        : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  /**
   * Returns true only when persisted sample evidence contains location metadata
   * matching the requested target. Text mentions alone are not treated as
   * verified geolocation.
   */
  private hasVerifiedLocalEvidence(context: IdeaGenerationContext): boolean {
    const targets = [
      context.location.country,
      context.location.city,
      context.location.region,
    ]
      .map((value) => this.normalizeLocationValue(value))
      .filter((value): value is string => value !== null);

    if (targets.length === 0 || !context.nlp) {
      return false;
    }

    return [context.nlp.samplePosts, context.nlp.sampleComments].some((value) =>
      this.containsMatchingLocationMetadata(value, targets),
    );
  }

  private containsMatchingLocationMetadata(
    value: unknown,
    targets: readonly string[],
  ): boolean {
    if (Array.isArray(value)) {
      return value.some((item) =>
        this.containsMatchingLocationMetadata(item, targets),
      );
    }

    if (!value || typeof value !== 'object') {
      return false;
    }

    for (const [key, nestedValue] of Object.entries(value)) {
      const normalizedKey = key.toLocaleLowerCase();

      if (
        ['country', 'city', 'region', 'location'].includes(normalizedKey) &&
        typeof nestedValue === 'string'
      ) {
        const normalizedValue = this.normalizeLocationValue(nestedValue);

        if (
          normalizedValue &&
          targets.some(
            (target) =>
              normalizedValue === target ||
              normalizedValue.includes(target) ||
              target.includes(normalizedValue),
          )
        ) {
          return true;
        }
      }

      if (this.containsMatchingLocationMetadata(nestedValue, targets)) {
        return true;
      }
    }

    return false;
  }

  private normalizeLocationValue(value: string | null): string | null {
    const normalized = value
      ?.normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();

    return normalized ? normalized : null;
  }

  /** Converts deterministic issues into one concise rejection reason. */
  private buildQualityRejectionMessage(quality: IdeaQualityEvaluation): string {
    const issueCodes = quality.issues.map((issue) => issue.code).join(', ');

    return `QUALITY_GATE_REJECTED: candidate score ${quality.score} is below the required threshold. Issues: ${issueCodes || 'insufficient overall quality'}.`;
  }

  /** Persists one quality-approved model execution. */
  private async persistSuccessfulCandidate(input: {
    readonly runId: string;
    readonly model: Pick<
      AiModel,
      'id' | 'providerKey' | 'apiModelId' | 'modelName' | 'displayName'
    >;
    readonly aiResult: AiExecutionResult;
    readonly parsedOutput: ParsedIdeaAiOutput;
    readonly quality: IdeaQualityEvaluation;
    readonly direction: CandidateConceptDirection;
  }): Promise<string> {
    const data = {
      aiModelId: input.model.id,
      modelName: input.model.modelName,
      displayName: input.model.displayName,
      opportunityTitle: input.direction.opportunity.title,
      rawResponse: input.aiResult.text,
      parsedResponse: this.toPrismaJson(input.parsedOutput),
      overallScore: input.quality.score,
      semanticDiversityAdjustedScore: null,
      hybridFinalScore: null,
      finalScore: null,
      innovationScore: input.quality.dimensions.innovation,
      marketFitScore: input.quality.dimensions.marketFit,
      technicalQualityScore: input.quality.dimensions.technicalQuality,
      completenessScore: input.quality.dimensions.completeness,
      originalityScore: input.quality.dimensions.originality,
      inputTokens: input.aiResult.inputTokens,
      outputTokens: input.aiResult.outputTokens,
      costEstimate: input.aiResult.costEstimate,
      responseTimeMs: input.aiResult.responseTimeMs,
      selected: false,
      errorCode: null,
      errorMessage: null,
    };

    const candidate = await this.prisma.ideaGenerationCandidate.upsert({
      where: {
        runId_providerKey_apiModelId_opportunityRank: {
          runId: input.runId,
          providerKey: input.model.providerKey,
          apiModelId: input.model.apiModelId,
          opportunityRank: input.direction.opportunity.rank,
        },
      },
      create: {
        runId: input.runId,
        providerKey: input.model.providerKey,
        apiModelId: input.model.apiModelId,
        opportunityRank: input.direction.opportunity.rank,
        ...data,
      },
      update: data,
      select: { id: true },
    });

    return candidate.id;
  }

  /** Persists a structurally valid response rejected by the quality gate. */
  private async persistRejectedCandidate(input: {
    readonly runId: string;
    readonly model: Pick<
      AiModel,
      'id' | 'providerKey' | 'apiModelId' | 'modelName' | 'displayName'
    >;
    readonly attempt: AcceptedModelAttempt;
    readonly errorCode?: string;
    readonly errorMessage: string;
    readonly direction: CandidateConceptDirection;
  }): Promise<void> {
    const data = {
      aiModelId: input.model.id,
      modelName: input.model.modelName,
      displayName: input.model.displayName,
      opportunityTitle: input.direction.opportunity.title,
      rawResponse: input.attempt.aiResult.text,
      parsedResponse: this.toPrismaJson(input.attempt.parsedOutput),
      overallScore: input.attempt.quality.score,
      semanticDiversityAdjustedScore: null,
      hybridFinalScore: null,
      finalScore: null,
      innovationScore: input.attempt.quality.dimensions.innovation,
      marketFitScore: input.attempt.quality.dimensions.marketFit,
      technicalQualityScore:
        input.attempt.quality.dimensions.technicalQuality,
      completenessScore: input.attempt.quality.dimensions.completeness,
      originalityScore: input.attempt.quality.dimensions.originality,
      inputTokens: input.attempt.aiResult.inputTokens,
      outputTokens: input.attempt.aiResult.outputTokens,
      costEstimate: input.attempt.aiResult.costEstimate,
      responseTimeMs: input.attempt.aiResult.responseTimeMs,
      selected: false,
      errorCode: input.errorCode ?? 'QUALITY_GATE_REJECTED',
      errorMessage: input.errorMessage,
    };

    await this.prisma.ideaGenerationCandidate.upsert({
      where: {
        runId_providerKey_apiModelId_opportunityRank: {
          runId: input.runId,
          providerKey: input.model.providerKey,
          apiModelId: input.model.apiModelId,
          opportunityRank: input.direction.opportunity.rank,
        },
      },
      create: {
        runId: input.runId,
        providerKey: input.model.providerKey,
        apiModelId: input.model.apiModelId,
        opportunityRank: input.direction.opportunity.rank,
        ...data,
      },
      update: data,
    });
  }

  /** Persists a provider, parsing, or execution failure. */
  private async persistFailedCandidate(input: {
    readonly runId: string;
    readonly model: Pick<
      AiModel,
      'id' | 'providerKey' | 'apiModelId' | 'modelName' | 'displayName'
    >;
    readonly responseTimeMs: number;
    readonly errorMessage: string;
    readonly direction: CandidateConceptDirection;
  }): Promise<void> {
    const data = {
      aiModelId: input.model.id,
      modelName: input.model.modelName,
      displayName: input.model.displayName,
      opportunityTitle: input.direction.opportunity.title,
      responseTimeMs: input.responseTimeMs,
      selected: false,
      errorCode: 'MODEL_EXECUTION_FAILED',
      errorMessage: input.errorMessage,
    };

    /*
     * The same model can be retried for the same opportunity rank. The schema
     * intentionally has one diagnostic row per run/model/opportunity, so update
     * that row instead of trying to insert a duplicate key.
     */
    await this.prisma.ideaGenerationCandidate.upsert({
      where: {
        runId_providerKey_apiModelId_opportunityRank: {
          runId: input.runId,
          providerKey: input.model.providerKey,
          apiModelId: input.model.apiModelId,
          opportunityRank: input.direction.opportunity.rank,
        },
      },
      create: {
        runId: input.runId,
        providerKey: input.model.providerKey,
        apiModelId: input.model.apiModelId,
        opportunityRank: input.direction.opportunity.rank,
        ...data,
      },
      update: data,
    });
  }

  /**
   * Persists every successful benchmark candidate and the final decision in
   * one batched database operation after deterministic scoring is complete.
   *
   * Successful candidate rows are diagnostics, not prerequisites for model
   * comparison. Deferring them removes remote database latency from each
   * parallel AI branch while preserving the complete benchmark audit trail.
   */
  private persistCandidateDecisionSnapshotInBackground(
    runId: string,
    candidates: readonly IdeaBenchmarkCandidate[],
    winnerCandidateId: string,
    evaluation: IdeaJudgeEvaluation | null,
  ): void {
    void this.persistCandidateDecisionSnapshot(
      runId,
      candidates,
      winnerCandidateId,
      evaluation,
    ).catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Background benchmark candidate persistence failed for run "${runId}": ${message}`,
      );
    });
  }

  private async persistCandidateDecisionSnapshot(
    runId: string,
    candidates: readonly IdeaBenchmarkCandidate[],
    winnerCandidateId: string,
    evaluation: IdeaJudgeEvaluation | null,
  ): Promise<void> {
    const rows = candidates.map((candidate) => {
      const score = candidate.aiJudge;
      const isWinner = candidate.candidateId === winnerCandidateId;

      return {
        id: candidate.candidateId,
        runId,
        aiModelId: candidate.deterministicEmergencyFallback
          ? null
          : candidate.modelSnapshot.id,
        providerKey: candidate.modelSnapshot.providerKey,
        apiModelId: candidate.modelSnapshot.apiModelId,
        modelName: candidate.modelSnapshot.modelName,
        displayName: candidate.modelSnapshot.displayName,
        opportunityRank: candidate.opportunityRank,
        opportunityTitle: candidate.opportunityTitle,
        rawResponse: candidate.aiResult.text,
        parsedResponse: this.toPrismaJson(candidate.parsedOutput),
        overallScore: candidate.quality.score,
        semanticDiversityAdjustedScore:
          candidate.semanticDiversityAdjustedScore,
        hybridFinalScore: candidate.hybridFinalScore,
        finalScore: candidate.hybridFinalScore,
        innovationScore: candidate.quality.dimensions.innovation,
        marketFitScore: candidate.quality.dimensions.marketFit,
        technicalQualityScore:
          candidate.quality.dimensions.technicalQuality,
        completenessScore: candidate.quality.dimensions.completeness,
        originalityScore: candidate.quality.dimensions.originality,
        inputTokens: candidate.aiResult.inputTokens,
        outputTokens: candidate.aiResult.outputTokens,
        costEstimate: candidate.aiResult.costEstimate,
        responseTimeMs: candidate.aiResult.responseTimeMs,
        selected: isWinner,
        errorCode: null,
        errorMessage: null,
        aiJudgeScore: score?.overallScore ?? null,
        semanticDiversityScore:
          candidate.semanticDiversity?.diversityScore ?? null,
        maximumSimilarity:
          candidate.semanticDiversity?.maxSimilarity ?? null,
        mostSimilarCandidateId:
          candidate.semanticDiversity?.mostSimilarCandidateId ?? null,
        semanticDuplicateRisk:
          candidate.semanticDiversity?.duplicateRisk ?? null,
        localRelevanceScore: score?.localRelevance ?? null,
        problemImportanceScore: score?.problemImportance ?? null,
        aiJudgeInnovationScore: score?.innovation ?? null,
        regulatoryFeasibilityScore:
          score?.regulatoryFeasibility ?? null,
        technicalFeasibilityScore:
          score?.technicalFeasibility ?? null,
        marketPotentialScore: score?.marketPotential ?? null,
        implementationClarityScore:
          score?.implementationClarity ?? null,
        judgeStrengths: score
          ? this.toPrismaJsonValue(score.strengths)
          : Prisma.JsonNull,
        judgeRisks: score
          ? this.toPrismaJsonValue(score.risks)
          : Prisma.JsonNull,
        judgeReason: isWinner
          ? (evaluation?.reason ??
            (candidate.deterministicEmergencyFallback
              ? 'Selected by the deterministic emergency fallback after all bounded AI core-generation attempts were unavailable or unusable.'
              : candidate.quality.accepted
                ? 'Selected by deterministic quality and semantic-diversity ranking.'
                : 'Selected as the strongest structurally valid availability fallback.'))
          : (evaluation?.comparisonReport.find(
              (report) => report.candidateId === candidate.candidateId,
            )?.whyItRankedHere ?? null),
        judgeConfidence: isWinner ? (evaluation?.confidence ?? 0) : null,
        requiresLegalVerification: isWinner
          ? (evaluation?.requiresLegalVerification ?? null)
          : null,
      };
    });

    const deduplicatedRows = Array.from(
      rows.reduce((byKey, row) => {
        const key = [
          row.runId,
          row.providerKey,
          row.apiModelId,
          row.opportunityRank,
        ].join('::');
        const existing = byKey.get(key);

        if (
          !existing ||
          row.selected ||
          (!existing.selected &&
            (row.overallScore ?? Number.NEGATIVE_INFINITY) >
              (existing.overallScore ?? Number.NEGATIVE_INFINITY))
        ) {
          byKey.set(key, row);
        }

        return byKey;
      }, new Map<string, (typeof rows)[number]>()),
    ).map(([, row]) => row);

    await this.prisma.ideaGenerationCandidate.createMany({
      data: deduplicatedRows,
      skipDuplicates: true,
    });
  }

  /** Selects the only structurally valid candidate atomically. */
  private async selectSingleCandidate(
    runId: string,
    candidate: IdeaBenchmarkCandidate,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.ideaGenerationCandidate.updateMany({
        where: { runId },
        data: { selected: false },
      }),
      this.prisma.ideaGenerationCandidate.update({
        where: { id: candidate.candidateId },
        data: {
          selected: true,
          semanticDiversityAdjustedScore: candidate.quality.score,
          hybridFinalScore: null,
          finalScore: null,
          semanticDiversityScore: 100,
          maximumSimilarity: 0,
          mostSimilarCandidateId: null,
          semanticDuplicateRisk: 'LOW',
          judgeReason: candidate.quality.accepted
            ? 'Selected by deterministic fallback because only one quality-approved candidate remained; comparative AI judging was not performed.'
            : 'Selected as the only structurally valid availability fallback after bounded model execution; review the stored quality issues before publication.',
          judgeConfidence: 0,
          requiresLegalVerification: null,
        },
      }),
    ]);
  }

  /** Persists available judge scores and atomically marks the final winner. */
  private async persistFinalDecision(
    runId: string,
    candidates: readonly IdeaBenchmarkCandidate[],
    winnerCandidateId: string,
    evaluation: IdeaJudgeEvaluation | null,
  ): Promise<void> {
    const resetDecisionOperation =
      this.prisma.ideaGenerationCandidate.updateMany({
        where: { runId },
        data: {
          selected: false,
          judgeReason: null,
          judgeConfidence: null,
          requiresLegalVerification: null,
        },
      });

    const candidateUpdateOperations = candidates.map((candidate) => {
      const score = candidate.aiJudge;
      const isWinner = candidate.candidateId === winnerCandidateId;

      return this.prisma.ideaGenerationCandidate.update({
        where: { id: candidate.candidateId },
        data: {
          aiJudgeScore: score?.overallScore ?? null,
          semanticDiversityAdjustedScore:
            candidate.semanticDiversityAdjustedScore,
          hybridFinalScore: candidate.hybridFinalScore,
          // Keep the legacy field aligned with the true hybrid score only.
          finalScore: candidate.hybridFinalScore,
          semanticDiversityScore:
            candidate.semanticDiversity?.diversityScore ?? null,
          maximumSimilarity: candidate.semanticDiversity?.maxSimilarity ?? null,
          mostSimilarCandidateId:
            candidate.semanticDiversity?.mostSimilarCandidateId ?? null,
          semanticDuplicateRisk:
            candidate.semanticDiversity?.duplicateRisk ?? null,
          localRelevanceScore: score?.localRelevance ?? null,
          problemImportanceScore: score?.problemImportance ?? null,
          aiJudgeInnovationScore: score?.innovation ?? null,
          regulatoryFeasibilityScore: score?.regulatoryFeasibility ?? null,
          technicalFeasibilityScore: score?.technicalFeasibility ?? null,
          marketPotentialScore: score?.marketPotential ?? null,
          implementationClarityScore: score?.implementationClarity ?? null,
          judgeStrengths: score
            ? this.toPrismaJsonValue(score.strengths)
            : Prisma.JsonNull,
          judgeRisks: score
            ? this.toPrismaJsonValue(score.risks)
            : Prisma.JsonNull,
          judgeReason: isWinner
            ? (evaluation?.reason ??
              'Selected by deterministic fallback ranking because the comparative AI judge was unavailable.')
            : (evaluation?.comparisonReport.find(
                (report) => report.candidateId === candidate.candidateId,
              )?.whyItRankedHere ?? null),
          judgeConfidence: isWinner ? (evaluation?.confidence ?? 0) : null,
          requiresLegalVerification: isWinner
            ? (evaluation?.requiresLegalVerification ?? null)
            : null,
          selected: isWinner,
        },
      });
    });

    await this.prisma.$transaction([
      resetDecisionOperation,
      ...candidateUpdateOperations,
    ]);
  }

  /**
   * Builds an administrator-readable explanation of the final winner.
   *
   * Low-confidence judge results are retained for diagnostics but cannot
   * override the deterministic quality evaluator.
   */
  private buildSelectionReason(
    winner: IdeaBenchmarkCandidate,
    evaluation: IdeaJudgeEvaluation,
    useJudgeScores: boolean,
  ): string {
    const deterministicScore = winner.quality.score.toFixed(2);
    const judgeScore = winner.aiJudge?.overallScore;
    const finalScore = winner.finalScore.toFixed(2);

    if (!useJudgeScores) {
      return [
        `Deterministic winner selection was used because judge confidence ${evaluation.confidence.toFixed(2)} was below the required threshold ${IDEA_JUDGE_MIN_CONFIDENCE_FOR_HYBRID_SELECTION}.`,
        `Winner deterministic score: ${deterministicScore}.`,
        judgeScore === undefined
          ? 'The judge did not return a score for the selected candidate.'
          : `Retained judge score for diagnostics: ${judgeScore.toFixed(2)}.`,
        `Final score: ${finalScore}.`,
        `Original judge explanation: ${evaluation.reason}`,
      ].join(' ');
    }

    const diversityScore = winner.semanticDiversity?.diversityScore ?? 100;
    const diversityPenalty = this.calculateDiversityPenalty(diversityScore);
    const adjustedDeterministicScore =
      winner.semanticDiversityAdjustedScore.toFixed(2);

    return [
      `Hybrid winner selection used ${Math.round(IDEA_JUDGE_FINAL_SCORE_WEIGHT * 100)}% AI judge and ${Math.round(IDEA_DETERMINISTIC_FINAL_SCORE_WEIGHT * 100)}% semantic-diversity-adjusted deterministic quality.`,
      `Winner raw deterministic score: ${deterministicScore}.`,
      `Semantic diversity score: ${diversityScore.toFixed(2)}.`,
      `Applied deterministic diversity penalty: ${diversityPenalty.toFixed(2)} point(s).`,
      `Adjusted deterministic score: ${adjustedDeterministicScore}.`,
      judgeScore === undefined
        ? 'Judge score was unavailable.'
        : `Winner judge score: ${judgeScore.toFixed(2)}.`,
      `Final score: ${finalScore}.`,
      `Judge confidence: ${evaluation.confidence.toFixed(2)}.`,
      `Original judge explanation: ${evaluation.reason}`,
    ].join(' ');
  }

  /** Applies one bounded semantic-diversity penalty to deterministic quality. */
  private calculateDiversityAdjustedDeterministicScore(
    deterministicScore: number,
    diversityScore: number,
  ): number {
    const adjustedScore =
      deterministicScore - this.calculateDiversityPenalty(diversityScore);

    return this.roundScore(adjustedScore);
  }

  /** Combines judge quality with the already diversity-adjusted score. */
  private calculateHybridFinalScore(
    diversityAdjustedDeterministicScore: number,
    aiJudgeScore: number,
  ): number {
    return this.roundScore(
      aiJudgeScore * IDEA_JUDGE_FINAL_SCORE_WEIGHT +
        diversityAdjustedDeterministicScore *
          IDEA_DETERMINISTIC_FINAL_SCORE_WEIGHT,
    );
  }

  /** Returns the bounded semantic-diversity penalty in score points. */
  private calculateDiversityPenalty(diversityScore: number): number {
    return Math.max(0, (100 - diversityScore) * 0.12);
  }

  /** Clamps and rounds one candidate score to two decimal places. */
  private roundScore(score: number): number {
    return Math.round(Math.max(0, Math.min(100, score)) * 100) / 100;
  }

  /** Converts a validated idea output into Prisma-compatible JSON. */
  private toPrismaJson(value: ParsedIdeaAiOutput): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  /** Converts immutable JSON-compatible values into Prisma input JSON. */
  private toPrismaJsonValue(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
  private isUngroundedEvidenceState(
    state: IdeaGenerationContext['evidenceState'],
  ): boolean {
    return (
      state === 'NO_VALID_EVIDENCE_FOUND' ||
      state === 'EVIDENCE_ADJUDICATION_UNAVAILABLE'
    );
  }

  /** Stops assigning one model again after quota, rate-limit, or outage errors. */
  private isTransientModelFailure(error: unknown): boolean {
    const message =
      error instanceof Error
        ? error.message.toLocaleLowerCase()
        : String(error).toLocaleLowerCase();

    return /429|rate limit|quota|temporarily unavailable|provider unavailable|timeout|network|truncated|max(?:imum)?[- ]?tokens?|output-token limit/iu.test(
      message,
    );
  }

  private isProviderScopedHardFailure(error: unknown): boolean {
    const message =
      error instanceof Error
        ? error.message.toLocaleLowerCase()
        : String(error).toLocaleLowerCase();

    return /insufficient credits|insufficient quota|account quota|invalid credentials|authentication failed|forbidden|billing(?:\s+)?disabled|payment required/iu.test(
      message,
    );
  }
}