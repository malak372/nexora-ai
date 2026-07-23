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
import { IdeaAiOutputParserService } from './idea-ai-output-parser.service';
import {
  IdeaQualityEvaluatorService,
  type IdeaQualityEvaluation,
} from './idea-quality-evaluator.service';

/**
 * One successfully generated and evaluated benchmark candidate.
 *
 * @author Malak
 */
export type IdeaBenchmarkCandidate = {
  readonly aiResult: AiExecutionResult;
  readonly parsedOutput: ParsedIdeaAiOutput;
  readonly quality: IdeaQualityEvaluation;
  readonly selected: boolean;
};

/**
 * Final result of benchmarking all currently eligible AI models.
 *
 * @author Malak
 */
export type IdeaBenchmarkResult = {
  readonly winner: IdeaBenchmarkCandidate;
  readonly candidates: readonly IdeaBenchmarkCandidate[];
};

/**
 * Executes the same persisted idea-generation prompt against every active,
 * routable model that supports structured JSON output.
 *
 * Successful and failed executions are stored independently so one failing
 * model does not abort the complete benchmark. The highest-quality successful
 * candidate is selected as the winner. Equal scores prefer lower cost, then
 * lower latency, then a stable model identifier.
 *
 * Model eligibility is loaded dynamically from the ai_models table. Adding or
 * disabling a model therefore affects future runs without hard-coded model IDs.
 * A provider adapter must still be registered for each providerKey.
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
  ) {}

  /**
   * Generates, evaluates, persists, ranks, and selects model candidates.
   *
   * @param context Current generation pipeline context.
   * @returns All successful candidates and the selected winner.
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

    // A retried generation run must start with a clean benchmark snapshot.
    await this.prisma.ideaGenerationCandidate.deleteMany({
      where: { runId: context.runId },
    });

    const settledResults: PromiseSettledResult<IdeaBenchmarkCandidate>[] =
      await Promise.allSettled(
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
                ? 4096
                : 2048,
              temperature: 0.65,
            });

            const parsedOutput = this.outputParserService.parseOrThrow(
              aiResult.text,
            );
            const quality = this.qualityEvaluatorService.evaluate(parsedOutput);

            await this.persistSuccessfulCandidate({
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
              aiResult,
              parsedOutput,
              quality,
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

    const successfulCandidates: IdeaBenchmarkCandidate[] = settledResults
      .filter(
        (result): result is PromiseFulfilledResult<IdeaBenchmarkCandidate> =>
          result.status === 'fulfilled',
      )
      .map((result) => result.value)
      .sort((first, second) => this.compareCandidates(first, second));

    const winner = successfulCandidates[0];

    if (!winner) {
      throw new ServiceUnavailableException(
        'Every configured AI model failed to generate a valid idea.',
      );
    }

    await this.selectWinner(context.runId, winner);

    const rankedCandidates: IdeaBenchmarkCandidate[] = successfulCandidates.map(
      (candidate) => ({
        ...candidate,
        selected:
          candidate.aiResult.providerKey === winner.aiResult.providerKey &&
          candidate.aiResult.apiModelId === winner.aiResult.apiModelId,
      }),
    );

    const selectedWinner = rankedCandidates[0];

    if (!selectedWinner) {
      throw new ServiceUnavailableException(
        'The benchmark winner could not be selected.',
      );
    }

    return {
      winner: selectedWinner,
      candidates: rankedCandidates,
    };
  }

  /**
   * Persists one successful model execution using the current Prisma schema.
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
  }): Promise<void> {
    await this.prisma.ideaGenerationCandidate.create({
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
    });
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
   * Atomically clears any old selection and marks the current winner.
   */
  private async selectWinner(
    runId: string,
    winner: IdeaBenchmarkCandidate,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.ideaGenerationCandidate.updateMany({
        where: { runId },
        data: { selected: false },
      });

      await transaction.ideaGenerationCandidate.update({
        where: {
          runId_providerKey_apiModelId: {
            runId,
            providerKey: winner.aiResult.providerKey,
            apiModelId: winner.aiResult.apiModelId,
          },
        },
        data: { selected: true },
      });
    });
  }

  /**
   * Converts a validated domain object into a Prisma-compatible JSON value.
   */
  private toPrismaJson(value: ParsedIdeaAiOutput): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  /**
   * Higher quality wins. Ties prefer lower cost, lower latency, then model ID.
   */
  private compareCandidates(
    first: IdeaBenchmarkCandidate,
    second: IdeaBenchmarkCandidate,
  ): number {
    if (first.quality.score !== second.quality.score) {
      return second.quality.score - first.quality.score;
    }

    if (first.aiResult.costEstimate !== second.aiResult.costEstimate) {
      return first.aiResult.costEstimate - second.aiResult.costEstimate;
    }

    if (first.aiResult.responseTimeMs !== second.aiResult.responseTimeMs) {
      return first.aiResult.responseTimeMs - second.aiResult.responseTimeMs;
    }

    return first.aiResult.aiModelId.localeCompare(second.aiResult.aiModelId);
  }
}
