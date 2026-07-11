import {
  AiProviderType,
} from '@prisma/client';

/**
 * Aggregated analytics for one AI model.
 */
export type AiModelUsageAnalytics = {
  readonly aiModelId: string | null;

  readonly model: {
    readonly id: string;
    readonly provider: AiProviderType;
    readonly modelName: string;
    readonly apiModelId: string;
  } | null;

  readonly requests: number;

  readonly successfulRequests: number;

  readonly failedRequests: number;

  readonly inputTokens: number;

  readonly outputTokens: number;

  readonly cost: number;

  readonly averageResponseTimeMs: number;
};

/**
 * AI-usage analytics summary.
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