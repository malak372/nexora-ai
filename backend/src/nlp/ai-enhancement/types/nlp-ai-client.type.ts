import type { AiProviderKey } from '../../../ai/constants/ai-provider.constants';

/**
 * Request sent by the NLP AI-enhancement layer to an AI client
 * implementation.
 *
 * This contract remains independent from provider SDKs and delegates
 * operation-ID generation to the central AI execution runtime.
 *
 * @author Eman
 */
export type NlpAiClientRequest = {
  /**
   * Fully rendered NLP enhancement prompt.
   */
  readonly prompt: string;
};

/**
 * Normalized response returned by an NLP AI-client implementation.
 *
 * The returned data remains unknown until it is validated by
 * AiAnalysisOutputValidatorService.
 *
 * Provider-specific SDK response objects are intentionally not exposed
 * through this contract. All execution metadata is copied from the
 * authoritative AiExecutionResult returned by the central AI runtime.
 *
 * @author Eman
 */
export type NlpAiClientResponse = {
  /**
   * Parsed but not yet domain-validated AI response.
   *
   * AiAnalysisOutputValidatorService is responsible for validating
   * and converting this value into AiEnhancementOutput.
   */
  readonly data: unknown;

  /**
   * Stable identifier shared by every request attempt that belongs to
   * the same logical AI operation.
   */
  readonly operationId: string;

  /**
   * Database identifier of the AiModel record that produced the final
   * successful response.
   */
  readonly aiModelId: string;

  /**
   * Stable backend registry key identifying the successful provider.
   *
   * Current examples:
   * - google
   * - openrouter
   */
  readonly providerKey: AiProviderKey;

  /**
   * Exact provider-side model identifier used for generation.
   */
  readonly apiModelId: string;

  /**
   * Number of input tokens reported by the successful provider.
   *
   * A zero value means usage metadata was unavailable or reported as
   * zero by the provider adapter.
   */
  readonly inputTokens: number;

  /**
   * Number of output tokens reported by the successful provider.
   *
   * A zero value means usage metadata was unavailable or reported as
   * zero by the provider adapter.
   */
  readonly outputTokens: number;

  /**
   * Total duration of the complete logical AI operation in
   * milliseconds, including retries, repair, and fallback work.
   */
  readonly responseTimeMs: number;

  /**
   * Estimated monetary cost of the final successful provider request.
   */
  readonly costEstimate: number;

  /**
   * Indicates whether a fallback model produced the final response.
   */
  readonly fallbackUsed: boolean;

  /**
   * Total number of external provider requests executed during the
   * logical operation.
   */
  readonly attemptCount: number;
};
