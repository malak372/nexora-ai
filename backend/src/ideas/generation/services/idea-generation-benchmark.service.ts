import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiRequestType, PromptType, Prisma, type AiModel } from '@prisma/client';

import { AiModelsService } from '../../../ai-models/ai-models.service';
import { AiExecutionService } from '../../../ai/services/ai-execution.service';
import type { AiExecutionResult } from '../../../ai/types/ai-execution-result.type';
import { AiResponseFormat } from '../../../ai/types/ai-provider.type';
import { PrismaService } from '../../../prisma/prisma.service';
import { IDEA_OWNER_TYPES } from '../../shared/constants/ideas.constants';
import {
  IDEA_DETERMINISTIC_FINAL_SCORE_WEIGHT,
  IDEA_JUDGE_FINAL_SCORE_WEIGHT,
} from '../constants/idea-judge.constants';
import {
  IDEA_BENCHMARK_INITIAL_MODEL_COUNT,
  IDEA_BENCHMARK_MAX_MODEL_ATTEMPTS,
  IDEA_BENCHMARK_MIN_SUCCESSFUL_CANDIDATES,
} from '../constants/idea-generation.constants';
import type { ParsedIdeaAiOutput } from '../types/idea-ai-output.type';
import type { IdeaGenerationContext } from '../types/idea-generation-context.type';
import type {
  IdeaJudgeCandidateScore,
  IdeaJudgeEvaluation,
} from '../types/idea-judge.type';
import { IdeaAiOutputParserService } from './idea-ai-output-parser.service';
import { IdeaCandidateJudgeService } from './idea-candidate-judge.service';
import { IdeaGenerationModelSelectorService } from './idea-generation-model-selector.service';
import {
  IdeaQualityEvaluatorService,
  type IdeaQualityEvaluation,
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
  readonly finalScore: number;
  readonly selected: boolean;
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

/**
 * Executes the same persisted generation prompt against every active,
 * routable model supporting structured JSON output.
 *
 * Every successfully generated and parsed candidate is persisted and sent to
 * the comparative AI judge. Failed candidates are recorded but excluded from
 * comparison. Winner selection uses a stable hybrid score: 70% comparative
 * AI-judge score and 30% deterministic quality. If the judge is unavailable,
 * deterministic ranking keeps the generation pipeline operational.
 *
 * Model eligibility is loaded dynamically from ai_models, so adding or
 * disabling a model automatically affects future benchmark runs.
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
  ) {}

  /**
   * Generates, persists, compares, and selects all successful candidates.
   *
   * @param context Current generation pipeline context.
   * @returns All successful candidates and the AI-selected winner.
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
    ).filter((model) => model.supportsJsonOutput);

    if (eligibleModels.length === 0) {
      throw new ServiceUnavailableException(
        'No active routable AI model supporting JSON output is available.',
      );
    }

    const orderedModels = await this.modelSelectorService.orderModels(
      context,
      eligibleModels,
    );

    // A retried run must start with a clean candidate snapshot.
    await this.prisma.ideaGenerationCandidate.deleteMany({
      where: { runId: context.runId },
    });

    const successfulCandidates: IdeaBenchmarkCandidate[] = [];
    const attemptedModelIds = new Set<string>();

    const initialModels = orderedModels.slice(
      0,
      IDEA_BENCHMARK_INITIAL_MODEL_COUNT,
    );

    const initialResults = await Promise.all(
      initialModels.map((model) =>
        this.executeModelCandidate(context, model).then(
          (candidate) => ({ candidate, model }),
          () => ({ candidate: null, model }),
        ),
      ),
    );

    for (const result of initialResults) {
      attemptedModelIds.add(result.model.id);

      if (result.candidate) {
        successfulCandidates.push(result.candidate);
      }
    }

    /*
     * Execute fallback models one at a time only when the initial group did
     * not produce enough valid candidates. This improves comparison quality
     * without paying the latency/rate-limit cost of running the full pool.
     */
    for (const model of orderedModels) {
      if (
        successfulCandidates.length >=
          IDEA_BENCHMARK_MIN_SUCCESSFUL_CANDIDATES ||
        attemptedModelIds.size >= IDEA_BENCHMARK_MAX_MODEL_ATTEMPTS
      ) {
        break;
      }

      if (attemptedModelIds.has(model.id)) {
        continue;
      }

      attemptedModelIds.add(model.id);

      try {
        const candidate = await this.executeModelCandidate(context, model);
        successfulCandidates.push(candidate);
      } catch {
        // Failure is already persisted and logged by executeModelCandidate.
      }
    }

    if (successfulCandidates.length === 0) {
      throw new ServiceUnavailableException(
        'Every configured AI model failed to generate a valid idea.',
      );
    }

    if (successfulCandidates.length === 1) {
      const onlyCandidate = successfulCandidates[0];

      await this.selectSingleCandidate(
        context.runId,
        onlyCandidate.candidateId,
      );

      const selectedCandidate: IdeaBenchmarkCandidate = {
        ...onlyCandidate,
        selected: true,
      };

      return {
        winner: selectedCandidate,
        candidates: [selectedCandidate],
        judgeEvaluation: null,
      };
    }

    const judgeEvaluation = await this.candidateJudgeService.evaluate(
      context,
      successfulCandidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        parsedOutput: candidate.parsedOutput,
      })),
    );

    const scoredCandidates = successfulCandidates.map((candidate) => {
      const aiJudge =
        judgeEvaluation?.scores.find(
          (score) => score.candidateId === candidate.candidateId,
        ) ?? null;

      const finalScore = this.calculateFinalScore(
        candidate.quality.score,
        aiJudge?.overallScore ?? null,
      );

      return {
        ...candidate,
        aiJudge,
        finalScore,
        selected: false,
      };
    });

    const rankedCandidates = [...scoredCandidates].sort(
      (first, second) =>
        second.finalScore - first.finalScore ||
        second.quality.score - first.quality.score ||
        first.aiResult.responseTimeMs - second.aiResult.responseTimeMs,
    );

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
          reason:
            `Hybrid winner selection (70% AI judge, 30% deterministic quality). ${judgeEvaluation.reason}`,
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
   * Executes, parses, evaluates, and persists one model candidate.
   *
   * Failures are persisted with an immutable model snapshot before the error is
   * rethrown so adaptive fallback selection can continue safely.
   */
  private async executeModelCandidate(
    context: IdeaGenerationContext,
    model: AiModel,
  ): Promise<IdeaBenchmarkCandidate> {
    const prompt = context.prompt;

    if (!prompt) {
      throw new ServiceUnavailableException(
        'A persisted prompt is required before model execution.',
      );
    }

    const startedAt = Date.now();

    try {
      const aiResult = await this.aiExecutionService.execute({
        aiModelId: model.id,
        userPrompt: prompt.promptText,
        systemInstruction:
          'Generate one specific, evidence-grounded, differentiated, locally deployable software product. Do not invent statistics, market sizes, legal conclusions, API availability, institutional counts, budgets, failure rates, or local facts. Mark estimates and assumptions explicitly.',
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
          ? 4_096
          : 2_048,
        temperature: 0.55,
      });

      const parsedOutput = this.outputParserService.parseOrThrow(aiResult.text);
      const quality = this.qualityEvaluatorService.evaluate(parsedOutput);
      const candidateId = await this.persistSuccessfulCandidate({
        runId: context.runId,
        model,
        aiResult,
        parsedOutput,
        quality,
      });

      return {
        candidateId,
        aiResult,
        parsedOutput,
        quality,
        aiJudge: null,
        finalScore: quality.score,
        selected: false,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Unknown model execution failure.';

      await this.persistFailedCandidate({
        runId: context.runId,
        model,
        responseTimeMs: Date.now() - startedAt,
        errorMessage,
      });

      this.logger.warn(
        `Idea benchmark model "${model.displayName ?? model.modelName}" failed: ${errorMessage}`,
      );

      throw error;
    }
  }

  /**
   * Persists one successful model execution and returns its candidate ID.
   */
  private async persistSuccessfulCandidate(input: {
    readonly runId: string;
    readonly model: {
      readonly id: string;
      readonly providerKey: string;
      readonly apiModelId: string;
      readonly modelName: string;
      readonly displayName: string | null;
    };
    readonly aiResult: AiExecutionResult;
    readonly parsedOutput: ParsedIdeaAiOutput;
    readonly quality: IdeaQualityEvaluation;
  }): Promise<string> {
    const candidate = await this.prisma.ideaGenerationCandidate.create({
      data: {
        runId: input.runId,
        aiModelId: input.model.id,
        providerKey: input.model.providerKey,
        apiModelId: input.model.apiModelId,
        modelName: input.model.modelName,
        displayName: input.model.displayName,
        rawResponse: input.aiResult.text,
        parsedResponse: this.toPrismaJson(input.parsedOutput),
        overallScore: input.quality.score,
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

  /**
   * Persists a failed execution while preserving its model snapshot.
   */
  private async persistFailedCandidate(input: {
    readonly runId: string;
    readonly model: {
      readonly id: string;
      readonly providerKey: string;
      readonly apiModelId: string;
      readonly modelName: string;
      readonly displayName: string | null;
    };
    readonly responseTimeMs: number;
    readonly errorMessage: string;
  }): Promise<void> {
    await this.prisma.ideaGenerationCandidate.create({
      data: {
        runId: input.runId,
        aiModelId: input.model.id,
        providerKey: input.model.providerKey,
        apiModelId: input.model.apiModelId,
        modelName: input.model.modelName,
        displayName: input.model.displayName,
        responseTimeMs: input.responseTimeMs,
        selected: false,
        errorCode: 'MODEL_EXECUTION_FAILED',
        errorMessage: input.errorMessage,
      },
    });
  }

  /**
   * Selects the only successful candidate when comparison is unnecessary.
   */
  private async selectSingleCandidate(
    runId: string,
    candidateId: string,
  ): Promise<void> {
    /*
     * Use Prisma's sequential batch transaction rather than an interactive
     * callback transaction. The batch form keeps both writes atomic without
     * being subject to the interactive transaction's short callback timeout.
     */
    await this.prisma.$transaction([
      this.prisma.ideaGenerationCandidate.updateMany({
        where: { runId },
        data: { selected: false },
      }),
      this.prisma.ideaGenerationCandidate.update({
        where: { id: candidateId },
        data: { selected: true },
      }),
    ]);
  }

  /**
   * Persists available judge scores and atomically marks the final winner.
   */
  private async persistFinalDecision(
    runId: string,
    candidates: readonly IdeaBenchmarkCandidate[],
    winnerCandidateId: string,
    evaluation: IdeaJudgeEvaluation | null,
  ): Promise<void> {
    /*
     * Build every database write before opening the transaction and execute
     * them with Prisma's sequential batch transaction API.
     *
     * The previous interactive transaction awaited one update at a time inside
     * a callback. Prisma closes interactive transactions after their callback
     * timeout, which caused the winner-persistence step to fail even though AI
     * generation and judging had already completed. Batch transactions preserve
     * atomicity without keeping a long-running JavaScript callback open.
     */
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
            : null,
          judgeConfidence: isWinner
            ? (evaluation?.confidence ?? 0)
            : null,
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
   * Calculates the final winner score.
   *
   * When the AI judge is unavailable, the deterministic score is used without
   * penalizing otherwise valid candidates.
   */
  private calculateFinalScore(
    deterministicScore: number,
    aiJudgeScore: number | null,
  ): number {
    if (aiJudgeScore === null) {
      return deterministicScore;
    }

    const score =
      aiJudgeScore * IDEA_JUDGE_FINAL_SCORE_WEIGHT +
      deterministicScore * IDEA_DETERMINISTIC_FINAL_SCORE_WEIGHT;

    return Math.round(score * 100) / 100;
  }

  /**
   * Converts a validated idea output into a Prisma-compatible JSON value.
   */
  private toPrismaJson(value: ParsedIdeaAiOutput): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  /**
   * Converts immutable JSON-compatible values into Prisma input JSON.
   */
  private toPrismaJsonValue(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}