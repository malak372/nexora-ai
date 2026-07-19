import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';

import {
  findIdeaGenerationStageDefinition,
  IDEA_GENERATION_STAGE_KEYS,
  type IdeaGenerationStageDefinition,
} from '../../constants/idea-generation-stages.constants';

import {
  IDEA_GENERATION_ERROR_CODES,
} from '../../constants/idea-generation.constants';

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

import type {
  ParsedIdeaAiOutput,
} from '../../types/idea-ai-output.type';

/**
 * Performs the final business-level validation of AI-generated
 * idea output before duplicate detection and persistence.
 *
 * The central AI runtime already validates the provider response
 * against the configured JSON schema. This stage provides an
 * additional domain-level validation boundary by reconstructing
 * the parsed idea payload and passing it through
 * IdeaAiOutputParserService.
 *
 * Responsibilities:
 * - Ensure that a core idea exists.
 * - Validate all required core idea fields.
 * - Normalize objectives and target users.
 * - Normalize optional advanced outputs.
 * - Ensure premium generation contains advanced output data.
 * - Store the validated result back in the generation context.
 *
 * This stage does not:
 * - Call an AI provider.
 * - Repair malformed provider output.
 * - Perform duplicate detection.
 * - Persist the generated idea.
 * - Consume credits or free-generation entitlement.
 *
 * @author Malak
 */
@Injectable()
export class AiOutputValidationStage
  implements IdeaGenerationStage
{
  /**
   * Stable pipeline-stage key.
   */
  readonly key =
    IDEA_GENERATION_STAGE_KEYS
      .AI_OUTPUT_VALIDATION;

  /**
   * Static pipeline-stage definition.
   */
  readonly definition: IdeaGenerationStageDefinition =
    this.resolveDefinition();

  constructor(
    private readonly outputParserService:
      IdeaAiOutputParserService,
  ) {}

  /**
   * Validates and normalizes the generated idea output.
   *
   * @param context Current generation context.
   * @returns Context containing validated AI output.
   */
  async execute(
    context: IdeaGenerationContext,
  ): Promise<IdeaGenerationStageExecutionResult> {
    this.validateContext(context);

    const rawOutput =
      this.buildRawOutput(context);

    const parsedOutput =
      this.outputParserService.parseOrThrow(
        rawOutput,
      );

    this.validatePremiumOutputAvailability(
      context,
      parsedOutput,
    );

    const updatedContext: IdeaGenerationContext = {
      ...context,

      coreIdea:
        parsedOutput.coreIdea,

      advancedOutputs:
        parsedOutput.advancedOutputs,
    };

    return {
      context: updatedContext,

      resultPreview:
        `AI output validated successfully for idea "${parsedOutput.coreIdea.title}".`,

      metadata: {
        title:
          parsedOutput.coreIdea.title,

        objectivesCount:
          parsedOutput.coreIdea
            .objectives.length,

        targetUsersCount:
          parsedOutput.coreIdea
            .targetUsers.length,

        hasFullAbstract:
          Boolean(
            parsedOutput.coreIdea
              .fullAbstract,
          ),

        advancedOutputsCount:
          parsedOutput
            .advancedOutputs.length,

        includePremiumOutputs:
          context.policy
            ?.includePremiumOutputs ??
          false,
      },
    };
  }

  /**
   * Validates that all required context values are available.
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
            .INVALID_AI_OUTPUT,

        message:
          'Generation entitlement must be resolved before AI-output validation.',
      });
    }

    if (!context.coreIdea) {
      throw new BadRequestException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .INVALID_AI_OUTPUT,

        message:
          'Core AI idea output is required before validation.',
      });
    }
  }

  /**
   * Reconstructs a parser-compatible AI-output object from the
   * normalized generation context.
   *
   * Advanced output records are mapped back to their original AI
   * field names before being passed through the parser.
   *
   * @param context Current generation context.
   * @returns Parser-compatible AI-output object.
   */
  private buildRawOutput(
    context: IdeaGenerationContext,
  ): Record<string, unknown> {
    const coreIdea = context.coreIdea!;

    const rawOutput: Record<string, unknown> = {
      title:
        coreIdea.title,

      problemStatement:
        coreIdea.problemStatement,

      objectives:
        coreIdea.objectives,

      targetUsers:
        coreIdea.targetUsers,

      limitedAbstract:
        coreIdea.limitedAbstract,

      partialAbstract:
        coreIdea.partialAbstract,

      ...(coreIdea.fullAbstract
        ? {
            fullAbstract:
              coreIdea.fullAbstract,
          }
        : {}),
    };

    for (
      const output of
      context.advancedOutputs
    ) {
      const fieldName =
        this.mapOutputKeyToFieldName(
          output.outputKey,
        );

      if (!fieldName) {
        continue;
      }

      rawOutput[fieldName] =
        output.structuredContent ??
        output.content;
    }

    return rawOutput;
  }

  /**
   * Ensures premium generation returns advanced output content.
   *
   * The exact output set may vary between prompt-template
   * versions, therefore the stage requires at least one advanced
   * output rather than enforcing every optional field here.
   *
   * Individual premium-output stages later validate their own
   * configured output keys.
   *
   * @param context Current generation context.
   * @param parsedOutput Parsed AI output.
   */
  private validatePremiumOutputAvailability(
    context: IdeaGenerationContext,
    parsedOutput: ParsedIdeaAiOutput,
  ): void {
    if (
      !context.policy
        ?.includePremiumOutputs
    ) {
      return;
    }

    if (
      parsedOutput.advancedOutputs
        .length === 0
    ) {
      throw new BadRequestException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .INVALID_AI_OUTPUT,

        message:
          'Premium generation did not return any advanced output.',
      });
    }
  }

  /**
   * Maps a stable generated-output key back to the original AI
   * response property.
   *
   * @param outputKey Stable generated-output key.
   * @returns Original AI response field name or null.
   */
  private mapOutputKeyToFieldName(
    outputKey: string,
  ): string | null {
    const fieldNames:
      Readonly<Record<string, string>> = {
      'full-abstract':
        'fullAbstract',

      'technology-stack':
        'technologyStack',

      'system-architecture':
        'systemArchitecture',

      'database-design':
        'databaseDesign',

      'business-model':
        'businessModel',

      budget:
        'budget',

      timeline:
        'timeline',

      feasibility:
        'feasibility',

      'market-potential':
        'marketPotential',

      'revenue-model':
        'revenueModel',

      'local-regulations':
        'localRegulations',
    };

    return (
      fieldNames[outputKey] ?? null
    );
  }

  /**
   * Resolves the static stage definition.
   *
   * @returns AI-output-validation stage definition.
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