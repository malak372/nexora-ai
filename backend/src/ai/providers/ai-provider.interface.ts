import {
  AiProviderGenerateInput,
  AiProviderGenerateResult,
} from '../types/ai-provider.type';

/**
 * Common contract implemented by every AI provider adapter.
 *
 * The application depends on this interface instead of depending
 * directly on provider-specific SDK contracts such as OpenAI,
 * Anthropic, or Google Gemini.
 *
 * Each adapter is responsible for:
 * - Translating the normalized input into the provider SDK format.
 * - Executing the provider request.
 * - Mapping provider-specific responses into the normalized result.
 * - Normalizing provider-specific finish reasons.
 * - Preventing raw SDK response objects from escaping the adapter layer.
 *
 * Provider-specific errors should be translated into application-level
 * AI errors before leaving the adapter whenever possible.
 *
 * @author Malak
 */
export interface AiProvider {
  /**
   * Generates a single AI response using the selected provider model.
   *
   * The input is provider-independent, while the returned result must
   * be normalized before it leaves the adapter.
   *
   * @param input Normalized generation request.
   * @returns Normalized provider generation result.
   *
   * @throws AiProviderError When the provider request fails.
   * @throws AiResponseValidationError When the provider returns an
   * invalid or unusable response.
   */
  generate(input: AiProviderGenerateInput): Promise<AiProviderGenerateResult>;
}
