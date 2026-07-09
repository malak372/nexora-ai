/**
 * Minimum allowed length for the configurable AI prompt template.
 */
export const PROMPT_TEMPLATE_MIN_LENGTH = 100;

/**
 * Maximum allowed length for the configurable AI prompt template.
 */
export const PROMPT_TEMPLATE_MAX_LENGTH = 15000;

/**
 * Approximate character-to-token ratio used for prompt cost estimation.
 *
 * This is not an exact tokenizer calculation.
 */
export const DEFAULT_TOKEN_RATIO = 4;