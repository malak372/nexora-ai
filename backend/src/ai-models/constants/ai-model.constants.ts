/**
 * Default fallback priority assigned to newly created AI models.
 *
 * Lower values indicate higher selection priority during model
 * routing.
 *
 * @author Malak
 */
export const DEFAULT_AI_MODEL_PRIORITY = 0;

/**
 * Default routing weight assigned to newly created AI models.
 *
 * Used by weighted-routing strategies when distributing requests
 * across multiple healthy models.
 *
 * @author Malak
 */
export const DEFAULT_AI_MODEL_WEIGHT = 1;

/**
 * Default maximum number of output tokens requested from newly created
 * AI models.
 *
 * Individual models may override this value in the database.
 *
 * @author Malak
 */
export const DEFAULT_AI_MODEL_MAX_OUTPUT_TOKENS = 2_048;