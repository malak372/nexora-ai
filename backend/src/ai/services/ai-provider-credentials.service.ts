import {
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiProviderType } from '@prisma/client';

import {
  AI_PROVIDER_API_KEY_ENVIRONMENT_KEYS,
} from '../constants';

/**
 * Resolves AI-provider credentials from application configuration.
 *
 * Provider API keys are stored in environment variables instead of
 * AiModel database records to prevent secrets from being persisted or
 * exposed through administrative model-management operations.
 *
 * Responsibilities:
 * - Resolve the environment-variable name for a provider.
 * - Read and normalize the configured API key.
 * - Reject missing or blank credentials.
 *
 * This service does not:
 * - Validate credentials against the external provider.
 * - Create provider SDK clients.
 * - Store or log provider credentials.
 *
 * @author Malak
 */
@Injectable()
export class AiProviderCredentialsService {
  constructor(
    private readonly configService:
      ConfigService,
  ) {}

  /**
   * Returns the configured API key for one AI provider.
   *
   * The returned credential must never be written to:
   * - Application logs.
   * - ExternalApiLog.
   * - API responses.
   * - Database records.
   *
   * @param provider AI provider whose credential should be resolved.
   * @returns Trimmed provider API key.
   *
   * @throws ServiceUnavailableException When the environment variable
   * is missing, empty, or whitespace-only.
   */
  getApiKey(
    provider: AiProviderType,
  ): string {
    const environmentKey =
      AI_PROVIDER_API_KEY_ENVIRONMENT_KEYS[
        provider
      ];

    const apiKey =
      this.configService
        .get<string>(
          environmentKey,
        )
        ?.trim();

    if (!apiKey) {
      throw new ServiceUnavailableException(
        `AI provider credentials are not configured for ${provider}.`,
      );
    }

    return apiKey;
  }
}