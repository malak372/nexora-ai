import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';

import {
  ApiRequestType,
} from '@prisma/client';

import {
  AiExecutionService,
} from '../../../../ai/services/ai-execution.service';

import {
  AiResponseFormat,
} from '../../../../ai/types/ai-provider.type';

import {
  PromptBuilderService,
} from '../../../../prompts/services/prompt-builder.service';

import {
  IDEA_GENERATION_ERROR_CODES,
  MAX_AI_RESPONSE_PREVIEW_LENGTH,
} from '../../constants/idea-generation.constants';

import {
  findIdeaGenerationStageDefinition,
  IDEA_GENERATION_STAGE_KEYS,
  type IdeaGenerationStageDefinition,
} from '../../constants/idea-generation-stages.constants';

import type {
  IdeaGenerationStage,
  IdeaGenerationStageExecutionResult,
} from '../../interfaces/idea-generation-stage.interface';

import {
  IdeaAiOutputParserService,
} from '../../services/idea-ai-output-parser.service';

import type {
  IdeaGenerationContext,
} from '../../types/idea-generation-context.type';

import {
  IDEA_OWNER_TYPES,
} from '../../../shared/constants/ideas.constants';

/**
 * Executes the core structured idea-generation request.
 *
 * Responsibilities:
 * - Rebuild the provider-neutral response schema associated with
 *   the persisted prompt.
 * - Execute the central AI runtime.
 * - Request structured JSON output.
 * - Parse the centrally validated response into business-level
 *   idea output.
 * - Store the normalized core idea in pipeline context.
 * - Preserve premium advanced fields returned by the core
 *   response when available.
 *
 * The AI runtime already handles:
 * - Model routing.
 * - Provider selection.
 * - Request timeout.
 * - Temporary retries.
 * - Fallback models.
 * - JSON parsing and schema validation.
 * - Bounded structured-output repair.
 * - External API logging.
 *
 * IdeaAiOutputParserService adds a second business-level
 * validation boundary before persistence.
 *
 * This stage does not:
 * - Persist the Idea record.
 * - Consume free generations or credits.
 * - Perform duplicate detection.
 * - Complete the generation run.
 *
 * @author Malak
 */
@Injectable()
export class CoreIdeaGenerationStage
  implements IdeaGenerationStage
{
  /**
   * Stable pipeline-stage key.
   */
  readonly key =
    IDEA_GENERATION_STAGE_KEYS
      .CORE_IDEA_GENERATION;

  /**
   * Static pipeline-stage definition.
   */
  readonly definition: IdeaGenerationStageDefinition =
    this.resolveDefinition();

  constructor(
    private readonly aiExecutionService:
      AiExecutionService,

    private readonly promptBuilderService:
      PromptBuilderService,

    private readonly outputParserService:
      IdeaAiOutputParserService,
  ) {}

  /**
   * Executes one structured core idea-generation operation.
   *
   * @param context Current generation context.
   * @returns Context containing parsed core and advanced output.
   */
  async execute(
    context: IdeaGenerationContext,
  ): Promise<IdeaGenerationStageExecutionResult> {
    this.validateContext(context);

    const collection =
      context.collection!;

    const persistedPrompt =
      context.prompt!;

    /*
     * PromptHistory stores the rendered prompt and trace metadata,
     * but it does not currently persist the response schema.
     *
     * Rebuilding through PromptBuilderService is deterministic for
     * the same collection job, generation type, and active template.
     *
     * A future PromptHistory schema may persist responseSchemaName
     * and responseSchema directly to avoid rebuilding here.
     */
    const promptContract =
      await this.promptBuilderService
        .buildIdeaPrompt({
          purpose: 'IDEA_GENERATION',

          collectionJobId:
            collection.collectionJobId,

          generationType:
            context.generationType,
        });

    const aiResult =
      await this.aiExecutionService.execute({
        userPrompt:
          persistedPrompt.promptText,

        requestType:
          ApiRequestType.IDEA_GENERATION,

        promptType:
          promptContract.promptType,

        generationType:
          context.generationType,

        userId:
          context.owner.type ===
          IDEA_OWNER_TYPES.USER
            ? context.owner.userId
            : undefined,

        guestSessionId:
          context.owner.type ===
          IDEA_OWNER_TYPES.GUEST
            ? context.owner
                .guestSessionId
            : undefined,

        responseFormat:
          AiResponseFormat.JSON,

        responseSchema:
          promptContract.responseSchema,

        responseSchemaName:
          promptContract.responseSchemaName,

        estimatedOutputTokens:
          this.resolveEstimatedOutputTokens(
            context,
          ),
      });

    const parsedOutput =
      this.outputParserService
        .parseOrThrow(aiResult.text);

    const updatedContext: IdeaGenerationContext = {
      ...context,

      coreIdea:
        parsedOutput.coreIdea,

      advancedOutputs:
        this.mergeAdvancedOutputs(
          context.advancedOutputs,
          parsedOutput.advancedOutputs,
        ),
    };

    return {
      context: updatedContext,

      resultPreview:
        this.createResponsePreview(
          aiResult.text,
        ),

      metadata: {
        operationId:
          aiResult.operationId,

        aiModelId:
          aiResult.aiModelId,

        providerKey:
          aiResult.providerKey,

        apiModelId:
          aiResult.apiModelId,

        inputTokens:
          aiResult.inputTokens,

        outputTokens:
          aiResult.outputTokens,

        costEstimate:
          aiResult.costEstimate,

        responseTimeMs:
          aiResult.responseTimeMs,

        finishReason:
          aiResult.finishReason,

        fallbackUsed:
          aiResult.fallbackUsed,

        attemptCount:
          aiResult.attemptCount,

        advancedOutputsReturned:
          parsedOutput
            .advancedOutputs.length,
      },
    };
  }

  /**
   * Validates all required context values before provider
   * execution.
   *
   * @param context Current generation context.
   */
  private validateContext(
    context: IdeaGenerationContext,
  ): void {
    if (!context.policy) {
      throw new BadRequestException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .AI_GENERATION_FAILED,

        message:
          'Generation entitlement must be resolved before AI execution.',
      });
    }

    if (!context.collection) {
      throw new BadRequestException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .AI_GENERATION_FAILED,

        message:
          'Collection-job information is required before AI execution.',
      });
    }

    if (!context.nlp) {
      throw new BadRequestException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .AI_GENERATION_FAILED,

        message:
          'NLP analysis is required before AI execution.',
      });
    }

    if (!context.prompt) {
      throw new BadRequestException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .AI_GENERATION_FAILED,

        message:
          'A persisted rendered prompt is required before AI execution.',
      });
    }

    if (!context.prompt.promptText.trim()) {
      throw new BadRequestException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .AI_GENERATION_FAILED,

        message:
          'The rendered AI prompt cannot be empty.',
      });
    }
  }

  /**
   * Resolves a routing estimate for expected output-token usage.
   *
   * Premium responses are expected to be larger because their
   * schema may include advanced outputs.
   *
   * This estimate does not limit the actual provider response.
   *
   * @param context Current generation context.
   * @returns Estimated output-token count.
   */
  private resolveEstimatedOutputTokens(
    context: IdeaGenerationContext,
  ): number {
    return context.policy
      ?.includePremiumOutputs
      ? 4_096
      : 2_048;
  }

  /**
   * Merges advanced outputs without duplicating stable output
   * keys.
   *
   * Newer outputs replace older outputs with the same key.
   *
   * @param existing Existing context outputs.
   * @param incoming Newly parsed outputs.
   * @returns Merged output list.
   */
  private mergeAdvancedOutputs(
    existing:
      IdeaGenerationContext['advancedOutputs'],
    incoming:
      IdeaGenerationContext['advancedOutputs'],
  ): IdeaGenerationContext['advancedOutputs'] {
    const outputsByKey =
      new Map(
        existing.map((output) => [
          output.outputKey,
          output,
        ]),
      );

    for (const output of incoming) {
      outputsByKey.set(
        output.outputKey,
        output,
      );
    }

    return Array.from(
      outputsByKey.values(),
    );
  }

  /**
   * Creates a bounded raw-response preview for stage history.
   *
   * Complete generated data remains in the generation context
   * and is later persisted in its dedicated models.
   *
   * @param responseText Complete provider response.
   * @returns Safe bounded preview.
   */
  private createResponsePreview(
    responseText: string,
  ): string {
    const normalizedResponse =
      responseText.trim();

    if (
      normalizedResponse.length <=
      MAX_AI_RESPONSE_PREVIEW_LENGTH
    ) {
      return normalizedResponse;
    }

    return normalizedResponse.slice(
      0,
      MAX_AI_RESPONSE_PREVIEW_LENGTH,
    );
  }

  /**
   * Resolves the static stage definition.
   *
   * @returns Core-generation stage definition.
   */
  private resolveDefinition(): IdeaGenerationStageDefinition {
    const definition =
      findIdeaGenerationStageDefinition(
        this.key,
      );

    if (!definition) {
      throw new Error(
        `Missing idea-generation stage definition for "${this.key}".`,
      );
    }

    return definition;
  }
}