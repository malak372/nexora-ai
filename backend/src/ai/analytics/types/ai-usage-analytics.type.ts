/**
 * Administrator-facing AI-model metadata included in analytics.
 *
 * providerKey remains a string because historical database records may
 * reference providers that are no longer enabled or implemented by the
 * current backend deployment.
 *
 * @author Malak
 */
export type AiAnalyticsModelDetails = {
  /**
   * AI-model database identifier.
   */
  readonly id: string;

  /**
   * Provider key persisted with the model.
   */
  readonly providerKey: string;

  /**
   * Internal administrative model name.
   */
  readonly modelName: string;

  /**
   * Exact model identifier sent to the external provider.
   */
  readonly apiModelId: string;
};

/**
 * Aggregated analytics for one AI model.
 *
 * aiModelId and model may be null when:
 * - A legacy log was created without an AI-model relation.
 * - The associated model was deleted and the relation was set to null.
 *
 * @author Malak
 */
export type AiModelUsageAnalytics = {
  readonly aiModelId: string | null;

  readonly model: AiAnalyticsModelDetails | null;

  readonly requests: number;

  readonly successfulRequests: number;

  readonly failedRequests: number;

  readonly inputTokens: number;

  readonly outputTokens: number;

  readonly cost: number;

  readonly averageResponseTimeMs: number;
};

/**
 * AI usage analytics summary.
 *
 * Request counts represent individual external provider attempts.
 * Retries, structured-output repairs, and fallback requests are
 * therefore counted as separate requests.
 *
 * @author Malak
 */
export type AiUsageAnalyticsSummary = {
  readonly totalRequests: number;

  readonly successfulRequests: number;

  readonly failedRequests: number;

  readonly successRate: number;

  readonly averageResponseTimeMs: number;

  readonly totalInputTokens: number;

  readonly totalOutputTokens: number;

  readonly totalCost: number;

  readonly fallbackAttempts: number;

  readonly models: AiModelUsageAnalytics[];
};
