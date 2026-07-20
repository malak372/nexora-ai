/**
 * Parses and normalizes structured AI responses returned during
 * new-idea generation.
 *
 * @author Malak
 */

import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';

import {
  IDEA_GENERATION_ERROR_CODES,
} from '../constants/idea-generation.constants';

import {
  IDEA_ADVANCED_OUTPUT_DEFINITIONS,
} from '../constants/idea-output.constants';

import type {
  AdvancedIdeaAiOutput,
  CoreIdeaAiOutput,
  IdeaAiOutputParseResult,
  ParsedIdeaAiOutput,
  RawIdeaAiOutput,
} from '../types/idea-ai-output.type';

/**
 * Parses and normalizes structured AI output returned while
 * generating a new idea.
 *
 * The central AI runtime remains responsible for:
 * - Executing the selected AI provider and model.
 * - Applying the selected response JSON schema.
 * - Parsing provider-level structured output.
 * - Performing schema validation.
 * - Attempting bounded response repair.
 *
 * This service introduces an additional business-level validation
 * boundary before generated data enters the idea-generation
 * pipeline or persistence layer.
 *
 * Responsibilities:
 * - Accept raw JSON text or an already parsed JSON value.
 * - Reject null, arrays, and primitive root payloads.
 * - Parse required core idea fields.
 * - Parse tier-specific abstract fields when provided.
 * - Normalize required string arrays.
 * - Remove blank and duplicate array values.
 * - Convert supported premium fields into
 *   GeneratedOutput-compatible records.
 * - Preserve centralized advanced-output ordering.
 * - Return safe parser errors without exposing internal details.
 *
 * Abstract requiredness is intentionally not enforced by this
 * parser because it depends on the resolved IdeaGenerationType:
 * - GUEST_FREE
 * - NORMAL_FREE
 * - PREMIUM_CREDIT
 *
 * AiOutputValidationStage is responsible for enforcing the
 * appropriate tier-specific abstract contract.
 *
 * Direct-unlock responses must be parsed by
 * IdeaUnlockOutputParserService because unlock responses
 * intentionally exclude existing core idea fields.
 */
@Injectable()
export class IdeaAiOutputParserService {
  /**
   * Parses a raw new-idea AI response without throwing.
   *
   * Any parsing or business-level validation failure is returned
   * as a discriminated failure result.
   *
   * @param raw Raw or already parsed AI response.
   * @returns Successful or failed parsing result.
   */
  parse(
    raw: RawIdeaAiOutput,
  ): IdeaAiOutputParseResult {
    try {
      const record = this.toRecord(raw);
      const output = this.parseRecord(record);

      return {
        success: true,
        output,
        repaired: false,
        errors: [],
      };
    } catch (error: unknown) {
      return {
        success: false,
        output: null,
        repaired: false,
        errors: [
          this.getSafeErrorMessage(error),
        ],
      };
    }
  }

  /**
   * Parses a raw new-idea response and throws a safe HTTP
   * exception when parsing or business-level validation fails.
   *
   * This method is suitable for request-facing services that need
   * to stop execution immediately after receiving malformed AI
   * output.
   *
   * @param raw Raw or already parsed AI response.
   * @returns Parsed and normalized idea output.
   *
   * @throws BadRequestException When the AI output is malformed.
   */
  parseOrThrow(
    raw: RawIdeaAiOutput,
  ): ParsedIdeaAiOutput {
    const result = this.parse(raw);

    if (!result.success) {
      throw new BadRequestException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .INVALID_AI_OUTPUT,

        message:
          'The AI returned an invalid idea payload.',

        errors:
          result.errors,
      });
    }

    return result.output;
  }

  /**
   * Parses one validated root object into normalized new-idea
   * output.
   *
   * Core fields are required for every newly generated idea.
   * Abstract fields remain optional at this layer because their
   * requiredness differs between guest, normal-free, and premium
   * generation.
   *
   * @param value Parsed AI-response object.
   * @returns Normalized core idea and advanced outputs.
   */
  private parseRecord(
    value: Record<string, unknown>,
  ): ParsedIdeaAiOutput {
    const coreIdea: CoreIdeaAiOutput = {
      title:
        this.requireString(
          value,
          'title',
        ),

      problemStatement:
        this.requireString(
          value,
          'problemStatement',
        ),

      objectives:
        this.requireStringArray(
          value,
          'objectives',
        ),

      targetUsers:
        this.requireStringArray(
          value,
          'targetUsers',
        ),
    };

    const limitedAbstract =
      this.optionalString(
        value,
        'limitedAbstract',
      );

    const partialAbstract =
      this.optionalString(
        value,
        'partialAbstract',
      );

    const fullAbstract =
      this.optionalString(
        value,
        'fullAbstract',
      );

    if (limitedAbstract !== undefined) {
      coreIdea.limitedAbstract =
        limitedAbstract;
    }

    if (partialAbstract !== undefined) {
      coreIdea.partialAbstract =
        partialAbstract;
    }

    if (fullAbstract !== undefined) {
      coreIdea.fullAbstract =
        fullAbstract;
    }

    return {
      coreIdea,

      advancedOutputs:
        this.parseAdvancedOutputs(
          value,
        ),
    };
  }

  /**
   * Converts supported advanced AI fields into normalized
   * GeneratedOutput-compatible records.
   *
   * Missing fields are ignored at this parser layer because guest
   * and normal-free generation schemas do not include advanced
   * outputs.
   *
   * Provided fields are validated strictly:
   * - Collection fields must contain string arrays.
   * - Scalar fields must contain non-empty strings.
   * - Blank collection entries are removed.
   * - Duplicate collection entries are removed
   *   case-insensitively.
   *
   * Collection outputs are represented as:
   * - Human-readable Markdown content.
   * - JSON-compatible structuredContent.
   *
   * Premium-output completeness is validated later by
   * AiOutputValidationStage after generation entitlement has been
   * resolved.
   *
   * @param value Parsed AI-response object.
   * @returns Ordered normalized advanced outputs.
   */
  private parseAdvancedOutputs(
    value: Record<string, unknown>,
  ): AdvancedIdeaAiOutput[] {
    const outputs:
      AdvancedIdeaAiOutput[] = [];

    for (
      const definition of
      IDEA_ADVANCED_OUTPUT_DEFINITIONS
    ) {
      if (
        !this.hasOwnProperty(
          value,
          definition.field,
        )
      ) {
        continue;
      }

      if (definition.collection) {
        const items =
          this.requireAdvancedStringArray(
            value[definition.field],
            definition.field,
          );

        outputs.push({
          outputKey:
            definition.outputKey,

          title:
            definition.title,

          content:
            this.toMarkdownList(
              items,
            ),

          structuredContent:
            items,
        });

        continue;
      }

      const content =
        this.requireAdvancedString(
          value[definition.field],
          definition.field,
        );

      outputs.push({
        outputKey:
          definition.outputKey,

        title:
          definition.title,

        content,
      });
    }

    return outputs;
  }

  /**
   * Converts raw input into a non-null JSON object.
   *
   * Arrays and primitive root values are rejected because a
   * generated idea must be represented by one JSON object.
   *
   * @param raw Raw or already parsed AI response.
   * @returns Parsed root object.
   */
  private toRecord(
    raw: RawIdeaAiOutput,
  ): Record<string, unknown> {
    const parsedValue =
      typeof raw === 'string'
        ? this.parseJson(raw)
        : raw;

    if (!this.isRecord(parsedValue)) {
      throw new Error(
        'AI idea output must be a JSON object.',
      );
    }

    return parsedValue;
  }

  /**
   * Parses one non-empty JSON response string.
   *
   * Markdown fences or other provider-specific wrappers are not
   * removed here because bounded repair belongs to the central AI
   * runtime.
   *
   * @param text Raw AI response text.
   * @returns Parsed JSON value.
   */
  private parseJson(
    text: string,
  ): unknown {
    const normalizedText =
      text.trim();

    if (!normalizedText) {
      throw new Error(
        'AI idea output cannot be empty.',
      );
    }

    try {
      return JSON.parse(
        normalizedText,
      ) as unknown;
    } catch {
      throw new Error(
        'AI idea output could not be parsed as JSON.',
      );
    }
  }

  /**
   * Reads and normalizes one required non-empty string field.
   *
   * @param value AI-output object.
   * @param key Required field name.
   * @returns Normalized string value.
   */
  private requireString(
    value: Record<string, unknown>,
    key: string,
  ): string {
    const fieldValue =
      value[key];

    if (
      typeof fieldValue !==
      'string'
    ) {
      throw new Error(
        `AI output field "${key}" must be a string.`,
      );
    }

    const normalizedValue =
      fieldValue.trim();

    if (!normalizedValue) {
      throw new Error(
        `AI output field "${key}" must not be empty.`,
      );
    }

    return normalizedValue;
  }

  /**
   * Reads and normalizes one optional string field.
   *
   * A missing field resolves to undefined.
   *
   * A field that is present but contains a non-string or blank
   * value is rejected because it indicates malformed provider
   * output rather than an omitted optional field.
   *
   * @param value AI-output object.
   * @param key Optional field name.
   * @returns Normalized string or undefined.
   */
  private optionalString(
    value: Record<string, unknown>,
    key: string,
  ): string | undefined {
    if (
      !this.hasOwnProperty(
        value,
        key,
      )
    ) {
      return undefined;
    }

    const fieldValue =
      value[key];

    if (
      typeof fieldValue !==
      'string'
    ) {
      throw new Error(
        `AI output field "${key}" must be a string when provided.`,
      );
    }

    const normalizedValue =
      fieldValue.trim();

    if (!normalizedValue) {
      throw new Error(
        `AI output field "${key}" must not be blank when provided.`,
      );
    }

    return normalizedValue;
  }

  /**
   * Reads and normalizes one required string-array field.
   *
   * Duplicate values are removed case-insensitively while
   * preserving the original casing of the first occurrence.
   *
   * Blank values are ignored, but the final normalized array must
   * contain at least one valid item.
   *
   * @param value AI-output object.
   * @param key Required array field name.
   * @returns Normalized non-empty string array.
   */
  private requireStringArray(
    value: Record<string, unknown>,
    key: string,
  ): string[] {
    const fieldValue =
      value[key];

    if (!Array.isArray(fieldValue)) {
      throw new Error(
        `AI output field "${key}" must be a string array.`,
      );
    }

    if (
      fieldValue.some(
        (item) =>
          typeof item !==
          'string',
      )
    ) {
      throw new Error(
        `AI output field "${key}" must contain only strings.`,
      );
    }

    const normalizedItems =
      this.normalizeStringArray(
        fieldValue,
      );

    if (
      normalizedItems.length === 0
    ) {
      throw new Error(
        `AI output field "${key}" must contain at least one non-empty value.`,
      );
    }

    return normalizedItems;
  }

  /**
   * Reads and normalizes one collection-valued advanced output.
   *
   * This method is called only when the field is present.
   * Therefore, invalid or empty collections are treated as
   * malformed provider output instead of silently ignored.
   *
   * @param value Advanced-output field value.
   * @param field Field name used in validation messages.
   * @returns Normalized non-empty string array.
   */
  private requireAdvancedStringArray(
    value: unknown,
    field: string,
  ): string[] {
    if (!Array.isArray(value)) {
      throw new Error(
        `Advanced AI output field "${field}" must be a string array.`,
      );
    }

    if (
      value.some(
        (item) =>
          typeof item !==
          'string',
      )
    ) {
      throw new Error(
        `Advanced AI output field "${field}" must contain only strings.`,
      );
    }

    const normalizedItems =
      this.normalizeStringArray(
        value,
      );

    if (
      normalizedItems.length === 0
    ) {
      throw new Error(
        `Advanced AI output field "${field}" must contain at least one non-empty value.`,
      );
    }

    return normalizedItems;
  }

  /**
   * Reads and normalizes one scalar advanced-output field.
   *
   * This method is called only when the field exists in the
   * response. Therefore, non-string and blank values are rejected.
   *
   * @param value Advanced-output field value.
   * @param field Field name used in validation messages.
   * @returns Normalized non-empty string.
   */
  private requireAdvancedString(
    value: unknown,
    field: string,
  ): string {
    if (typeof value !== 'string') {
      throw new Error(
        `Advanced AI output field "${field}" must be a string.`,
      );
    }

    const normalizedValue =
      value.trim();

    if (!normalizedValue) {
      throw new Error(
        `Advanced AI output field "${field}" must not be empty.`,
      );
    }

    return normalizedValue;
  }

  /**
   * Trims string-array values and removes blank or duplicate
   * entries.
   *
   * Duplicate comparison is case-insensitive while the casing of
   * the first occurrence is preserved.
   *
   * @param values Raw string values.
   * @returns Unique normalized string values.
   */
  private normalizeStringArray(
    values: readonly string[],
  ): string[] {
    const uniqueValues =
      new Map<string, string>();

    for (const rawValue of values) {
      const normalizedValue =
        rawValue.trim();

      if (!normalizedValue) {
        continue;
      }

      const comparisonKey =
        normalizedValue.toLocaleLowerCase(
          'en-US',
        );

      if (
        uniqueValues.has(
          comparisonKey,
        )
      ) {
        continue;
      }

      uniqueValues.set(
        comparisonKey,
        normalizedValue,
      );
    }

    return [
      ...uniqueValues.values(),
    ];
  }

  /**
   * Converts normalized collection values into a Markdown bullet
   * list suitable for GeneratedOutput.content.
   *
   * @param values Normalized collection values.
   * @returns Markdown bullet-list content.
   */
  private toMarkdownList(
    values: readonly string[],
  ): string {
    return values
      .map(
        (value) =>
          `- ${value}`,
      )
      .join('\n');
  }

  /**
   * Determines whether an unknown value is a non-null object and
   * not an array.
   *
   * @param value Unknown parsed value.
   * @returns Whether the value can be treated as a JSON object.
   */
  private isRecord(
    value: unknown,
  ): value is Record<string, unknown> {
    return (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
    );
  }

  /**
   * Determines whether an object owns a specific property.
   *
   * Using Object.prototype prevents collisions with properties
   * inherited from an unusual object prototype.
   *
   * @param value Object to inspect.
   * @param key Property name.
   * @returns Whether the object directly owns the property.
   */
  private hasOwnProperty(
    value: Record<string, unknown>,
    key: string,
  ): boolean {
    return Object.prototype.hasOwnProperty.call(
      value,
      key,
    );
  }

  /**
   * Extracts a safe parser-error message.
   *
   * Unknown thrown values are replaced with a generic message.
   *
   * @param error Unknown caught error.
   * @returns Safe parser error message.
   */
  private getSafeErrorMessage(
    error: unknown,
  ): string {
    return error instanceof Error
      ? error.message
      : 'Unknown AI-output validation error.';
  }
}