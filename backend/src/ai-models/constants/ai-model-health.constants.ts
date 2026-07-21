/**
 * Number of consecutive logical model failures after which a model
 * becomes DEGRADED.
 *
 * @author Malak
 */
export const AI_MODEL_DEGRADED_FAILURE_THRESHOLD = 2;

/**
 * Number of consecutive logical model failures after which a model
 * becomes UNAVAILABLE.
 */
export const AI_MODEL_UNAVAILABLE_FAILURE_THRESHOLD = 4;

/**
 * Maximum number of retry attempts for serializable database
 * transactions.
 *
 * Used when retrying PostgreSQL serialization failures.
 */
export const AI_MODEL_SERIALIZABLE_TRANSACTION_ATTEMPTS = 3;
