import { BadGatewayException, Injectable } from '@nestjs/common';
import { IdeaGenerationType, PromptType } from '@prisma/client';

import { FreeIdeaOutput, FreeIdeaSchema } from '../schemas/free-idea.schema';
import { GuestIdeaOutput, GuestIdeaSchema } from '../schemas/guest-idea.schema';
import {
  PremiumIdeaOutput,
  PremiumIdeaSchema,
} from '../schemas/premium-idea.schema';
import {
  UnlockIdeaOutput,
  UnlockIdeaSchema,
} from '../schemas/unlock-idea.schema';

import { AiResponseParserService } from './ai-response-parser.service';

/**
 * Union of all validated structured idea outputs.
 */
export type StructuredIdeaOutput =
  | GuestIdeaOutput
  | FreeIdeaOutput
  | PremiumIdeaOutput
  | UnlockIdeaOutput;

/**
 * One normalized parsing or schema-validation issue.
 *
 * These issues are safe to include in the bounded structured-output
 * repair prompt.
 */
export type StructuredOutputValidationIssue = {
  /**
   * Path of the invalid field.
   *
   * The root object is represented by "$".
   */
  readonly path: string;

  /**
   * Stable validation or parsing error category.
   */
  readonly code: string;

  /**
   * Safe human-readable validation message.
   */
  readonly message: string;
};

/**
 * Successful structured-output validation result.
 */
export type StructuredOutputValidationSuccess = {
  readonly success: true;
  readonly data: StructuredIdeaOutput;
};

/**
 * Failed structured-output validation result.
 */
export type StructuredOutputValidationFailure = {
  readonly success: false;
  readonly issues: StructuredOutputValidationIssue[];
};

/**
 * Non-throwing structured-output validation result.
 */
export type StructuredOutputValidationResult =
  | StructuredOutputValidationSuccess
  | StructuredOutputValidationFailure;

/**
 * Parses and validates structured AI idea responses.
 *
 * Responsibilities:
 * - Parse provider text into JSON.
 * - Resolve the expected Zod schema.
 * - Reject missing, invalid, or unexpected fields.
 * - Expose a non-throwing result for repair orchestration.
 * - Expose a throwing method for regular business-service usage.
 *
 * This service does not:
 * - Execute AI providers.
 * - Retry failed provider responses.
 * - Repair malformed output.
 * - Persist ideas.
 * - Append trusted NLP data.
 *
 * @author Malak
 */
@Injectable()
export class AiStructuredOutputService {
  constructor(private readonly parser: AiResponseParserService) {}

  /**
   * Parses and validates one structured idea response.
   *
   * This method is convenient for business services that want an
   * exception when the AI response is invalid.
   *
   * @param rawText Raw textual response returned by the AI provider.
   * @param generationType Requested idea-generation tier.
   * Required for IDEA_GENERATION and ignored for IDEA_UNLOCK.
   * @param promptType Purpose of the executed prompt.
   * @returns Validated structured idea output.
   *
   * @throws BadGatewayException When provider output is invalid.
   */
  validateIdeaOutput(
    rawText: string,
    generationType: IdeaGenerationType | undefined,
    promptType: PromptType,
  ): StructuredIdeaOutput {
    const validation = this.safeValidateIdeaOutput(
      rawText,
      generationType,
      promptType,
    );

    if (!validation.success) {
      throw new BadGatewayException({
        message:
          'The AI provider returned an invalid structured idea response.',
        validationErrors: validation.issues,
      });
    }

    return validation.data;
  }

  /**
   * Parses and validates structured output without throwing for
   * malformed provider content.
   *
   * AiExecutionService uses this method to decide whether to:
   * - Accept the response.
   * - Request one structured-output repair.
   * - Continue with a fallback model.
   *
   * @param rawText Raw textual response returned by the AI provider.
   * @param generationType Requested idea-generation tier.
   * @param promptType Purpose of the executed prompt.
   * @returns Discriminated success or failure result.
   */
  safeValidateIdeaOutput(
    rawText: string,
    generationType: IdeaGenerationType | undefined,
    promptType: PromptType,
  ): StructuredOutputValidationResult {
    let parsed: unknown;

    try {
      parsed = this.parser.parseJson(rawText);
    } catch (error: unknown) {
      return {
        success: false,
        issues: [
          {
            path: '$',
            code: 'invalid_json',
            message: this.readSafeErrorMessage(
              error,
              'The response could not be parsed as valid JSON.',
            ),
          },
        ],
      };
    }

    const schemaResolution = this.resolveSchema(generationType, promptType);

    if (!schemaResolution.success) {
      return schemaResolution;
    }

    const result = schemaResolution.schema.safeParse(parsed);

    if (!result.success) {
      return {
        success: false,
        issues: result.error.issues.map((issue) => ({
          path: issue.path.length > 0 ? issue.path.map(String).join('.') : '$',
          code: issue.code,
          message: issue.message,
        })),
      };
    }

    return {
      success: true,
      data: result.data,
    };
  }

  /**
   * Resolves the correct structured-output schema.
   *
   * IDEA_UNLOCK:
   * - Always returns advanced unlock fields only.
   * - Does not require generationType.
   *
   * IDEA_GENERATION:
   * - Requires generationType.
   * - Selects Guest, Free, or Premium schema.
   */
  private resolveSchema(
    generationType: IdeaGenerationType | undefined,
    promptType: PromptType,
  ):
    | {
        readonly success: true;
        readonly schema:
          | typeof GuestIdeaSchema
          | typeof FreeIdeaSchema
          | typeof PremiumIdeaSchema
          | typeof UnlockIdeaSchema;
      }
    | StructuredOutputValidationFailure {
    if (promptType === PromptType.IDEA_UNLOCK) {
      return {
        success: true,
        schema: UnlockIdeaSchema,
      };
    }

    if (promptType !== PromptType.IDEA_GENERATION) {
      return {
        success: false,
        issues: [
          {
            path: '$',
            code: 'unsupported_prompt_type',
            message: `Structured idea output is not supported for prompt type ${promptType}.`,
          },
        ],
      };
    }

    if (generationType === undefined) {
      return {
        success: false,
        issues: [
          {
            path: '$',
            code: 'missing_generation_type',
            message:
              'generationType is required for structured idea generation.',
          },
        ],
      };
    }

    switch (generationType) {
      case IdeaGenerationType.GUEST_FREE:
        return {
          success: true,
          schema: GuestIdeaSchema,
        };

      case IdeaGenerationType.NORMAL_FREE:
        return {
          success: true,
          schema: FreeIdeaSchema,
        };

      case IdeaGenerationType.PREMIUM_CREDIT:
        return {
          success: true,
          schema: PremiumIdeaSchema,
        };

      default:
        return this.assertNever(generationType);
    }
  }

  /**
   * Extracts a safe parsing-error message.
   *
   * Raw provider response bodies, stack traces, and nested SDK
   * objects are not included.
   */
  private readSafeErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof BadGatewayException) {
      const response = error.getResponse();

      if (typeof response === 'string') {
        return response;
      }

      if (
        typeof response === 'object' &&
        response !== null &&
        'message' in response &&
        typeof response.message === 'string'
      ) {
        return response.message;
      }
    }

    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }

    return fallback;
  }

  /**
   * Ensures exhaustive handling when new Prisma generation types
   * are added in the future.
   */
  private assertNever(value: never): never {
    throw new Error(`Unsupported idea generation type: ${String(value)}`);
  }
}
