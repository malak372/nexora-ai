import type { AiProviderKey } from '../constants/ai-provider.constants';

import type {
  AiProviderGenerateInput,
  AiProviderGenerateResult,
} from '../types/ai-provider.type';

/**
 * Common provider-neutral contract implemented by every external
 * AI-provider adapter.
 *
 * AiExecutionService depends on this abstraction rather than directly
 * depending on Google, OpenRouter, or provider-specific SDK classes.
 *
 * Implementations are responsible for:
 * - Translating the provider-neutral input into an SDK request.
 * - Returning normalized usage and completion metadata.
 * - Converting SDK exceptions into AiProviderError.
 *
 * @author Malak
 */
export interface AiProvider {
  /**
   * Stable backend registry key identifying this provider.
   *
   * This value must match the key stored in AiModel.providerKey.
   */
  readonly providerKey: AiProviderKey;

  /**
   * Generates one response using the requested external model.
   *
   * @param input Provider-neutral generation input.
   * @returns Normalized provider response.
   */
  generate(input: AiProviderGenerateInput): Promise<AiProviderGenerateResult>;
}
