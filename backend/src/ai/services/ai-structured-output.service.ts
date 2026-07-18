import {
  BadGatewayException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';

import {
  IdeaGenerationType,
  PromptType,
} from '@prisma/client';

import Ajv, {
  type ErrorObject,
  type ValidateFunction,
} from 'ajv';

import {
  FreeIdeaSchema,
  type FreeIdeaOutput,
} from '../schemas/free-idea.schema';

import {
  GuestIdeaSchema,
  type GuestIdeaOutput,
} from '../schemas/guest-idea.schema';

import {
  PremiumIdeaSchema,
  type PremiumIdeaOutput,
} from '../schemas/premium-idea.schema';

import {
  UnlockIdeaSchema,
  type UnlockIdeaOutput,
} from '../schemas/unlock-idea.schema';

import type { AiJsonSchema } from '../types/ai-json-schema.type';

import { AiResponseParserService } from './ai-response-parser.service';

/**
 * Union of all validated structured idea outputs.
 *
 * This type is retained for backward compatibility with idea business
 * services that still use validateIdeaOutput() directly.
 *
 * New generic AI execution flows should preferably use
 * validateSchema<T>() with the expected output type.
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
 * Validation issues describe problems found in provider-generated
 * output. They may be included in a bounded response-repair prompt.
 *
 * These issues must not represent internal application configuration
 * errors such as invalid JSON Schemas or schema-name collisions.
 *
 * @author Malak
 */
export type StructuredOutputValidationIssue = {
  /**
   * Path of the invalid field.
   *
   * Examples:
   * - "$" for the root value.
   * - "$.title" for a root property.
   * - "$.objectives.0" for an array item.
   */
  readonly path: string;

  /**
   * Stable parsing or validation error category.
   *
   * Examples:
   * - "invalid_json"
   * - "required"
   * - "type"
   * - "additionalProperties"
   */
  readonly code: string;

  /**
   * Safe human-readable validation message.
   */
  readonly message: string;
};

/**
 * Successful structured-output validation result.
 *
 * @template T Validated output type.
 */
export type StructuredOutputValidationSuccess<T = unknown> = {
  /**
   * Indicates successful parsing and schema validation.
   */
  readonly success: true;

  /**
   * Parsed and validated output.
   */
  readonly data: T;
};

/**
 * Failed provider-output validation result.
 *
 * This result represents invalid provider-generated data only.
 * Internal schema or application configuration errors are thrown as
 * InternalServerErrorException instead.
 */
export type StructuredOutputValidationFailure = {
  /**
   * Indicates parsing or validation failure.
   */
  readonly success: false;

  /**
   * Normalized validation issues.
   */
  readonly issues: readonly StructuredOutputValidationIssue[];
};

/**
 * Discriminated result returned by non-throwing provider-output
 * validation methods.
 *
 * @template T Expected validated output type.
 */
export type StructuredOutputValidationResult<T = unknown> =
  | StructuredOutputValidationSuccess<T>
  | StructuredOutputValidationFailure;

/**
 * Compiled JSON Schema validator stored in the local validator cache.
 */
type CachedSchemaValidator = {
  /**
   * Deterministic representation of the schema definition.
   *
   * The fingerprint prevents the same schema name from being reused
   * with a different schema definition.
   */
  readonly fingerprint: string;

  /**
   * Compiled AJV validation function.
   */
  readonly validator: ValidateFunction;
};

/**
 * Successful internal JSON Schema validator resolution.
 */
type SchemaValidatorResolutionSuccess = {
  /**
   * Compiled or cached AJV validator.
   */
  readonly validator: ValidateFunction;
};

/**
 * Union of the supported idea-specific Zod schemas.
 */
type IdeaOutputSchema =
  | typeof GuestIdeaSchema
  | typeof FreeIdeaSchema
  | typeof PremiumIdeaSchema
  | typeof UnlockIdeaSchema;

/**
 * Successful idea-schema resolution result.
 */
type IdeaSchemaResolutionSuccess = {
  /**
   * Indicates successful schema resolution.
   */
  readonly success: true;

  /**
   * Zod schema matching the requested idea-generation operation.
   */
  readonly schema: IdeaOutputSchema;
};

/**
 * Result returned when resolving an idea-specific Zod schema.
 */
type IdeaSchemaResolutionResult =
  | IdeaSchemaResolutionSuccess
  | StructuredOutputValidationFailure;

/**
 * Parses and validates structured AI-provider responses.
 *
 * Supported validation paths:
 *
 * 1. Generic provider-neutral JSON Schema validation using AJV.
 * 2. Legacy idea-specific validation using Zod.
 *
 * Responsibilities:
 * - Parse textual provider output as JSON.
 * - Compile provider-neutral JSON Schemas.
 * - Cache compiled AJV validators.
 * - Detect schema-name collisions.
 * - Validate structured provider responses.
 * - Normalize parser, AJV, and Zod validation issues.
 * - Distinguish provider-output errors from internal schema errors.
 *
 * Provider-output errors:
 * - Invalid JSON.
 * - Missing required properties.
 * - Invalid property types.
 * - Unexpected properties.
 * - Any other schema mismatch.
 *
 * Internal application errors:
 * - Missing schema names.
 * - Invalid JSON Schema definitions.
 * - Reusing one schema name with a different schema definition.
 *
 * This service does not:
 * - Execute AI providers.
 * - Select AI models.
 * - Retry provider requests.
 * - Repair malformed provider responses.
 * - Persist validated business data.
 *
 * @author Malak
 */
@Injectable()
export class AiStructuredOutputService {
  /**
   * Shared AJV instance used for provider-neutral JSON Schema
   * validation.
   *
   * Configuration:
   * - allErrors: reports multiple useful validation issues in one pass.
   * - strict: rejects invalid or ambiguous application-owned schemas.
   *
   * Type coercion, default insertion, and automatic property removal are
   * intentionally disabled. Validation must not silently mutate an AI
   * provider response.
   */
  private readonly ajv = new Ajv({
    allErrors: true,
    strict: true,
  });

  /**
   * Compiled AJV validators indexed by normalized schema name.
   *
   * Validators are compiled once and reused across provider requests.
   */
  private readonly validatorCache = new Map<
    string,
    CachedSchemaValidator
  >();

  constructor(
    private readonly parser: AiResponseParserService,
  ) {}

  /**
   * Parses and validates provider output using a supplied JSON Schema
   * without throwing for provider-output errors.
   *
   * This is the primary validation path used by AiExecutionService.
   *
   * The method returns a failure result when the provider response:
   * - Is not valid JSON.
   * - Does not match the supplied schema.
   *
   * The method still throws InternalServerErrorException when the
   * application supplies an invalid schema name or schema definition.
   * Those failures are internal configuration errors and must never be
   * sent to the AI response-repair flow.
   *
   * @template T Expected validated output type.
   * @param rawText Raw textual provider response.
   * @param schema Expected provider-neutral JSON Schema.
   * @param schemaName Stable schema identifier used by the validator
   * cache.
   * @returns Successful validated data or normalized provider-output
   * issues.
   *
   * @throws InternalServerErrorException when the schema name is empty,
   * the JSON Schema is invalid, or one schema name is reused with a
   * different schema definition.
   */
  safeValidateSchema<T = unknown>(
    rawText: string,
    schema: AiJsonSchema,
    schemaName: string,
  ): StructuredOutputValidationResult<T> {
    const normalizedSchemaName =
      this.normalizeRequiredSchemaName(schemaName);

    const parsedResult =
      this.safeParseJson(rawText);

    if (!parsedResult.success) {
      return parsedResult;
    }

    const { validator } = this.resolveValidator(
      schema,
      normalizedSchemaName,
    );

    const isValid = validator(parsedResult.data);

    if (!isValid) {
      return {
        success: false,

        issues: this.mapAjvErrors(
          validator.errors,
          normalizedSchemaName,
        ),
      };
    }

    /*
     * AJV confirms that the runtime value matches the supplied schema.
     *
     * TypeScript cannot infer T directly from the provider-neutral schema
     * object, so the validated runtime value is returned as T.
     */
    return {
      success: true,
      data: parsedResult.data as T,
    };
  }

  /**
   * Parses and validates provider output using a supplied JSON Schema.
   *
   * Unlike safeValidateSchema(), this method throws
   * BadGatewayException when provider-generated output is invalid.
   *
   * Internal schema errors remain InternalServerErrorException and are
   * not converted into gateway errors.
   *
   * @template T Expected validated output type.
   * @param rawText Raw textual provider response.
   * @param schema Expected provider-neutral JSON Schema.
   * @param schemaName Stable schema identifier.
   * @returns Parsed and validated output.
   *
   * @throws BadGatewayException when the provider response is invalid.
   * @throws InternalServerErrorException when application-owned schema
   * configuration is invalid.
   */
  validateSchema<T = unknown>(
    rawText: string,
    schema: AiJsonSchema,
    schemaName: string,
  ): T {
    const validation = this.safeValidateSchema<T>(
      rawText,
      schema,
      schemaName,
    );

    if (!validation.success) {
      throw new BadGatewayException({
        message:
          'The AI provider returned an invalid ' +
          `${schemaName.trim()} structured response.`,

        validationErrors: validation.issues,
      });
    }

    return validation.data;
  }

  /**
   * Parses and validates one structured idea response.
   *
   * This method is retained for existing idea-generation business
   * services that use Prisma enums and idea-specific Zod schemas.
   *
   * New generic AI execution flows should use validateSchema<T>() or
   * safeValidateSchema<T>().
   *
   * @param rawText Raw textual provider response.
   * @param generationType Requested idea-generation access level.
   * @param promptType Prompt operation type.
   * @returns Parsed and validated idea output.
   *
   * @throws BadGatewayException when provider-generated idea output is
   * invalid or does not match the expected idea schema.
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
   * Parses and validates one idea-specific provider response without
   * throwing for invalid provider output.
   *
   * This method is retained for backward compatibility with existing
   * idea-generation services.
   *
   * Unsupported prompt or generation types are returned as normalized
   * failure results rather than thrown errors.
   *
   * @param rawText Raw textual provider response.
   * @param generationType Requested idea-generation access level.
   * @param promptType Prompt operation type.
   * @returns Validated idea output or normalized validation issues.
   */
  safeValidateIdeaOutput(
    rawText: string,
    generationType: IdeaGenerationType | undefined,
    promptType: PromptType,
  ): StructuredOutputValidationResult<StructuredIdeaOutput> {
    const parsedResult =
      this.safeParseJson(rawText);

    if (!parsedResult.success) {
      return parsedResult;
    }

    const schemaResolution = this.resolveIdeaSchema(
      generationType,
      promptType,
    );

    if (!schemaResolution.success) {
      return schemaResolution;
    }

    const result = schemaResolution.schema.safeParse(
      parsedResult.data,
    );

    if (!result.success) {
      return {
        success: false,

        issues: result.error.issues.map((issue) => ({
          path: this.normalizeZodPath(issue.path),

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
   *
   * BadGatewayException values thrown by AiResponseParserService are
   * converted into normalized provider-output validation issues.
   *
   * @param rawText Raw textual provider response.
   * @returns Parsed JSON value or one normalized parsing issue.
   */
  private safeParseJson(
    rawText: string,
  ): StructuredOutputValidationResult<unknown> {
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
   * Returns a cached AJV validator or compiles and caches a new one.
   *
   * Reusing the same normalized schema name with a different schema
   * definition is treated as an internal application error.
   *
   * This protects the validator cache from silently returning a
   * validator for an unrelated schema.
   *
   * @param schema Provider-neutral JSON Schema.
   * @param schemaName Normalized stable schema identifier.
   * @returns Compiled or cached validator.
   *
   * @throws InternalServerErrorException when the schema name is reused
   * with a different definition or the supplied schema cannot be
   * compiled by AJV.
   */
  private resolveValidator(
    schema: AiJsonSchema,
    schemaName: string,
  ): SchemaValidatorResolutionSuccess {
    const fingerprint =
      this.createSchemaFingerprint(schema);

    const cached =
      this.validatorCache.get(schemaName);

    if (cached) {
      if (cached.fingerprint !== fingerprint) {
        throw new InternalServerErrorException(
          `Response schema name "${schemaName}" was reused ` +
            'with a different JSON Schema.',
        );
      }

      return {
        validator: cached.validator,
      };
    }

    try {
      const validator =
        this.ajv.compile(schema);

      this.validatorCache.set(schemaName, {
        fingerprint,
        validator,
      });

      return {
        validator,
      };
    } catch (error: unknown) {
      throw new InternalServerErrorException(
        {
          message:
            `Response schema "${schemaName}" is invalid.`,

          cause: this.readSafeInternalErrorMessage(error),
        },
      );
    }
  }

  /**
   * Converts AJV errors into normalized provider-output issues.
   *
   * @param errors AJV validation errors.
   * @param schemaName Stable schema identifier used for fallback
   * messages.
   * @returns Normalized validation issue list.
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

          message:
            `The response does not match schema ` +
            `"${schemaName}".`,
        },
      ];
    }

    return errors.map((error) => ({
      path: this.resolveAjvErrorPath(error),

      code: error.keyword,

      message:
        error.message ??
        `The value does not match schema "${schemaName}".`,
    }));
  }

  /**
   * Resolves a readable field path from one AJV validation error.
   *
   * Special handling is applied to:
   * - required: appends the missing property name.
   * - additionalProperties: appends the unexpected property name.
   *
   * AJV normally points these errors to the parent object rather than
   * directly to the affected property.
   *
   * @param error AJV validation error.
   * @returns Normalized path beginning with "$".
   */
  private resolveAjvErrorPath(
    error: ErrorObject,
  ): string {
    const basePath = this.normalizeAjvPath(
      error.instancePath,
    );

    if (
      error.keyword === 'required' &&
      this.hasStringParameter(
        error.params,
        'missingProperty',
      )
    ) {
      return this.appendPathSegment(
        basePath,
        error.params.missingProperty,
      );
    }

    if (
      error.keyword === 'additionalProperties' &&
      this.hasStringParameter(
        error.params,
        'additionalProperty',
      )
    ) {
      return this.appendPathSegment(
        basePath,
        error.params.additionalProperty,
      );
    }

    return basePath;
  }

  /**
   * Determines whether an AJV error-parameter object contains one
   * string-valued property.
   *
   * @param params AJV error parameters.
   * @param propertyName Parameter property to check.
   * @returns True when the requested parameter exists as a string.
   */
  private hasStringParameter<
    TPropertyName extends string,
  >(
    params: unknown,
    propertyName: TPropertyName,
  ): params is Record<TPropertyName, string> {
    return (
      typeof params === 'object' &&
      params !== null &&
      propertyName in params &&
      typeof (
        params as Record<string, unknown>
      )[propertyName] === 'string'
    );
  }

  /**
   * Converts an AJV JSON Pointer into a readable root-based property
   * path.
   *
   * Example:
   *
   * /objectives/0
   *
   * Becomes:
   *
   * $.objectives.0
   *
   * JSON Pointer escape sequences are decoded before path construction.
   *
   * @param instancePath AJV JSON Pointer.
   * @returns Root-based readable property path.
   */
  private normalizeAjvPath(
    instancePath: string,
  ): string {
    if (!instancePath) {
      return '$';
    }

    const segments = instancePath
      .split('/')
      .filter(Boolean)
      .map((segment) =>
        segment
          .replace(/~1/g, '/')
          .replace(/~0/g, '~'),
      );

    return this.buildRootPath(segments);
  }

  /**
   * Converts a Zod issue path into the normalized root-based path format
   * used by the generic validation flow.
   *
   * @param path Zod issue path.
   * @returns Root-based readable property path.
   */
  private normalizeZodPath(
    path: readonly PropertyKey[],
  ): string {
    return this.buildRootPath(
      path.map(String),
    );
  }

  /**
   * Builds one readable path beginning at the "$" root marker.
   *
   * @param segments Property or array-index path segments.
   * @returns Root-based path.
   */
  private buildRootPath(
    segments: readonly string[],
  ): string {
    if (segments.length === 0) {
      return '$';
    }

    return `$.${segments.join('.')}`;
  }

  /**
   * Appends one property segment to an existing root-based path.
   *
   * @param basePath Existing normalized path.
   * @param segment Property name to append.
   * @returns Extended normalized path.
   */
  private appendPathSegment(
    basePath: string,
    segment: string,
  ): string {
    return basePath === '$'
      ? `$.${segment}`
      : `${basePath}.${segment}`;
  }

  /**
   * Produces a deterministic schema fingerprint.
   *
   * Object keys are sorted recursively before serialization so schemas
   * with identical content but different property insertion order
   * produce the same fingerprint.
   *
   * Array order is preserved because array order may be semantically
   * meaningful in JSON Schema keywords such as required, enum, oneOf,
   * anyOf, and allOf.
   *
   * @param schema Provider-neutral JSON Schema.
   * @returns Deterministic JSON fingerprint.
   */
  private createSchemaFingerprint(
    schema: AiJsonSchema,
  ): string {
    return JSON.stringify(
      this.sortObjectKeysRecursively(schema),
    );
  }

  /**
   * Recursively sorts keys of plain JSON objects.
   *
   * Arrays retain their original order while each array element is
   * normalized recursively.
   *
   * @param value JSON-compatible value.
   * @returns Structurally equivalent value with sorted object keys.
   */
  private sortObjectKeysRecursively(
    value: unknown,
  ): unknown {
    if (Array.isArray(value)) {
      return value.map((item) =>
        this.sortObjectKeysRecursively(item),
      );
    }

    if (
      typeof value !== 'object' ||
      value === null
    ) {
      return value;
    }

    const record =
      value as Record<string, unknown>;

    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>(
        (sortedObject, key) => {
          sortedObject[key] =
            this.sortObjectKeysRecursively(
              record[key],
            );

          return sortedObject;
        },
        {},
      );
  }

  /**
   * Resolves the idea-specific Zod schema matching the requested prompt
   * and generation type.
   *
   * IDEA_UNLOCK uses UnlockIdeaSchema independently from
   * generationType.
   *
   * IDEA_GENERATION requires one supported IdeaGenerationType.
   *
   * @param generationType Requested idea-generation access level.
   * @param promptType Prompt operation type.
   * @returns Resolved schema or normalized unsupported-operation issue.
   */
  private resolveIdeaSchema(
    generationType: IdeaGenerationType | undefined,
    promptType: PromptType,
  ): IdeaSchemaResolutionResult {
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
              'Structured idea output is not supported for ' +
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
              'generationType is required for structured ' +
              'idea generation.',
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
        return this.resolveUnsupportedIdeaGenerationType(
          generationType,
        );
    }
  }

  /**
   * Handles runtime idea-generation values that are unknown to the
   * current backend implementation.
   *
   * The never parameter preserves compile-time exhaustive checking:
   * adding a new IdeaGenerationType requires adding a matching switch
   * branch.
   *
   * At runtime, stale database values or unsafe casts are returned as a
   * normalized validation failure instead of throwing from a method
   * documented as safe.
   *
   * @param value Unexpected idea-generation type.
   * @returns Unsupported-generation-type failure.
   */
  private resolveUnsupportedIdeaGenerationType(
    value: never,
  ): StructuredOutputValidationFailure {
    return {
      success: false,

      issues: [
        {
          path: '$',

          code: 'unsupported_generation_type',

          message:
            'Unsupported idea generation type: ' +
            `${String(value)}.`,
        },
      ],
    };
  }

  /**
   * Validates and normalizes one required schema name.
   *
   * Empty schema names are application configuration errors rather than
   * provider-output errors.
   *
   * @param schemaName Candidate schema identifier.
   * @returns Trimmed non-empty schema name.
   *
   * @throws InternalServerErrorException when the schema name is empty.
   */
  private normalizeRequiredSchemaName(
    schemaName: string,
  ): string {
    const normalizedSchemaName =
      schemaName.trim();

    if (!normalizedSchemaName) {
      throw new InternalServerErrorException(
        'A structured AI response schema name is required.',
      );
    }

    return normalizedSchemaName;
  }

  /**
   * Extracts a safe parser error message.
   *
   * NestJS gateway exceptions may contain either:
   * - A string response.
   * - An object with a string message.
   * - An object with an array of messages.
   *
   * @param error Unknown parser error.
   * @param fallback Message returned when no safe message is available.
   * @returns Safe normalized error message.
   */
  private readSafeErrorMessage(
    error: unknown,
    fallback: string,
  ): string {
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
          return message
            .map(String)
            .join('; ');
        }
      }
    }

    if (
      error instanceof Error &&
      error.message.trim()
    ) {
      return error.message;
    }

    return fallback;
  }

  /**
   * Extracts a safe internal schema-compilation error message.
   *
   * This information is included only in the internal exception
   * response and must not contain provider credentials or raw provider
   * content.
   *
   * @param error Unknown AJV compilation error.
   * @returns Safe internal error description.
   */
  private readSafeInternalErrorMessage(
    error: unknown,
  ): string {
    if (
      error instanceof Error &&
      error.message.trim()
    ) {
      return error.message;
    }

    return 'The JSON Schema could not be compiled.';
  }
}