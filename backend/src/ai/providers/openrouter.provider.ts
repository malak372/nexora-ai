import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiProviderType } from '@prisma/client';
import OpenAI from 'openai';

import { isRetryableAiProviderStatus } from '../constants';

import { AiProviderErrorCode } from '../errors/ai-provider-error-code.enum';
import { AiProviderError } from '../errors/ai-provider.error';

import { AiProviderCredentialsService } from '../services/ai-provider-credentials.service';

import {
  AiFinishReason,
  AiProviderGenerateInput,
  AiProviderGenerateResult,
  AiResponseFormat,
} from '../types/ai-provider.type';

import { AiProvider } from './ai-provider.interface';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const MAX_OPENROUTER_ERROR_MESSAGE_LENGTH = 500;

/**
 * OpenRouter AI-provider adapter.
 *
 * OpenRouter exposes an OpenAI-compatible Chat Completions API
 * and provides access to multiple hosted model families.
 *
 * Model selection remains database-driven through AiModel.apiModelId.
 *
 * @author Malak
 */
@Injectable()
export class OpenRouterProvider implements AiProvider {
  private readonly client: OpenAI;

  constructor(
    credentialsService: AiProviderCredentialsService,
    configService: ConfigService,
  ) {
    const siteUrl = configService.get<string>('OPENROUTER_SITE_URL')?.trim();

    const applicationName = configService
      .get<string>('OPENROUTER_APP_NAME')
      ?.trim();

    this.client = new OpenAI({
      apiKey: credentialsService.getApiKey(AiProviderType.OPENROUTER),
      baseURL: OPENROUTER_BASE_URL,
      maxRetries: 0,
      defaultHeaders: {
        ...(siteUrl
          ? {
              'HTTP-Referer': siteUrl,
            }
          : {}),
        ...(applicationName
          ? {
              'X-OpenRouter-Title': applicationName,
            }
          : {}),
      },
    });
  }

  async generate(
    input: AiProviderGenerateInput,
  ): Promise<AiProviderGenerateResult> {
    const startedAt = Date.now();

    try {
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

      if (input.systemInstruction?.trim()) {
        messages.push({
          role: 'system',
          content: input.systemInstruction.trim(),
        });
      }

      messages.push({
        role: 'user',
        content: input.userPrompt,
      });

      const completion = await this.client.chat.completions.create(
        {
          model: input.apiModelId,
          messages,
          max_tokens: input.maxOutputTokens,
          ...(input.temperature !== undefined
            ? {
                temperature: input.temperature,
              }
            : {}),
          ...(input.responseFormat === AiResponseFormat.JSON
            ? {
                response_format: {
                  type: 'json_object',
                },
              }
            : {}),
          stream: false,
        },
        {
          signal: input.signal,
        },
      );

      const firstChoice = completion.choices[0];
      const text = firstChoice?.message?.content?.trim();

      if (!text) {
        throw new AiProviderError(
          'OpenRouter returned an empty textual response.',
          AiProviderErrorCode.EMPTY_RESPONSE,
          true,
          502,
          completion.id,
        );
      }

      return {
        text,
        requestId: completion.id,
        inputTokens: completion.usage?.prompt_tokens ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0,
        finishReason: this.mapFinishReason(firstChoice.finish_reason),
        providerLatencyMs: Date.now() - startedAt,
      };
    } catch (error: unknown) {
      if (error instanceof AiProviderError) {
        throw error;
      }

      throw this.normalizeError(error);
    }
  }

  private mapFinishReason(
    finishReason: string | null | undefined,
  ): AiFinishReason {
    switch (finishReason) {
      case 'stop':
        return AiFinishReason.STOP;

      case 'length':
        return AiFinishReason.MAX_TOKENS;

      case 'tool_calls':
      case 'function_call':
        return AiFinishReason.TOOL_CALL;

      case 'content_filter':
        return AiFinishReason.CONTENT_FILTER;

      default:
        return AiFinishReason.UNKNOWN;
    }
  }

  private normalizeError(error: unknown): AiProviderError {
    const statusCode = this.readNumericProperty(error, 'status');

    const requestId =
      this.readStringProperty(error, 'request_id') ??
      this.readStringProperty(error, 'requestID');

    const providerMessage = this.readSafeProviderMessage(error);

    if (this.isAbortError(error)) {
      return new AiProviderError(
        'OpenRouter request was cancelled.',
        AiProviderErrorCode.CANCELLED,
        false,
        statusCode,
        requestId,
        error,
      );
    }

    if (this.indicatesInsufficientQuota(providerMessage)) {
      return new AiProviderError(
        this.buildErrorMessage(
          'OpenRouter account credit or quota is unavailable.',
          providerMessage,
        ),
        AiProviderErrorCode.INSUFFICIENT_QUOTA,
        false,
        statusCode,
        requestId,
        error,
      );
    }

    switch (statusCode) {
      case 400:
      case 422:
        return new AiProviderError(
          this.buildErrorMessage(
            'OpenRouter rejected the prompt or model configuration.',
            providerMessage,
          ),
          AiProviderErrorCode.INVALID_MODEL_CONFIGURATION,
          false,
          statusCode,
          requestId,
          error,
        );

      case 401:
        return new AiProviderError(
          'OpenRouter credentials are invalid.',
          AiProviderErrorCode.INVALID_CREDENTIALS,
          false,
          statusCode,
          requestId,
          error,
        );

      case 402:
        return new AiProviderError(
          'OpenRouter account has insufficient credits.',
          AiProviderErrorCode.INSUFFICIENT_QUOTA,
          false,
          statusCode,
          requestId,
          error,
        );

      case 403:
        return new AiProviderError(
          'OpenRouter credentials do not have permission for this request.',
          AiProviderErrorCode.FORBIDDEN,
          false,
          statusCode,
          requestId,
          error,
        );

      case 404:
        return new AiProviderError(
          'The configured OpenRouter model was not found.',
          AiProviderErrorCode.MODEL_NOT_FOUND,
          false,
          statusCode,
          requestId,
          error,
        );

      case 408:
        return new AiProviderError(
          'OpenRouter request timed out.',
          AiProviderErrorCode.TIMEOUT,
          true,
          statusCode,
          requestId,
          error,
        );

      case 409:
      case 425:
      case 429:
        return new AiProviderError(
          this.buildErrorMessage(
            'OpenRouter rate limit was exceeded.',
            providerMessage,
          ),
          AiProviderErrorCode.RATE_LIMIT,
          true,
          statusCode,
          requestId,
          error,
        );

      case 500:
      case 502:
      case 503:
      case 504:
      case 529:
        return new AiProviderError(
          'OpenRouter is temporarily unavailable.',
          AiProviderErrorCode.PROVIDER_UNAVAILABLE,
          true,
          statusCode,
          requestId,
          error,
        );

      default:
        return new AiProviderError(
          this.buildErrorMessage(
            'An unexpected OpenRouter provider error occurred.',
            providerMessage,
          ),
          AiProviderErrorCode.UNKNOWN,
          isRetryableAiProviderStatus(statusCode),
          statusCode,
          requestId,
          error,
        );
    }
  }

  private indicatesInsufficientQuota(message?: string): boolean {
    const normalized = message?.toLowerCase() ?? '';

    return [
      'insufficient credits',
      'insufficient quota',
      'quota exceeded',
      'credit limit',
      'payment required',
      'free-models-per-day',
    ].some((term) => normalized.includes(term));
  }

  private isAbortError(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error.name === 'AbortError' ||
        error.name === 'APIUserAbortError' ||
        error.message.toLowerCase().includes('aborted'))
    );
  }

  private readSafeProviderMessage(error: unknown): string | undefined {
    if (!(error instanceof Error)) {
      return undefined;
    }

    const normalized = error.message
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_OPENROUTER_ERROR_MESSAGE_LENGTH);

    return normalized || undefined;
  }

  private buildErrorMessage(
    fallback: string,
    providerMessage?: string,
  ): string {
    return providerMessage
      ? `${fallback} Provider details: ${providerMessage}`
      : fallback;
  }

  private readStringProperty(
    value: unknown,
    property: string,
  ): string | undefined {
    if (typeof value !== 'object' || value === null || !(property in value)) {
      return undefined;
    }

    const result = (value as Record<string, unknown>)[property];

    if (typeof result !== 'string') {
      return undefined;
    }

    const normalized = result.trim();

    return normalized || undefined;
  }

  private readNumericProperty(
    value: unknown,
    property: string,
  ): number | undefined {
    if (typeof value !== 'object' || value === null || !(property in value)) {
      return undefined;
    }

    const result = (value as Record<string, unknown>)[property];

    return typeof result === 'number' && Number.isFinite(result)
      ? result
      : undefined;
  }
}
