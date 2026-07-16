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
export const MAX_RENDERED_PROMPT_LENGTH = 100_000;

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
