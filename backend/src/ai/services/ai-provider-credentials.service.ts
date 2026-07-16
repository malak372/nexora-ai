import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  AI_PROVIDER_KEYS,
  type AiProviderKey,
} from '../constants/ai-provider.constants';

/**
 * Resolves AI-provider configuration from environment variables.
 *
 * Secrets must never be stored in AiModel or returned through APIs.
 *
 * @author Malak
 */
@Injectable()
export class AiProviderCredentialsService {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Returns the required provider API key.
   */
  getApiKey(providerKey: AiProviderKey): string {
    switch (providerKey) {
      case AI_PROVIDER_KEYS.GOOGLE:
        return this.requireValue('GOOGLE_AI_API_KEY');

      case AI_PROVIDER_KEYS.OPENROUTER:
        return this.requireValue('OPENROUTER_API_KEY');

      default:
        return this.assertNever(providerKey);
    }
  }

  /**
   * Optional OpenRouter site URL used in HTTP-Referer.
   */
  getOpenRouterSiteUrl(): string | undefined {
    return this.getOptionalValue('OPENROUTER_SITE_URL');
  }

  /**
   * Optional OpenRouter application name.
   */
  getOpenRouterAppName(): string | undefined {
    return this.getOptionalValue('OPENROUTER_APP_NAME');
  }

  private requireValue(key: string): string {
    const value = this.configService.get<string>(key)?.trim();

    if (!value) {
      throw new ServiceUnavailableException(
        `Required AI provider configuration is missing: ${key}`,
      );
    }

    return value;
  }

  private getOptionalValue(key: string): string | undefined {
    const value = this.configService.get<string>(key)?.trim();

    return value || undefined;
  }

  private assertNever(value: never): never {
    throw new ServiceUnavailableException(
      `Unsupported AI provider key: ${String(value)}`,
    );
  }
}
