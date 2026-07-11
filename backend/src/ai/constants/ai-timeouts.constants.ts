/**
 * Timeout-related constants for external AI requests.
 *
 * @author Malak
 */

/**
 * Default maximum duration of one AI provider request.
 */
export const DEFAULT_AI_REQUEST_TIMEOUT_MS = 60_000;

/**
 * Minimum allowed timeout.
 *
 * Prevents configuration mistakes that would cancel requests almost
 * immediately.
 */
export const MIN_AI_REQUEST_TIMEOUT_MS = 1_000;

/**
 * Maximum allowed timeout.
 *
 * Requests should not remain open indefinitely.
 */
export const MAX_AI_REQUEST_TIMEOUT_MS = 300_000;

/**
 * Default cooldown applied before an unavailable model may be
 * considered for recovery.
 */
export const DEFAULT_AI_HEALTH_COOLDOWN_MS = 300_000;

/**
 * Number of consecutive failed model executions after which the
 * model becomes degraded.
 */
export const DEFAULT_AI_DEGRADED_FAILURE_THRESHOLD = 2;

/**
 * Number of consecutive failed model executions after which the
 * model becomes unavailable.
 */
export const DEFAULT_AI_UNAVAILABLE_FAILURE_THRESHOLD = 4;