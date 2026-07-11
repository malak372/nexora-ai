import Anthropic from '@anthropic-ai/sdk';
import { Injectable } from '@nestjs/common';
import { AiProviderType } from '@prisma/client';

import { AiProviderErrorCode } from '../errors/ai-provider-error-code.enum';
import { AiProviderError } from '../errors/ai-provider.error';
import { AiProviderCredentialsService } from '../services/ai-provider-credentials.service';
import {
  AiFinishReason,
  AiProviderGenerateInput,
  AiProviderGenerateResult,
} from '../types/ai-provider.type';

import { AiProvider } from './ai-provider.interface';

/**
 * Anthropic Messages API adapter.
 *
 * This adapter translates the application's provider-independent
 * generation contract into the Anthropic Messages API format.
 *
 * Provider-specific content blocks, finish reasons, token usage, and
 * errors are normalized before leaving this class.
 *
 * @author Malak
 */
@Injectable()
export class AnthropicProvider implements AiProvider {
  /**
   * Anthropic SDK client configured with the server-side API key.
   */
  private readonly client: Anthropic;

  constructor(
    credentialsService: AiProviderCredentialsService,
  ) {
    this.client = new Anthropic({
      apiKey: credentialsService.getApiKey(
        AiProviderType.ANTHROPIC,
      ),

      /**
       * Retries are controlled centrally by AiExecutionService.
       */
      maxRetries: 0,
    });
  }

  /**
   * Generates one response through the Anthropic Messages API.
   */
  async generate(
    input: AiProviderGenerateInput,
  ): Promise<AiProviderGenerateResult> {
    const startedAt = Date.now();

    try {
      const message =
        await this.client.messages.create(
          {
            model:
              input.apiModelId,

            max_tokens:
              input.maxOutputTokens,

            ...(input.systemInstruction && {
              system:
                input.systemInstruction,
            }),

            ...(input.temperature !== undefined && {
              temperature:
                input.temperature,
            }),

            messages: [
              {
                role: 'user',
                content:
                  input.userPrompt,
              },
            ],
          },
          {
            signal:
              input.signal,
          },
        );

      const text = message.content
        .filter(
          (
            block,
          ): block is Anthropic.Messages.TextBlock =>
            block.type === 'text',
        )
        .map((block) => block.text)
        .join('\n')
        .trim();

      if (!text) {
        if (
          message.stop_reason ===
          'refusal'
        ) {
          throw new AiProviderError(
            'Anthropic blocked the generated response because of content safety policies.',
            AiProviderErrorCode.CONTENT_FILTERED,
            false,
          );
        }

        throw new AiProviderError(
          'Anthropic returned an empty textual response.',
          AiProviderErrorCode.EMPTY_RESPONSE,
          true,
        );
      }

      return {
        text,

        requestId:
          undefined,

        inputTokens:
          message.usage.input_tokens,

        outputTokens:
          message.usage.output_tokens,

        finishReason:
          this.mapFinishReason(
            message.stop_reason,
          ),

        providerLatencyMs:
          Date.now() -
          startedAt,
      };
    } catch (error: unknown) {
      if (error instanceof AiProviderError) {
        throw error;
      }

      const statusCode =
        this.readStatusCode(error);

      const errorCode =
        this.resolveErrorCode(
          error,
          statusCode,
        );

      throw new AiProviderError(
        this.readMessage(
          error,
          'Anthropic request failed.',
        ),
        errorCode,
        this.isRetryableCode(
          errorCode,
        ),
        statusCode,
        this.readRequestId(
          error,
        ),
        error,
      );
    }
  }

  /**
   * Maps an Anthropic stop reason into the normalized application enum.
   */
  private mapFinishReason(
    stopReason:
      | Anthropic.Messages.Message['stop_reason']
      | undefined,
  ): AiFinishReason {
    switch (stopReason) {
      case 'end_turn':
      case 'stop_sequence':
        return AiFinishReason.STOP;

      case 'max_tokens':
        return AiFinishReason.MAX_TOKENS;

      case 'tool_use':
        return AiFinishReason.TOOL_CALL;

      case 'refusal':
        return AiFinishReason.CONTENT_FILTER;

      case 'pause_turn':
      case null:
      case undefined:
      default:
        return AiFinishReason.UNKNOWN;
    }
  }

  /**
   * Converts an Anthropic SDK failure into a normalized error category.
   */
  private resolveErrorCode(
    error: unknown,
    statusCode?: number,
  ): AiProviderErrorCode {
    if (this.isAbortError(error)) {
      return AiProviderErrorCode.CANCELLED;
    }

    /**
     * Anthropic may return insufficient-credit failures as HTTP 400.
     * They must be detected before generic invalid-prompt handling.
     */
    if (this.isInsufficientQuotaError(error)) {
      return AiProviderErrorCode.INSUFFICIENT_QUOTA;
    }

    if (
      statusCode === undefined &&
      this.isNetworkError(error)
    ) {
      return AiProviderErrorCode.NETWORK;
    }

    switch (statusCode) {
      case 400:
        return this.isModelConfigurationError(
          error,
        )
          ? AiProviderErrorCode
              .INVALID_MODEL_CONFIGURATION
          : AiProviderErrorCode
              .INVALID_PROMPT;

      case 401:
        return AiProviderErrorCode
          .INVALID_CREDENTIALS;

      case 403:
        return AiProviderErrorCode.FORBIDDEN;

      case 404:
        return AiProviderErrorCode
          .MODEL_NOT_FOUND;

      case 408:
        return AiProviderErrorCode.TIMEOUT;

      case 409:
        return AiProviderErrorCode
          .PROVIDER_UNAVAILABLE;

      case 429:
        return AiProviderErrorCode
          .RATE_LIMIT;

      case 529:
        return AiProviderErrorCode
          .PROVIDER_UNAVAILABLE;

      default:
        if (
          statusCode !== undefined &&
          statusCode >= 500
        ) {
          return AiProviderErrorCode
            .PROVIDER_UNAVAILABLE;
        }

        return AiProviderErrorCode.UNKNOWN;
    }
  }

  /**
   * Determines whether the same Anthropic model may be retried.
   */
  private isRetryableCode(
    code: AiProviderErrorCode,
  ): boolean {
    switch (code) {
      case AiProviderErrorCode.TIMEOUT:
      case AiProviderErrorCode.NETWORK:
      case AiProviderErrorCode.RATE_LIMIT:
      case AiProviderErrorCode
        .PROVIDER_UNAVAILABLE:
      case AiProviderErrorCode
        .EMPTY_RESPONSE:
      case AiProviderErrorCode
        .INVALID_STRUCTURED_OUTPUT:
      case AiProviderErrorCode.UNKNOWN:
        return true;

      case AiProviderErrorCode
        .INSUFFICIENT_QUOTA:
      case AiProviderErrorCode
        .INVALID_CREDENTIALS:
      case AiProviderErrorCode.FORBIDDEN:
      case AiProviderErrorCode
        .MODEL_NOT_FOUND:
      case AiProviderErrorCode
        .INVALID_MODEL_CONFIGURATION:
      case AiProviderErrorCode
        .INVALID_PROMPT:
      case AiProviderErrorCode
        .CONTENT_FILTERED:
      case AiProviderErrorCode.CANCELLED:
        return false;

      default:
        return this.assertNeverErrorCode(
          code,
        );
    }
  }

  /**
   * Detects Anthropic account-credit or quota failures.
   */
  private isInsufficientQuotaError(
    error: unknown,
  ): boolean {
    const message =
      this.readMessage(error, '')
        .toLowerCase();

    return [
      'credit balance is too low',
      'insufficient credit',
      'insufficient quota',
      'quota exceeded',
      'purchase credits',
      'plans & billing',
      'billing details',
    ].some((term) =>
      message.includes(term),
    );
  }

  /**
   * Detects likely model-specific configuration failures returned with
   * status 400.
   */
  private isModelConfigurationError(
    error: unknown,
  ): boolean {
    const message =
      this.readMessage(error, '')
        .toLowerCase();

    return [
      'model',
      'temperature',
      'max_tokens',
      'unsupported parameter',
      'unsupported model',
    ].some((term) =>
      message.includes(term),
    );
  }

  /**
   * Extracts the HTTP status code exposed by the Anthropic SDK.
   */
  private readStatusCode(
    error: unknown,
  ): number | undefined {
    if (
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      typeof error.status === 'number'
    ) {
      return error.status;
    }

    return undefined;
  }

  /**
   * Extracts the request identifier from an Anthropic SDK error.
   */
  private readRequestId(
    error: unknown,
  ): string | undefined {
    if (
      typeof error !== 'object' ||
      error === null
    ) {
      return undefined;
    }

    if (
      'request_id' in error &&
      typeof error.request_id === 'string'
    ) {
      return error.request_id;
    }

    if (
      'requestID' in error &&
      typeof error.requestID === 'string'
    ) {
      return error.requestID;
    }

    return undefined;
  }

  /**
   * Extracts a readable provider error message.
   */
  private readMessage(
    error: unknown,
    fallback: string,
  ): string {
    return error instanceof Error
      ? error.message
      : fallback;
  }

  /**
   * Determines whether an error represents cancellation.
   */
  private isAbortError(
    error: unknown,
  ): boolean {
    return (
      error instanceof Error &&
      (
        error.name === 'AbortError' ||
        error.name ===
          'APIUserAbortError'
      )
    );
  }

  /**
   * Detects Anthropic networking and transport failures.
   */
  private isNetworkError(
    error: unknown,
  ): boolean {
    if (
      typeof error !== 'object' ||
      error === null
    ) {
      return false;
    }

    if (
      'code' in error &&
      typeof error.code === 'string'
    ) {
      return [
        'ECONNRESET',
        'ETIMEDOUT',
        'ECONNREFUSED',
        'ENOTFOUND',
        'EAI_AGAIN',
        'UND_ERR_CONNECT_TIMEOUT',
      ].includes(error.code);
    }

    return (
      error instanceof Error &&
      (
        error.name ===
          'APIConnectionError' ||
        error.name ===
          'APIConnectionTimeoutError'
      )
    );
  }

  /**
   * Enforces exhaustive handling of normalized error categories.
   */
  private assertNeverErrorCode(
    value: never,
  ): never {
    throw new Error(
      `Unsupported AI provider error code: ${String(value)}.`,
    );
  }
}