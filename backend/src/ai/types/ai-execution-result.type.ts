import { AiProviderType } from '@prisma/client';

import { AiFinishReason } from './ai-provider.type';

/**
 * Normalized result returned by AiExecutionService.
 *
 * This result represents the final successful AI execution after
 * model selection, provider execution, retries, structured-output
 * validation, optional response repair, and fallback execution.
 *
 * Provider-specific SDK response objects must never escape through
 * this contract.
 *
 * @author Malak
 */
export type AiExecutionResult = {
  /**
   * Final generated response text.
   *
   * For JSON operations, this value contains normalized validated
   * JSON serialized as a string.
   *
   * For plain-text operations, it contains the provider text.
   */
  readonly text: string;

  /**
   * Unique identifier shared by every provider attempt belonging
   * to the same logical AI operation.
   */
  readonly operationId: string;

  /**
   * Database identifier of the AI model that produced the final
   * successful response.
   */
  readonly aiModelId: string;

  /**
   * Provider associated with the successful AI model.
   */
  readonly provider: AiProviderType;

  /**
   * Exact provider-side model identifier used for generation.
   *
   * Examples:
   * - gpt-4.1-mini
   * - claude-sonnet-4
   * - gemini-2.5-flash
   * - llama-3.3-70b-versatile
   */
  readonly apiModelId: string;

  /**
   * Actual input-token count reported by the final successful
   * provider request.
   */
  readonly inputTokens: number;

  /**
   * Actual output-token count reported by the final successful
   * provider request.
   */
  readonly outputTokens: number;

  /**
   * Estimated monetary cost of the final successful provider
   * request.
   *
   * The project should use one consistent currency, preferably USD.
   */
  readonly costEstimate: number;

  /**
   * Total logical-operation duration in milliseconds.
   *
   * This includes retries, structured-output repair attempts,
   * fallback execution, and the final successful request.
   */
  readonly responseTimeMs: number;

  /**
   * Normalized reason explaining why generation stopped.
   */
  readonly finishReason: AiFinishReason;

  /**
   * Indicates whether the final response was produced by a fallback
   * model rather than the first routed model.
   */
  readonly fallbackUsed: boolean;

  /**
   * Total number of external provider calls executed during the
   * logical operation.
   *
   * Initial calls, retries, repair requests, and fallback calls are
   * all included.
   */
  readonly attemptCount: number;
};
