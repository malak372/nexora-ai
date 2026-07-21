/**
 * Timeout-related constants used by the central AI execution runtime.
 *
 * These values control the maximum duration permitted for one external
 * provider request.
 *
 * Model-health thresholds and cooldown configuration belong to the
 * AI Models module because they are consumed by AiModelHealthService.
 *
 * @author Malak
 */

/**
 * Default maximum duration of one external AI-provider request.
 *
 * The timeout applies to one provider attempt only. It does not include:
 * - Retry delays.
 * - Additional retries.
 * - Structured-output repair attempts.
 * - Fallback-model execution.
 */
export const DEFAULT_AI_REQUEST_TIMEOUT_MS = 60_000;

/**
 * Minimum permitted provider-request timeout.
 *
 * Values below one second are rejected because they are unlikely to
 * allow a remote AI request to complete successfully.
 */
export const MIN_AI_REQUEST_TIMEOUT_MS = 1_000;

/**
 * Maximum permitted provider-request timeout.
 *
 * The upper bound prevents an invalid environment configuration from
 * allowing one provider request to remain active indefinitely.
 */
export const MAX_AI_REQUEST_TIMEOUT_MS = 300_000;
