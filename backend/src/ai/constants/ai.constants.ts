/**
 * General runtime constants used by the central AI execution pipeline.
 *
 * Environment variables may override operational defaults where the
 * corresponding service supports runtime configuration.
 *
 * Centralizing these values prevents repeated magic numbers and keeps:
 * - Provider execution.
 * - Retry behavior.
 * - Structured-output repair.
 * - Token estimation.
 * - External API logging.
 *
 * consistent across the AI module.
 *
 * AI-model configuration constants such as:
 * - Default model priority.
 * - Default model weight.
 * - Default model output-token limit.
 *
 * belong to the AI Models module and are intentionally excluded from
 * this file.
 *
 * @author Malak
 */

/**
 * Default estimated output-token count used before provider execution.
 *
 * This value is used only for:
 * - Cost-aware model routing.
 * - Preliminary provider-cost estimation.
 *
 * It does not limit the actual provider response. The final output-token
 * limit is resolved from the selected AiModel configuration.
 *
 * Actual token usage must be read from provider usage metadata whenever
 * it is available.
 */
export const DEFAULT_AI_ESTIMATED_OUTPUT_TOKENS = 2_048;

/**
 * Default model generation temperature.
 *
 * A relatively low value is appropriate because most Nexora AI
 * operations expect stable and structured responses rather than highly
 * variable creative output.
 *
 * Business modules may provide a more specific temperature when their
 * workflow requires different generation behavior.
 */
export const DEFAULT_AI_TEMPERATURE = 0.3;

/**
 * Maximum number of retries permitted after the initial provider
 * request for the same AI model.
 *
 * A value of one means:
 * - One initial provider request.
 * - One retry.
 * - Two total provider requests for the same model.
 *
 * After retries are exhausted, AiExecutionService may continue with the
 * next available fallback model.
 */
export const DEFAULT_AI_MAX_RETRIES_PER_MODEL = 1;

/**
 * Base delay in milliseconds used for exponential retry backoff.
 *
 * Example:
 * - First retry: 500 milliseconds.
 * - Second retry: 1,000 milliseconds.
 * - Third retry: 2,000 milliseconds.
 */
export const DEFAULT_AI_RETRY_BASE_DELAY_MS = 500;

/**
 * Internal operation label persisted in ExternalApiLog for AI
 * text-generation requests.
 *
 * This value identifies an internal external-provider operation and is
 * not a public HTTP endpoint.
 */
export const AI_TEXT_GENERATION_ENDPOINT = 'ai/text-generation';

/**
 * Maximum normalized AI error-message length stored in ExternalApiLog.
 *
 * This protects the database from unexpectedly large provider or SDK
 * error messages.
 */
export const MAX_AI_ERROR_MESSAGE_LENGTH = 2_000;

/**
 * Maximum provider-response length accepted by the JSON response
 * parser.
 *
 * This limit protects the application from:
 * - Unexpectedly large provider responses.
 * - Excessive memory consumption.
 * - Unnecessary JSON-parsing overhead.
 */
export const MAX_AI_RESPONSE_LENGTH = 100_000;

/**
 * Maximum number of structured-output repair requests allowed for one
 * invalid provider response.
 *
 * A value of one means Nexora AI attempts one deterministic repair
 * request before continuing with another fallback model.
 */
export const MAX_AI_STRUCTURED_OUTPUT_REPAIRS = 1;

/**
 * Maximum number of characters copied from an invalid provider response
 * into a structured-output repair prompt.
 *
 * Provider output is treated as untrusted input and must always be
 * bounded before being included in another AI request.
 */
export const MAX_AI_REPAIR_SOURCE_LENGTH = 12_000;

/**
 * Maximum number of characters copied from the original generation
 * prompt into a structured-output repair prompt.
 *
 * This provides enough task context for repair while preventing an
 * unexpectedly large repeated prompt.
 */
export const MAX_AI_REPAIR_CONTEXT_LENGTH = 24_000;

/**
 * Maximum number of parsing or schema-validation issues included in one
 * structured-output repair prompt.
 */
export const MAX_AI_REPAIR_VALIDATION_ISSUES = 20;

/**
 * Temperature used for structured-output repair requests.
 *
 * Repair is deterministic JSON correction rather than creative content
 * generation.
 */
export const AI_STRUCTURED_OUTPUT_REPAIR_TEMPERATURE = 0;

/**
 * Approximate number of characters represented by one token.
 *
 * This approximation is used only before provider execution for:
 * - Model routing.
 * - Input-token estimation.
 * - Preliminary cost estimation.
 *
 * Actual token counts must come from provider usage metadata whenever
 * available.
 */
export const APPROXIMATE_CHARACTERS_PER_TOKEN = 4;

/**
 * Determines whether an HTTP-like provider status represents a
 * temporary failure that may reasonably succeed when retried.
 *
 * Retryable statuses:
 * - 408: Request timeout.
 * - 409: Temporary request conflict.
 * - 425: Provider is not ready to process the request.
 * - 429: Provider rate limit.
 * - 500–599: Provider or gateway failure.
 *
 * When no status code is available, the failure may have originated
 * from a temporary network or transport problem and is therefore
 * considered retryable.
 *
 * Authentication, permission, model-not-found, and invalid-request
 * failures are intentionally not marked retryable here.
 *
 * @param statusCode Optional HTTP-like status returned by the provider.
 * @returns True when retrying the same provider request may succeed.
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