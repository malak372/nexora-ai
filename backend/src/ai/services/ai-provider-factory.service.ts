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
 * Resolves registered AI-provider adapters using AiModel.providerKey.
 *
 * Provider keys are stored in the database as ordinary strings, while
 * executable provider adapters remain registered inside the backend.
 *
 * This design keeps the database independent from provider-specific
 * implementation details and prevents credentials or SDK objects from
 * being persisted.
 *
 * Responsibilities:
 * - Build the backend provider-adapter registry.
 * - Normalize provider keys loaded from the database.
 * - Reject unsupported provider keys.
 * - Return the adapter matching a normalized provider key.
 * - Protect against provider-registration mismatches.
 * - Validate the complete provider registry during application startup.
 *
 * This service does not:
 * - Read provider credentials.
 * - Execute AI requests.
 * - Select or rank AI models.
 * - Store provider adapters in the database.
 *
 * @author Malak
 */
@Injectable()
export class AiProviderFactoryService {
  /**
   * Registered AI-provider adapters indexed by their stable provider
   * keys.
   *
   * The property is exposed as ReadonlyMap so the registry cannot be
   * modified after service construction.
   */
  private readonly providerRegistry: ReadonlyMap<
    AiProviderKey,
    AiProvider
  >;

  constructor(
    googleProvider: GoogleProvider,
    openRouterProvider: OpenRouterProvider,
  ) {
    this.providerRegistry = this.createProviderRegistry(
      googleProvider,
      openRouterProvider,
    );

    /**
     * Fail fast during dependency-injection initialization when the
     * advertised provider list and executable adapter registry are not
     * synchronized.
     */
    this.validateRegistry();
  }

  /**
   * Returns the registered provider adapter matching a raw provider key.
   *
   * Database values are normalized before lookup. For example, all of
   * the following values resolve to the same provider:
   *
   * - "google"
   * - "GOOGLE"
   * - " GOOGLE "
   *
   * @param providerKey Raw provider key stored in AiModel.providerKey.
   * @returns Registered provider adapter.
   * @throws BadRequestException when the provider key is unsupported.
   * @throws InternalServerErrorException when the provider is supported
   * but its adapter is missing or incorrectly registered.
   */
  getProvider(providerKey: string): AiProvider {
    const normalizedProviderKey =
      this.normalizeRequiredProviderKey(providerKey);

    const provider = this.providerRegistry.get(normalizedProviderKey);

    if (!provider) {
      /**
       * Reaching this branch means the provider is advertised by the
       * backend constants but is missing from the executable registry.
       *
       * This is an application configuration error rather than an
       * invalid caller request.
       */
      throw new InternalServerErrorException(
        `AI provider adapter is not registered: ${normalizedProviderKey}`,
      );
    }

    this.validateProviderRegistration(
      normalizedProviderKey,
      provider,
    );

    return provider;
  }

  /**
   * Determines whether a raw string represents one of the provider keys
   * advertised by the backend.
   *
   * The return type is a TypeScript type predicate. After this method
   * returns true, TypeScript narrows providerKey to AiProviderKey.
   *
   * Note that this method validates provider-key support only. It does
   * not resolve or execute the corresponding adapter.
   *
   * @param providerKey Raw provider-key candidate.
   * @returns True when the value can be normalized to AiProviderKey.
   */
  isSupportedProviderKey(
    providerKey: string,
  ): providerKey is AiProviderKey {
    return normalizeAiProviderKey(providerKey) !== undefined;
  }

  /**
   * Builds the immutable provider registry used by the AI execution
   * layer.
   *
   * Each supported provider should be registered exactly once under the
   * same stable key exposed by its adapter.
   *
   * When a new provider is introduced, it should be:
   * - Added to AI_PROVIDER_KEYS.
   * - Added to SUPPORTED_AI_PROVIDER_KEYS.
   * - Implemented as an AiProvider adapter.
   * - Injected into this factory.
   * - Registered in this map.
   *
   * @param googleProvider Google AI provider adapter.
   * @param openRouterProvider OpenRouter provider adapter.
   * @returns Read-only provider registry.
   */
  private createProviderRegistry(
    googleProvider: GoogleProvider,
    openRouterProvider: OpenRouterProvider,
  ): ReadonlyMap<AiProviderKey, AiProvider> {
    return new Map<AiProviderKey, AiProvider>([
      [
        AI_PROVIDER_KEYS.GOOGLE,
        googleProvider,
      ],
      [
        AI_PROVIDER_KEYS.OPENROUTER,
        openRouterProvider,
      ],
    ]);
  }

  /**
   * Normalizes and validates a provider key loaded from the database or
   * supplied by another application service.
   *
   * @param providerKey Raw provider-key value.
   * @returns Normalized supported provider key.
   * @throws BadRequestException when the value is not supported.
   */
  private normalizeRequiredProviderKey(
    providerKey: string,
  ): AiProviderKey {
    const normalizedProviderKey =
      normalizeAiProviderKey(providerKey);

    if (!normalizedProviderKey) {
      throw new BadRequestException(
        `Unsupported AI provider key: ${providerKey}`,
      );
    }

    return normalizedProviderKey;
  }

  /**
   * Verifies that one registry entry is internally consistent.
   *
   * This protects against accidental registration mistakes such as
   * placing OpenRouterProvider under the Google registry key.
   *
   * @param registeredProviderKey Key used by the provider registry.
   * @param provider Provider adapter stored under that key.
   * @throws InternalServerErrorException when the adapter advertises a
   * different provider key.
   */
  private validateProviderRegistration(
    registeredProviderKey: AiProviderKey,
    provider: AiProvider,
  ): void {
    if (provider.providerKey !== registeredProviderKey) {
      throw new InternalServerErrorException(
        `AI provider registry mismatch for: ${registeredProviderKey}`,
      );
    }
  }

  /**
   * Validates the complete provider registry during application startup.
   *
   * The application fails fast when:
   * - An advertised provider has no executable adapter.
   * - The registry contains more or fewer entries than expected.
   * - An adapter is registered under a key different from the key it
   * advertises.
   *
   * Failing during startup is safer than allowing a production request
   * to discover an incomplete or inconsistent provider registry.
   */
  private validateRegistry(): void {
    const missingProviderKeys =
      this.findMissingProviderKeys();

    if (missingProviderKeys.length > 0) {
      throw new InternalServerErrorException(
        `Missing AI provider adapters: ${missingProviderKeys.join(', ')}`,
      );
    }

    if (
      this.providerRegistry.size !==
      SUPPORTED_AI_PROVIDER_KEYS.length
    ) {
      throw new InternalServerErrorException(
        'The AI provider registry contains unexpected adapters.',
      );
    }

    for (const [
      registeredProviderKey,
      provider,
    ] of this.providerRegistry.entries()) {
      this.validateProviderRegistration(
        registeredProviderKey,
        provider,
      );
    }
  }

  /**
   * Returns all provider keys advertised by the backend but missing from
   * the executable adapter registry.
   */
  private findMissingProviderKeys(): AiProviderKey[] {
    return SUPPORTED_AI_PROVIDER_KEYS.filter(
      (providerKey) =>
        !this.providerRegistry.has(providerKey),
    );
  }
}