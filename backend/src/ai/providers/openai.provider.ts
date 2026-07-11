import { Injectable } from '@nestjs/common';
import { AiProviderType } from '@prisma/client';
import OpenAI from 'openai';

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
 * OpenAI Responses API adapter.
 *
 * This adapter translates the application's provider-independent
 * generation contract into the OpenAI Responses API request format.
 *
 * Provider-specific responses, finish reasons, token usage, and errors
 * are normalized before leaving this class.
 *
 * @author Malak
 */
@Injectable()
export class OpenAiProvider implements AiProvider {
  /**
   * OpenAI SDK client configured with the server-side API key.
   */
  private readonly client: OpenAI;

  constructor(
    credentialsService: AiProviderCredentialsService,
  ) {
    this.client = new OpenAI({
      apiKey: credentialsService.getApiKey(
        AiProviderType.OPENAI,
      ),

      /**
       * Retry execution is controlled centrally by AiExecutionService.
       *
       * This prevents SDK retries from multiplying the number of
       * externally billed provider requests.
       */
      maxRetries: 0,
    });
  }

  /**
   * Generates one response through the OpenAI Responses API.
   *
   * @param input Provider-independent generation input.
   * @returns Normalized provider generation result.
   *
   * @throws AiProviderError When OpenAI rejects the request, the
   * transport fails, or no usable response is returned.
   */
  async generate(
    input: AiProviderGenerateInput,
  ): Promise<AiProviderGenerateResult> {
    const startedAt = Date.now();

    try {
      const response =
        await this.client.responses.create(
          {
            model: input.apiModelId,

            instructions:
              input.systemInstruction,

            input:
              input.userPrompt,

            max_output_tokens:
              input.maxOutputTokens,

            ...(input.temperature !== undefined && {
              temperature:
                input.temperature,
            }),
          },
          {
            signal:
              input.signal,
          },
        );

      const text =
        response.output_text?.trim();

      if (!text) {
        const finishReason =
          this.mapFinishReason(
            response.status,
            response.incomplete_details?.reason,
          );

        if (
          finishReason ===
          AiFinishReason.CONTENT_FILTER
        ) {
          throw new AiProviderError(
            'OpenAI blocked the generated response because of content safety policies.',
            AiProviderErrorCode.CONTENT_FILTERED,
            false,
            undefined,
            this.readResponseRequestId(
              response,
            ),
          );
        }

        throw new AiProviderError(
          'OpenAI returned an empty textual response.',
          AiProviderErrorCode.EMPTY_RESPONSE,
          true,
          undefined,
          this.readResponseRequestId(
            response,
          ),
        );
      }

      return {
        text,

        requestId:
          this.readResponseRequestId(
            response,
          ),

        inputTokens:
          response.usage?.input_tokens ??
          0,

        outputTokens:
          response.usage?.output_tokens ??
          0,

        finishReason:
          this.mapFinishReason(
            response.status,
            response.incomplete_details?.reason,
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
          'OpenAI request failed.',
        ),
        errorCode,
        this.isRetryableCode(
          errorCode,
        ),
        statusCode,
        this.readErrorRequestId(
          error,
        ),
        error,
      );
    }
  }

  /**
   * Maps an OpenAI response status and incomplete reason into the
   * normalized finish-reason enum.
   */
  private mapFinishReason(
    status: string | undefined,
    incompleteReason?: string | null,
  ): AiFinishReason {
    if (status === 'completed') {
      return AiFinishReason.STOP;
    }

    if (status === 'cancelled') {
      return AiFinishReason.CANCELLED;
    }

    if (status === 'incomplete') {
      switch (incompleteReason) {
        case 'max_output_tokens':
          return AiFinishReason.MAX_TOKENS;

        case 'content_filter':
          return AiFinishReason.CONTENT_FILTER;

        default:
          return AiFinishReason.UNKNOWN;
      }
    }

    return AiFinishReason.UNKNOWN;
  }

  /**
   * Converts an OpenAI SDK failure into a provider-independent error
   * category.
   */
  private resolveErrorCode(
    error: unknown,
    statusCode?: number,
  ): AiProviderErrorCode {
    if (this.isAbortError(error)) {
      return AiProviderErrorCode.CANCELLED;
    }

    /**
     * Quota errors may use HTTP 429, but unlike a temporary rate limit,
     * retrying the same provider immediately will not resolve them.
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
   * Determines whether the same OpenAI model may be attempted again.
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
   * Detects provider-account quota or billing failures.
   *
   * These errors must not be retried using the same OpenAI account,
   * but another configured provider may still be selected.
   */
  private isInsufficientQuotaError(
    error: unknown,
  ): boolean {
    const message =
      this.readMessage(error, '')
        .toLowerCase();

    return [
      'insufficient_quota',
      'exceeded your current quota',
      'current quota',
      'check your plan and billing details',
      'billing details',
      'quota exceeded',
      'insufficient quota',
    ].some((term) =>
      message.includes(term),
    );
  }

  /**
   * Detects likely model-specific configuration failures returned with
   * HTTP 400.
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
      'max_output_tokens',
      'unsupported parameter',
      'response format',
      'response_format',
    ].some((term) =>
      message.includes(term),
    );
  }

  /**
   * Extracts an HTTP status code from an OpenAI SDK error.
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
   * Extracts a request identifier from a failed OpenAI request.
   */
  private readErrorRequestId(
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
   * Extracts the request identifier attached to a successful response.
   */
  private readResponseRequestId(
    response: unknown,
  ): string | undefined {
    if (
      typeof response === 'object' &&
      response !== null &&
      '_request_id' in response &&
      typeof response._request_id === 'string'
    ) {
      return response._request_id;
    }

    return undefined;
  }

  /**
   * Extracts a readable error message.
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
   * Determines whether an error represents request cancellation.
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
   * Detects temporary network and transport failures.
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
   * Enforces exhaustive handling of AiProviderErrorCode values.
   */
  private assertNeverErrorCode(
    value: never,
  ): never {
    throw new Error(
      `Unsupported AI provider error code: ${String(value)}.`,
    );
  }
}