/**
 * Default fallback priority assigned to newly created AI models.
 *
 * Higher numeric values indicate higher selection priority during
 * default and fallback model routing.
 *
 * @author Malak
 */
export const DEFAULT_AI_MODEL_PRIORITY = 0;

/**
 * Default routing weight assigned to newly created AI models.
 *
 * The BALANCED routing strategy uses this value to influence the
 * probability that a model is selected earlier in the weighted
 * execution order.
 *
 * Higher values increase selection probability. Every persisted model
 * should have a positive weight.
 */
export const DEFAULT_AI_MODEL_WEIGHT = 1;

/**
 * Default maximum number of output tokens requested from newly created
 * AI models.
 *
 * Individual model configurations may override this value in the
 * database. AiExecutionService always bounds caller-supplied output
 * limits using the selected model's configured maximum.
 */
export const DEFAULT_AI_MODEL_MAX_OUTPUT_TOKENS = 2_048;