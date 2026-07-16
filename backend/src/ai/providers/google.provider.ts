import {
  GoogleGenAI,
  type GenerateContentConfig,
} from '@google/genai';

import { Injectable } from '@nestjs/common';

import {
  AI_PROVIDER_KEYS,
  type AiProviderKey,
} from '../constants/ai-provider.constants';

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
 * Exact responseJsonSchema type expected by the installed Google
 * Gen AI SDK.
 *
 * AiJsonSchema remains provider-neutral throughout the application.
 * Conversion into Google's SDK-specific type is restricted to this
 * provider adapter.
 */
type GoogleResponseJsonSchema = NonNullable<
  GenerateContentConfig['responseJsonSchema']
>;

/**
 * Google Gemini AI-provider adapter.
 *
 * Responsibilities:
 * - Convert provider-neutral requests into Google Gen AI requests.
 * - Normalize generated text, usage metadata, and finish reasons.
 * - Convert provider-specific exceptions into AiProviderError.
 *
 * Model selection remains database-driven through:
 * - AiModel.providerKey
 * - AiModel.apiModelId
 *
 * @author Malak
 */
@Injectable()
export class GoogleProvider implements AiProvider {
  /**
   * Stable backend provider-registry key.
   */
  readonly providerKey: AiProviderKey =
    AI_PROVIDER_KEYS.GOOGLE;

  /**
   * Google Gen AI SDK client.
   */
  private readonly client: GoogleGenAI;

  constructor(
    credentialsService: AiProviderCredentialsService,
  ) {
    this.client = new GoogleGenAI({
      apiKey: credentialsService.getApiKey(
        this.providerKey,
      ),
    });
  }

  /**
   * Generates one response through Google Gemini.
   *
   * @param input Provider-neutral generation request.
   * @returns Normalized provider result.
   */
  async generate(
    input: AiProviderGenerateInput,
  ): Promise<AiProviderGenerateResult> {
    const startedAt = Date.now();

    try {
      const config =
        this.buildGenerateConfig(input);

      const response =
        await this.client.models.generateContent({
          model: input.apiModelId,

          contents: input.userPrompt,

          config,
        });

      const finishReason =
        this.mapFinishReason(
          response.candidates?.[0]
            ?.finishReason,
        );

      const text =
        response.text?.trim();

      if (!text) {
        if (
          finishReason ===
          AiFinishReason.CONTENT_FILTER
        ) {
          throw new AiProviderError(
            'Google AI blocked the response because of content-safety policies.',

            AiProviderErrorCode.CONTENT_FILTERED,

            false,
          );
        }

        throw new AiProviderError(
          'Google AI returned an empty textual response.',

          AiProviderErrorCode.EMPTY_RESPONSE,

          true,
        );
      }

      return {
        providerKey:
          this.providerKey,

        apiModelId:
          input.apiModelId,

        text,

        /**
         * The current generateContent SDK response does not expose a
         * consistent provider request identifier.
         */
        requestId:
          undefined,

        inputTokens:
          response.usageMetadata
            ?.promptTokenCount ??
          0,

        outputTokens:
          response.usageMetadata
            ?.candidatesTokenCount ??
          0,

        finishReason,

        providerLatencyMs:
          Date.now() - startedAt,
      };
    } catch (error: unknown) {
      if (
        error instanceof AiProviderError
      ) {
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
          'Google AI request failed.',
        ),

        errorCode,

        this.isRetryableCode(
          errorCode,
        ),

        statusCode,

        this.readRequestId(error),

        error,
      );
    }
  }

  /**
   * Builds the Google-specific generation configuration.
   *
   * Provider-neutral JSON Schema conversion happens only at this
   * boundary. Runtime AJV validation remains mandatory after the
   * provider returns its response.
   */
  private buildGenerateConfig(
    input: AiProviderGenerateInput,
  ): GenerateContentConfig {
    return {
      ...(input.systemInstruction?.trim()
        ? {
            systemInstruction:
              input.systemInstruction.trim(),
          }
        : {}),

      maxOutputTokens:
        input.maxOutputTokens,

      ...(input.temperature !== undefined
        ? {
            temperature:
              input.temperature,
          }
        : {}),

      ...(input.responseFormat ===
      AiResponseFormat.JSON
        ? {
            responseMimeType:
              'application/json',

            ...(input.responseSchema
              ? {
                  /**
                   * AiJsonSchema is intentionally provider-neutral.
                   *
                   * This cast is isolated inside the Google adapter so
                   * the rest of the application does not depend on
                   * Google SDK schema types.
                   */
                  responseJsonSchema:
                    input.responseSchema as
                      GoogleResponseJsonSchema,
                }
              : {}),
          }
        : {}),

      ...(input.signal
        ? {
            abortSignal:
              input.signal,
          }
        : {}),
    };
  }

  /**
   * Maps a Google finish reason into the provider-neutral application
   * enum.
   */
  private mapFinishReason(
    finishReason: unknown,
  ): AiFinishReason {
    const normalizedReason =
      typeof finishReason === 'string'
        ? finishReason
            .trim()
            .toUpperCase()
        : '';

    switch (normalizedReason) {
      case 'STOP':
        return AiFinishReason.STOP;

      case 'MAX_TOKENS':
        return AiFinishReason
          .MAX_TOKENS;

      case 'SAFETY':
      case 'BLOCKLIST':
      case 'PROHIBITED_CONTENT':
      case 'SPII':
      case 'RECITATION':
      case 'IMAGE_SAFETY':
        return AiFinishReason
          .CONTENT_FILTER;

      case 'MALFORMED_FUNCTION_CALL':
      case 'UNEXPECTED_TOOL_CALL':
      case 'TOO_MANY_TOOL_CALLS':
        return AiFinishReason
          .TOOL_CALL;

      default:
        return AiFinishReason
          .UNKNOWN;
    }
  }

  /**
   * Converts a Google SDK exception into a provider-independent error
   * category.
   */
  private resolveErrorCode(
    error: unknown,
    statusCode?: number,
  ): AiProviderErrorCode {
    if (this.isAbortError(error)) {
      return AiProviderErrorCode
        .CANCELLED;
    }

    if (
      this.isInsufficientQuotaError(
        error,
      )
    ) {
      return AiProviderErrorCode
        .INSUFFICIENT_QUOTA;
    }

    if (
      statusCode === undefined &&
      this.isNetworkError(error)
    ) {
      return AiProviderErrorCode
        .NETWORK;
    }

    switch (statusCode) {
      case 400:
      case 422:
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
        return AiProviderErrorCode
          .FORBIDDEN;

      case 404:
        return AiProviderErrorCode
          .MODEL_NOT_FOUND;

      case 408:
        return AiProviderErrorCode
          .TIMEOUT;

      case 409:
        return AiProviderErrorCode
          .PROVIDER_UNAVAILABLE;

      case 429:
        return AiProviderErrorCode
          .RATE_LIMIT;

      default:
        if (
          statusCode !== undefined &&
          statusCode >= 500 &&
          statusCode <= 599
        ) {
          return AiProviderErrorCode
            .PROVIDER_UNAVAILABLE;
        }

        return AiProviderErrorCode
          .UNKNOWN;
    }
  }

  /**
   * Determines whether another request may be made using the same
   * Google model.
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
      case AiProviderErrorCode
        .CANCELLED:
        return false;

      default:
        return this.assertNeverErrorCode(
          code,
        );
    }
  }

  /**
   * Detects quota, credit, billing, and resource-exhaustion errors.
   */
  private isInsufficientQuotaError(
    error: unknown,
  ): boolean {
    const message =
      this.readMessage(
        error,
        '',
      ).toLowerCase();

    return [
      'quota exceeded',
      'insufficient quota',
      'resource exhausted',
      'resource_exhausted',
      'billing',
      'free tier quota',
      'limit: 0',
    ].some((term) =>
      message.includes(term),
    );
  }

  /**
   * Detects likely model or generation-parameter configuration
   * failures.
   */
  private isModelConfigurationError(
    error: unknown,
  ): boolean {
    const message =
      this.readMessage(
        error,
        '',
      ).toLowerCase();

    return [
      'model',
      'temperature',
      'maxoutputtokens',
      'max output tokens',
      'responsemimetype',
      'response mime type',
      'responsejsonschema',
      'response json schema',
      'unsupported parameter',
      'schema',
    ].some((term) =>
      message.includes(term),
    );
  }

  /**
   * Reads an HTTP-like status code from an unknown SDK exception.
   */
  private readStatusCode(
    error: unknown,
  ): number | undefined {
    if (
      typeof error !== 'object' ||
      error === null
    ) {
      return undefined;
    }

    const record =
      error as Record<
        string,
        unknown
      >;

    if (
      typeof record.status === 'number' &&
      Number.isFinite(
        record.status,
      )
    ) {
      return record.status;
    }

    if (
      typeof record.code === 'number' &&
      Number.isFinite(
        record.code,
      )
    ) {
      return record.code;
    }

    return undefined;
  }

  /**
   * Reads an optional provider request identifier.
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

    const record =
      error as Record<
        string,
        unknown
      >;

    const requestId =
      record.request_id ??
      record.requestId;

    if (
      typeof requestId !== 'string'
    ) {
      return undefined;
    }

    const normalizedRequestId =
      requestId.trim();

    return normalizedRequestId ||
      undefined;
  }

  /**
   * Reads a human-readable provider error message.
   */
  private readMessage(
    error: unknown,
    fallback: string,
  ): string {
    if (error instanceof Error) {
      const normalizedMessage =
        error.message.trim();

      if (normalizedMessage) {
        return normalizedMessage;
      }
    }

    return fallback;
  }

  /**
   * Detects request cancellation.
   *
   * AiTimeoutService distinguishes an application timeout from other
   * cancellation reasons.
   */
  private isAbortError(
    error: unknown,
  ): boolean {
    return (
      error instanceof Error &&
      (
        error.name ===
          'AbortError' ||
        error.name ===
          'TimeoutError'
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

    const record =
      error as Record<
        string,
        unknown
      >;

    if (
      typeof record.code === 'string'
    ) {
      return [
        'ECONNRESET',
        'ETIMEDOUT',
        'ECONNREFUSED',
        'ENOTFOUND',
        'EAI_AGAIN',
        'UND_ERR_CONNECT_TIMEOUT',
      ].includes(record.code);
    }

    return (
      error instanceof Error &&
      (
        error.name ===
          'FetchError' ||
        error.name ===
          'TypeError'
      )
    );
  }

  /**
   * Enforces exhaustive AiProviderErrorCode handling.
   */
  private assertNeverErrorCode(
    value: never,
  ): never {
    throw new Error(
      `Unsupported AI provider error code: ${String(value)}.`,
    );
  }
}