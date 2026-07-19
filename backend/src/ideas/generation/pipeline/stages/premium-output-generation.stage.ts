import {
  BadRequestException,
} from '@nestjs/common';

import type {
  IdeaGenerationStage,
  IdeaGenerationStageExecutionResult,
} from '../../interfaces/idea-generation-stage.interface';

import type {
  IdeaGenerationStageDefinition,
  IdeaGenerationStageKey,
} from '../../constants/idea-generation-stages.constants';

import {
  IDEA_GENERATION_ERROR_CODES,
} from '../../constants/idea-generation.constants';

import type {
  IdeaGenerationContext,
} from '../../types/idea-generation-context.type';

/**
 * Configuration used to create one premium-output pipeline stage.
 *
 * One instance is registered for each premium stage definition
 * inside IdeasModule.
 *
 * @author Malak
 */
export type PremiumOutputGenerationStageOptions = {
  /**
   * Complete pipeline definition associated with this stage.
   */
  readonly definition:
    IdeaGenerationStageDefinition;

  /**
   * Stable GeneratedOutput.outputKey expected from the premium AI
   * response.
   */
  readonly outputKey: string;

  /**
   * Human-readable output title used in validation messages.
   */
  readonly outputTitle: string;

  /**
   * Whether the configured output must exist.
   *
   * This should normally remain true for required premium stages.
   */
  readonly required?: boolean;
};

/**
 * Generic pipeline stage used to validate one premium generated
 * output.
 *
 * The current premium prompt returns core idea data and advanced
 * output fields in one structured AI response. Those fields are
 * parsed during core generation and persisted atomically with the
 * Idea record.
 *
 * Consequently, this stage currently acts as an isolated premium
 * checkpoint that:
 * - Runs only when premium outputs are authorized.
 * - Locates the output associated with its configured key.
 * - Verifies required output content exists.
 * - Confirms the output was persisted with the idea.
 * - Exposes output-specific stage progress and monitoring data.
 *
 * This generic implementation avoids ten nearly identical stage
 * classes while preserving ten independent persisted stage keys.
 *
 * A future implementation may replace the validation body with a
 * dedicated AI request for each output without changing the stage
 * registration contract.
 *
 * This class intentionally does not use @Injectable because each
 * instance requires different runtime configuration. Instances
 * are created through provider factories in IdeasModule.
 *
 * @author Malak
 */
export class PremiumOutputGenerationStage
  implements IdeaGenerationStage
{
  /**
   * Stable stage key derived from the configured definition.
   */
  readonly key: IdeaGenerationStageKey;

  /**
   * Static pipeline-stage definition.
   */
  readonly definition:
    IdeaGenerationStageDefinition;

  /**
   * Stable generated-output key expected from the context.
   */
  private readonly outputKey: string;

  /**
   * Human-readable generated-output title.
   */
  private readonly outputTitle: string;

  /**
   * Indicates whether the output is required.
   */
  private readonly required: boolean;

  constructor(
    options:
      PremiumOutputGenerationStageOptions,
  ) {
    this.validateOptions(options);

    this.definition =
      options.definition;

    this.key =
      options.definition.key;

    this.outputKey =
      options.outputKey.trim();

    this.outputTitle =
      options.outputTitle.trim();

    this.required =
      options.required ?? true;
  }

  /**
   * Runs the stage only for generation policies that authorize
   * premium outputs.
   *
   * @param context Current generation context.
   * @returns Whether the premium checkpoint should execute.
   */
  shouldExecute(
    context: IdeaGenerationContext,
  ): boolean {
    return Boolean(
      context.policy
        ?.includePremiumOutputs,
    );
  }

  /**
   * Verifies that the configured premium output was generated and
   * persisted.
   *
   * @param context Current generation context.
   * @returns Unchanged validated generation context.
   */
  async execute(
    context: IdeaGenerationContext,
  ): Promise<IdeaGenerationStageExecutionResult> {
    this.validateContext(context);

    const output =
      context.advancedOutputs.find(
        (candidate) =>
          candidate.outputKey ===
          this.outputKey,
      );

    if (!output) {
      if (!this.required) {
        return {
          context,

          resultPreview:
            `Optional premium output "${this.outputTitle}" was not returned.`,

          metadata: {
            outputKey:
              this.outputKey,

            outputTitle:
              this.outputTitle,

            generated: false,

            required: false,
          },
        };
      }

      throw new BadRequestException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .INVALID_AI_OUTPUT,

        message:
          `Required premium output "${this.outputTitle}" was not generated.`,
      });
    }

    if (
      !output.content?.trim() &&
      output.structuredContent ===
        undefined
    ) {
      throw new BadRequestException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .INVALID_AI_OUTPUT,

        message:
          `Premium output "${this.outputTitle}" does not contain usable content.`,
      });
    }

    return {
      context,

      resultPreview:
        `Premium output "${this.outputTitle}" verified successfully.`,

      metadata: {
        ideaId:
          context.ideaId,

        outputKey:
          output.outputKey,

        outputTitle:
          output.title,

        generated: true,

        required:
          this.required,

        persisted:
          context.generatedOutputIds
            .length > 0,

        contentLength:
          output.content.length,

        hasStructuredContent:
          output.structuredContent !==
          undefined,
      },
    };
  }

  /**
   * Validates pipeline state before premium output verification.
   *
   * @param context Current generation context.
   */
  private validateContext(
    context: IdeaGenerationContext,
  ): void {
    if (
      !context.policy
        ?.includePremiumOutputs
    ) {
      throw new BadRequestException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .INVALID_REQUEST,

        message:
          'Premium-output stages cannot execute for a non-premium generation policy.',
      });
    }

    if (!context.ideaId) {
      throw new BadRequestException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .PERSISTENCE_FAILED,

        message:
          'The generated idea must be persisted before premium-output verification.',
      });
    }

    if (
      context.generatedOutputIds
        .length === 0
    ) {
      throw new BadRequestException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .PERSISTENCE_FAILED,

        message:
          'No persisted generated-output records were found for the premium idea.',
      });
    }
  }

  /**
   * Validates constructor configuration.
   *
   * @param options Premium stage options.
   */
  private validateOptions(
    options:
      PremiumOutputGenerationStageOptions,
  ): void {
    if (!options?.definition) {
      throw new Error(
        'Premium-output stage definition is required.',
      );
    }

    if (
      !options.definition
        .requiredForPremium
    ) {
      throw new Error(
        `Stage "${options.definition.key}" is not configured as a premium stage.`,
      );
    }

    if (!options.outputKey?.trim()) {
      throw new Error(
        'Premium generated-output key is required.',
      );
    }

    if (
      !options.outputTitle?.trim()
    ) {
      throw new Error(
        'Premium generated-output title is required.',
      );
    }
  }
}