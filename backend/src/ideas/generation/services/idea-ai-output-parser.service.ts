/**
 * Parses and normalizes structured AI responses returned during
 * new-idea generation.
 *
 * @author Malak
 */

import { BadRequestException, Injectable } from '@nestjs/common';

import { IDEA_GENERATION_ERROR_CODES } from '../constants/idea-generation.constants';
import { IDEA_ADVANCED_OUTPUT_DEFINITIONS } from '../constants/idea-output.constants';

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
 *
 * @author Malak
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
  parse(raw: RawIdeaAiOutput): IdeaAiOutputParseResult {
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
   * Parses a raw response and throws a safe HTTP exception when
   * parsing or business-level validation fails.
   *
   * @param raw Raw or already parsed AI response.
   * @returns Parsed and normalized idea output.
   *
   * @throws BadRequestException When the AI output is malformed.
   */
  parseOrThrow(raw: RawIdeaAiOutput): ParsedIdeaAiOutput {
    const result = this.parse(raw);

    if (!result.success) {
      throw new BadRequestException({
        code: IDEA_GENERATION_ERROR_CODES.INVALID_AI_OUTPUT,
        message: 'The AI returned an invalid idea payload.',
        errors: result.errors,
      });
    }

    return result.output;
  }

  /**
   * Parses one validated root object into normalized new-idea
   * output.
   *
   * Core fields are required for every newly generated idea.
   * Abstract fields remain optional at this parser layer because
   * their requiredness differs between generation tiers.
   *
   * @param value Parsed AI-response object.
   * @returns Normalized core idea and advanced outputs.
   */
  private parseRecord(value: Record<string, unknown>): ParsedIdeaAiOutput {
    const coreIdea: CoreIdeaAiOutput = {
      title: this.requireString(value, 'title'),
      problemStatement: this.requireString(value, 'problemStatement'),
      objectives: this.requireStringArray(value, 'objectives'),
      targetUsers: this.requireStringArray(value, 'targetUsers'),
    };

    const limitedAbstract = this.optionalString(value, 'limitedAbstract');
    const partialAbstract = this.optionalString(value, 'partialAbstract');
    const fullAbstract = this.optionalString(value, 'fullAbstract');

    if (limitedAbstract !== undefined) {
      coreIdea.limitedAbstract = limitedAbstract;
    }

    if (partialAbstract !== undefined) {
      coreIdea.partialAbstract = partialAbstract;
    }

    if (fullAbstract !== undefined) {
      coreIdea.fullAbstract = fullAbstract;
    }

    return {
      coreIdea,
      advancedOutputs: this.parseAdvancedOutputs(value),
    };
  }

  /**
   * Converts supported advanced fields into normalized
   * GeneratedOutput-compatible records.
   *
   * Missing advanced fields are ignored at this layer because
   * guest and normal-free schemas do not include premium outputs.
   *
   * Provided collection fields must contain non-empty string
   * arrays. Scalar fields must contain non-empty strings.
   *
   * @param value Parsed AI-response object.
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
        const items = this.requireAdvancedStringArray(
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

      const content = this.requireAdvancedString(fieldValue, definition.field);

      outputs.push({
        outputKey: definition.outputKey,
        title: definition.title,
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
  private toRecord(raw: RawIdeaAiOutput): Record<string, unknown> {
    const parsedValue = typeof raw === 'string' ? this.parseJson(raw) : raw;

    if (!this.isRecord(parsedValue)) {
      throw new Error('AI idea output must be a JSON object.');
    }

    return parsedValue;
  }

  /**
   * Parses one non-empty JSON response string.
   *
   * Provider wrappers are not removed here because response
   * repair belongs to the central AI runtime.
   *
   * @param text Raw AI response text.
   * @returns Parsed JSON value.
   */
  private parseJson(text: string): unknown {
    const normalizedText = text.trim();

    if (!normalizedText) {
      throw new Error('AI idea output cannot be empty.');
    }

    try {
      const parsedValue: unknown = JSON.parse(normalizedText);
      return parsedValue;
    } catch {
      throw new Error('AI idea output could not be parsed as JSON.');
    }
  }

  /**
   * Reads and normalizes one required non-empty string field.
   *
   * @param value AI-output object.
   * @param key Required field name.
   * @returns Normalized string value.
   */
  private requireString(value: Record<string, unknown>, key: string): string {
    const fieldValue = value[key];

    if (typeof fieldValue !== 'string') {
      throw new Error(`AI output field "${key}" must be a string.`);
    }

    const normalizedValue = fieldValue.trim();

    if (!normalizedValue) {
      throw new Error(`AI output field "${key}" must not be empty.`);
    }

    return normalizedValue;
  }

  /**
   * Reads and normalizes one optional string field.
   *
   * Missing fields resolve to undefined. Present but malformed
   * fields are rejected.
   *
   * @param value AI-output object.
   * @param key Optional field name.
   * @returns Normalized string or undefined.
   */
  private optionalString(
    value: Record<string, unknown>,
    key: string,
  ): string | undefined {
    if (!this.ownsProperty(value, key)) {
      return undefined;
    }

    const fieldValue = value[key];

    if (typeof fieldValue !== 'string') {
      throw new Error(
        `AI output field "${key}" must be a string when provided.`,
      );
    }

    const normalizedValue = fieldValue.trim();

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
   * Duplicate values are removed case-insensitively while the
   * original casing of the first occurrence is preserved.
   *
   * @param value AI-output object.
   * @param key Required array field name.
   * @returns Normalized non-empty string array.
   */
  private requireStringArray(
    value: Record<string, unknown>,
    key: string,
  ): string[] {
    const fieldValue = value[key];

    if (!this.isStringArray(fieldValue)) {
      throw new Error(
        `AI output field "${key}" must be an array containing only strings.`,
      );
    }

    const normalizedItems = this.normalizeStringArray(fieldValue);

    if (normalizedItems.length === 0) {
      throw new Error(
        `AI output field "${key}" must contain at least one non-empty value.`,
      );
    }

    return normalizedItems;
  }

  /**
   * Reads and normalizes one collection-valued advanced output.
   *
   * @param value Advanced-output field value.
   * @param field Field name used in validation messages.
   * @returns Normalized non-empty string array.
   */
  private requireAdvancedStringArray(value: unknown, field: string): string[] {
    if (!this.isStringArray(value)) {
      throw new Error(
        `Advanced AI output field "${field}" must be an array containing only strings.`,
      );
    }

    const normalizedItems = this.normalizeStringArray(value);

    if (normalizedItems.length === 0) {
      throw new Error(
        `Advanced AI output field "${field}" must contain at least one non-empty value.`,
      );
    }

    return normalizedItems;
  }

  /**
   * Reads and normalizes one scalar advanced-output field.
   *
   * @param value Advanced-output field value.
   * @param field Field name used in validation messages.
   * @returns Normalized non-empty string.
   */
  private requireAdvancedString(value: unknown, field: string): string {
    if (typeof value !== 'string') {
      throw new Error(`Advanced AI output field "${field}" must be a string.`);
    }

    const normalizedValue = value.trim();

    if (!normalizedValue) {
      throw new Error(`Advanced AI output field "${field}" must not be empty.`);
    }

    return normalizedValue;
  }

  /**
   * Trims string-array values and removes blank or duplicate
   * entries.
   *
   * Duplicate comparison is case-insensitive while the first
   * occurrence keeps its original casing.
   *
   * @param values Raw string values.
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
   * Converts normalized collection values into Markdown
   * bullet-list content.
   *
   * @param values Normalized collection values.
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
   * @returns Safe parser error message.
   */
  private getSafeErrorMessage(error: unknown): string {
    if (error instanceof Error && typeof error.message === 'string') {
      const message: string = error.message;
      return message;
    }

    return 'Unknown AI-output validation error.';
  }
}
