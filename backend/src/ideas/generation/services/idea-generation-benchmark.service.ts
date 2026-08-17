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
} from '@prisma/client';

import { AiModelsService } from '../../../ai-models/ai-models.service';
import { AiExecutionService } from '../../../ai/services/ai-execution.service';
import {
  AI_PROVIDER_KEYS,
  normalizeAiProviderKey,
} from '../../../ai/constants/ai-provider.constants';
import type { AiExecutionResult } from '../../../ai/types/ai-execution-result.type';
import { AiResponseFormat } from '../../../ai/types/ai-provider.type';
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
import {
  matchEvidenceToAtomicProblem,
  matchEvidenceToProblemFamily,
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
 * This does not lower the quality gate or increase the number of candidates
 * required for selection. It only starts one extra already-eligible model in
 * parallel so a slow provider request cannot block a faster quality-approved
 * model behind a full timeout window.
 */
const IDEA_BENCHMARK_INITIAL_HEDGE_WIDTH = 2;

@Injectable()
export class IdeaGenerationBenchmarkService {
  private readonly logger = new Logger(IdeaGenerationBenchmarkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiModelsService: AiModelsService,
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
  ): Promise<IdeaBenchmarkResult> {
    const prompt = context.prompt;

    if (!prompt) {
      throw new ServiceUnavailableException(
        'A persisted prompt is required before model benchmarking.',
      );
    }

    const [routableModels, , duplicateCorpus] = await Promise.all([
        this.aiModelsService.getRoutableModels(),
        // Candidate cleanup is independent from model discovery. Starting both
        // together removes one remote database latency wave without changing
        // selection, scoring, or persistence semantics.
        this.prisma.ideaGenerationCandidate.deleteMany({
          where: { runId: context.runId },
        }),
        // Warm the bounded semantic corpus while model metadata is loading.
        // The returned rows are reused as a compact novelty guard in the first
        // provider prompt, so an already-known idea is avoided before paying
        // for a full duplicate-regeneration call.
        this.duplicateDetectionService.prepareBenchmarkSemanticCorpus(
          context.runId,
          context.domainId,
        ),
      ]);

    const eligibleModels = routableModels.filter((model) => {
      if (
        !model.supportsJsonOutput ||
        IDEA_BENCHMARK_EXCLUDED_CORE_MODEL_API_IDS.has(model.apiModelId)
      ) {
        return false;
      }

      const provider = normalizeAiProviderKey(model.providerKey);
      const isSlowMirroredGemini =
        provider === AI_PROVIDER_KEYS.OPENROUTER &&
        model.apiModelId === 'google/gemini-3.5-flash-lite';

      return !isSlowMirroredGemini;
    });

    if (eligibleModels.length === 0) {
      throw new ServiceUnavailableException(
        'No active routable AI model supporting JSON output is available.',
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
      ? eligibleModels.find(
          (model) =>
            normalizeAiProviderKey(model.providerKey) === AI_PROVIDER_KEYS.OLLAMA,
        )
      : undefined;

    const orderedModels =
      onlineModels.length > 0
        ? await this.modelSelectorService.orderModels(context, onlineModels)
        : [];

    /*
     * Fast-path policy:
     * - Up to two ordered online models may be latency-hedged in parallel.
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
    const blockedModelIds = new Set<string>();
    const warnedOpportunityTitles = new Set<string>();

    /*
     * Execute a bounded model batch for one opportunity at a time. When a
     * selected model fails or produces a rejected candidate, the next healthy
     * model in the ordered rotation is attempted immediately for the same
     * opportunity. This preserves comparative judging even during a temporary
     * provider outage without launching every routable model at once.
     */
    for (const [directionIndex, direction] of conceptDirections.entries()) {
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
      const hasRetainedDirectEvidence =
        direction.opportunity.evidenceSamples.length > 0 ||
        (direction.opportunity.independentEvidence?.length ?? 0) > 0;
      const isNoEvidenceHypothesis =
        direction.opportunity.disqualificationReasons.includes(
          'PRIMARY_DOMAIN_VALIDATION_HYPOTHESIS',
        ) ||
        direction.opportunity.disqualificationReasons.includes(
          'NO_DIRECT_EVIDENCE',
        ) ||
        !hasRetainedDirectEvidence;
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
        ? Math.min(attemptedCandidateCount + 1, IDEA_BENCHMARK_MAX_MODEL_ATTEMPTS)
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
            !attemptedModelIdsForDirection.has(model.id),
        );
        const isInitialWave = attemptedModelIdsForDirection.size === 0;
        const selectedModels = remainingEligibleModels;

        /*
         * Latency hedge:
         *
         * The product still needs only the configured target number of
         * candidates, but the first wave may start one extra eligible model.
         * The first quality-approved candidate keeps the existing early-stop
         * semantics and cancels the slower requests.
         *
         * This specifically avoids the expensive pattern where:
         * 1. a fast model returns a structurally valid but blocked fallback;
         * 2. another provider/model spends its complete timeout window; and
         * 3. only then is a third model allowed to start.
         *
         * Quality, evidence, duplicate detection, and the 70-point gate are
         * unchanged; only the wait order is changed.
         */
        const parallelWidth = isInitialWave
          ? Math.min(
              IDEA_BENCHMARK_INITIAL_HEDGE_WIDTH,
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

        const settledAttempts = await this.executeParallelCandidateBatch(
          context,
          modelsForDirection,
          direction,
          blockedModelIds,
          true,
        );

        for (const candidate of settledAttempts) {
          if (!candidate) {
            continue;
          }

          acceptedCandidatesForDirection.push(candidate);
          successfulCandidates.push(candidate);
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
      if (attemptedCandidateCount >= IDEA_BENCHMARK_MAX_MODEL_ATTEMPTS) {
        break;
      }
    }

    if (successfulCandidates.length === 0 && localFallbackModel) {
      const localCandidate = await this.executeLocalEmergencyFallback(
        context,
        localFallbackModel,
        conceptDirections,
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
      throw new ServiceUnavailableException(
        localFallbackModel
          ? 'No sufficiently distinct quality-approved idea could be generated after exhausting all online benchmark models and the local Ollama emergency fallback.'
          : 'No sufficiently distinct quality-approved idea could be generated after trying the configured online models, bounded duplicate redesign attempts, and ranked fallback opportunities. No local Ollama fallback model was available.',
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
        : successfulCandidates;

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
      deterministicJudgeGap < 6;

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
    allowQualityRevision = true,
  ): Promise<Array<IdeaBenchmarkCandidate | null>> {
    if (models.length <= 1) {
      const model = models[0];

      if (!model) {
        return [];
      }

      try {
        const candidate = await this.executeModelCandidate(
          context,
          model,
          direction,
          allowQualityRevision,
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
        if (this.isTransientModelFailure(error)) {
          blockedModelIds.add(model.id);
        }

        return [null];
      }
    }

    const controllers = models.map(() => new AbortController());
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
        allowQualityRevision,
        controllers[index].signal,
      )
        .then((candidate) => ({ index, candidate }))
        .catch((error: unknown) => ({ index, candidate: null, error }));

      pending.set(index, promise);
    });

    let acceptedGraceDeadlineAt: number | null = null;

    while (pending.size > 0) {
      const settlementPromise = Promise.race(pending.values()).then(
        (settled) =>
          ({
            kind: 'settled' as const,
            settled,
          }),
      );

      const next =
        acceptedGraceDeadlineAt === null
          ? await settlementPromise
          : await Promise.race([
              settlementPromise,
              this.createBenchmarkGraceTimeout(
                Math.max(0, acceptedGraceDeadlineAt - Date.now()),
              ),
            ]);

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

        acceptedGraceDeadlineAt = null;
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
          this.isTransientModelFailure(settled.error)
        ) {
          blockedModelIds.add(model.id);
          this.logger.warn(
            `Model "${model.displayName ?? model.modelName}" was removed from the remaining benchmark assignments after a transient provider failure.`,
          );
        }
      }

      const candidate = settled.candidate;
      const isQualityApproved =
        candidate?.quality.accepted === true &&
        candidate.quality.score >= IDEA_MIN_ACCEPTED_QUALITY_SCORE;

      if (!candidate || !isQualityApproved) {
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
      /*
       * Every hedged request has already finished, so return only the strongest
       * quality-approved candidate. This avoids paying for an additional
       * comparative-judge request after the deterministic gate has already
       * produced a clear bounded winner.
       */
      return results.map((candidate) =>
        candidate?.candidateId === bestAccepted.candidateId
          ? bestAccepted
          : null,
      );
    }

    return results;
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

  private async executeLocalEmergencyFallback(
    context: IdeaGenerationContext,
    localModel: AiModel,
    conceptDirections: readonly CandidateConceptDirection[],
  ): Promise<IdeaBenchmarkCandidate | null> {
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

    try {
      return await this.executeModelCandidate(
        context,
        localModel,
        primaryDirection,
        true,
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
       * Keep complete first-pass candidates for comparison. When a hedged
       * model is structurally valid but weak, its bounded revision may run in
       * parallel too; this avoids making quality recovery a serial latency tax.
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

      const isUnvalidatedHypothesis =
        direction.opportunity.disqualificationReasons.includes(
          'PRIMARY_DOMAIN_VALIDATION_HYPOTHESIS',
        ) ||
        direction.opportunity.disqualificationReasons.includes(
          'NO_DIRECT_EVIDENCE',
        );

      const acceptedAttempt = await this.resolveDistinctAttempt(
        context,
        model,
        direction,
        usableAttempt,
        qualityContext,
        signal,
        !isUnvalidatedHypothesis,
      );

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
    let duplicateResult = await this.checkAttemptDuplicate(
      context,
      currentAttempt,
    );

    if (!duplicateResult.isDuplicate) {
      return currentAttempt;
    }

    this.logDuplicateRejection(model, direction, 0, duplicateResult);

    if (!allowDuplicateRedesign) {
      this.logger.warn(
        `Duplicate redesign was skipped for unvalidated opportunity "${direction.opportunity.title}" to keep the benchmark bounded. The first complete candidate is returned with a deterministic identity adjustment instead of starting another provider/revision window.`,
      );
      return this.applyDeterministicIdentityDiversification(
        currentAttempt,
        direction,
      );
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

        duplicateResult = await this.checkAttemptDuplicate(
          context,
          currentAttempt,
        );

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

  private applyDeterministicIdentityDiversification(
    attempt: AcceptedModelAttempt,
    direction: CandidateConceptDirection,
  ): AcceptedModelAttempt {
    const coreIdea = attempt.parsedOutput.coreIdea;
    const baseTitle = coreIdea.title
      .replace(
        /\b(?:platform|workbench|system|solution|evidence|intake|pilot|validation)\b/giu,
        '',
      )
      .replace(/\s+/gu, ' ')
      .trim();
    const diversifiedTitle = `${baseTitle || 'Operational Insight'} Workspace`;
    return {
      ...attempt,
      parsedOutput: {
        ...attempt.parsedOutput,
        coreIdea: {
          ...coreIdea,
          title: diversifiedTitle,
          problemStatement: `${coreIdea.problemStatement} This bounded pilot uses the selected opportunity as a validation target and does not claim a distinct market-wide problem family.`,
        },
      },
    };
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

    return this.duplicateDetectionService.check(
      context.domainId,
      collectionJobId,
      attempt.parsedOutput.coreIdea,
      undefined,
      context.runId,
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
      allowTemporaryModelCooldownBypass: true,
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
      timeoutMs: this.resolveCoreModelTimeoutMs(model),
      maxRetriesPerModel: IDEA_BENCHMARK_TRANSIENT_RETRIES_PER_MODEL,
      signal,
    });
    const parsedOutput = this.outputParserService.parseOrThrow(aiResult.text);
    this.assertCandidateProblemSolutionPortfolio(context, parsedOutput);
    const quality = this.qualityEvaluatorService.evaluate(
      parsedOutput,
      qualityContext,
    );

    return { aiResult, parsedOutput, quality };
  }

  /**
   * Uses a shorter timeout for OpenRouter without shortening the direct Google
   * quality window. This prevents one unavailable routed model from adding a
   * full nine-second stall while preserving the stronger model response time.
   */
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

    this.assertWinnerProblemLock(context, parsedOutput);

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
    if (familyMatch.matched || atomicMatch.matched) {
      return;
    }

    const winnerFamilies = resolveProblemFamilyKeys(winnerEvidence).filter(
      (key) => !key.startsWith('lexical:') && key !== 'generic-friction',
    );
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
    const effectiveEvidenceSamples =
      this.resolveOpportunityEvidenceSamples(opportunity);
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
      !opportunity.selectionEligible && !isDefensiveFallbackAllowed;
    const opportunityDomainName =
      opportunity.matchedDomainNames?.[0]?.trim() ||
      (this.isJsonObject(opportunity.raw) &&
      typeof opportunity.raw.domainName === 'string'
        ? opportunity.raw.domainName.trim()
        : '');
    const finalClaimDomains = (
      opportunity.matchedDomainNames?.length
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
        `- The candidate is evaluated on a 100-point deterministic score and should reach at least ${IDEA_MIN_ACCEPTED_QUALITY_SCORE}/100 in this first response.`,
        '- Weighted dimensions: innovation 25%, market fit 25%, technical quality 20%, completeness 15%, originality 15%.',
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
          ? [
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
          ? [
              `- FINAL CLAIM SPACE: the selected opportunity is verified across ${alignedEvidenceDomains.join(', ')}. Use all and only these domains in the title, problem, target users, objectives, abstracts, features, architecture examples, market discussion, and pilot participants.`,
              `- Forbidden search-space domains for this candidate: ${forbiddenSearchDomains.join(', ') || 'none'}.`,
              '- Every target-user segment, objective, and capability must map to retained verified evidence supporting the selected opportunity.',
            ]
          : [
              `- FINAL CLAIM SPACE: generate only for ${alignedEvidenceDomains[0] ?? opportunityDomainName ?? context.domainName ?? 'the domain represented by the selected opportunity'}.`,
              `- Do not add users, workflows, institutions, capabilities, architecture examples, market claims, or pilot participants from these other selected search-space domains: ${forbiddenSearchDomains.join(', ') || 'none'}.`,
              '- Separate evidence attached to a shortlisted alternative does not authorize cross-domain wording in this candidate.',
              '- A contextual mention of a domain, organization, website, product name, or data source is not sufficient domain evidence. Classify the problem by the affected workflow and verified winner evidence.',
            ]),
        '- All candidates must solve the same supported problem portfolio, but each assigned direction must use a materially different primary user job, core workflow, and dominant capability combination.',
        '- Produce one coherent commercially viable software product, not a feature list or a minor patch.',
        ...(effectiveEvidenceSamples.length === 1
          ? [
              '- SPARSE-EVIDENCE SCOPE: exactly one direct evidence sample supports this opportunity. Prefer the smallest standalone product, configurable module, or narrow API that directly solves the observed user job.',
              '- USER-ALIGNMENT RULE: when the evidence is an end-user review or complaint, the default product must directly improve the affected user workflow. Do not redirect the solution to developers, QA teams, or platform operators unless the evidence explicitly identifies them as the affected user or direct buyer.',
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
      'Operational resilience and assisted triage',
      [
        'Make the primary buyer and operator an institutional IT, support, or platform-operations team.',
        'Center the product on evidence capture, incident triage, prioritization, and coordinated remediation across affected deployments.',
        'The dominant workflow must be operational diagnosis and response coordination, materially distinct from direct end-user resolution.',
      ],
    );

    return effectiveEvidenceSamples.length === 1
      ? [endUserDirection, developerDirection, operationalDirection]
      : [developerDirection, endUserDirection, operationalDirection];
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
    const retainedDirectEvidenceCount = (context.domainEvidence ?? []).reduce(
      (total, domain) => {
        const samplePostsCount = Array.isArray(domain.samplePosts)
          ? domain.samplePosts.length
          : 0;

        const sampleCommentsCount = Array.isArray(domain.sampleComments)
          ? domain.sampleComments.length
          : 0;

        return total + samplePostsCount + sampleCommentsCount;
      },
      0,
    );

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
      primaryDomainName,
      // This field is a leakage guard: only selected domains outside the
      // authoritative final claim set are forbidden. Valid multi-domain
      // validation hypotheses must not be penalized for naming their own
      // allowed claim domains.
      secondaryDomainNames: forbiddenDomainNames,
    };
  }

  /** Builds the application-controlled system instruction for all candidates. */
  private buildSystemInstruction(context: IdeaGenerationContext): string {
    const metrics = context.nlp
      ? `Trusted NLP totals: ${context.nlp.totalTextsAnalyzed} texts, ${context.nlp.totalPostsAnalyzed} posts, and ${context.nlp.totalCommentsAnalyzed} comments.`
      : 'Trusted NLP totals are unavailable.';

    return [
      'Generate one specific, evidence-grounded, differentiated, locally deployable software product.',
      'Use a natural public-facing product title. Never put Cross-Domain, Multi-Domain, Validation, Request Validation, Validation Pilot, Evidence Validation, Opportunity Discovery, Primary Domain, Preliminary Pilot, or a plus-sign-joined domain list in the title. Keep evidence/validation qualification in the narrative instead.',
      context.requestDescription
        ? `Requester intent: ${context.requestDescription}. This is a mandatory product-scope constraint for the final idea, but it is never evidence. Keep the selected product directly about the named user problem/workflow and do not substitute an easier same-domain problem. Preserve every material pain, operational constraint, named data source, and requested outcome from the description; do not silently drop one merely to simplify the product. Map each material dimension to the problem narrative, a concrete capability/objective, or an explicit pilot measurement/assumption. If evidence is weak, build the smallest validation-first product for this exact requester scope. If the wording asks to enhance, improve, automate, or optimize something with AI, treat AI as a preferred solution mechanism rather than a separate problem domain unless Artificial Intelligence is explicitly selected as a domain.`
        : '',
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
      'Preserve the assigned opportunity as the immutable evidence unit for the candidate: its title, problem, need, solution area, severity, frequency, verified matched domains, and retained evidence must remain mutually consistent. Do not merge a separate shortlisted opportunity into the candidate unless that opportunity is the explicit candidate-specific assignment.',
      'The final problemStatement must be one coherent problem-only narrative. Use only domains that have retained direct evidence in domainEvidence. A selected domain with zero retained posts and comments must not appear in targetUsers, objectives, abstracts, market claims, or advanced outputs.',
      'Classify domain alignment by the affected user workflow and unmet need, not by incidental words naming a government website, school, city, company, repository, or source system.',
      'A cybersecurity incident such as ransomware, deletion by an attacker, or a data breach is not evidence of ordinary synchronization failure, network timeout, or storage-choice demand. Do not reinterpret security incidents as product reliability evidence.',
      'When directEvidenceCount or frequency equals 1, use singular and qualified wording such as one report indicates or a limited evidence sample suggests. Never use frequently, recurring discussions, common, widespread, or equivalent market-wide language.',
      'When directEvidenceCount equals 1, the solution scope must remain proportional to one observed case: prefer one narrow user workflow and one primary product surface. Do not escalate a simple taxonomy, access, storage, or usability complaint into an enterprise SDK, telemetry platform, compliance suite, or CI/CD product unless host integration is strictly necessary and explicitly justified.',
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
        aiModelId: candidate.modelSnapshot.id,
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
            (candidate.quality.accepted
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
}