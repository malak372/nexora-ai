import { Injectable } from '@nestjs/common';

import OpenAI from 'openai';

import {
  AI_PROVIDER_KEYS,
  type AiProviderKey,
} from '../constants/ai-provider.constants';

import { isRetryableAiProviderStatus } from '../constants';

import { AiProviderErrorCode } from '../errors/ai-provider-error-code.enum';
import { AiProviderError } from '../errors/ai-provider.error';

import { AiProviderCredentialsService } from '../services/ai-provider-credentials.service';

import {
  AiFinishReason,
  AiResponseFormat,
  type AiProviderGenerateInput,
  type AiProviderGenerateResult,
} from '../types/ai-provider.type';

import type { AiProvider } from './ai-provider.interface';

/**
 * OpenRouter OpenAI-compatible API base URL.
 */
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * Maximum provider-message length copied into a normalized
 * application error.
 */
const MAX_OPENROUTER_ERROR_MESSAGE_LENGTH = 500;

/**
 * Default instruction used when JSON mode is requested without a
 * caller-supplied system instruction.
 */
const OPENROUTER_JSON_SYSTEM_INSTRUCTION =
  'Return exactly one valid JSON object. Do not include Markdown, code fences, explanations, or text outside the JSON object.';

/**
 * Exact response_format property accepted by the installed OpenAI
 * Chat Completions SDK.
 */
type OpenRouterResponseFormat = NonNullable<
  OpenAI.Chat.Completions.ChatCompletionCreateParams['response_format']
>;

/**
 * OpenRouter AI-provider adapter.
 *
 * OpenRouter exposes an OpenAI-compatible Chat Completions API and
 * provides access to multiple hosted model families.
 *
 * Model selection remains database-driven through:
 * - AiModel.providerKey
 * - AiModel.apiModelId
 *
 * SDK retries are disabled because retries and provider fallback are
 * handled centrally by AiExecutionService.
 *
 * @author Malak
 */
@Injectable()
export class OpenRouterProvider implements AiProvider {
  /**
   * Stable backend registry key.
   */
  readonly providerKey: AiProviderKey = AI_PROVIDER_KEYS.OPENROUTER;

  /**
   * OpenAI-compatible SDK client configured for OpenRouter.
   */
  private readonly client: OpenAI;

  constructor(credentialsService: AiProviderCredentialsService) {
    const siteUrl = credentialsService.getOpenRouterSiteUrl();

    const applicationName = credentialsService.getOpenRouterAppName();

    this.client = new OpenAI({
      apiKey: credentialsService.getApiKey(this.providerKey),

      baseURL: OPENROUTER_BASE_URL,

      /**
       * Retries are managed by AiExecutionService so every attempt
       * is timed, logged, and included in fallback decisions.
       */
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

  /**
   * Generates one response through OpenRouter.
   *
   * @param input Provider-neutral generation input.
   * @returns Normalized provider result.
   */
  async generate(
    input: AiProviderGenerateInput,
  ): Promise<AiProviderGenerateResult> {
    const startedAt = Date.now();

    try {
      const messages = this.buildMessages(input);

      const responseFormat = this.buildResponseFormat(input);

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

          ...(responseFormat
            ? {
                response_format: responseFormat,
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
        providerKey: this.providerKey,

        apiModelId: input.apiModelId,

        text,

        requestId: completion.id,

        inputTokens: completion.usage?.prompt_tokens ?? 0,

        outputTokens: completion.usage?.completion_tokens ?? 0,

        finishReason: this.mapFinishReason(firstChoice?.finish_reason),

        providerLatencyMs: Date.now() - startedAt,
      };
    } catch (error: unknown) {
      if (error instanceof AiProviderError) {
        throw error;
      }

      throw this.normalizeError(error);
    }
  }

  /**
   * Builds OpenRouter chat messages.
   *
   * JSON mode receives an explicit JSON-only instruction when the
   * calling service did not supply a system instruction.
   */
  private buildMessages(
    input: AiProviderGenerateInput,
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

    const systemInstruction =
      input.systemInstruction?.trim() ||
      (input.responseFormat === AiResponseFormat.JSON
        ? OPENROUTER_JSON_SYSTEM_INSTRUCTION
        : undefined);

    if (systemInstruction) {
      messages.push({
        role: 'system',

        content: systemInstruction,
      });
    }

    messages.push({
      role: 'user',

      content: input.userPrompt,
    });

    return messages;
  }

  /**
   * Builds the OpenAI-compatible response_format configuration.
   *
   * json_object is used for maximum compatibility across OpenRouter
   * model families.
   *
   * The returned JSON is still validated against the complete business
   * schema by AiStructuredOutputService and AJV.
   */
  private buildResponseFormat(
    input: AiProviderGenerateInput,
  ): OpenRouterResponseFormat | undefined {
    if (input.responseFormat !== AiResponseFormat.JSON) {
      return undefined;
    }

    return {
      type: 'json_object',
    };
  }

  /**
   * Converts an OpenRouter finish reason into the application enum.
   */
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

  /**
   * Normalizes an OpenRouter or OpenAI SDK exception.
   */
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
            'OpenRouter rejected the request.',

            providerMessage,
          ),

          this.isPromptError(providerMessage)
            ? AiProviderErrorCode.INVALID_PROMPT
            : AiProviderErrorCode.INVALID_MODEL_CONFIGURATION,

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

  /**
   * Detects errors primarily caused by prompt or message content.
   */
  private isPromptError(message?: string): boolean {
    const normalizedMessage = message?.toLowerCase() ?? '';

    return [
      'prompt',
      'messages',
      'message content',
      'context length',
      'context window',
      'input too long',
      'maximum context',
    ].some((term) => normalizedMessage.includes(term));
  }

  /**
   * Detects credit and quota failures.
   */
  private indicatesInsufficientQuota(message?: string): boolean {
    const normalizedMessage = message?.toLowerCase() ?? '';

    return [
      'insufficient credits',
      'insufficient quota',
      'quota exceeded',
      'credit limit',
      'payment required',
      'free-models-per-day',
    ].some((term) => normalizedMessage.includes(term));
  }

  /**
   * Detects intentional request cancellation.
   */
  private isAbortError(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error.name === 'AbortError' ||
        error.name === 'APIUserAbortError' ||
        error.message.toLowerCase().includes('aborted'))
    );
  }

  /**
   * Returns a bounded provider error message safe for internal logs.
   */
  private readSafeProviderMessage(error: unknown): string | undefined {
    if (!(error instanceof Error)) {
      return undefined;
    }

    const normalizedMessage = error.message
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_OPENROUTER_ERROR_MESSAGE_LENGTH);

    return normalizedMessage || undefined;
  }

  /**
   * Combines a normalized application message with bounded provider
   * details.
   */
  private buildErrorMessage(
    fallback: string,
    providerMessage?: string,
  ): string {
    return providerMessage
      ? `${fallback} Provider details: ${providerMessage}`
      : fallback;
  }

  /**
   * Reads an optional string property from an unknown SDK exception.
   */
  private readStringProperty(
    value: unknown,
    property: string,
  ): string | undefined {
    if (typeof value !== 'object' || value === null) {
      return undefined;
    }

    const propertyValue = (value as Record<string, unknown>)[property];

    if (typeof propertyValue !== 'string') {
      return undefined;
    }

    const normalizedValue = propertyValue.trim();

    return normalizedValue || undefined;
  }

  /**
   * Reads an optional finite numeric property from an unknown SDK
   * exception.
   */
  private readNumericProperty(
    value: unknown,
    property: string,
  ): number | undefined {
    if (typeof value !== 'object' || value === null) {
      return undefined;
    }

    const propertyValue = (value as Record<string, unknown>)[property];

    return typeof propertyValue === 'number' && Number.isFinite(propertyValue)
      ? propertyValue
      : undefined;
  }
}
