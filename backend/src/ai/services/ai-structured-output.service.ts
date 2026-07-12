import { BadGatewayException, Injectable } from '@nestjs/common';
import { IdeaGenerationType, PromptType } from '@prisma/client';
import Ajv, { ErrorObject, ValidateFunction } from 'ajv';

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

import { AiJsonSchema } from '../types/ai-json-schema.type';
import { AiResponseParserService } from './ai-response-parser.service';

/**
 * Union of all validated structured idea outputs.
 *
 * Kept for backward compatibility with idea business services
 * that call validateIdeaOutput directly.
 */
export type StructuredIdeaOutput =
  | GuestIdeaOutput
  | FreeIdeaOutput
  | PremiumIdeaOutput
  | UnlockIdeaOutput;

/**
 * One normalized parsing or schema-validation issue.
 *
 * These issues are safe to include in the bounded
 * structured-output repair prompt.
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
export type StructuredOutputValidationSuccess<T = unknown> = {
  readonly success: true;
  readonly data: T;
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
export type StructuredOutputValidationResult<T = unknown> =
  | StructuredOutputValidationSuccess<T>
  | StructuredOutputValidationFailure;

/**
 * Cached compiled JSON Schema validator.
 *
 * The fingerprint protects against accidentally reusing the same
 * responseSchemaName for two different schemas.
 */
type CachedSchemaValidator = {
  readonly fingerprint: string;
  readonly validator: ValidateFunction;
};

/**
 * Parses and validates structured AI responses.
 *
 * The service supports two validation paths:
 *
 * 1. Generic JSON Schema validation:
 *    Used by AiExecutionService for every business module.
 *
 * 2. Existing idea-specific Zod validation:
 *    Retained for backward compatibility with business services
 *    that validate idea responses directly.
 *
 * Responsibilities:
 * - Parse provider text into JSON.
 * - Compile provider-neutral JSON Schemas.
 * - Cache compiled schema validators.
 * - Validate any structured business response.
 * - Normalize AJV and Zod validation issues.
 * - Reject malformed and unexpected output safely.
 *
 * This service does not:
 * - Execute AI providers.
 * - Select AI models.
 * - Retry or repair responses.
 * - Persist business records.
 *
 * @author Malak
 */
@Injectable()
export class AiStructuredOutputService {
  /**
   * JSON Schema validator shared across AI operations.
   *
   * allErrors allows the repair request to receive multiple useful
   * validation issues rather than only the first failure.
   */
  private readonly ajv = new Ajv({
    allErrors: true,
    strict: true,
  });

  /**
   * Compiled schemas cached by their stable schema name.
   */
  private readonly validatorCache = new Map<string, CachedSchemaValidator>();

  constructor(private readonly parser: AiResponseParserService) {}

  /**
   * Parses and validates provider output using any supplied
   * provider-neutral JSON Schema.
   *
   * This is the main validation method used by AiExecutionService.
   *
   * @param rawText Raw provider response.
   * @param schema Expected provider-neutral JSON Schema.
   * @param schemaName Stable schema identifier.
   * @returns Non-throwing validation result.
   */
  safeValidateSchema(
    rawText: string,
    schema: AiJsonSchema,
    schemaName: string,
  ): StructuredOutputValidationResult {
    const parsedResult = this.safeParseJson(rawText);

    if (!parsedResult.success) {
      return parsedResult;
    }

    const validatorResult = this.resolveValidator(schema, schemaName);

    if (!validatorResult.success) {
      return validatorResult;
    }

    const isValid = validatorResult.validator(parsedResult.data);

    if (!isValid) {
      return {
        success: false,
        issues: this.mapAjvErrors(validatorResult.validator.errors, schemaName),
      };
    }

    return {
      success: true,
      data: parsedResult.data,
    };
  }

  /**
   * Parses and validates provider output using a supplied JSON
   * Schema and throws when the response is invalid.
   *
   * This method is convenient for business services that prefer
   * exception-based validation.
   */
  validateSchema(
    rawText: string,
    schema: AiJsonSchema,
    schemaName: string,
  ): unknown {
    const validation = this.safeValidateSchema(rawText, schema, schemaName);

    if (!validation.success) {
      throw new BadGatewayException({
        message:
          `The AI provider returned an invalid ` +
          `${schemaName} structured response.`,
        validationErrors: validation.issues,
      });
    }

    return validation.data;
  }

  /**
   * Parses and validates one structured idea response.
   *
   * Retained for existing idea-generation business services.
   *
   * AiExecutionService no longer depends on this method because
   * central execution now accepts caller-supplied JSON Schemas.
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
   * Parses and validates idea structured output without throwing.
   *
   * Retained for backward compatibility. New central execution
   * should use safeValidateSchema instead.
   */
  safeValidateIdeaOutput(
    rawText: string,
    generationType: IdeaGenerationType | undefined,
    promptType: PromptType,
  ): StructuredOutputValidationResult<StructuredIdeaOutput> {
    const parsedResult = this.safeParseJson(rawText);

    if (!parsedResult.success) {
      return parsedResult;
    }

    const schemaResolution = this.resolveIdeaSchema(generationType, promptType);

    if (!schemaResolution.success) {
      return schemaResolution;
    }

    const result = schemaResolution.schema.safeParse(parsedResult.data);

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
   * Parses raw provider output safely.
   */
  private safeParseJson(rawText: string): StructuredOutputValidationResult {
    try {
      return {
        success: true,
        data: this.parser.parseJson(rawText),
      };
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
  }

  /**
   * Returns a cached AJV validator or compiles a new one.
   *
   * Schema names must remain stable and unique. Reusing one name
   * for different schemas is rejected because it may otherwise
   * validate a response against the wrong contract.
   */
  private resolveValidator(
    schema: AiJsonSchema,
    schemaName: string,
  ):
    | {
        readonly success: true;
        readonly validator: ValidateFunction;
      }
    | StructuredOutputValidationFailure {
    const fingerprint = this.createSchemaFingerprint(schema);
    const cached = this.validatorCache.get(schemaName);

    if (cached) {
      if (cached.fingerprint !== fingerprint) {
        return {
          success: false,
          issues: [
            {
              path: '$',
              code: 'schema_name_conflict',
              message:
                `Response schema name "${schemaName}" ` +
                'was reused with a different JSON Schema.',
            },
          ],
        };
      }

      return {
        success: true,
        validator: cached.validator,
      };
    }

    try {
      const validator = this.ajv.compile(schema);

      this.validatorCache.set(schemaName, {
        fingerprint,
        validator,
      });

      return {
        success: true,
        validator,
      };
    } catch (error: unknown) {
      return {
        success: false,
        issues: [
          {
            path: '$',
            code: 'invalid_response_schema',
            message: this.readSafeErrorMessage(
              error,
              `Response schema "${schemaName}" is invalid.`,
            ),
          },
        ],
      };
    }
  }

  /**
   * Converts AJV validation errors into the normalized validation
   * issue structure used by response repair.
   */
  private mapAjvErrors(
    errors: ErrorObject[] | null | undefined,
    schemaName: string,
  ): StructuredOutputValidationIssue[] {
    if (!errors || errors.length === 0) {
      return [
        {
          path: '$',
          code: 'schema_validation_failed',
          message: `The response does not match schema "${schemaName}".`,
        },
      ];
    }

    return errors.map((error) => ({
      path: this.normalizeAjvPath(error.instancePath),
      code: error.keyword,
      message:
        error.message ?? `The value does not match schema "${schemaName}".`,
    }));
  }

  /**
   * Converts an AJV JSON Pointer into a readable property path.
   *
   * Example:
   * /recurringProblems/0/title
   * becomes:
   * recurringProblems.0.title
   */
  private normalizeAjvPath(instancePath: string): string {
    if (!instancePath) {
      return '$';
    }

    return instancePath
      .split('/')
      .filter(Boolean)
      .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
      .join('.');
  }

  /**
   * Produces a stable JSON representation used to detect schema-name
   * collisions.
   */
  private createSchemaFingerprint(schema: AiJsonSchema): string {
    return JSON.stringify(schema);
  }

  /**
   * Resolves the existing Zod schema for idea operations.
   */
  private resolveIdeaSchema(
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
            message:
              `Structured idea output is not supported for ` +
              `prompt type ${promptType}.`,
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
        return this.assertNeverIdeaGenerationType(generationType);
    }
  }

  /**
   * Extracts a safe parsing or schema-compilation error message.
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
   * Ensures exhaustive handling when new idea generation types
   * are added.
   */
  private assertNeverIdeaGenerationType(value: never): never {
    throw new Error(`Unsupported idea generation type: ${String(value)}.`);
  }
}
