import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiRequestType, PromptType, Prisma } from '@prisma/client';

import { AiModelsService } from '../../../ai-models/ai-models.service';
import { AiExecutionService } from '../../../ai/services/ai-execution.service';
import type { AiExecutionResult } from '../../../ai/types/ai-execution-result.type';
import { AiResponseFormat } from '../../../ai/types/ai-provider.type';
import { PrismaService } from '../../../prisma/prisma.service';
import { IDEA_OWNER_TYPES } from '../../shared/constants/ideas.constants';
import type { ParsedIdeaAiOutput } from '../types/idea-ai-output.type';
import type { IdeaGenerationContext } from '../types/idea-generation-context.type';
import type {
  IdeaJudgeCandidateScore,
  IdeaJudgeEvaluation,
} from '../types/idea-judge.type';
import { IdeaAiOutputParserService } from './idea-ai-output-parser.service';
import { IdeaCandidateJudgeService } from './idea-candidate-judge.service';
import {
  IdeaQualityEvaluatorService,
  type IdeaQualityEvaluation,
} from './idea-quality-evaluator.service';

/**
 * One successfully generated benchmark candidate.
 *
 * quality is retained for validation diagnostics and internal analytics only.
 * It never participates in winner selection. aiJudge contains the comparative
 * score returned by the AI judge when at least two candidates succeeded.
 *
 * @author Malak
 */
export type IdeaBenchmarkCandidate = {
  readonly candidateId: string;
  readonly aiResult: AiExecutionResult;
  readonly parsedOutput: ParsedIdeaAiOutput;
  readonly quality: IdeaQualityEvaluation;
  readonly aiJudge: IdeaJudgeCandidateScore | null;
  readonly selected: boolean;
};

/**
 * Final result of executing and comparing all eligible AI models.
 *
 * judgeEvaluation is null only when exactly one model produced a valid
 * candidate and no comparison was necessary.
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
 * comparison. The deterministic evaluator is retained for diagnostics only;
 * the AI judge alone selects the winner whenever multiple candidates exist.
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

    const models = (await this.aiModelsService.getRoutableModels()).filter(
      (model) => model.supportsJsonOutput,
    );

    if (models.length === 0) {
      throw new ServiceUnavailableException(
        'No active routable AI model supporting JSON output is available.',
      );
    }

    // A retried run must start with a clean candidate snapshot.
    await this.prisma.ideaGenerationCandidate.deleteMany({
      where: { runId: context.runId },
    });

    const settledResults = await Promise.allSettled(
      models.map(async (model): Promise<IdeaBenchmarkCandidate> => {
        const startedAt = Date.now();

        try {
          const aiResult = await this.aiExecutionService.execute({
            aiModelId: model.id,
            userPrompt: prompt.promptText,
            systemInstruction:
              'Generate one specific, evidence-grounded, differentiated, locally relevant, technically feasible software product. Avoid generic CRUD-only ideas and do not invent evidence.',
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
            temperature: 0.65,
          });

          const parsedOutput = this.outputParserService.parseOrThrow(
            aiResult.text,
          );
          const quality = this.qualityEvaluatorService.evaluate(parsedOutput);
          const candidateId = await this.persistSuccessfulCandidate({
            runId: context.runId,
            model: {
              id: model.id,
              providerKey: model.providerKey,
              apiModelId: model.apiModelId,
              modelName: model.modelName,
              displayName: model.displayName,
            },
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
            selected: false,
          };
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error
              ? error.message
              : 'Unknown model execution failure.';

          await this.persistFailedCandidate({
            runId: context.runId,
            model: {
              id: model.id,
              providerKey: model.providerKey,
              apiModelId: model.apiModelId,
              modelName: model.modelName,
              displayName: model.displayName,
            },
            responseTimeMs: Date.now() - startedAt,
            errorMessage,
          });

          this.logger.warn(
            `Idea benchmark model "${model.displayName ?? model.modelName}" failed: ${errorMessage}`,
          );

          throw error;
        }
      }),
    );

    const successfulCandidates = settledResults
      .filter(
        (result): result is PromiseFulfilledResult<IdeaBenchmarkCandidate> =>
          result.status === 'fulfilled',
      )
      .map((result) => result.value);

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
      const aiJudge = judgeEvaluation.scores.find(
        (score) => score.candidateId === candidate.candidateId,
      );

      if (!aiJudge) {
        throw new ServiceUnavailableException(
          'The AI judge did not return a score for every successful candidate.',
        );
      }

      return {
        ...candidate,
        aiJudge,
        selected: candidate.candidateId === judgeEvaluation.winnerCandidateId,
      };
    });

    await this.persistJudgeDecision(
      context.runId,
      scoredCandidates,
      judgeEvaluation,
    );

    const rankedCandidates = [...scoredCandidates].sort((first, second) => {
      if (first.selected !== second.selected) {
        return first.selected ? -1 : 1;
      }

      return (
        (second.aiJudge?.overallScore ?? 0) - (first.aiJudge?.overallScore ?? 0)
      );
    });

    const winner = rankedCandidates.find((candidate) => candidate.selected);

    if (!winner) {
      throw new ServiceUnavailableException(
        'The AI judge winner could not be selected.',
      );
    }

    return {
      winner,
      candidates: rankedCandidates,
      judgeEvaluation,
    };
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
    await this.prisma.$transaction(async (transaction) => {
      await transaction.ideaGenerationCandidate.updateMany({
        where: { runId },
        data: { selected: false },
      });

      await transaction.ideaGenerationCandidate.update({
        where: { id: candidateId },
        data: { selected: true },
      });
    });
  }

  /**
   * Persists every judge score and atomically marks the AI-selected winner.
   */
  private async persistJudgeDecision(
    runId: string,
    candidates: readonly IdeaBenchmarkCandidate[],
    evaluation: IdeaJudgeEvaluation,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.ideaGenerationCandidate.updateMany({
        where: { runId },
        data: {
          selected: false,
          judgeReason: null,
          judgeConfidence: null,
          requiresLegalVerification: null,
        },
      });

      for (const candidate of candidates) {
        const score = candidate.aiJudge;

        if (!score) {
          throw new Error(
            `Missing AI-judge score for candidate "${candidate.candidateId}".`,
          );
        }

        const isWinner = candidate.candidateId === evaluation.winnerCandidateId;

        await transaction.ideaGenerationCandidate.update({
          where: { id: candidate.candidateId },
          data: {
            aiJudgeScore: score.overallScore,
            localRelevanceScore: score.localRelevance,
            problemImportanceScore: score.problemImportance,
            aiJudgeInnovationScore: score.innovation,
            regulatoryFeasibilityScore: score.regulatoryFeasibility,
            technicalFeasibilityScore: score.technicalFeasibility,
            marketPotentialScore: score.marketPotential,
            implementationClarityScore: score.implementationClarity,
            judgeStrengths: this.toPrismaJsonValue(score.strengths),
            judgeRisks: this.toPrismaJsonValue(score.risks),
            judgeReason: isWinner ? evaluation.reason : null,
            judgeConfidence: isWinner ? evaluation.confidence : null,
            requiresLegalVerification: isWinner
              ? evaluation.requiresLegalVerification
              : null,
            selected: isWinner,
          },
        });
      }
    });
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
