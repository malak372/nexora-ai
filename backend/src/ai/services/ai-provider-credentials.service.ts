import {
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

import {
  AI_PROVIDER_KEYS,
  type AiProviderKey,
} from '../constants/ai-provider.constants';

/**
 * Supported environment-variable keys used by AI-provider
 * configuration.
 *
 * Keeping these values centralized prevents spelling differences
 * between credential-resolution methods.
 */
const AI_PROVIDER_ENV_KEYS = {
  GOOGLE_API_KEY: 'GOOGLE_AI_API_KEY',
  OPENROUTER_API_KEY: 'OPENROUTER_API_KEY',
  OPENROUTER_SITE_URL: 'OPENROUTER_SITE_URL',
  OPENROUTER_APP_NAME: 'OPENROUTER_APP_NAME',
} as const;

/**
 * Environment-variable key used by AI-provider configuration.
 */
type AiProviderEnvironmentKey =
  (typeof AI_PROVIDER_ENV_KEYS)[keyof typeof AI_PROVIDER_ENV_KEYS];

/**
 * Resolves AI-provider credentials and optional provider metadata from
 * application configuration.
 *
 * Provider secrets must:
 * - Be supplied through environment variables or a secure secret store.
 * - Never be persisted in AiModel database records.
 * - Never be returned through public or administrator APIs.
 * - Never be included in logs or thrown error metadata.
 *
 * This service centralizes provider configuration so individual
 * adapters do not read environment variables directly.
 *
 * @author Malak
 */
@Injectable()
export class AiProviderCredentialsService {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Returns the required API key for one supported AI provider.
   *
   * @param providerKey Stable provider-registry key.
   * @returns Trimmed provider API key.
   * @throws ServiceUnavailableException when the provider configuration
   * is missing or empty.
   */
  getApiKey(providerKey: AiProviderKey): string {
    switch (providerKey) {
      case AI_PROVIDER_KEYS.GOOGLE:
        return this.requireValue(
          AI_PROVIDER_ENV_KEYS.GOOGLE_API_KEY,
        );

      case AI_PROVIDER_KEYS.OPENROUTER:
        return this.requireValue(
          AI_PROVIDER_ENV_KEYS.OPENROUTER_API_KEY,
        );

      default:
        return this.assertNever(providerKey);
    }
  }

  /**
   * Returns the optional application site URL sent to OpenRouter through
   * the HTTP-Referer request header.
   *
   * The value is omitted when the environment variable is missing,
   * empty, or contains only whitespace.
   */
  getOpenRouterSiteUrl(): string | undefined {
    return this.getOptionalValue(
      AI_PROVIDER_ENV_KEYS.OPENROUTER_SITE_URL,
    );
  }

  /**
   * Returns the optional application name sent to OpenRouter through
   * the X-Title request header.
   *
   * The value is omitted when the environment variable is missing,
   * empty, or contains only whitespace.
   */
  getOpenRouterAppName(): string | undefined {
    return this.getOptionalValue(
      AI_PROVIDER_ENV_KEYS.OPENROUTER_APP_NAME,
    );
  }

  /**
   * Reads one mandatory configuration value.
   *
   * Leading and trailing whitespace is removed before validation and
   * before returning the value.
   *
   * @param key Environment-variable key.
   * @returns Non-empty trimmed configuration value.
   * @throws ServiceUnavailableException when the configuration is
   * missing or blank.
   */
  private requireValue(key: AiProviderEnvironmentKey): string {
    const value = this.readTrimmedValue(key);

    if (!value) {
      throw new ServiceUnavailableException(
        `Required AI provider configuration is missing: ${key}`,
      );
    }

    return value;
  }

  /**
   * Reads one optional configuration value.
   *
   * Missing, empty, or whitespace-only values are normalized to
   * undefined.
   *
   * @param key Environment-variable key.
   * @returns Trimmed value when configured; otherwise undefined.
   */
  private getOptionalValue(
    key: AiProviderEnvironmentKey,
  ): string | undefined {
    return this.readTrimmedValue(key);
  }

  /**
   * Reads and normalizes one string configuration value.
   *
   * @param key Environment-variable key.
   * @returns Trimmed value or undefined when no usable value exists.
   */
  private readTrimmedValue(
    key: AiProviderEnvironmentKey,
  ): string | undefined {
    const value = this.configService.get<string>(key)?.trim();

    return value || undefined;
  }

  /**
   * Enforces exhaustive handling of AiProviderKey.
   *
   * When a new provider is added to AiProviderKey, TypeScript requires
   * getApiKey() to add a corresponding switch case before this method
   * can receive the value as never.
   */
  private assertNever(value: never): never {
    throw new ServiceUnavailableException(
      `Unsupported AI provider key: ${String(value)}`,
    );
  }
}