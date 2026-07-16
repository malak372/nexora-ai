/**
 * Timeout and health-related AI constants.
 *
 * @author Malak
 */

/**
 * Default maximum duration of one provider request.
 */
export const DEFAULT_AI_REQUEST_TIMEOUT_MS = 60_000;

/**
 * Minimum permitted provider timeout.
 */
export const MIN_AI_REQUEST_TIMEOUT_MS = 1_000;

/**
 * Maximum permitted provider timeout.
 */
export const MAX_AI_REQUEST_TIMEOUT_MS = 300_000;

/**
 * Cooldown before an unavailable model may be reconsidered.
 */
export const DEFAULT_AI_HEALTH_COOLDOWN_MS = 300_000;

/**
 * Consecutive failures required to mark a model as degraded.
 */
export const DEFAULT_AI_DEGRADED_FAILURE_THRESHOLD = 2;

/**
 * Consecutive failures required to mark a model as unavailable.
 */
export const DEFAULT_AI_UNAVAILABLE_FAILURE_THRESHOLD = 4;
