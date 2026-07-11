/**
 * General runtime constants used by the AI execution pipeline.
 *
 * Environment variables may override operational defaults where
 * runtime configuration is supported.
 *
 * These values centralize shared limits and defaults to prevent
 * magic numbers from being repeated across AI services.
 *
 * @author Malak
 */

/**
 * Default maximum number of output tokens requested from an AI
 * provider when neither the request nor the selected model supplies
 * a more specific limit.
 */
export const DEFAULT_AI_MAX_OUTPUT_TOKENS = 4_096;

/**
 * Default estimated output-token count used only for model routing
 * and cost-aware selection before actual provider usage is available.
 */
export const DEFAULT_AI_ESTIMATED_OUTPUT_TOKENS = 2_048;

/**
 * Default generation temperature.
 *
 * A relatively low value is appropriate for Nexora AI because most
 * generation flows expect stable structured output rather than highly
 * variable creative prose.
 *
 * This value should only be applied when the calling flow explicitly
 * wants an application-level default. Provider defaults may still be
 * used by leaving temperature undefined.
 */
export const DEFAULT_AI_TEMPERATURE = 0.3;

/**
 * Maximum number of retries allowed after the initial attempt for
 * the same AI model.
 *
 * A value of one means:
 * - One initial attempt.
 * - One retry.
 * - Two total external requests for the model.
 *
 * After retries are exhausted, AiExecutionService may continue with
 * the next fallback candidate.
 */
export const DEFAULT_AI_MAX_RETRIES_PER_MODEL = 1;

/**
 * Base delay in milliseconds used by exponential retry backoff.
 *
 * Example:
 * - First retry: 500 ms.
 * - Second retry: 1,000 ms.
 * - Third retry: 2,000 ms.
 */
export const DEFAULT_AI_RETRY_BASE_DELAY_MS = 500;

/**
 * Maximum error-message length persisted in ExternalApiLog.
 *
 * This prevents unexpectedly large provider or SDK error messages
 * from consuming excessive database storage.
 */
export const MAX_AI_ERROR_MESSAGE_LENGTH = 2_000;

/**
 * Maximum textual provider-response length accepted by the JSON
 * response parser.
 *
 * This protects the application from unexpectedly large responses
 * and unnecessary JSON parsing overhead.
 */
export const MAX_AI_RESPONSE_LENGTH = 100_000;

/**
 * Maximum number of structured-output repair requests allowed for
 * one model response.
 *
 * Nexora AI performs exactly one repair request before moving to
 * another fallback model.
 */
export const MAX_AI_STRUCTURED_OUTPUT_REPAIRS = 1;

/**
 * Maximum number of characters copied from an invalid provider
 * response into the structured-output repair prompt.
 *
 * Invalid provider responses must not be resent without a bound.
 */
export const MAX_AI_REPAIR_SOURCE_LENGTH = 12_000;

/**
 * Maximum number of characters copied from the original generation
 * prompt into the repair prompt.
 *
 * The repair request receives enough context to preserve the original
 * idea while avoiding an unexpectedly large repeated prompt.
 */
export const MAX_AI_REPAIR_CONTEXT_LENGTH = 24_000;

/**
 * Maximum number of structured-output validation issues included
 * inside one repair prompt.
 */
export const MAX_AI_REPAIR_VALIDATION_ISSUES = 20;

/**
 * Temperature used for structured-output repair requests.
 *
 * Repair is deterministic formatting work rather than creative
 * content generation.
 */
export const AI_STRUCTURED_OUTPUT_REPAIR_TEMPERATURE = 0;

/**
 * Approximate number of characters per token.
 *
 * This approximation is used only for routing and pre-request cost
 * estimation. Actual token usage is taken from the provider response
 * whenever available.
 */
export const APPROXIMATE_CHARACTERS_PER_TOKEN = 4;

/**
 * Minimum valid model-routing weight.
 */
export const MIN_AI_MODEL_WEIGHT = 1;

/**
 * Default routing priority assigned to newly configured AI models.
 */
export const DEFAULT_AI_MODEL_PRIORITY = 0;

/**
 * Default routing weight assigned to newly configured AI models.
 */
export const DEFAULT_AI_MODEL_WEIGHT = 1;
