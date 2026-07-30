/**
 * Maximum number of registration tokens accepted by one
 * Firebase multicast request.
 */
export const FCM_MULTICAST_BATCH_SIZE = 500;

/**
 * Maximum number of delivery attempts for transient Firebase failures.
 */
export const PUSH_NOTIFICATION_MAX_ATTEMPTS = 2;

/**
 * Initial delay used before retrying a transient Firebase failure.
 */
export const PUSH_NOTIFICATION_RETRY_DELAY_MS = 500;

/**
 * Firebase errors indicating that a registration token
 * must no longer be used.
 */
export const INVALID_FCM_TOKEN_ERROR_CODES = new Set<string>([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
]);

/**
 * Firebase errors that may succeed when retried.
 */
export const RETRYABLE_FCM_ERROR_CODES = new Set<string>([
  'messaging/internal-error',
  'messaging/server-unavailable',
  'messaging/unknown-error',
]);
