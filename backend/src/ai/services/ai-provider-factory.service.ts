import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';

import {
  AI_PROVIDER_KEYS,
  SUPPORTED_AI_PROVIDER_KEYS,
  normalizeAiProviderKey,
  type AiProviderKey,
} from '../constants/ai-provider.constants';

import type { AiProvider } from '../providers/ai-provider.interface';

import { GoogleProvider } from '../providers/google.provider';
import { OpenRouterProvider } from '../providers/openrouter.provider';

/**
 * Resolves AI-provider adapters using AiModel.providerKey.
 *
 * Provider keys are stored in the database as strings, while the
 * executable adapters remain registered inside the backend.
 *
 * Responsibilities:
 * - Normalize database provider keys.
 * - Reject unsupported providers.
 * - Return the matching provider adapter.
 * - Validate that every advertised provider has an adapter.
 *
 * @author Malak
 */
@Injectable()
export class AiProviderFactoryService {
  /**
   * Registered provider adapters indexed by stable provider key.
   */
  private readonly providers:
    ReadonlyMap<
      AiProviderKey,
      AiProvider
    >;

  constructor(
    googleProvider: GoogleProvider,
    openRouterProvider: OpenRouterProvider,
  ) {
    this.providers =
      new Map<
        AiProviderKey,
        AiProvider
      >([
        [
          AI_PROVIDER_KEYS.GOOGLE,
          googleProvider,
        ],

        [
          AI_PROVIDER_KEYS.OPENROUTER,
          openRouterProvider,
        ],
      ]);

    this.validateRegistry();
  }

  /**
   * Returns the provider adapter matching a database provider key.
   *
   * Database values are normalized before lookup so values such as:
   * - "google"
   * - " GOOGLE "
   *
   * resolve to the same adapter.
   *
   * @param providerKey Raw provider key stored in AiModel.
   * @returns Registered provider adapter.
   */
  getProvider(
    providerKey: string,
  ): AiProvider {
    const normalizedProviderKey =
      normalizeAiProviderKey(
        providerKey,
      );

    if (!normalizedProviderKey) {
      throw new BadRequestException(
        `Unsupported AI provider: ${providerKey}`,
      );
    }

    const provider =
      this.providers.get(
        normalizedProviderKey,
      );

    if (!provider) {
      throw new InternalServerErrorException(
        `AI provider adapter is not registered: ${normalizedProviderKey}`,
      );
    }

    /**
     * Protects the provider registry from accidental mismatches such
     * as registering GoogleProvider under the OpenRouter key.
     */
    if (
      provider.providerKey !==
      normalizedProviderKey
    ) {
      throw new InternalServerErrorException(
        `AI provider registry mismatch for: ${normalizedProviderKey}`,
      );
    }

    return provider;
  }

  /**
   * Determines whether a raw provider key is supported.
   *
   * @param providerKey Raw provider-key candidate.
   */
  isSupportedProviderKey(
    providerKey: string,
  ): providerKey is AiProviderKey {
    return (
      normalizeAiProviderKey(
        providerKey,
      ) !== undefined
    );
  }

  /**
   * Ensures every provider advertised by the backend constants has
   * exactly one registered adapter.
   */
  private validateRegistry(): void {
    const missingProviders =
      SUPPORTED_AI_PROVIDER_KEYS.filter(
        (providerKey) =>
          !this.providers.has(
            providerKey,
          ),
      );

    if (
      missingProviders.length > 0
    ) {
      throw new InternalServerErrorException(
        `Missing AI provider adapters: ${missingProviders.join(', ')}`,
      );
    }

    if (
      this.providers.size !==
      SUPPORTED_AI_PROVIDER_KEYS.length
    ) {
      throw new InternalServerErrorException(
        'The AI provider registry contains unexpected adapters.',
      );
    }
  }
}