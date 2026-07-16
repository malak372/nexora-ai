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
 * A relatively low temperature is appropriate because most Nexora AI
 * operations expect stable structured output rather than highly
 * variable creative prose.
 *
 * This value should only be applied when the calling business flow
 * explicitly wants an application-level default.
 */
export const DEFAULT_AI_TEMPERATURE = 0.3;

/**
 * Maximum number of retries allowed after the initial request attempt
 * for the same AI model.
 *
 * A value of one means:
 * - One initial request.
 * - One retry.
 * - Two total provider requests for the model.
 *
 * After the retries are exhausted, AiExecutionService may continue
 * with the next fallback candidate.
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
 * Internal endpoint label stored in ExternalApiLog for text-generation
 * operations.
 *
 * This is an internal operation label rather than a public HTTP route.
 */
export const AI_TEXT_GENERATION_ENDPOINT = 'ai/text-generation';

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
 * This protects the application from unexpectedly large provider
 * responses and unnecessary JSON-parsing overhead.
 */
export const MAX_AI_RESPONSE_LENGTH = 100_000;

/**
 * Maximum number of structured-output repair requests allowed for
 * one invalid model response.
 *
 * Nexora AI performs one repair request before continuing with another
 * fallback model.
 */
export const MAX_AI_STRUCTURED_OUTPUT_REPAIRS = 1;

/**
 * Maximum number of characters copied from an invalid provider
 * response into the structured-output repair prompt.
 *
 * Invalid provider output must never be resent without a size bound.
 */
export const MAX_AI_REPAIR_SOURCE_LENGTH = 12_000;

/**
 * Maximum number of characters copied from the original generation
 * prompt into the structured-output repair prompt.
 *
 * The repair operation receives enough original context to preserve
 * the requested idea while avoiding an unexpectedly large repeated
 * prompt.
 */
export const MAX_AI_REPAIR_CONTEXT_LENGTH = 24_000;

/**
 * Maximum number of structured-output validation issues included in
 * one repair prompt.
 */
export const MAX_AI_REPAIR_VALIDATION_ISSUES = 20;

/**
 * Temperature used for structured-output repair requests.
 *
 * Repair is deterministic formatting and schema-correction work rather
 * than creative generation.
 */
export const AI_STRUCTURED_OUTPUT_REPAIR_TEMPERATURE = 0;

/**
 * Approximate number of characters per token.
 *
 * This approximation is used only for:
 * - Model routing.
 * - Pre-request token estimation.
 * - Preliminary cost estimation.
 *
 * Actual token usage must be taken from the provider response whenever
 * it is available.
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

/**
 * Determines whether an HTTP status represents a temporary external
 * provider failure that may reasonably succeed when retried.
 *
 * This helper is primarily used as a safe fallback when a provider
 * exception could not be mapped to a more specific error category.
 *
 * Retryable status codes:
 * - 408: Request timeout.
 * - 409: Temporary request conflict.
 * - 425: Provider is not ready to process the request.
 * - 429: Rate limit.
 * - 500–599: Provider or gateway failure.
 *
 * When no HTTP status is available, the failure may have originated
 * from a temporary network or transport problem. It is therefore
 * considered retryable by default.
 *
 * Authentication, permission, invalid-request, and model-not-found
 * statuses are intentionally not retryable.
 *
 * @param statusCode Optional HTTP-like status returned by the provider.
 * @returns Whether retrying the same provider request may succeed.
 *
 * @author Malak
 */
export function isRetryableAiProviderStatus(
  statusCode: number | undefined,
): boolean {
  if (statusCode === undefined) {
    return true;
  }

  switch (statusCode) {
    case 408:
    case 409:
    case 425:
    case 429:
      return true;

    default:
      return statusCode >= 500 && statusCode <= 599;
  }
}
