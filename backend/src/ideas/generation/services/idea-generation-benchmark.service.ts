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
  IDEA_BENCHMARK_EXCLUDED_CORE_MODEL_API_IDS,
  IDEA_BENCHMARK_INITIAL_OPPORTUNITY_COUNT,
  IDEA_BENCHMARK_MAX_MODEL_ATTEMPTS,
  IDEA_BENCHMARK_MIN_SUCCESSFUL_CANDIDATES,
  IDEA_BENCHMARK_MODELS_PER_OPPORTUNITY,
  IDEA_BENCHMARK_TRANSIENT_RETRIES_PER_MODEL,
  IDEA_DUPLICATE_REGENERATION_MAX_ATTEMPTS,
  IDEA_MIN_ACCEPTED_QUALITY_SCORE,
  IDEA_QUALITY_REVISION_MAX_ATTEMPTS,
} from '../constants/idea-generation.constants';
import type { ParsedIdeaAiOutput } from '../types/idea-ai-output.type';
import type { IdeaGenerationContext } from '../types/idea-generation-context.type';
import type { RankedIdeaOpportunity } from '../types/idea-opportunity-ranking.type';
import type {
  IdeaJudgeCandidateScore,
  IdeaJudgeEvaluation,
} from '../types/idea-judge.type';
import { IdeaAiOutputParserService } from './idea-ai-output-parser.service';
import { IdeaCandidateJudgeService } from './idea-candidate-judge.service';
import {
  IdeaDuplicateDetectionService,
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
 * - A weak response receives one bounded revision attempt on the same model.
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

    const eligibleModels = (
      await this.aiModelsService.getRoutableModels()
    ).filter(
      (model) =>
        model.supportsJsonOutput &&
        !IDEA_BENCHMARK_EXCLUDED_CORE_MODEL_API_IDS.has(model.apiModelId),
    );

    if (eligibleModels.length === 0) {
      throw new ServiceUnavailableException(
        'No active routable AI model supporting JSON output is available.',
      );
    }

    /*
     * Ollama must not participate in the normal comparative benchmark.
     * Otherwise several failed online assignments could each be replaced by
     * the same local model, producing duplicate Qwen candidates and weakening
     * provider diversity. The local model is retained separately and executed
     * exactly once only when every online candidate attempt fails.
     */
    const onlineModels = eligibleModels.filter(
      (model) =>
        normalizeAiProviderKey(model.providerKey) !== AI_PROVIDER_KEYS.OLLAMA,
    );
    const localFallbackModel = eligibleModels.find(
      (model) =>
        normalizeAiProviderKey(model.providerKey) === AI_PROVIDER_KEYS.OLLAMA,
    );

    const orderedModels =
      onlineModels.length > 0
        ? await this.modelSelectorService.orderModels(context, onlineModels)
        : [];

    // A retried run must start with a clean candidate snapshot.
    await this.prisma.ideaGenerationCandidate.deleteMany({
      where: { runId: context.runId },
    });

    const successfulCandidates: IdeaBenchmarkCandidate[] = [];
    const conceptDirections = this.buildConceptDirections(context);
    let attemptedCandidateCount = 0;
    const blockedModelIds = new Set<string>();

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
        successfulCandidates.length >= IDEA_BENCHMARK_MIN_SUCCESSFUL_CANDIDATES
      ) {
        this.logger.log(
          `Initial ${IDEA_BENCHMARK_INITIAL_OPPORTUNITY_COUNT} opportunities produced ${successfulCandidates.length} accepted candidates; fallback opportunities were skipped.`,
        );
        break;
      }

      const attemptedModelIdsForDirection = new Set<string>();
      const acceptedCandidatesForDirection: IdeaBenchmarkCandidate[] = [];

      while (
        acceptedCandidatesForDirection.length <
          IDEA_BENCHMARK_MODELS_PER_OPPORTUNITY &&
        attemptedCandidateCount < IDEA_BENCHMARK_MAX_MODEL_ATTEMPTS
      ) {
        const missingCandidateCount =
          IDEA_BENCHMARK_MODELS_PER_OPPORTUNITY -
          acceptedCandidatesForDirection.length;
        const remainingAttemptCount =
          IDEA_BENCHMARK_MAX_MODEL_ATTEMPTS - attemptedCandidateCount;

        const modelsForDirection = orderedModels
          .filter(
            (model) =>
              !blockedModelIds.has(model.id) &&
              !attemptedModelIdsForDirection.has(model.id),
          )
          .slice(0, Math.min(missingCandidateCount, remainingAttemptCount));

        if (modelsForDirection.length === 0) {
          break;
        }

        for (const model of modelsForDirection) {
          attemptedModelIdsForDirection.add(model.id);
        }
        attemptedCandidateCount += modelsForDirection.length;

        const settledAttempts = await Promise.all(
          modelsForDirection.map(async (model) => {
            try {
              return await this.executeModelCandidate(
                context,
                model,
                direction,
              );
            } catch (error: unknown) {
              if (this.isTransientModelFailure(error)) {
                blockedModelIds.add(model.id);
                this.logger.warn(
                  `Model "${model.displayName ?? model.modelName}" was removed from the remaining benchmark assignments after a transient provider failure.`,
                );
              }

              return null;
            }
          }),
        );

        for (const candidate of settledAttempts) {
          if (!candidate) {
            continue;
          }

          acceptedCandidatesForDirection.push(candidate);
          successfulCandidates.push(candidate);
        }
      }

      if (
        acceptedCandidatesForDirection.length <
        IDEA_BENCHMARK_MODELS_PER_OPPORTUNITY
      ) {
        this.logger.warn(
          `Opportunity "${direction.opportunity.title}" produced ${acceptedCandidatesForDirection.length}/${IDEA_BENCHMARK_MODELS_PER_OPPORTUNITY} accepted candidate(s) after exhausting its healthy model fallbacks.`,
        );
      }
    }

    if (successfulCandidates.length === 0 && localFallbackModel) {
      const localCandidate = await this.executeLocalEmergencyFallback(
        context,
        localFallbackModel,
        conceptDirections,
      );

      if (localCandidate) {
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

    if (successfulCandidates.length === 1) {
      const onlyCandidate = successfulCandidates[0];

      await this.selectSingleCandidate(context.runId, onlyCandidate);

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
        selected: true,
      };

      return {
        winner: selectedCandidate,
        candidates: [selectedCandidate],
        judgeEvaluation: null,
      };
    }

    const diversityScores = this.semanticDiversityService.evaluate(
      successfulCandidates.map((candidate) => ({
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
      successfulCandidates,
      IDEA_JUDGE_MAX_CANDIDATES,
    );
    const judgeCandidateIds = new Set(
      judgeCandidates.map((candidate) => candidate.candidateId),
    );

    const judgeEvaluation = await this.candidateJudgeService.evaluate(
      context,
      judgeCandidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        parsedOutput: candidate.parsedOutput,
      })),
    );

    const useJudgeScores =
      judgeEvaluation !== null &&
      judgeEvaluation.confidence >=
        IDEA_JUDGE_MIN_CONFIDENCE_FOR_HYBRID_SELECTION;

    const diversityScoresForScoring = diversityScores;

    const scoredCandidates = successfulCandidates.map((candidate) => {
      const aiJudge =
        judgeEvaluation?.scores.find(
          (score) => score.candidateId === candidate.candidateId,
        ) ?? null;
      const semanticDiversity =
        diversityScoresForScoring.get(candidate.candidateId) ?? null;

      const diversityScore = semanticDiversity?.diversityScore ?? 100;
      const semanticDiversityAdjustedScore = this.calculateFinalScore(
        candidate.quality.score,
        null,
        diversityScore,
      );
      const hybridFinalScore =
        useJudgeScores &&
        judgeCandidateIds.has(candidate.candidateId) &&
        aiJudge !== null
          ? this.calculateFinalScore(
              candidate.quality.score,
              aiJudge.overallScore,
              diversityScore,
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

    await this.persistFinalDecision(
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
      );
      const qualityApprovedAttempt = initialAttempt.quality.accepted
        ? initialAttempt
        : await this.reviseWeakCandidate(
            context,
            model,
            initialAttempt,
            qualityContext,
            direction.promptText,
          );

      if (!qualityApprovedAttempt.quality.accepted) {
        const errorMessage = this.buildQualityRejectionMessage(
          qualityApprovedAttempt.quality,
        );

        await this.persistRejectedCandidate({
          runId: context.runId,
          model,
          attempt: qualityApprovedAttempt,
          errorMessage,
          direction,
        });
        failurePersisted = true;

        throw new ServiceUnavailableException(errorMessage);
      }

      const acceptedAttempt = await this.resolveDistinctAttempt(
        context,
        model,
        direction,
        qualityApprovedAttempt,
        qualityContext,
      );

      const candidateId = await this.persistSuccessfulCandidate({
        runId: context.runId,
        model,
        aiResult: acceptedAttempt.aiResult,
        parsedOutput: acceptedAttempt.parsedOutput,
        quality: acceptedAttempt.quality,
        direction,
      });

      return {
        candidateId,
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
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Unknown model execution failure.';

      const duplicateRejectionPersisted = errorMessage.startsWith(
        'SEMANTIC_DUPLICATE_REJECTED:',
      );

      if (!failurePersisted && !duplicateRejectionPersisted) {
        await this.persistFailedCandidate({
          runId: context.runId,
          model,
          responseTimeMs: Date.now() - startedAt,
          errorMessage,
          direction,
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
  ): Promise<AcceptedModelAttempt> {
    let currentAttempt = initialAttempt;
    let duplicateResult = await this.checkAttemptDuplicate(
      context,
      currentAttempt,
    );

    if (!duplicateResult.isDuplicate) {
      return currentAttempt;
    }

    this.logDuplicateRejection(model, direction, 0, duplicateResult);

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
        );
        currentAttempt = generatedAttempt.quality.accepted
          ? generatedAttempt
          : await this.reviseWeakCandidate(
              context,
              model,
              generatedAttempt,
              qualityContext,
              redesignPrompt,
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

    await this.persistRejectedCandidate({
      runId: context.runId,
      model,
      attempt: currentAttempt,
      errorCode: 'SEMANTIC_DUPLICATE_REJECTED',
      errorMessage,
      direction,
    });

    throw new ServiceUnavailableException(errorMessage);
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
    );
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
            '- Change the core workflow and primary value proposition.',
            '- Replace the main user journey, not only the title, wording, or feature names.',
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
      '<previous_rejected_candidate_json>',
      JSON.stringify(previousAttempt.parsedOutput),
      '</previous_rejected_candidate_json>',
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
  ): Promise<AcceptedModelAttempt> {
    const prompt = context.prompt;

    if (!prompt) {
      throw new ServiceUnavailableException(
        'A persisted prompt is required before model execution.',
      );
    }

    const aiResult = await this.aiExecutionService.execute({
      aiModelId: model.id,
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
        ? 6_144
        : 2_048,
      maxOutputTokens: context.policy?.includePremiumOutputs ? 8_192 : 2_048,
      temperature: 0.55,
      // Retry the exact assigned model once for transient provider failures.
      // If that bounded retry is exhausted, the benchmark loop immediately
      // replaces the failed assignment with the next healthy model in its
      // provider-diverse fallback rotation. This keeps candidate attribution
      // correct while preventing one temporary network failure from reducing
      // the comparative benchmark to a single candidate.
      timeoutMs: 90_000,
      maxRetriesPerModel: IDEA_BENCHMARK_TRANSIENT_RETRIES_PER_MODEL,
    });
    const parsedOutput = this.outputParserService.parseOrThrow(aiResult.text);
    const quality = this.qualityEvaluatorService.evaluate(
      parsedOutput,
      qualityContext,
    );

    return { aiResult, parsedOutput, quality };
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
  ): Promise<AcceptedModelAttempt> {
    if (!context.prompt || initialAttempt.quality.accepted) {
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
      '- Keep valid strengths from the previous candidate while fixing every listed weakness.',
      '- Do not invent facts, APIs, regulations, statistics, local evidence, user complaints, or market claims.',
      '<deterministic_quality_feedback>',
      this.qualityEvaluatorService.buildImprovementInstructions(
        previousAttempt.quality,
      ),
      '</deterministic_quality_feedback>',
      '<previous_candidate_json>',
      JSON.stringify(previousAttempt.parsedOutput),
      '</previous_candidate_json>',
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
        ...(!opportunity.selectionEligible
          ? [
              isControlledSparseFallback
                ? '- QUALITY QUALIFIER: this opportunity is a controlled sparse-evidence fallback selected only after bounded recovery. Treat the problem as a hypothesis to validate, make no market-wide or local-prevalence claims, and require evidence collection as an explicit first pilot activity.'
                : '- QUALITY QUALIFIER: this opportunity is a controlled evidence-backed fallback. Keep claims conservative, explicitly qualify uncertainty, and frame validation as part of the pilot.',
            ]
          : []),
        '- Do not switch to, merge with, or replace it using an alternative opportunity.',
        '- All candidates must solve the same observed problem, but each assigned direction must use a materially different primary user job, core workflow, and dominant capability combination.',
        '- Produce one coherent commercially viable software product, not a feature list or a minor patch. The product may use a host-integrated SDK, vendor backend, or supported companion workflow when platform boundaries require it.',
        '- Use only the supplied evidence for problem and local claims.',
        '- Treat the requested location as the initial pilot target unless direct local evidence explicitly proves local prevalence.',
        '- Any numerical impact goal must state an explicit direction such as increase, improvement, reduction, or decrease. Use one complete grammatical form: "Target at least a X percent increase/reduction during a defined pilot period, measured by ..." or "Evaluate whether the pilot can achieve at least a X percent increase/reduction during a defined period, measured by ...". Never use the ambiguous phrase "percent change", combine the openings, or write "target an evaluate".',
        '- Check spelling in the product name and all proper nouns. Never use common misspellings such as "Resiliant"; use "Resilient".',
        '- Do not present an inferred root cause as observed fact. Use wording such as plausible technical cause, likely failure pattern, or hypothesis to validate unless the evidence explicitly proves causation.',
        "- Respect operating-system and application sandbox boundaries. A standalone mobile or desktop app cannot read another app's secure receipts, private logs, storage, or identifiers unless a host-integrated SDK, supported API/export, or explicit user-authorized import makes that access possible.",
        '- Make the supported integration path primary in the title direction, objectives, architecture, and abstract; do not mention an SDK only as an optional afterthought when the core workflow depends on host-app access.',
        "- For subscription, receipt, entitlement, or account-recovery concepts involving third-party apps, use one of these primary designs: (a) an SDK embedded by the host application plus a vendor-owned verification backend, or (b) a user-authorized diagnostic/import workflow that does not claim to change the host app entitlement. A standalone independent verification bridge that reads or restores another app's subscription is technically invalid.",
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

    return [
      buildDirection('Prevention and developer remediation', [
        'Make the primary buyer and operator a development, QA, or product engineering team.',
        'Center the product on detecting, reproducing, prioritizing, and preventing the failure before it reaches users.',
        'The dominant workflow must be engineering remediation, not end-user session restoration.',
      ]),
      buildDirection('User continuity and state recovery', [
        'Make the primary outcome preservation of user work and rapid continuity after interruption.',
        'Center the product on safe checkpointing, recovery orchestration, and user-visible continuity.',
        'The dominant workflow must be state preservation and recovery, not merely crash analytics or developer monitoring.',
      ]),
      buildDirection('Operational resilience and assisted triage', [
        'Make the primary buyer and operator an institutional IT, support, or platform-operations team.',
        'Center the product on evidence capture, incident triage, prioritization, and coordinated remediation across affected deployments.',
        'The dominant workflow must be operational diagnosis and response coordination, materially distinct from developer prevention and end-user state recovery.',
      ]),
    ];
  }

  /** Builds trusted metrics used by premium-output quality validation. */
  private buildQualityContext(
    context: IdeaGenerationContext,
  ): IdeaQualityEvaluationContext {
    return {
      totalTextsAnalyzed: context.nlp?.totalTextsAnalyzed,
      totalPostsAnalyzed: context.nlp?.totalPostsAnalyzed,
      totalCommentsAnalyzed: context.nlp?.totalCommentsAnalyzed,
      requireAdvancedOutputs: context.policy?.includePremiumOutputs ?? false,
      targetCountry: context.location.country,
      targetCity: context.location.city,
      targetRegion: context.location.region,
      localEvidenceVerified: this.hasVerifiedLocalEvidence(context),
    };
  }

  /** Builds the application-controlled system instruction for all candidates. */
  private buildSystemInstruction(context: IdeaGenerationContext): string {
    const metrics = context.nlp
      ? `Trusted NLP totals: ${context.nlp.totalTextsAnalyzed} texts, ${context.nlp.totalPostsAnalyzed} posts, and ${context.nlp.totalCommentsAnalyzed} comments.`
      : 'Trusted NLP totals are unavailable.';

    return [
      'Generate one specific, evidence-grounded, differentiated, locally deployable software product.',
      'Do not invent statistics, market sizes, legal conclusions, API availability, institutional counts, failure rates, or local facts.',
      'When evidence is not locally verified, describe the discovered problem generally and say that the initial pilot deployment is planned for the target location. Never write that students, faculty, institutions, or residents in the requested city currently face or report the problem.',
      'Mark estimates and assumptions explicitly. Any inferred root cause must be described as a plausible hypothesis to validate unless direct evidence proves causation. A percentage objective must use one complete grammatical form with an explicit direction: "Target at least a X percent increase/reduction during a defined pilot period, measured by ..." or "Evaluate whether the pilot can achieve at least a X percent increase/reduction during a defined period, measured by ...". Never use the ambiguous phrase "percent change", never write "target an evaluate", and never present the percentage as a promise.',
      'Treat store descriptions and promotional product copy as contextual source material, never as direct proof of a user complaint or unmet need.',
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
    const candidate = await this.prisma.ideaGenerationCandidate.create({
      data: {
        runId: input.runId,
        aiModelId: input.model.id,
        providerKey: input.model.providerKey,
        apiModelId: input.model.apiModelId,
        modelName: input.model.modelName,
        displayName: input.model.displayName,
        opportunityRank: input.direction.opportunity.rank,
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
      },
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
    await this.prisma.ideaGenerationCandidate.create({
      data: {
        runId: input.runId,
        aiModelId: input.model.id,
        providerKey: input.model.providerKey,
        apiModelId: input.model.apiModelId,
        modelName: input.model.modelName,
        displayName: input.model.displayName,
        opportunityRank: input.direction.opportunity.rank,
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
      },
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
    await this.prisma.ideaGenerationCandidate.create({
      data: {
        runId: input.runId,
        aiModelId: input.model.id,
        providerKey: input.model.providerKey,
        apiModelId: input.model.apiModelId,
        modelName: input.model.modelName,
        displayName: input.model.displayName,
        opportunityRank: input.direction.opportunity.rank,
        opportunityTitle: input.direction.opportunity.title,
        responseTimeMs: input.responseTimeMs,
        selected: false,
        errorCode: 'MODEL_EXECUTION_FAILED',
        errorMessage: input.errorMessage,
      },
    });
  }

  /** Selects the only quality-approved candidate atomically. */
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
          judgeReason:
            'Selected because it was the only quality-approved candidate available for this benchmark run.',
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

    return [
      `Hybrid winner selection used ${Math.round(IDEA_JUDGE_FINAL_SCORE_WEIGHT * 100)}% AI judge and ${Math.round(IDEA_DETERMINISTIC_FINAL_SCORE_WEIGHT * 100)}% deterministic quality.`,
      `Winner deterministic score: ${deterministicScore}.`,
      judgeScore === undefined
        ? 'Judge score was unavailable.'
        : `Winner judge score: ${judgeScore.toFixed(2)}.`,
      `Final score: ${finalScore}.`,
      `Judge confidence: ${evaluation.confidence.toFixed(2)}.`,
      `Original judge explanation: ${evaluation.reason}`,
    ].join(' ');
  }

  /** Calculates the stable hybrid winner score. */
  private calculateFinalScore(
    deterministicScore: number,
    aiJudgeScore: number | null,
    diversityScore: number,
  ): number {
    const baseScore =
      aiJudgeScore === null
        ? deterministicScore
        : aiJudgeScore * IDEA_JUDGE_FINAL_SCORE_WEIGHT +
          deterministicScore * IDEA_DETERMINISTIC_FINAL_SCORE_WEIGHT;

    // Diversity acts as a bounded penalty, not as a substitute for quality.
    // A concept with 100 diversity keeps its full score; a near duplicate can
    // lose at most 12 points, preventing repeated ideas from winning only due
    // to polished wording.
    const diversityPenalty = Math.max(0, (100 - diversityScore) * 0.12);
    return Math.round(Math.max(0, baseScore - diversityPenalty) * 100) / 100;
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

    return /429|rate limit|quota|temporarily unavailable|provider unavailable|timeout|network/iu.test(
      message,
    );
  }
}
