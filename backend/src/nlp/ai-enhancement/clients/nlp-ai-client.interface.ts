import {
  NlpAiClientRequest,
  NlpAiClientResponse,
} from '../types/nlp-ai-client.type';

/**
 * Defines the contract between the NLP AI-enhancement layer and an
 * AI client implementation.
 *
 * The NLP module depends only on this interface and remains
 * independent of provider SDKs and the central AI execution layer.
 *
 * Different implementations may delegate requests to:
 * - A production AI execution module.
 * - A mock implementation for testing.
 * - A disabled implementation when AI enhancement is unavailable.
 *
 * @author Eman
 */
export interface NlpAiClient {
  /**
   * Executes one AI-enhancement request.
   *
   * Implementations are responsible for:
   * - Sending the rendered prompt to an AI model.
   * - Returning a normalized response.
   * - Throwing an exception when the request cannot be completed.
   *
   * @param request AI-enhancement request.
   * @returns Normalized AI-enhancement response.
   */
  enhance(request: NlpAiClientRequest): Promise<NlpAiClientResponse>;
}
