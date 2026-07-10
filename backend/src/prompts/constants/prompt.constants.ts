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
 */
export const PROMPT_TEMPLATE_MAX_LENGTH = 15_000;

/**
 * Approximate character-to-token ratio used for prompt
 * input-token estimation.
 *
 * This value is only an estimate and must not be treated
 * as an exact tokenizer result.
 */
export const DEFAULT_TOKEN_RATIO = 4;
