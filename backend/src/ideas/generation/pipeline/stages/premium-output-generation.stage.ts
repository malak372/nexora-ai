/**
 * @author Malak
 */

import { BadRequestException } from '@nestjs/common';

import type {
  IdeaGenerationStageDefinition,
  IdeaGenerationStageKey,
} from '../../constants/idea-generation-stages.constants';

import { IDEA_GENERATION_ERROR_CODES } from '../../constants/idea-generation.constants';

import { findIdeaAdvancedOutputDefinitionByKey } from '../../constants/idea-output.constants';

import type {
  IdeaGenerationStage,
  IdeaGenerationStageExecutionResult,
} from '../../interfaces/idea-generation-stage.interface';

import type { IdeaAdvancedOutputKey } from '../../types/idea-ai-output.type';

import type { IdeaGenerationContext } from '../../types/idea-generation-context.type';

/**
 * Configuration used to create one premium-output validation stage.
 *
 * One configured instance is registered for every premium output
 * exposed by the idea-generation pipeline.
 *
 * @author Malak
 */
export type PremiumOutputGenerationStageOptions = {
  /**
   * Pipeline definition associated with this output.
   */
  readonly definition: IdeaGenerationStageDefinition;

  /**
   * Stable advanced-output key expected in the parsed AI result.
   */
  readonly outputKey: IdeaAdvancedOutputKey;

  /**
   * Whether the output is mandatory for premium generation.
   */
  readonly required?: boolean;
};

/**
 * Pre-persistence validation checkpoint for one premium output.
 *
 * Premium generation uses one structured AI request that returns
 * the core idea and all advanced outputs. The parser normalizes
 * those outputs into context.advancedOutputs.
 *
 * This stage intentionally runs before IdeaPersistenceStage. It:
 * - Does not call the AI provider.
 * - Does not require context.ideaId.
 * - Does not require persisted GeneratedOutput identifiers.
 * - Validates one normalized output independently.
 *
 * After all premium-output stages succeed, IdeaPersistenceService
 * performs a final registry-wide validation, saves the idea and all
 * generated outputs, and deducts the premium credit atomically.
 *
 * This class is created through provider factories because every
 * registered instance has a different stage definition and output
 * key.
 *
 * @author Malak
 */
export class PremiumOutputGenerationStage implements IdeaGenerationStage {
  /** Stable pipeline-stage key. */
  readonly key: IdeaGenerationStageKey;

  /** Static pipeline-stage definition. */
  readonly definition: IdeaGenerationStageDefinition;

  /** Stable output key validated by this stage. */
  private readonly outputKey: IdeaAdvancedOutputKey;

  /** Human-readable title resolved from the centralized registry. */
  private readonly outputTitle: string;

  /** Indicates whether the output is mandatory. */
  private readonly required: boolean;

  constructor(options: PremiumOutputGenerationStageOptions) {
    const outputDefinition = this.validateAndResolveOptions(options);

    this.definition = options.definition;
    this.key = options.definition.key;
    this.outputKey = outputDefinition.outputKey;
    this.outputTitle = outputDefinition.title;
    this.required = options.required ?? outputDefinition.requiredForPremium;
  }

  /**
   * Runs only when the resolved entitlement policy authorizes
   * premium outputs.
   */
  shouldExecute(context: IdeaGenerationContext): boolean {
    return context.policy?.includePremiumOutputs === true;
  }

  /**
   * Validates one parsed premium output before persistence and
   * credit deduction.
   */
  async execute(
    context: IdeaGenerationContext,
  ): Promise<IdeaGenerationStageExecutionResult> {
    this.validateContext(context);

    const matchingOutputs = context.advancedOutputs.filter(
      (candidate) => candidate.outputKey === this.outputKey,
    );

    if (matchingOutputs.length === 0) {
      if (!this.required) {
        return {
          context,
          resultPreview:
            `Optional premium output "${this.outputTitle}" was not returned.`,
          metadata: {
            outputKey: this.outputKey,
            outputTitle: this.outputTitle,
            generated: false,
            required: false,
            premiumOutputValidated: true,
          },
        };
      }

      this.throwInvalidOutput(
        `Required premium output "${this.outputTitle}" was not generated.`,
      );
    }

    if (matchingOutputs.length > 1) {
      this.throwInvalidOutput(
        `Premium output "${this.outputTitle}" was returned more than once.`,
      );
    }

    const output = matchingOutputs[0];

    this.validateOutputContent(
      output.content,
      output.structuredContent,
    );

    return {
      context,
      resultPreview:
        `Premium output "${this.outputTitle}" validated successfully.`,
      metadata: {
        outputKey: output.outputKey,
        outputTitle: output.title,
        generated: true,
        required: this.required,
        contentLength: output.content.trim().length,
        hasStructuredContent: output.structuredContent !== undefined,
        structuredItemCount: Array.isArray(output.structuredContent)
          ? output.structuredContent.length
          : null,
        premiumOutputValidated: true,
      },
    };
  }

  /**
   * Validates the pre-persistence pipeline context.
   */
  private validateContext(context: IdeaGenerationContext): void {
    if (!context.policy) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.INVALID_REQUEST,
        message:
          'The generation policy must be resolved before premium-output validation.',
      });
    }

    if (!context.policy.includePremiumOutputs) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.INVALID_REQUEST,
        message:
          'Premium-output stages cannot execute for a non-premium generation policy.',
      });
    }

    if (!Array.isArray(context.advancedOutputs)) {
      this.throwInvalidOutput(
        'The parsed premium-output collection is invalid.',
      );
    }
  }

  /**
   * Validates normalized premium-output content.
   */
  private validateOutputContent(
    content: string,
    structuredContent: Record<string, unknown> | unknown[] | undefined,
  ): void {
    if (typeof content !== 'string' || !content.trim()) {
      this.throwInvalidOutput(
        `Premium output "${this.outputTitle}" does not contain usable content.`,
      );
    }

    if (structuredContent === undefined) {
      return;
    }

    if (
      structuredContent === null ||
      typeof structuredContent !== 'object'
    ) {
      this.throwInvalidOutput(
        `Premium output "${this.outputTitle}" contains invalid structured content.`,
      );
    }

    if (Array.isArray(structuredContent) && structuredContent.length === 0) {
      this.throwInvalidOutput(
        `Premium output "${this.outputTitle}" contains an empty structured collection.`,
      );
    }
  }

  /**
   * Validates constructor options and resolves the centralized
   * advanced-output definition.
   */
  private validateAndResolveOptions(
    options: PremiumOutputGenerationStageOptions,
  ) {
    if (!options?.definition) {
      throw new Error('Premium-output stage definition is required.');
    }

    if (!options.definition.requiredForPremium) {
      throw new Error(
        `Stage "${options.definition.key}" is not configured as a premium stage.`,
      );
    }

    if (!options.outputKey) {
      throw new Error('Premium generated-output key is required.');
    }

    const outputDefinition = findIdeaAdvancedOutputDefinitionByKey(
      options.outputKey,
    );

    if (!outputDefinition) {
      throw new Error(
        `Unsupported premium generated-output key "${options.outputKey}".`,
      );
    }

    return outputDefinition;
  }

  /**
   * Throws a standardized invalid-AI-output exception.
   */
  private throwInvalidOutput(message: string): never {
    throw new BadRequestException({
      code: IDEA_GENERATION_ERROR_CODES.INVALID_AI_OUTPUT,
      message,
    });
  }
}