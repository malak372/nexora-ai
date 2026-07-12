import { AiProviderType } from '@prisma/client';

/**
 * Request sent by the NLP AI-enhancement layer to an AI client
 * implementation.
 *
 * This contract remains independent from provider SDKs and the
 * central AI execution implementation.
 *
 * @author Eman
 */
export type NlpAiClientRequest = {
  /**
   * Fully rendered NLP enhancement prompt.
   */
  readonly prompt: string;

  /**
   * Optional logical operation identifier used for tracing and
   * correlating provider attempts and logs.
   *
   * Undefined when the client implementation delegates operation-ID
   * generation to the central AI execution layer.
   */
  readonly operationId?: string;
};

/**
 * Normalized response returned by an NLP AI-client implementation.
 *
 * The returned data remains unknown until it is validated by
 * AiAnalysisOutputValidatorService.
 *
 * This prevents external AI responses from being trusted as
 * AiEnhancementOutput before domain-level validation succeeds.
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
   * Provider that produced the successful response.
   *
   * Undefined when the request fails before a provider returns a
   * successful response.
   */
  readonly provider?: AiProviderType;

  /**
   * Exact provider-side model identifier used for generation.
   *
   * Undefined when execution fails before a model produces a
   * successful response.
   */
  readonly modelId?: string;

  /**
   * Actual number of input tokens reported by the provider.
   *
   * Undefined when token usage is unavailable or execution fails
   * before usage metadata is returned.
   */
  readonly inputTokens?: number;

  /**
   * Actual number of output tokens reported by the provider.
   *
   * Undefined when token usage is unavailable or execution fails
   * before usage metadata is returned.
   */
  readonly outputTokens?: number;

  /**
   * Total AI execution duration in milliseconds.
   *
   * Undefined when execution timing metadata is not provided by the
   * underlying AI implementation.
   */
  readonly responseTimeMs?: number;

  /**
   * Estimated monetary cost of the successful AI request.
   *
   * Undefined when pricing metadata is unavailable.
   */
  readonly estimatedCost?: number;
};