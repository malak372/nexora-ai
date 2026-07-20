/**
 * Parses and normalizes structured AI responses returned during
 * direct idea unlocking.
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
  REQUIRED_PREMIUM_IDEA_OUTPUT_KEYS,
} from '../constants/idea-output.constants';

import type {
  AdvancedIdeaAiOutput,
  IdeaAdvancedOutputKey,
  IdeaUnlockOutputParseResult,
  ParsedIdeaUnlockAiOutput,
  RawIdeaAiOutput,
} from '../types/idea-ai-output.type';

/**
 * Parses and normalizes structured AI output returned while
 * unlocking the advanced features of an existing free idea.
 *
 * Direct-unlock output differs from new-idea generation output
 * because the existing idea already contains:
 * - title
 * - problemStatement
 * - objectives
 * - targetUsers
 * - limitedAbstract or partialAbstract
 *
 * The unlock operation must therefore return only:
 * - fullAbstract
 * - complete advanced project outputs
 *
 * Responsibilities:
 * - Accept raw JSON text or an already parsed JSON value.
 * - Reject primitive, null, and array root payloads.
 * - Require a non-empty full abstract.
 * - Parse every registered advanced-output field.
 * - Normalize collection-valued outputs.
 * - Reject malformed scalar and collection values.
 * - Reject missing required unlock outputs.
 * - Detect duplicated normalized output keys.
 * - Preserve centralized advanced-output ordering.
 * - Return safe parser errors without exposing sensitive details.
 *
 * This service does not:
 * - Generate a new Idea record.
 * - Replace existing core idea fields.
 * - Call an AI provider.
 * - Repair malformed provider output.
 * - Persist GeneratedOutput records.
 * - Update payment or credit transactions.
 * - Mark an idea as unlocked.
 *
 * Provider-level JSON-schema validation and bounded response
 * repair remain responsibilities of the central AI runtime.
 */
@Injectable()
export class IdeaUnlockOutputParserService {
  /**
   * Parses a raw direct-unlock AI response without throwing.
   *
   * Parsing and business-level validation failures are returned as
   * a discriminated failure result.
   *
   * @param raw Raw or already parsed unlock AI response.
   * @returns Successful or failed unlock-output parsing result.
   */
  parse(
    raw: RawIdeaAiOutput,
  ): IdeaUnlockOutputParseResult {
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
   * Parses a raw direct-unlock response and throws a safe HTTP
   * exception when the output violates the unlock contract.
   *
   * @param raw Raw or already parsed unlock AI response.
   * @returns Parsed and normalized unlock output.
   *
   * @throws BadRequestException When the AI response is malformed
   * or incomplete.
   */
  parseOrThrow(
    raw: RawIdeaAiOutput,
  ): ParsedIdeaUnlockAiOutput {
    const result = this.parse(raw);

    if (!result.success) {
      throw new BadRequestException({
        code:
          IDEA_GENERATION_ERROR_CODES
            .INVALID_AI_OUTPUT,

        message:
          'The AI returned an invalid idea-unlock payload.',

        errors:
          result.errors,
      });
    }

    return result.output;
  }

  /**
   * Parses one unlock-response object into the normalized internal
   * representation.
   *
   * Every output marked as required by the centralized premium
   * output registry must be present because direct unlock grants
   * the same advanced project guidance available to a
   * premium-generated idea.
   *
   * @param value Parsed unlock-response object.
   * @returns Normalized direct-unlock output.
   */
  private parseRecord(
    value: Record<string, unknown>,
  ): ParsedIdeaUnlockAiOutput {
    const fullAbstract =
      this.requireString(
        value,
        'fullAbstract',
      );

    const advancedOutputs =
      this.parseAdvancedOutputs(
        value,
      );

    this.validateRequiredOutputs(
      advancedOutputs,
    );

    return {
      fullAbstract,
      advancedOutputs,
    };
  }

  /**
   * Parses every supported advanced-output field from the unlock
   * response.
   *
   * The full abstract is included in advancedOutputs using the
   * stable `full-abstract` output key. This allows the persistence
   * layer to:
   * - Update Idea.fullAbstract.
   * - Persist the same content in GeneratedOutput.
   * - Use one unified output registry and ordering contract.
   *
   * Scalar outputs are stored as normalized text.
   *
   * Collection-valued outputs are stored as:
   * - Markdown bullet-list content.
   * - JSON-compatible structured arrays.
   *
   * Missing fields are omitted during parsing and reported
   * together by validateRequiredOutputs().
   *
   * Fields that are present but malformed are rejected
   * immediately.
   *
   * @param value Parsed unlock-response object.
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

      const fieldValue =
        value[definition.field];

      if (definition.collection) {
        const items =
          this.requireStringArrayValue(
            fieldValue,
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
        this.requireStringValue(
          fieldValue,
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
   * Ensures the unlock response contains every advanced output
   * required by the centralized premium-output registry.
   *
   * This validation also protects the persistence layer against
   * duplicated normalized output keys.
   *
   * Registry-based parsing should normally prevent duplicated
   * keys, but this defensive check keeps the normalized contract
   * safe if parsing behavior changes later.
   *
   * @param outputs Parsed and normalized unlock outputs.
   */
  private validateRequiredOutputs(
    outputs:
      readonly AdvancedIdeaAiOutput[],
  ): void {
    const outputKeys =
      new Set<IdeaAdvancedOutputKey>();

    for (const output of outputs) {
      if (
        outputKeys.has(
          output.outputKey,
        )
      ) {
        throw new Error(
          `Unlock output contains the duplicated output key "${output.outputKey}".`,
        );
      }

      outputKeys.add(
        output.outputKey,
      );
    }

    const missingOutputKeys =
      REQUIRED_PREMIUM_IDEA_OUTPUT_KEYS
        .filter(
          (outputKey) =>
            !outputKeys.has(
              outputKey,
            ),
        );

    if (
      missingOutputKeys.length >
      0
    ) {
      throw new Error(
        `Unlock output is missing required outputs: ${missingOutputKeys.join(', ')}.`,
      );
    }
  }

  /**
   * Converts a raw unlock response into a non-null JSON object.
   *
   * Arrays and primitive root values are rejected because an
   * unlock response must be represented by one structured object.
   *
   * @param raw Raw or already parsed unlock AI response.
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
        'AI unlock output must be a JSON object.',
      );
    }

    return parsedValue;
  }

  /**
   * Parses one non-empty JSON response string.
   *
   * Markdown fences and provider-specific wrappers are not removed
   * here because response repair belongs to the central AI runtime.
   *
   * @param text Raw unlock-response text.
   * @returns Parsed JSON value.
   */
  private parseJson(
    text: string,
  ): unknown {
    const normalizedText =
      text.trim();

    if (!normalizedText) {
      throw new Error(
        'AI unlock output cannot be empty.',
      );
    }

    try {
      return JSON.parse(
        normalizedText,
      ) as unknown;
    } catch {
      throw new Error(
        'AI unlock output could not be parsed as JSON.',
      );
    }
  }

  /**
   * Reads and normalizes one required string field from the
   * unlock-response object.
   *
   * @param value Unlock-response object.
   * @param key Required field name.
   * @returns Normalized non-empty string.
   */
  private requireString(
    value: Record<string, unknown>,
    key: string,
  ): string {
    if (
      !this.hasOwnProperty(
        value,
        key,
      )
    ) {
      throw new Error(
        `AI unlock output is missing the required field "${key}".`,
      );
    }

    return this.requireStringValue(
      value[key],
      key,
    );
  }

  /**
   * Validates and normalizes one required scalar string value.
   *
   * @param value Unknown field value.
   * @param fieldName Field name used in safe validation errors.
   * @returns Normalized non-empty string.
   */
  private requireStringValue(
    value: unknown,
    fieldName: string,
  ): string {
    if (typeof value !== 'string') {
      throw new Error(
        `AI unlock output field "${fieldName}" must be a string.`,
      );
    }

    const normalizedValue =
      value.trim();

    if (!normalizedValue) {
      throw new Error(
        `AI unlock output field "${fieldName}" must not be empty.`,
      );
    }

    return normalizedValue;
  }

  /**
   * Validates and normalizes one required string-array value.
   *
   * Blank entries are removed. Duplicate values are removed
   * case-insensitively while preserving the original casing of the
   * first occurrence.
   *
   * The final normalized collection must contain at least one
   * usable item.
   *
   * @param value Unknown collection field value.
   * @param fieldName Field name used in safe validation errors.
   * @returns Normalized non-empty string array.
   */
  private requireStringArrayValue(
    value: unknown,
    fieldName: string,
  ): string[] {
    if (!Array.isArray(value)) {
      throw new Error(
        `AI unlock output field "${fieldName}" must be a string array.`,
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
        `AI unlock output field "${fieldName}" must contain only strings.`,
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
        `AI unlock output field "${fieldName}" must contain at least one non-empty value.`,
      );
    }

    return normalizedItems;
  }

  /**
   * Trims string-array values and removes blank or duplicated
   * entries.
   *
   * Duplicate comparison is case-insensitive while the first
   * occurrence retains its original casing.
   *
   * @param values Raw string-array values.
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
   * Converts a normalized string collection into Markdown
   * bullet-list content suitable for GeneratedOutput.content.
   *
   * @param values Normalized string values.
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
   * Determines whether an object directly owns a specific
   * property.
   *
   * This prevents inherited properties from being treated as
   * provider-response fields.
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
   * Unknown thrown values are replaced with a generic validation
   * message.
   *
   * @param error Unknown caught error.
   * @returns Safe unlock-output validation message.
   */
  private getSafeErrorMessage(
    error: unknown,
  ): string {
    return error instanceof Error
      ? error.message
      : 'Unknown AI unlock-output validation error.';
  }
}