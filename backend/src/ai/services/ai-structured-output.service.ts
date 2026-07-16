import { BadGatewayException, Injectable } from '@nestjs/common';

import { IdeaGenerationType, PromptType } from '@prisma/client';

import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';

import { FreeIdeaSchema } from '../schemas/free-idea.schema';

import type { FreeIdeaOutput } from '../schemas/free-idea.schema';

import { GuestIdeaSchema } from '../schemas/guest-idea.schema';

import type { GuestIdeaOutput } from '../schemas/guest-idea.schema';

import { PremiumIdeaSchema } from '../schemas/premium-idea.schema';

import type { PremiumIdeaOutput } from '../schemas/premium-idea.schema';

import { UnlockIdeaSchema } from '../schemas/unlock-idea.schema';

import type { UnlockIdeaOutput } from '../schemas/unlock-idea.schema';

import type { AiJsonSchema } from '../types/ai-json-schema.type';

import { AiResponseParserService } from './ai-response-parser.service';

/**
 * Union of all validated structured idea outputs.
 *
 * Retained for backward compatibility with idea business services
 * that call validateIdeaOutput directly.
 *
 * @author Malak
 */
export type StructuredIdeaOutput =
  | GuestIdeaOutput
  | FreeIdeaOutput
  | PremiumIdeaOutput
  | UnlockIdeaOutput;

/**
 * One normalized parsing or schema-validation issue.
 *
 * These issues may be included in the bounded structured-output repair
 * prompt.
 *
 * @author Malak
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
 * The fingerprint prevents one schema name from being reused with a
 * different schema definition.
 */
type CachedSchemaValidator = {
  readonly fingerprint: string;
  readonly validator: ValidateFunction;
};

/**
 * Parses and validates structured AI responses.
 *
 * Supported validation paths:
 *
 * 1. Generic JSON Schema validation using AJV.
 * 2. Existing idea-specific validation using Zod.
 *
 * Responsibilities:
 * - Parse provider text as JSON.
 * - Compile JSON Schemas.
 * - Cache compiled validators.
 * - Validate structured provider responses.
 * - Normalize AJV and Zod validation issues.
 *
 * This service does not:
 * - Execute providers.
 * - Select models.
 * - Retry provider requests.
 * - Repair provider responses.
 * - Persist business data.
 *
 * @author Malak
 */
@Injectable()
export class AiStructuredOutputService {
  /**
   * Shared AJV instance.
   *
   * allErrors allows repair requests to receive more than one useful
   * validation issue.
   */
  private readonly ajv = new Ajv({
    allErrors: true,
    strict: true,
  });

  /**
   * Compiled validators cached by normalized schema name.
   */
  private readonly validatorCache = new Map<string, CachedSchemaValidator>();

  constructor(private readonly parser: AiResponseParserService) {}

  /**
   * Parses and validates provider output using a supplied JSON Schema.
   *
   * This is the primary validation path used by AiExecutionService.
   *
   * @param rawText Raw provider response.
   * @param schema Expected provider-neutral JSON Schema.
   * @param schemaName Stable schema identifier.
   */
  safeValidateSchema(
    rawText: string,
    schema: AiJsonSchema,
    schemaName: string,
  ): StructuredOutputValidationResult {
    const normalizedSchemaName = schemaName.trim();

    if (!normalizedSchemaName) {
      return {
        success: false,
        issues: [
          {
            path: '$',
            code: 'missing_schema_name',
            message: 'A response schema name is required.',
          },
        ],
      };
    }

    const parsedResult = this.safeParseJson(rawText);

    if (!parsedResult.success) {
      return parsedResult;
    }

    const validatorResult = this.resolveValidator(schema, normalizedSchemaName);

    if (!validatorResult.success) {
      return validatorResult;
    }

    const isValid = validatorResult.validator(parsedResult.data);

    if (!isValid) {
      return {
        success: false,

        issues: this.mapAjvErrors(
          validatorResult.validator.errors,

          normalizedSchemaName,
        ),
      };
    }

    return {
      success: true,
      data: parsedResult.data,
    };
  }

  /**
   * Parses and validates provider output using a JSON Schema.
   *
   * @throws BadGatewayException When the provider response is invalid.
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
          `${schemaName.trim()} structured response.`,

        validationErrors: validation.issues,
      });
    }

    return validation.data;
  }

  /**
   * Parses and validates one structured idea response.
   *
   * Retained for existing idea-generation services.
   *
   * New generic execution flows should use validateSchema or
   * safeValidateSchema.
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
   * Parses and validates idea output without throwing.
   *
   * Retained for backward compatibility.
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
   * Parses raw provider output without throwing.
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
   * Returns a cached AJV validator or compiles a new validator.
   *
   * Reusing the same schema name with a different schema is rejected.
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
   * Converts AJV errors into normalized validation issues.
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

    return errors.map((error) => {
      const path = this.resolveAjvErrorPath(error);

      return {
        path,

        code: error.keyword,

        message:
          error.message ?? `The value does not match schema "${schemaName}".`,
      };
    });
  }

  /**
   * Resolves a readable field path from one AJV error.
   *
   * Required-property errors are extended with the missing property
   * name because their instancePath normally points only to the parent.
   */
  private resolveAjvErrorPath(error: ErrorObject): string {
    const basePath = this.normalizeAjvPath(error.instancePath);

    if (
      error.keyword === 'required' &&
      typeof error.params === 'object' &&
      error.params !== null &&
      'missingProperty' in error.params &&
      typeof error.params.missingProperty === 'string'
    ) {
      const missingProperty = error.params.missingProperty;

      return basePath === '$'
        ? missingProperty
        : `${basePath}.${missingProperty}`;
    }

    return basePath;
  }

  /**
   * Converts an AJV JSON Pointer into a readable property path.
   *
   * Example:
   * /objectives/0
   *
   * Becomes:
   * objectives.0
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
   * Produces a JSON representation used to detect schema-name
   * collisions.
   */
  private createSchemaFingerprint(schema: AiJsonSchema): string {
    return JSON.stringify(schema);
  }

  /**
   * Resolves an idea-specific Zod schema.
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
        'message' in response
      ) {
        const message = response.message;

        if (typeof message === 'string') {
          return message;
        }

        if (Array.isArray(message)) {
          return message.map(String).join('; ');
        }
      }
    }

    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }

    return fallback;
  }

  /**
   * Enforces exhaustive idea generation type handling.
   */
  private assertNeverIdeaGenerationType(value: never): never {
    throw new Error(`Unsupported idea generation type: ${String(value)}.`);
  }
}
