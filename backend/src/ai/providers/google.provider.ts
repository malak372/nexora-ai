import { GoogleGenAI } from '@google/genai';
import { Injectable } from '@nestjs/common';
import { AiProviderType } from '@prisma/client';

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

/**
 * Google Gemini generateContent API adapter.
 *
 * This adapter translates the application's provider-independent
 * generation contract into the Google Gen AI SDK request format.
 *
 * Provider-specific responses, finish reasons, token usage, and errors
 * are normalized before leaving this class.
 *
 * @author Malak
 */
@Injectable()
export class GoogleProvider implements AiProvider {
  /**
   * Google Gen AI SDK client configured with the server-side API key.
   */
  private readonly client: GoogleGenAI;

  constructor(credentialsService: AiProviderCredentialsService) {
    this.client = new GoogleGenAI({
      apiKey: credentialsService.getApiKey(AiProviderType.GOOGLE),
    });
  }

  /**
   * Generates one response through Gemini generateContent.
   */
  async generate(
    input: AiProviderGenerateInput,
  ): Promise<AiProviderGenerateResult> {
    const startedAt = Date.now();

    try {
      const response = await this.client.models.generateContent({
        model: input.apiModelId,

        contents: input.userPrompt,

        config: {
          ...(input.systemInstruction && {
            systemInstruction: input.systemInstruction,
          }),

          maxOutputTokens: input.maxOutputTokens,

          ...(input.temperature !== undefined && {
            temperature: input.temperature,
          }),

          ...(input.responseFormat === AiResponseFormat.JSON && {
            responseMimeType: 'application/json',
          }),

          abortSignal: input.signal,
        },
      });

      const candidateFinishReason = response.candidates?.[0]?.finishReason;

      const finishReason = this.mapFinishReason(candidateFinishReason);

      const text = response.text?.trim();

      if (!text) {
        if (finishReason === AiFinishReason.CONTENT_FILTER) {
          throw new AiProviderError(
            'Google AI blocked the generated response because of content safety policies.',
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
        text,

        requestId: undefined,

        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,

        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,

        finishReason,

        providerLatencyMs: Date.now() - startedAt,
      };
    } catch (error: unknown) {
      if (error instanceof AiProviderError) {
        throw error;
      }

      const statusCode = this.readStatusCode(error);

      const errorCode = this.resolveErrorCode(error, statusCode);

      throw new AiProviderError(
        this.readMessage(error, 'Google AI request failed.'),
        errorCode,
        this.isRetryableCode(errorCode),
        statusCode,
        this.readRequestId(error),
        error,
      );
    }
  }

  /**
   * Maps a Gemini finish reason into the normalized application enum.
   */
  private mapFinishReason(finishReason: unknown): AiFinishReason {
    const normalizedReason =
      typeof finishReason === 'string' ? finishReason.toUpperCase() : '';

    switch (normalizedReason) {
      case 'STOP':
        return AiFinishReason.STOP;

      case 'MAX_TOKENS':
        return AiFinishReason.MAX_TOKENS;

      case 'SAFETY':
      case 'BLOCKLIST':
      case 'PROHIBITED_CONTENT':
      case 'SPII':
      case 'RECITATION':
      case 'IMAGE_SAFETY':
        return AiFinishReason.CONTENT_FILTER;

      case 'MALFORMED_FUNCTION_CALL':
      case 'UNEXPECTED_TOOL_CALL':
      case 'TOO_MANY_TOOL_CALLS':
        return AiFinishReason.TOOL_CALL;

      default:
        return AiFinishReason.UNKNOWN;
    }
  }

  /**
   * Converts a Google SDK failure into a normalized error category.
   */
  private resolveErrorCode(
    error: unknown,
    statusCode?: number,
  ): AiProviderErrorCode {
    if (this.isAbortError(error)) {
      return AiProviderErrorCode.CANCELLED;
    }

    if (this.isInsufficientQuotaError(error)) {
      return AiProviderErrorCode.INSUFFICIENT_QUOTA;
    }

    if (statusCode === undefined && this.isNetworkError(error)) {
      return AiProviderErrorCode.NETWORK;
    }

    switch (statusCode) {
      case 400:
        return this.isModelConfigurationError(error)
          ? AiProviderErrorCode.INVALID_MODEL_CONFIGURATION
          : AiProviderErrorCode.INVALID_PROMPT;

      case 401:
        return AiProviderErrorCode.INVALID_CREDENTIALS;

      case 403:
        return AiProviderErrorCode.FORBIDDEN;

      case 404:
        return AiProviderErrorCode.MODEL_NOT_FOUND;

      case 408:
        return AiProviderErrorCode.TIMEOUT;

      case 409:
        return AiProviderErrorCode.PROVIDER_UNAVAILABLE;

      case 429:
        return AiProviderErrorCode.RATE_LIMIT;

      default:
        if (statusCode !== undefined && statusCode >= 500) {
          return AiProviderErrorCode.PROVIDER_UNAVAILABLE;
        }

        return AiProviderErrorCode.UNKNOWN;
    }
  }

  /**
   * Determines whether the same Gemini model may be retried.
   */
  private isRetryableCode(code: AiProviderErrorCode): boolean {
    switch (code) {
      case AiProviderErrorCode.TIMEOUT:
      case AiProviderErrorCode.NETWORK:
      case AiProviderErrorCode.RATE_LIMIT:
      case AiProviderErrorCode.PROVIDER_UNAVAILABLE:
      case AiProviderErrorCode.EMPTY_RESPONSE:
      case AiProviderErrorCode.INVALID_STRUCTURED_OUTPUT:
      case AiProviderErrorCode.UNKNOWN:
        return true;

      case AiProviderErrorCode.INSUFFICIENT_QUOTA:
      case AiProviderErrorCode.INVALID_CREDENTIALS:
      case AiProviderErrorCode.FORBIDDEN:
      case AiProviderErrorCode.MODEL_NOT_FOUND:
      case AiProviderErrorCode.INVALID_MODEL_CONFIGURATION:
      case AiProviderErrorCode.INVALID_PROMPT:
      case AiProviderErrorCode.CONTENT_FILTERED:
      case AiProviderErrorCode.CANCELLED:
        return false;

      default:
        return this.assertNeverErrorCode(code);
    }
  }

  /**
   * Detects Gemini quota, billing, or resource-exhaustion failures.
   */
  private isInsufficientQuotaError(error: unknown): boolean {
    const message = this.readMessage(error, '').toLowerCase();

    return [
      'quota exceeded',
      'insufficient quota',
      'resource exhausted',
      'resource_exhausted',
      'billing',
      'free tier quota',
      'limit: 0',
    ].some((term) => message.includes(term));
  }

  /**
   * Detects likely Gemini model-configuration failures.
   */
  private isModelConfigurationError(error: unknown): boolean {
    const message = this.readMessage(error, '').toLowerCase();

    return [
      'model',
      'temperature',
      'maxoutputtokens',
      'max output tokens',
      'responsemimetype',
      'response mime type',
      'unsupported parameter',
    ].some((term) => message.includes(term));
  }

  /**
   * Extracts an HTTP-like status code from a Google SDK error.
   */
  private readStatusCode(error: unknown): number | undefined {
    if (typeof error !== 'object' || error === null) {
      return undefined;
    }

    if ('status' in error && typeof error.status === 'number') {
      return error.status;
    }

    if ('code' in error && typeof error.code === 'number') {
      return error.code;
    }

    return undefined;
  }

  /**
   * Extracts a provider request identifier when available.
   */
  private readRequestId(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null) {
      return undefined;
    }

    if ('request_id' in error && typeof error.request_id === 'string') {
      return error.request_id;
    }

    if ('requestId' in error && typeof error.requestId === 'string') {
      return error.requestId;
    }

    return undefined;
  }

  /**
   * Extracts a human-readable error message.
   */
  private readMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
  }

  /**
   * Determines whether the request was cancelled.
   */
  private isAbortError(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'TimeoutError')
    );
  }

  /**
   * Detects temporary network and connection errors.
   */
  private isNetworkError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) {
      return false;
    }

    if ('code' in error && typeof error.code === 'string') {
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
      (error.name === 'FetchError' || error.name === 'TypeError')
    );
  }

  /**
   * Enforces exhaustive handling of normalized error categories.
   */
  private assertNeverErrorCode(value: never): never {
    throw new Error(`Unsupported AI provider error code: ${String(value)}.`);
  }
}
