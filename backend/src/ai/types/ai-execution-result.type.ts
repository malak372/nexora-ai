import { AiProviderType } from '@prisma/client';

import { AiFinishReason } from './ai-provider.type';

/**
 * Normalized result returned by AiExecutionService.
 *
 * This result represents the final successful AI execution after
 * model selection, provider execution, retries, and optional fallback.
 *
 * Provider-specific SDK response objects must not be exposed through
 * this contract.
 *
 * @author Malak
 */
export type AiExecutionResult = {
  /**
   * Final generated textual response.
   *
   * For structured outputs, this value contains the raw JSON text
   * before or after parsing depending on the calling service design.
   */
  readonly text: string;

  /**
   * Unique identifier representing the complete AI operation.
   *
   * The same operation identifier should be used across retries,
   * fallback attempts, and external API logs.
   */
  readonly operationId: string;

  /**
   * Database identifier of the AiModel that produced the final
   * successful response.
   */
  readonly aiModelId: string;

  /**
   * Provider associated with the final successful model.
   */
  readonly provider: AiProviderType;

  /**
   * Exact provider-side model identifier used for generation.
   *
   * Examples:
   * - gpt-4.1-mini
   * - claude-sonnet-4-20250514
   * - gemini-2.5-flash
   */
  readonly apiModelId: string;

  /**
   * Actual number of input tokens reported by the final provider
   * request.
   */
  readonly inputTokens: number;

  /**
   * Actual number of output tokens reported by the final provider
   * request.
   */
  readonly outputTokens: number;

  /**
   * Estimated monetary cost of the successful provider request.
   *
   * The value should use one consistent currency across the
   * application, preferably USD.
   */
  readonly costEstimate: number;

  /**
   * Total execution duration in milliseconds.
   *
   * This value should include provider execution, retries, and
   * fallback attempts performed during the complete operation.
   */
  readonly responseTimeMs: number;

  /**
   * Normalized reason explaining why the final generation stopped.
   */
  readonly finishReason: AiFinishReason;

  /**
   * Indicates whether the successful response was produced by a
   * fallback model or provider rather than the initially selected one.
   */
  readonly fallbackUsed: boolean;

  /**
   * Total number of provider calls made during this operation.
   *
   * The initial request counts as one attempt.
   */
  readonly attemptCount: number;
};
