/**
 * Parses and normalizes structured AI responses returned during
 * direct idea unlocking.
 *
 * @author Malak
 */

import { BadRequestException, Injectable } from '@nestjs/common';

import { IDEA_GENERATION_ERROR_CODES } from '../constants/idea-generation.constants';

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
 * The unlock operation must return:
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
 * This service does not call providers, repair responses, persist
 * records, update payments, or mark ideas as unlocked.
 *
 * @author Malak
 */
@Injectable()
export class IdeaUnlockOutputParserService {
  /**
   * Parses a raw direct-unlock AI response without throwing.
   *
   * @param raw Raw or already parsed unlock AI response.
   * @returns Successful or failed parsing result.
   */
  parse(raw: RawIdeaAiOutput): IdeaUnlockOutputParseResult {
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
        errors: [this.getSafeErrorMessage(error)],
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
  parseOrThrow(raw: RawIdeaAiOutput): ParsedIdeaUnlockAiOutput {
    const result = this.parse(raw);

    if (!result.success) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.INVALID_AI_OUTPUT,
        message: 'The AI returned an invalid idea-unlock payload.',
        errors: result.errors,
      });
    }

    return result.output;
  }

  /**
   * Parses one unlock-response object into the normalized internal
   * representation.
   *
   * @param value Parsed unlock-response object.
   * @returns Normalized direct-unlock output.
   */
  private parseRecord(
    value: Record<string, unknown>,
  ): ParsedIdeaUnlockAiOutput {
    const fullAbstract = this.requireString(value, 'fullAbstract');
    const advancedOutputs = this.parseAdvancedOutputs(value);

    this.validateRequiredOutputs(advancedOutputs);

    return {
      fullAbstract,
      advancedOutputs,
    };
  }

  /**
   * Parses every supported advanced-output field.
   *
   * Collection outputs are represented as Markdown content and
   * JSON-compatible string arrays.
   *
   * Missing fields are omitted during parsing and reported
   * together by validateRequiredOutputs().
   *
   * @param value Parsed unlock-response object.
   * @returns Ordered normalized advanced outputs.
   */
  private parseAdvancedOutputs(
    value: Record<string, unknown>,
  ): AdvancedIdeaAiOutput[] {
    const outputs: AdvancedIdeaAiOutput[] = [];

    for (const definition of IDEA_ADVANCED_OUTPUT_DEFINITIONS) {
      if (!this.ownsProperty(value, definition.field)) {
        continue;
      }

      const fieldValue = value[definition.field];

      if (definition.collection) {
        const items = this.requireStringArrayValue(
          fieldValue,
          definition.field,
        );

        outputs.push({
          outputKey: definition.outputKey,
          title: definition.title,
          content: this.toMarkdownList(items),
          structuredContent: items,
        });

        continue;
      }

      const content = this.requireStringValue(fieldValue, definition.field);

      outputs.push({
        outputKey: definition.outputKey,
        title: definition.title,
        content,
      });
    }

    return outputs;
  }

  /**
   * Ensures the response contains every required output and no
   * duplicated normalized output keys.
   *
   * @param outputs Parsed and normalized unlock outputs.
   */
  private validateRequiredOutputs(
    outputs: readonly AdvancedIdeaAiOutput[],
  ): void {
    const outputKeys = new Set<IdeaAdvancedOutputKey>();

    for (const output of outputs) {
      if (outputKeys.has(output.outputKey)) {
        throw new Error(
          `Unlock output contains the duplicated output key "${output.outputKey}".`,
        );
      }

      outputKeys.add(output.outputKey);
    }

    const missingOutputKeys = REQUIRED_PREMIUM_IDEA_OUTPUT_KEYS.filter(
      (outputKey) => !outputKeys.has(outputKey),
    );

    if (missingOutputKeys.length > 0) {
      throw new Error(
        `Unlock output is missing required outputs: ${missingOutputKeys.join(', ')}.`,
      );
    }
  }

  /**
   * Converts a raw unlock response into a non-null JSON object.
   *
   * Arrays and primitive root values are rejected because the
   * response must be represented by one structured object.
   *
   * @param raw Raw or already parsed unlock AI response.
   * @returns Parsed root object.
   */
  private toRecord(raw: RawIdeaAiOutput): Record<string, unknown> {
    const parsedValue = typeof raw === 'string' ? this.parseJson(raw) : raw;

    if (!this.isRecord(parsedValue)) {
      throw new Error('AI unlock output must be a JSON object.');
    }

    return parsedValue;
  }

  /**
   * Parses one non-empty JSON response string.
   *
   * Provider wrappers are not removed here because response
   * repair belongs to the central AI runtime.
   *
   * @param text Raw unlock-response text.
   * @returns Parsed JSON value.
   */
  private parseJson(text: string): unknown {
    const normalizedText = text.trim();

    if (!normalizedText) {
      throw new Error('AI unlock output cannot be empty.');
    }

    try {
      const parsedValue: unknown = JSON.parse(normalizedText);
      return parsedValue;
    } catch {
      throw new Error('AI unlock output could not be parsed as JSON.');
    }
  }

  /**
   * Reads and normalizes one required string field.
   *
   * @param value Unlock-response object.
   * @param key Required field name.
   * @returns Normalized non-empty string.
   */
  private requireString(value: Record<string, unknown>, key: string): string {
    if (!this.ownsProperty(value, key)) {
      throw new Error(
        `AI unlock output is missing the required field "${key}".`,
      );
    }

    return this.requireStringValue(value[key], key);
  }

  /**
   * Validates and normalizes one scalar string value.
   *
   * @param value Unknown field value.
   * @param fieldName Field name used in validation errors.
   * @returns Normalized non-empty string.
   */
  private requireStringValue(value: unknown, fieldName: string): string {
    if (typeof value !== 'string') {
      throw new Error(
        `AI unlock output field "${fieldName}" must be a string.`,
      );
    }

    const normalizedValue = value.trim();

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
   * case-insensitively while the first occurrence keeps its
   * original casing.
   *
   * @param value Unknown collection field value.
   * @param fieldName Field name used in validation errors.
   * @returns Normalized non-empty string array.
   */
  private requireStringArrayValue(value: unknown, fieldName: string): string[] {
    if (!this.isStringArray(value)) {
      throw new Error(
        `AI unlock output field "${fieldName}" must be an array containing only strings.`,
      );
    }

    const normalizedItems = this.normalizeStringArray(value);

    if (normalizedItems.length === 0) {
      throw new Error(
        `AI unlock output field "${fieldName}" must contain at least one non-empty value.`,
      );
    }

    return normalizedItems;
  }

  /**
   * Trims values and removes blank or duplicated entries.
   *
   * @param values Raw string-array values.
   * @returns Unique normalized string values.
   */
  private normalizeStringArray(values: readonly string[]): string[] {
    const uniqueValues = new Map<string, string>();

    for (const rawValue of values) {
      const normalizedValue = rawValue.trim();

      if (!normalizedValue) {
        continue;
      }

      const comparisonKey = normalizedValue.toLocaleLowerCase('en-US');

      if (uniqueValues.has(comparisonKey)) {
        continue;
      }

      uniqueValues.set(comparisonKey, normalizedValue);
    }

    return Array.from(uniqueValues.values());
  }

  /**
   * Converts normalized values into Markdown bullet-list content.
   *
   * @param values Normalized string values.
   * @returns Markdown bullet-list content.
   */
  private toMarkdownList(values: readonly string[]): string {
    return values.map((value) => `- ${value}`).join('\n');
  }

  /**
   * Determines whether an unknown value is a non-null object and
   * not an array.
   *
   * @param value Unknown parsed value.
   * @returns Whether the value can be treated as a JSON object.
   */
  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  /**
   * Determines whether an unknown value is an array containing
   * only strings.
   *
   * @param value Unknown value to inspect.
   * @returns Whether the value is a string array.
   */
  private isStringArray(value: unknown): value is string[] {
    return (
      Array.isArray(value) &&
      value.every((item: unknown): item is string => typeof item === 'string')
    );
  }

  /**
   * Determines whether an object directly owns a property.
   *
   * The `in` operator is combined with a prototype comparison so
   * inherited properties are not accepted. This avoids direct use
   * of `hasOwnProperty`, satisfying `no-prototype-builtins`, while
   * remaining compatible with TypeScript targets that do not
   * provide Object.hasOwn.
   *
   * @param value Object to inspect.
   * @param key Property name.
   * @returns Whether the object directly owns the property.
   */
  private ownsProperty(value: Record<string, unknown>, key: string): boolean {
    if (!(key in value)) {
      return false;
    }

    let prototype = Object.getPrototypeOf(value) as object | null;

    while (prototype !== null) {
      if (key in prototype) {
        return false;
      }

      prototype = Object.getPrototypeOf(prototype) as object | null;
    }

    return true;
  }

  /**
   * Extracts a safe parser-error message.
   *
   * The message is copied into a local string after the runtime
   * type check so strict ESLint rules do not infer an unsafe
   * return value.
   *
   * @param error Unknown caught error.
   * @returns Safe unlock-output validation message.
   */
  private getSafeErrorMessage(error: unknown): string {
    if (error instanceof Error && typeof error.message === 'string') {
      const message: string = error.message;
      return message;
    }

    return 'Unknown AI unlock-output validation error.';
  }
}
