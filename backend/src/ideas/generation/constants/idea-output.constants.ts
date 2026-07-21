/**
 * Central registry and lookup utilities for advanced generated
 * idea outputs.
 *
 * This file provides the single source of truth connecting:
 * - Structured AI response fields.
 * - Stable GeneratedOutput persistence keys.
 * - Human-readable output titles.
 * - Premium and unlock output requirements.
 * - Collection-output behavior.
 * - Default persistence ordering.
 *
 * @author Malak
 */

import type {
  IdeaAdvancedOutputField,
  IdeaAdvancedOutputKey,
} from '../types/idea-ai-output.type';

/**
 * Central definition of one advanced generated-idea output.
 *
 * Each definition connects:
 * - The field returned by the structured AI response.
 * - The stable key persisted in GeneratedOutput.
 * - The human-readable title exposed by the application.
 * - Whether the field is required for a complete premium or
 *   direct-unlock response.
 * - Whether the field contains a collection of values.
 */
export type IdeaAdvancedOutputDefinition = {
  /**
   * Property name expected in premium-generation and direct-unlock
   * AI responses.
   */
  readonly field: IdeaAdvancedOutputField;

  /**
   * Stable value persisted in GeneratedOutput.outputKey.
   *
   * Existing keys must not be renamed casually because they may
   * already be stored in the database or consumed by frontend
   * applications.
   */
  readonly outputKey: IdeaAdvancedOutputKey;

  /**
   * Human-readable output title displayed by the application.
   */
  readonly title: string;

  /**
   * Indicates whether the output must be returned by complete
   * premium-generation and direct-unlock schemas.
   *
   * The property name is retained for backward compatibility with
   * existing generation and validation services.
   */
  readonly requiredForPremium: boolean;

  /**
   * Indicates whether the structured AI field is expected to
   * contain an array rather than one plain string value.
   *
   * Collection outputs are normally converted into:
   * - Human-readable Markdown content.
   * - JSON-compatible structuredContent.
   */
  readonly collection: boolean;
};

/**
 * Complete registry of supported advanced generated outputs.
 *
 * This registry is the single source of truth for:
 * - IdeaAiOutputParserService.
 * - IdeaUnlockOutputParserService.
 * - AiOutputValidationStage.
 * - PremiumOutputGenerationStage.
 * - Idea persistence.
 * - Unlock persistence.
 * - API response mapping.
 *
 * Registry order defines the default one-based
 * GeneratedOutput.sequence value.
 */
export const IDEA_ADVANCED_OUTPUT_DEFINITIONS = [
  {
    field: 'fullAbstract',
    outputKey: 'full-abstract',
    title: 'Full Abstract',
    requiredForPremium: true,
    collection: false,
  },
  {
    field: 'technologyStack',
    outputKey: 'technology-stack',
    title: 'Technology Stack',
    requiredForPremium: true,
    collection: true,
  },
  {
    field: 'systemArchitecture',
    outputKey: 'system-architecture',
    title: 'System Architecture',
    requiredForPremium: true,
    collection: false,
  },
  {
    field: 'databaseDesign',
    outputKey: 'database-design',
    title: 'Database Design',
    requiredForPremium: true,
    collection: false,
  },
  {
    field: 'mvpFeatures',
    outputKey: 'mvp-features',
    title: 'MVP Features',
    requiredForPremium: true,
    collection: true,
  },
  {
    field: 'businessModel',
    outputKey: 'business-model',
    title: 'Business Model',
    requiredForPremium: true,
    collection: false,
  },
  {
    field: 'valueProposition',
    outputKey: 'value-proposition',
    title: 'Value Proposition',
    requiredForPremium: true,
    collection: false,
  },
  {
    field: 'revenueModel',
    outputKey: 'revenue-model',
    title: 'Revenue Model',
    requiredForPremium: true,
    collection: false,
  },
  {
    field: 'localRegulations',
    outputKey: 'local-regulations',
    title: 'Local Regulations',
    requiredForPremium: true,
    collection: false,
  },
  {
    field: 'budgetEstimation',
    outputKey: 'budget-estimation',
    title: 'Budget Estimation',
    requiredForPremium: true,
    collection: false,
  },
  {
    field: 'feasibilityAssessment',
    outputKey: 'feasibility-assessment',
    title: 'Feasibility Assessment',
    requiredForPremium: true,
    collection: false,
  },
  {
    field: 'implementationTimeline',
    outputKey: 'implementation-timeline',
    title: 'Implementation Timeline',
    requiredForPremium: true,
    collection: false,
  },
  {
    field: 'marketPotential',
    outputKey: 'market-potential',
    title: 'Market Potential',
    requiredForPremium: true,
    collection: false,
  },
  {
    field: 'nlpExecutiveSummary',
    outputKey: 'nlp-executive-summary',
    title: 'NLP Executive Summary',
    requiredForPremium: true,
    collection: false,
  },
  {
    field: 'communityFeedbackSummary',
    outputKey: 'community-feedback-summary',
    title: 'Community Feedback Summary',
    requiredForPremium: true,
    collection: false,
  },
] as const satisfies readonly IdeaAdvancedOutputDefinition[];

/**
 * Stable advanced-output keys required for a complete premium
 * generation or direct-unlock response.
 *
 * The array is derived from IDEA_ADVANCED_OUTPUT_DEFINITIONS to
 * prevent requirement definitions from becoming inconsistent.
 */
export const REQUIRED_PREMIUM_IDEA_OUTPUT_KEYS = Object.freeze(
  IDEA_ADVANCED_OUTPUT_DEFINITIONS.filter(
    (definition) => definition.requiredForPremium,
  ).map((definition) => definition.outputKey),
) as readonly IdeaAdvancedOutputKey[];

/**
 * Internal read-only set containing all supported advanced-output
 * keys.
 *
 * This enables constant-time key validation without repeatedly
 * scanning the complete registry.
 */
const IDEA_ADVANCED_OUTPUT_KEY_SET: ReadonlySet<IdeaAdvancedOutputKey> =
  new Set<IdeaAdvancedOutputKey>(
    IDEA_ADVANCED_OUTPUT_DEFINITIONS.map((definition) => definition.outputKey),
  );

/**
 * Internal read-only set containing all supported structured AI
 * response fields.
 *
 * This enables constant-time field validation without repeatedly
 * scanning the complete registry.
 */
const IDEA_ADVANCED_OUTPUT_FIELD_SET: ReadonlySet<IdeaAdvancedOutputField> =
  new Set<IdeaAdvancedOutputField>(
    IDEA_ADVANCED_OUTPUT_DEFINITIONS.map((definition) => definition.field),
  );

/**
 * Internal lookup map for resolving an advanced-output definition
 * from its stable persistence key.
 */
const IDEA_ADVANCED_OUTPUT_DEFINITION_BY_KEY: ReadonlyMap<
  IdeaAdvancedOutputKey,
  IdeaAdvancedOutputDefinition
> = new Map<IdeaAdvancedOutputKey, IdeaAdvancedOutputDefinition>(
  IDEA_ADVANCED_OUTPUT_DEFINITIONS.map(
    (definition) => [definition.outputKey, definition] as const,
  ),
);

/**
 * Internal lookup map for resolving an advanced-output definition
 * from its structured AI response field.
 */
const IDEA_ADVANCED_OUTPUT_DEFINITION_BY_FIELD: ReadonlyMap<
  IdeaAdvancedOutputField,
  IdeaAdvancedOutputDefinition
> = new Map<IdeaAdvancedOutputField, IdeaAdvancedOutputDefinition>(
  IDEA_ADVANCED_OUTPUT_DEFINITIONS.map(
    (definition) => [definition.field, definition] as const,
  ),
);

/**
 * Maps every stable generated-output key to its structured AI
 * response field.
 *
 * The map is derived from the central registry to prevent parser,
 * validation, and persistence layers from using inconsistent
 * field mappings.
 */
export const IDEA_OUTPUT_FIELD_BY_KEY = Object.freeze(
  Object.fromEntries(
    IDEA_ADVANCED_OUTPUT_DEFINITIONS.map((definition) => [
      definition.outputKey,
      definition.field,
    ]),
  ),
) as Readonly<Record<IdeaAdvancedOutputKey, IdeaAdvancedOutputField>>;

/**
 * Maps every structured AI response field to its stable
 * GeneratedOutput persistence key.
 */
export const IDEA_OUTPUT_KEY_BY_FIELD = Object.freeze(
  Object.fromEntries(
    IDEA_ADVANCED_OUTPUT_DEFINITIONS.map((definition) => [
      definition.field,
      definition.outputKey,
    ]),
  ),
) as Readonly<Record<IdeaAdvancedOutputField, IdeaAdvancedOutputKey>>;

/**
 * Maps every stable output key to its human-readable title.
 *
 * This map can be reused by persistence and API response mapping
 * without repeating title definitions in multiple services.
 */
export const IDEA_OUTPUT_TITLE_BY_KEY = Object.freeze(
  Object.fromEntries(
    IDEA_ADVANCED_OUTPUT_DEFINITIONS.map((definition) => [
      definition.outputKey,
      definition.title,
    ]),
  ),
) as Readonly<Record<IdeaAdvancedOutputKey, string>>;

/**
 * Maps every stable output key to its default one-based
 * persistence sequence.
 *
 * The sequence follows the order of
 * IDEA_ADVANCED_OUTPUT_DEFINITIONS.
 */
export const IDEA_OUTPUT_SEQUENCE_BY_KEY = Object.freeze(
  Object.fromEntries(
    IDEA_ADVANCED_OUTPUT_DEFINITIONS.map((definition, index) => [
      definition.outputKey,
      index + 1,
    ]),
  ),
) as Readonly<Record<IdeaAdvancedOutputKey, number>>;

/**
 * Finds an advanced-output definition by its stable persistence
 * key.
 *
 * Unknown values safely return undefined.
 *
 * @param outputKey Stable or unknown GeneratedOutput output key.
 * @returns Matching advanced-output definition, or undefined when
 * the key is unsupported.
 */
export function findIdeaAdvancedOutputDefinitionByKey(
  outputKey: string,
): IdeaAdvancedOutputDefinition | undefined {
  if (!isIdeaAdvancedOutputKey(outputKey)) {
    return undefined;
  }

  return IDEA_ADVANCED_OUTPUT_DEFINITION_BY_KEY.get(outputKey);
}

/**
 * Finds an advanced-output definition by its structured AI
 * response field name.
 *
 * Unknown values safely return undefined.
 *
 * @param field Structured or unknown AI response field.
 * @returns Matching advanced-output definition, or undefined when
 * the field is unsupported.
 */
export function findIdeaAdvancedOutputDefinitionByField(
  field: string,
): IdeaAdvancedOutputDefinition | undefined {
  if (!isIdeaAdvancedOutputField(field)) {
    return undefined;
  }

  return IDEA_ADVANCED_OUTPUT_DEFINITION_BY_FIELD.get(field);
}

/**
 * Determines whether a string is a supported advanced-output
 * persistence key.
 *
 * This function is also a TypeScript type guard.
 *
 * @param value Output-key value to validate.
 * @returns Whether the value is a supported
 * IdeaAdvancedOutputKey.
 */
export function isIdeaAdvancedOutputKey(
  value: string,
): value is IdeaAdvancedOutputKey {
  return IDEA_ADVANCED_OUTPUT_KEY_SET.has(value as IdeaAdvancedOutputKey);
}

/**
 * Determines whether a string is a supported structured AI
 * response field.
 *
 * This function is also a TypeScript type guard.
 *
 * @param value Field-name value to validate.
 * @returns Whether the value is a supported
 * IdeaAdvancedOutputField.
 */
export function isIdeaAdvancedOutputField(
  value: string,
): value is IdeaAdvancedOutputField {
  return IDEA_ADVANCED_OUTPUT_FIELD_SET.has(value as IdeaAdvancedOutputField);
}

/**
 * Returns the one-based default persistence sequence assigned to
 * an advanced generated output.
 *
 * Supported keys use the registry-defined sequence. Unknown keys
 * are placed after all registered outputs to preserve backward
 * compatibility with callers that may pass external strings.
 *
 * @param outputKey Stable or unknown generated-output key.
 * @returns One-based GeneratedOutput sequence.
 */
export function getIdeaAdvancedOutputSequence(outputKey: string): number {
  if (!isIdeaAdvancedOutputKey(outputKey)) {
    return IDEA_ADVANCED_OUTPUT_DEFINITIONS.length + 1;
  }

  return IDEA_OUTPUT_SEQUENCE_BY_KEY[outputKey];
}
