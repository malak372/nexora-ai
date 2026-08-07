/**
 * Unique key used to resolve the global SystemSetting record.
 *
 * @author Malak
 */
export const GLOBAL_SYSTEM_SETTINGS_KEY = 'GLOBAL';

/**
 * Minimum allowed length for the configurable AI prompt template.
 */
export const PROMPT_TEMPLATE_MIN_LENGTH = 100;

/**
 * Maximum allowed length for the configurable AI prompt template.
 *
 * This limit applies to the template before collection and NLP
 * values are inserted.
 */
export const PROMPT_TEMPLATE_MAX_LENGTH = 15_000;

/**
 * Maximum allowed length for the final rendered AI prompt.
 *
 * The rendered prompt may be much larger than the template because
 * it contains persisted NLP analysis, community samples, collection
 * metadata, and potentially an existing idea.
 *
 * This limit protects the application from unexpectedly large
 * prompts and excessive provider input usage.
 */
export const MAX_RENDERED_PROMPT_LENGTH = 60_000;

/**
 * Approximate character-to-token ratio used for English and
 * Latin-script prompt input-token estimation.
 *
 * This value is only an estimate and must not be treated as an
 * exact tokenizer result. Provider-reported token usage remains
 * the final source of truth.
 */
export const DEFAULT_TOKEN_RATIO = 4;

/**
 * Approximate character-to-token ratio used when Arabic text
 * appears in the rendered prompt.
 *
 * Arabic and mixed-language prompts commonly require more tokens
 * per character than English-only prompts.
 */
export const ARABIC_TOKEN_RATIO = 2.5;

/**
 * Maximum number of collection data sources included in one
 * generated prompt.
 *
 * Collection jobs normally contain a much smaller number, but this
 * limit protects the prompt from unexpected relation growth.
 */
export const MAX_PROMPT_DATA_SOURCES = 50;

/**
 * Maximum character budget allocated to each rendered NLP section.
 *
 * These limits keep the final provider prompt below
 * MAX_RENDERED_PROMPT_LENGTH without discarding the complete NLP
 * analysis stored in the database. Only the provider-facing
 * representation is compacted.
 */
export const PROMPT_SECTION_CHARACTER_BUDGETS = {
  sentimentStats: 450,
  keywords: 650,
  topics: 900,
  recurringProblems: 2_000,
  extractedNeeds: 1_800,
  featureRequests: 1_400,
  opportunities: 2_000,
  insights: 1_000,
  dataQuality: 600,
  samplePosts: 1_000,
  sampleComments: 1_600,
  domainEvidence: 2_800,
  selectedOpportunity: 2_300,
  shortlistedOpportunities: 1_200,
} as const;

/**
 * Maximum number of array items retained in one provider-facing NLP
 * section before lower-priority trailing entries are omitted.
 */
export const MAX_PROMPT_JSON_ARRAY_ITEMS = 16;

/**
 * Maximum nesting depth retained while compacting arbitrary NLP JSON
 * values for provider input.
 */
export const MAX_PROMPT_JSON_DEPTH = 6;

/**
 * Maximum length retained for one string value inside compacted NLP
 * prompt context.
 */
export const MAX_PROMPT_JSON_STRING_LENGTH = 700;

/**
 * Marker appended when provider-facing context is shortened.
 */
export const PROMPT_TRUNCATION_MARKER =
  '\n...[additional persisted context omitted to respect prompt limits]';