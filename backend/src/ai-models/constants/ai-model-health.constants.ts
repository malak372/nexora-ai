/**
 * Shared operational health thresholds for AI models.
 *
 * These values are used by AiModelHealthService and should remain
 * centralized to prevent health behavior from diverging across
 * services.
 *
 * @author Malak
 */

/**
 * Number of consecutive failed logical model executions after which
 * a model becomes DEGRADED.
 */
export const AI_MODEL_DEGRADED_FAILURE_THRESHOLD = 2;

/**
 * Number of consecutive failed logical model executions after which
 * a model becomes UNAVAILABLE.
 */
export const AI_MODEL_UNAVAILABLE_FAILURE_THRESHOLD = 4;

/**
 * Maximum number of attempts used for serializable transactions.
 */
export const AI_MODEL_SERIALIZABLE_TRANSACTION_ATTEMPTS = 3;
