import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';

import type {
  AdvancedIdeaAiOutput,
  CoreIdeaAiOutput,
  IdeaAiOutputParseResult,
  ParsedIdeaAiOutput,
  RawIdeaAiOutput,
} from '../types/idea-ai-output.type';

/**
 * Parses and normalizes structured AI idea output before
 * persistence.
 *
 * The central AI runtime remains responsible for:
 * - Executing the selected AI provider.
 * - Enforcing the requested JSON response format.
 * - Validating the provider response against the configured schema.
 * - Attempting bounded structured-output repair when required.
 *
 * This service provides an additional business-level validation
 * boundary before generated data enters idea persistence.
 *
 * Responsibilities:
 * - Accept raw JSON text or an already parsed object.
 * - Ensure the AI output is a valid JSON object.
 * - Parse required core idea fields.
 * - Normalize objectives and target users as string arrays.
 * - Parse optional premium output fields.
 * - Convert premium fields into stable generated-output records.
 * - Return safe validation errors through a non-throwing API.
 * - Provide a throwing API for pipeline stages that require valid
 *   output.
 *
 * This service does not:
 * - Execute AI providers.
 * - Repair invalid provider output.
 * - Select generation entitlement.
 * - Persist Idea records.
 * - Persist generated-output records.
 * - Deduct credits.
 *
 * @author Malak
 */
@Injectable()
export class IdeaAiOutputParserService {
  /**
   * Parses one raw AI response without throwing validation
   * exceptions to the caller.
   *
   * This method is useful when the pipeline needs to inspect
   * validation errors or pass them to a repair stage.
   *
   * @param raw Raw AI response as JSON text or an object.
   * @returns Successful parsed output or normalized validation
   * errors.
   */
  parse(
    raw: RawIdeaAiOutput,
  ): IdeaAiOutputParseResult {
    try {
      const record =
        this.toRecord(raw);

      const output =
        this.parseRecord(record);

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
          error instanceof Error
            ? error.message
            : 'Unknown AI-output validation error.',
        ],
      };
    }
  }

  /**
   * Parses one raw AI response and throws a safe HTTP exception
   * when the payload is invalid.
   *
   * This is the preferred method for pipeline stages that cannot
   * continue without a valid structured idea.
   *
   * @param raw Raw AI response as JSON text or an object.
   * @returns Parsed and normalized idea output.
   *
   * @throws BadRequestException When the AI output is malformed or
   * missing required fields.
   */
  parseOrThrow(
    raw: RawIdeaAiOutput,
  ): ParsedIdeaAiOutput {
    const result =
      this.parse(raw);

    if (!result.success) {
      throw new BadRequestException({
        code: 'INVALID_IDEA_AI_OUTPUT',

        message:
          'The AI returned an invalid idea payload.',

        errors:
          result.errors,
      });
    }

    return result.output;
  }

  /**
   * Parses the complete idea output from a validated object.
   *
   * Core fields are always required because every generation tier
   * must produce a stable base idea record.
   *
   * Advanced fields are optional because:
   * - Guest and normal-free generations may omit them.
   * - Premium outputs may be generated progressively in separate
   *   stages.
   * - Older prompt versions may not include every advanced field.
   *
   * @param value Parsed AI response object.
   * @returns Normalized core idea and advanced output records.
   */
  private parseRecord(
    value: Record<string, unknown>,
  ): ParsedIdeaAiOutput {
    const fullAbstract =
      this.optionalString(
        value,
        'fullAbstract',
      );

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

      limitedAbstract:
        this.requireString(
          value,
          'limitedAbstract',
        ),

      partialAbstract:
        this.requireString(
          value,
          'partialAbstract',
        ),

      ...(fullAbstract
        ? {
            fullAbstract,
          }
        : {}),
    };

    const advancedOutputs =
      this.parseAdvancedOutputs(
        value,
      );

    return {
      coreIdea,
      advancedOutputs,
    };
  }

  /**
   * Converts optional advanced AI fields into stable generated
   * output records.
   *
   * Each definition contains:
   * - Original field name returned by the AI.
   * - Stable output key used by application persistence.
   * - Human-readable title shown by the frontend.
   *
   * String fields are stored as plain content.
   *
   * String-array fields are:
   * - Normalized.
   * - Stored as structured content.
   * - Also converted into readable Markdown bullet content.
   *
   * Unsupported or empty advanced fields are ignored rather than
   * causing the complete idea generation to fail.
   *
   * @param value Parsed AI response object.
   * @returns Normalized advanced output records.
   */
  private parseAdvancedOutputs(
    value: Record<string, unknown>,
  ): AdvancedIdeaAiOutput[] {
    const definitions = [
      [
        'fullAbstract',
        'full-abstract',
        'Full Abstract',
      ],

      [
        'technologyStack',
        'technology-stack',
        'Technology Stack',
      ],

      [
        'systemArchitecture',
        'system-architecture',
        'System Architecture',
      ],

      [
        'databaseDesign',
        'database-design',
        'Database Design',
      ],

      [
        'businessModel',
        'business-model',
        'Business Model',
      ],

      [
        'valueProposition',
        'value-proposition',
        'Value Proposition',
      ],

      [
        'revenueModel',
        'revenue-model',
        'Revenue Model',
      ],

      [
        'localRegulations',
        'local-regulations',
        'Local Regulations',
      ],

      [
        'budgetEstimation',
        'budget-estimation',
        'Budget Estimation',
      ],

      [
        'feasibilityAssessment',
        'feasibility-assessment',
        'Feasibility Assessment',
      ],

      [
        'implementationTimeline',
        'implementation-timeline',
        'Implementation Timeline',
      ],

      [
        'marketPotential',
        'market-potential',
        'Market Potential',
      ],

      [
        'nlpExecutiveSummary',
        'nlp-executive-summary',
        'NLP Executive Summary',
      ],

      [
        'communityFeedbackSummary',
        'community-feedback-summary',
        'Community Feedback Summary',
      ],
    ] as const;

    const outputs:
      AdvancedIdeaAiOutput[] = [];

    for (
      const [
        field,
        outputKey,
        title,
      ] of definitions
    ) {
      const fieldValue =
        value[field];

      if (
        typeof fieldValue === 'string'
      ) {
        const normalizedContent =
          fieldValue.trim();

        if (!normalizedContent) {
          continue;
        }

        outputs.push({
          outputKey,
          title,
          content:
            normalizedContent,
        });

        continue;
      }

      if (
        !Array.isArray(fieldValue)
      ) {
        continue;
      }

      const items =
        this.normalizeOptionalStringArray(
          fieldValue,
        );

      if (
        items.length === 0
      ) {
        continue;
      }

      outputs.push({
        outputKey,
        title,

        content:
          items
            .map(
              (item) =>
                `- ${item}`,
            )
            .join('\n'),

        structuredContent:
          items,
      });
    }

    return outputs;
  }

  /**
   * Converts raw input into a non-null JSON object.
   *
   * Raw input may already be parsed by the AI runtime or may still
   * be serialized JSON text.
   *
   * Arrays, null, primitive values, and malformed JSON are rejected.
   *
   * @param raw Raw AI response.
   * @returns Parsed object record.
   */
  private toRecord(
    raw: RawIdeaAiOutput,
  ): Record<string, unknown> {
    const value =
      typeof raw === 'string'
        ? this.parseJson(raw)
        : raw;

    if (!this.isRecord(value)) {
      throw new Error(
        'AI idea output must be a JSON object.',
      );
    }

    return value;
  }

  /**
   * Parses one JSON string.
   *
   * @param text Raw JSON response text.
   * @returns Parsed unknown JSON value.
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
   * @param value AI output object.
   * @param key Required field name.
   * @returns Trimmed string value.
   */
  private requireString(
    value: Record<string, unknown>,
    key: string,
  ): string {
    const result =
      value[key];

    if (
      typeof result !== 'string' ||
      !result.trim()
    ) {
      throw new Error(
        `AI output field "${key}" must be a non-empty string.`,
      );
    }

    return result.trim();
  }

  /**
   * Reads and normalizes one optional string field.
   *
   * Missing, non-string, or blank values resolve to null.
   *
   * @param value AI output object.
   * @param key Optional field name.
   * @returns Trimmed string or null.
   */
  private optionalString(
    value: Record<string, unknown>,
    key: string,
  ): string | null {
    const result =
      value[key];

    if (
      typeof result !== 'string'
    ) {
      return null;
    }

    const normalized =
      result.trim();

    return normalized || null;
  }

  /**
   * Reads one required array containing non-empty strings.
   *
   * Invalid non-string items are rejected rather than silently
   * discarded because required core fields must match the output
   * contract exactly.
   *
   * Duplicate values are removed case-insensitively while the
   * original casing of the first occurrence is preserved.
   *
   * @param value AI output object.
   * @param key Required array field name.
   * @returns Normalized non-empty string array.
   */
  private requireStringArray(
    value: Record<string, unknown>,
    key: string,
  ): string[] {
    const result =
      value[key];

    if (!Array.isArray(result)) {
      throw new Error(
        `AI output field "${key}" must be a string array.`,
      );
    }

    if (
      result.some(
        (item) =>
          typeof item !== 'string',
      )
    ) {
      throw new Error(
        `AI output field "${key}" must contain only strings.`,
      );
    }

    const items =
      this.normalizeStringArray(
        result,
      );

    if (
      items.length === 0
    ) {
      throw new Error(
        `AI output field "${key}" must not be empty.`,
      );
    }

    return items;
  }

  /**
   * Normalizes an optional unknown array into a clean string array.
   *
   * Non-string and blank values are ignored because advanced
   * outputs are optional and should not invalidate the core idea.
   *
   * @param values Raw array value.
   * @returns Unique normalized strings.
   */
  private normalizeOptionalStringArray(
    values: readonly unknown[],
  ): string[] {
    return this.normalizeStringArray(
      values.filter(
        (
          item,
        ): item is string =>
          typeof item === 'string',
      ),
    );
  }

  /**
   * Trims string-array values and removes blank or duplicate
   * entries.
   *
   * Duplicate comparison is case-insensitive.
   *
   * @param values Raw string values.
   * @returns Unique normalized string values.
   */
  private normalizeStringArray(
    values: readonly string[],
  ): string[] {
    const uniqueValues =
      new Map<string, string>();

    for (const value of values) {
      const normalized =
        value.trim();

      if (!normalized) {
        continue;
      }

      const comparisonKey =
        normalized.toLowerCase();

      if (
        !uniqueValues.has(
          comparisonKey,
        )
      ) {
        uniqueValues.set(
          comparisonKey,
          normalized,
        );
      }
    }

    return [
      ...uniqueValues.values(),
    ];
  }

  /**
   * Checks whether a value is a non-null object record.
   *
   * Arrays are rejected because an AI idea response must have
   * named fields.
   *
   * @param value Unknown input value.
   * @returns Whether the value is a valid record.
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
}