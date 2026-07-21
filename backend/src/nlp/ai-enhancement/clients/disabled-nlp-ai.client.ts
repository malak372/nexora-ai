import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import type { NlpAiClientRequest } from '../types/nlp-ai-client.type';
import type { NlpAiClientResponse } from '../types/nlp-ai-client.type';

import type { NlpAiClient } from './nlp-ai-client.interface';

/**
 * Default AI client implementation used when no operational AI
 * client has been registered.
 *
 * This implementation intentionally rejects every enhancement request,
 * allowing the NLP pipeline to gracefully fall back to rule-based
 * analysis until an operational AI client implementation is provided.
 *
 * @author Eman
 */
@Injectable()
export class DisabledNlpAiClient implements NlpAiClient {
  /**
   * Rejects every AI-enhancement request because no operational
   * AI client is currently available.
   *
   * @param request Unused AI-enhancement request.
   * @returns A rejected promise indicating that AI enhancement is
   * currently unavailable.
   */
  enhance(_request: NlpAiClientRequest): Promise<NlpAiClientResponse> {
    return Promise.reject(
      new ServiceUnavailableException(
        'AI enhancement is currently unavailable.',
      ),
    );
  }
}
