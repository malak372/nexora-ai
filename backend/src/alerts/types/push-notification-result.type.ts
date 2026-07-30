/**
 * Aggregated result of one user push-notification delivery operation.
 */
export interface PushNotificationResult {
  attemptedCount: number;
  successCount: number;
  failureCount: number;
  revokedTokenCount: number;
  skipped: boolean;
}
