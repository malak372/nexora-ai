import type { AiProviderKey } from '../constants/ai-provider.constants';
import type { AiFinishReason } from './ai-provider.type';

/**
 * Final successful result returned by AiExecutionService.
 *
 * This result represents the complete logical operation after:
 * - Model routing.
 * - Provider execution.
 * - Temporary retries.
 * - Structured-output validation.
 * - Optional response repair.
 * - Model or provider fallback.
 *
 * Provider-specific SDK objects must never be returned through this
 * contract.
 *
 * @author Malak
 */
export type AiExecutionResult = {
  /**
   * Final generated response.
   *
   * JSON operations return normalized validated JSON serialized as a
   * string. Text operations return provider-generated text.
   */
  readonly text: string;

  /**
   * Identifier shared by every external attempt belonging to the same
   * logical AI operation.
   */
  readonly operationId: string;

  /**
   * Database identifier of the successful AI model.
   */
  readonly aiModelId: string;

  /**
   * Stable backend provider-registry key.
   */
  readonly providerKey: AiProviderKey;

  /**
   * Exact provider-side model identifier.
   *
   * Examples:
   * - gemini-2.5-flash
   * - openai/gpt-4.1-mini
   */
  readonly apiModelId: string;

  /**
   * Input-token count reported by the final successful provider call.
   */
  readonly inputTokens: number;

  /**
   * Output-token count reported by the final successful provider call.
   */
  readonly outputTokens: number;

  /**
   * Estimated cost of the final successful external request.
   *
   * The application should use one consistent currency, preferably USD.
   */
  readonly costEstimate: number;

  /**
   * Total logical-operation duration in milliseconds.
   *
   * This includes retries, repair requests, and fallback execution.
   */
  readonly responseTimeMs: number;

  /**
   * Normalized completion reason.
   */
  readonly finishReason: AiFinishReason;

  /**
   * Whether the successful response came from a fallback model.
   */
  readonly fallbackUsed: boolean;

  /**
   * Total number of external provider requests executed.
   *
   * Initial attempts, retries, repair attempts, and fallback attempts
   * are all included.
   */
  readonly attemptCount: number;
};
