/**
 * Performs final business-level validation of generated idea
 * output before duplicate detection and persistence.
 *
 * @author Malak
 */

import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';

import {
  IdeaGenerationType,
} from '@prisma/client';

import {
  IDEA_GENERATION_ERROR_CODES,
} from '../../constants/idea-generation.constants';

import {
  findIdeaGenerationStageDefinition,
  IDEA_GENERATION_STAGE_KEYS,
  type IdeaGenerationStageDefinition,
} from '../../constants/idea-generation-stages.constants';

import {
  findIdeaAdvancedOutputDefinitionByKey,
  REQUIRED_PREMIUM_IDEA_OUTPUT_KEYS,
} from '../../constants/idea-output.constants';

import type {
  IdeaGenerationStage,
  IdeaGenerationStageExecutionResult,
} from '../../interfaces/idea-generation-stage.interface';

import {
  IdeaAiOutputParserService,
} from '../../services/idea-ai-output-parser.service';

import type {
  AdvancedIdeaAiOutput,
  IdeaAdvancedOutputKey,
  JsonObject,
  ParsedIdeaAiOutput,
} from '../../types/idea-ai-output.type';

import type {
  IdeaGenerationContext,
} from '../../types/idea-generation-context.type';

/**
 * Performs final business-level validation and normalization of
 * AI-generated idea output before duplicate detection and
 * persistence.
 *
 * The central AI runtime remains responsible for:
 * - Calling the selected AI provider.
 * - Applying the configured JSON response schema.
 * - Parsing provider-level JSON.
 * - Performing schema-level validation.
 * - Attempting bounded response repair.
 *
 * This stage introduces an additional application-level boundary
 * that understands the resolved generation policy and the final
 * IdeaGenerationType.
 *
 * Responsibilities:
 * - Ensure generation entitlement has been resolved.
 * - Ensure the policy generation type matches the pipeline type.
 * - Ensure core AI output exists.
 * - Validate existing advanced-output keys.
 * - Reconstruct a parser-compatible response object.
 * - Normalize core and advanced output fields.
 * - Enforce tier-specific abstract requirements.
 * - Prevent premium-output leakage into free generations.
 * - Enforce complete premium-output requirements.
 * - Reject duplicated or unsupported output keys.
 * - Store normalized output back into the pipeline context.
 *
 * Tier contracts:
 *
 * GUEST_FREE:
 * - title
 * - problemStatement
 * - objectives
 * - targetUsers
 * - limitedAbstract
 * - partialAbstract
 * - no fullAbstract
 * - no advanced outputs
 *
 * NORMAL_FREE:
 * - title
 * - problemStatement
 * - objectives
 * - targetUsers
 * - partialAbstract
 * - no fullAbstract
 * - no advanced outputs
 *
 * PREMIUM_CREDIT:
 * - title
 * - problemStatement
 * - objectives
 * - targetUsers
 * - fullAbstract
 * - every required advanced output
 *
 * This stage does not:
 * - Call an AI provider.
 * - Repair malformed provider output.
 * - Detect duplicate ideas.
 * - Persist ideas or generated outputs.
 * - Consume user credits.
 * - Consume free-generation attempts.
 * - Mark guest generation as consumed.
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
  readonly definition:
    IdeaGenerationStageDefinition =
    this.resolveDefinition();

  constructor(
    private readonly outputParserService:
      IdeaAiOutputParserService,
  ) {}

  /**
   * Validates and normalizes generated idea output.
   *
   * @param context Current idea-generation context.
   * @returns Updated context containing normalized AI output.
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

    this.validateOutputForGenerationType(
      context,
      parsedOutput,
    );

    const updatedContext:
      IdeaGenerationContext = {
        ...context,

        coreIdea:
          parsedOutput.coreIdea,

        advancedOutputs:
          parsedOutput.advancedOutputs,
      };

    return {
      context:
        updatedContext,

      resultPreview:
        this.buildResultPreview(
          context,
          parsedOutput,
        ),

      metadata: {
        generationType:
          context.generationType,

        title:
          parsedOutput.coreIdea.title,

        objectivesCount:
          parsedOutput.coreIdea
            .objectives.length,

        targetUsersCount:
          parsedOutput.coreIdea
            .targetUsers.length,

        hasLimitedAbstract:
          Boolean(
            parsedOutput.coreIdea
              .limitedAbstract,
          ),

        hasPartialAbstract:
          Boolean(
            parsedOutput.coreIdea
              .partialAbstract,
          ),

        hasFullAbstract:
          Boolean(
            parsedOutput.coreIdea
              .fullAbstract,
          ),

        advancedOutputsCount:
          parsedOutput
            .advancedOutputs.length,

        requiredPremiumOutputsCount:
          context.policy
            ?.includePremiumOutputs
            ? REQUIRED_PREMIUM_IDEA_OUTPUT_KEYS
                .length
            : 0,

        includePremiumOutputs:
          context.policy
            ?.includePremiumOutputs ??
          false,

        outputValidated:
          true,
      },
    };
  }

  /**
   * Validates all context values required before AI-output
   * validation can run.
   *
   * @param context Current idea-generation context.
   *
   * @throws BadRequestException When required context is missing
   * or inconsistent.
   */
  private validateContext(
    context: IdeaGenerationContext,
  ): void {
    if (!context.policy) {
      this.throwInvalidOutput(
        'Generation entitlement must be resolved before AI-output validation.',
      );
    }

    if (
      context.policy.generationType !==
      context.generationType
    ) {
      this.throwInvalidOutput(
        'Resolved generation policy does not match the pipeline generation type.',
      );
    }

    if (!context.coreIdea) {
      this.throwInvalidOutput(
        'Core AI idea output is required before validation.',
      );
    }

    if (
      !Array.isArray(
        context.advancedOutputs,
      )
    ) {
      this.throwInvalidOutput(
        'Advanced AI outputs must be represented as an array.',
      );
    }

    this.validateContextOutputKeys(
      context.advancedOutputs,
    );
  }

  /**
   * Validates normalized output according to the authorized
   * generation type.
   *
   * @param context Current generation context.
   * @param parsedOutput Parsed and normalized AI output.
   */
  private validateOutputForGenerationType(
    context: IdeaGenerationContext,
    parsedOutput: ParsedIdeaAiOutput,
  ): void {
    switch (context.generationType) {
      case IdeaGenerationType.GUEST_FREE:
        this.validateGuestOutput(
          parsedOutput,
        );
        return;

      case IdeaGenerationType.NORMAL_FREE:
        this.validateNormalFreeOutput(
          parsedOutput,
        );
        return;

      case IdeaGenerationType.PREMIUM_CREDIT:
        this.validatePremiumOutput(
          context,
          parsedOutput,
        );
        return;

      default:
        this.assertNeverGenerationType(
          context.generationType,
        );
    }
  }

  /**
   * Validates guest-generation output.
   *
   * Guest generation produces the complete free foundation in one
   * AI request:
   * - limitedAbstract is exposed to the guest.
   * - partialAbstract is retained for the authenticated free view
   *   after a successful guest-idea transfer.
   *
   * Guest generation must never include full premium content.
   *
   * @param parsedOutput Parsed guest-generation output.
   */
  private validateGuestOutput(
    parsedOutput: ParsedIdeaAiOutput,
  ): void {
    this.requireCoreString(
      parsedOutput.coreIdea
        .limitedAbstract,
      'limitedAbstract',
      IdeaGenerationType.GUEST_FREE,
    );

    this.requireCoreString(
      parsedOutput.coreIdea
        .partialAbstract,
      'partialAbstract',
      IdeaGenerationType.GUEST_FREE,
    );

    this.rejectCoreStringWhenPresent(
      parsedOutput.coreIdea
        .fullAbstract,
      'fullAbstract',
      IdeaGenerationType.GUEST_FREE,
    );

    this.validateNoAdvancedOutputs(
      parsedOutput.advancedOutputs,
      IdeaGenerationType.GUEST_FREE,
    );
  }

  /**
   * Validates authenticated free-tier output.
   *
   * Normal free generation returns a partial abstract and must not
   * contain full premium content.
   *
   * A limited abstract is tolerated when returned by a shared
   * generation schema, but it is not required by this tier.
   *
   * @param parsedOutput Parsed normal-free output.
   */
  private validateNormalFreeOutput(
    parsedOutput: ParsedIdeaAiOutput,
  ): void {
    this.requireCoreString(
      parsedOutput.coreIdea
        .partialAbstract,
      'partialAbstract',
      IdeaGenerationType.NORMAL_FREE,
    );

    this.rejectCoreStringWhenPresent(
      parsedOutput.coreIdea
        .fullAbstract,
      'fullAbstract',
      IdeaGenerationType.NORMAL_FREE,
    );

    this.validateNoAdvancedOutputs(
      parsedOutput.advancedOutputs,
      IdeaGenerationType.NORMAL_FREE,
    );
  }

  /**
   * Validates premium credit-based generation output.
   *
   * Premium generation must:
   * - Be authorized for premium output generation.
   * - Be unlocked immediately.
   * - Return a complete full abstract.
   * - Return every output required by the centralized premium
   *   output registry.
   *
   * @param context Current generation context.
   * @param parsedOutput Parsed premium AI output.
   */
  private validatePremiumOutput(
    context: IdeaGenerationContext,
    parsedOutput: ParsedIdeaAiOutput,
  ): void {
    const policy =
      context.policy;

    if (!policy) {
      this.throwInvalidOutput(
        'Generation policy is required for premium-output validation.',
      );
    }

    if (
      !policy.includePremiumOutputs
    ) {
      this.throwInvalidOutput(
        'Premium generation policy must enable advanced outputs.',
      );
    }

    if (
      !policy.unlockOnGeneration
    ) {
      this.throwInvalidOutput(
        'Premium-generated ideas must be unlocked on successful generation.',
      );
    }

    this.requireCoreString(
      parsedOutput.coreIdea
        .fullAbstract,
      'fullAbstract',
      IdeaGenerationType.PREMIUM_CREDIT,
    );

    this.validateRequiredPremiumOutputs(
      parsedOutput.advancedOutputs,
    );
  }

  /**
   * Ensures free-tier generations do not contain advanced outputs.
   *
   * This protects against accidental persistence or exposure of
   * premium content when a provider returns fields outside the
   * selected response contract.
   *
   * @param outputs Parsed advanced outputs.
   * @param generationType Current free generation type.
   */
  private validateNoAdvancedOutputs(
    outputs:
      readonly AdvancedIdeaAiOutput[],
    generationType:
      IdeaGenerationType,
  ): void {
    if (outputs.length === 0) {
      return;
    }

    this.throwInvalidOutput(
      `${generationType} generation must not include advanced premium outputs.`,
      {
        unexpectedOutputKeys:
          outputs.map(
            (output) =>
              output.outputKey,
          ),
      },
    );
  }

  /**
   * Ensures every premium output registered as required exists
   * exactly once and contains valid normalized content.
   *
   * Required output keys are obtained from the centralized output
   * registry rather than duplicated in this stage.
   *
   * @param outputs Parsed advanced outputs.
   */
  private validateRequiredPremiumOutputs(
    outputs:
      readonly AdvancedIdeaAiOutput[],
  ): void {
    const outputByKey =
      new Map<
        IdeaAdvancedOutputKey,
        AdvancedIdeaAiOutput
      >();

    for (const output of outputs) {
      if (
        outputByKey.has(
          output.outputKey,
        )
      ) {
        this.throwInvalidOutput(
          `Premium AI output contains the duplicated output key "${output.outputKey}".`,
        );
      }

      this.validateAdvancedOutputContent(
        output,
      );

      outputByKey.set(
        output.outputKey,
        output,
      );
    }

    const missingOutputKeys =
      REQUIRED_PREMIUM_IDEA_OUTPUT_KEYS
        .filter(
          (outputKey) =>
            !outputByKey.has(
              outputKey,
            ),
        );

    if (
      missingOutputKeys.length >
      0
    ) {
      this.throwInvalidOutput(
        `Premium generation is missing required outputs: ${missingOutputKeys.join(', ')}.`,
        {
          missingOutputKeys,
        },
      );
    }
  }

  /**
   * Validates one normalized advanced output against its
   * centralized registry definition.
   *
   * @param output Advanced output to validate.
   */
  private validateAdvancedOutputContent(
    output: AdvancedIdeaAiOutput,
  ): void {
    const definition =
      findIdeaAdvancedOutputDefinitionByKey(
        output.outputKey,
      );

    if (!definition) {
      this.throwInvalidOutput(
        `Unsupported advanced output key "${String(output.outputKey)}".`,
      );
    }

    if (
      typeof output.title !==
      'string'
    ) {
      this.throwInvalidOutput(
        `Advanced output "${output.outputKey}" must contain a string title.`,
      );
    }

    const normalizedTitle =
      output.title.trim();

    if (
      normalizedTitle !==
      definition.title
    ) {
      this.throwInvalidOutput(
        `Advanced output "${output.outputKey}" has an invalid title.`,
      );
    }

    if (
      typeof output.content !==
      'string' ||
      output.content.trim().length ===
        0
    ) {
      this.throwInvalidOutput(
        `Advanced output "${output.outputKey}" must contain non-empty string content.`,
      );
    }

    if (definition.collection) {
      this.validateCollectionStructuredContent(
        output,
      );
      return;
    }

    if (
      output.structuredContent !==
      undefined
    ) {
      this.throwInvalidOutput(
        `Scalar advanced output "${output.outputKey}" must not contain structured collection content.`,
      );
    }
  }

  /**
   * Validates structured content for one collection-valued output.
   *
   * @param output Collection-valued advanced output.
   */
  private validateCollectionStructuredContent(
    output: AdvancedIdeaAiOutput,
  ): void {
    const structuredContent =
      output.structuredContent;

    if (
      !Array.isArray(
        structuredContent,
      )
    ) {
      this.throwInvalidOutput(
        `Advanced output "${output.outputKey}" must contain structured array content.`,
      );
    }

    if (
      structuredContent.length === 0
    ) {
      this.throwInvalidOutput(
        `Advanced output "${output.outputKey}" must contain at least one structured value.`,
      );
    }

    if (
      structuredContent.some(
        (item) =>
          typeof item !==
            'string' ||
          item.trim().length === 0,
      )
    ) {
      this.throwInvalidOutput(
        `Advanced output "${output.outputKey}" must contain a non-empty string array.`,
      );
    }
  }

  /**
   * Validates advanced-output keys already present in the context
   * before they are reconstructed for parser validation.
   *
   * This prevents unsupported or duplicated keys from being
   * silently discarded or overwritten while constructing the raw
   * provider-response object.
   *
   * @param outputs Context advanced outputs.
   */
  private validateContextOutputKeys(
    outputs:
      readonly AdvancedIdeaAiOutput[],
  ): void {
    const seenOutputKeys =
      new Set<IdeaAdvancedOutputKey>();

    for (const output of outputs) {
      if (
        !output ||
        typeof output !== 'object'
      ) {
        this.throwInvalidOutput(
          'Every advanced output in the generation context must be an object.',
        );
      }

      const definition =
        findIdeaAdvancedOutputDefinitionByKey(
          output.outputKey,
        );

      if (!definition) {
        this.throwInvalidOutput(
          `Unsupported advanced output key "${String(output.outputKey)}" was found in the generation context.`,
        );
      }

      if (
        seenOutputKeys.has(
          output.outputKey,
        )
      ) {
        this.throwInvalidOutput(
          `Duplicated advanced output key "${output.outputKey}" was found in the generation context.`,
        );
      }

      seenOutputKeys.add(
        output.outputKey,
      );
    }
  }

  /**
   * Reconstructs a parser-compatible AI response object from the
   * normalized generation context.
   *
   * Optional abstract fields are included only when present.
   *
   * This matters because the parser distinguishes between:
   * - A missing optional field.
   * - A present but invalid undefined or blank field.
   *
   * Advanced-output records are mapped back to their original AI
   * schema property names through the centralized output registry.
   *
   * @param context Current generation context.
   * @returns Parser-compatible AI-output object.
   */
  private buildRawOutput(
    context: IdeaGenerationContext,
  ): JsonObject {
    const coreIdea =
      context.coreIdea;

    if (!coreIdea) {
      this.throwInvalidOutput(
        'Core AI idea output is required before reconstructing the response payload.',
      );
    }

    const rawOutput: JsonObject = {
        title:
          coreIdea.title,

        problemStatement:
          coreIdea.problemStatement,

        objectives:
          coreIdea.objectives,

        targetUsers:
          coreIdea.targetUsers,
      };

    this.assignOptionalString(
      rawOutput,
      'limitedAbstract',
      coreIdea.limitedAbstract,
    );

    this.assignOptionalString(
      rawOutput,
      'partialAbstract',
      coreIdea.partialAbstract,
    );

    this.assignOptionalString(
      rawOutput,
      'fullAbstract',
      coreIdea.fullAbstract,
    );

    for (
      const output of
      context.advancedOutputs
    ) {
      const definition =
        findIdeaAdvancedOutputDefinitionByKey(
          output.outputKey,
        );

      if (!definition) {
        this.throwInvalidOutput(
          `Unsupported advanced output key "${String(output.outputKey)}".`,
        );
      }

      if (definition.collection) {
        if (
          !Array.isArray(
            output.structuredContent,
          )
        ) {
          this.throwInvalidOutput(
            `Advanced output "${output.outputKey}" must contain structured array content.`,
          );
        }

        rawOutput[
          definition.field
        ] =
          output.structuredContent;

        continue;
      }

      rawOutput[
        definition.field
      ] =
        output.content;
    }

    return rawOutput;
  }

  /**
   * Adds an optional string to a reconstructed output object only
   * when the field is present.
   *
   * Blank values are intentionally included so the parser can
   * reject malformed present fields instead of treating them as
   * missing.
   *
   * @param target Reconstructed raw output object.
   * @param key AI schema field name.
   * @param value Optional string value.
   */
  private assignOptionalString(
    target: JsonObject,
    key: string,
    value: string | undefined,
  ): void {
    if (
      value === undefined
    ) {
      return;
    }

    target[key] = value;
  }

  /**
   * Ensures a tier-required core string exists and is not blank.
   *
   * @param value Core field value.
   * @param fieldName Required field name.
   * @param generationType Generation type requiring the field.
   */
  private requireCoreString(
    value: string | undefined,
    fieldName: string,
    generationType:
      IdeaGenerationType,
  ): asserts value is string {
    if (
      typeof value !== 'string' ||
      value.trim().length === 0
    ) {
      this.throwInvalidOutput(
        `${generationType} generation requires a non-empty "${fieldName}" field.`,
      );
    }
  }

  /**
   * Rejects a core string when it is not authorized for the
   * current generation type.
   *
   * @param value Optional core string.
   * @param fieldName Unauthorized field name.
   * @param generationType Current generation type.
   */
  private rejectCoreStringWhenPresent(
    value: string | undefined,
    fieldName: string,
    generationType:
      IdeaGenerationType,
  ): void {
    if (value === undefined) {
      return;
    }

    this.throwInvalidOutput(
      `${generationType} generation must not include the premium "${fieldName}" field.`,
    );
  }

  /**
   * Builds a safe stage-result preview.
   *
   * @param context Current generation context.
   * @param parsedOutput Validated parsed output.
   * @returns Human-readable stage result preview.
   */
  private buildResultPreview(
    context: IdeaGenerationContext,
    parsedOutput: ParsedIdeaAiOutput,
  ): string {
    const outputDescription =
      context.generationType ===
      IdeaGenerationType
        .PREMIUM_CREDIT
        ? ` with ${parsedOutput.advancedOutputs.length} advanced outputs`
        : '';

    return (
      `AI output validated successfully for ` +
      `${context.generationType} idea ` +
      `"${parsedOutput.coreIdea.title}"` +
      `${outputDescription}.`
    );
  }

  /**
   * Throws a consistent business-level invalid-output exception.
   *
   * @param message Safe human-readable error message.
   * @param details Optional additional safe error details.
   *
   * @throws BadRequestException Always.
   */
  private throwInvalidOutput(
    message: string,
    details?: Record<
      string,
      unknown
    >,
  ): never {
    throw new BadRequestException({
      code:
        IDEA_GENERATION_ERROR_CODES
          .INVALID_AI_OUTPUT,

      message,

      ...(details ?? {}),
    });
  }

  /**
   * Provides exhaustive handling when a new IdeaGenerationType is
   * introduced.
   *
   * @param generationType Unexpected generation type.
   */
  private assertNeverGenerationType(
    generationType: never,
  ): never {
    return this.throwInvalidOutput(
      `Unsupported idea generation type "${String(generationType)}".`,
    );
  }

  /**
   * Resolves the static stage definition from the centralized
   * generation-stage registry.
   *
   * @returns AI-output-validation stage definition.
   */
  private resolveDefinition():
    IdeaGenerationStageDefinition {
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
