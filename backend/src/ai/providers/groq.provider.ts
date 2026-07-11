import { Injectable } from '@nestjs/common';
import { AiProviderType } from '@prisma/client';
import Groq from 'groq-sdk';

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

/**
 * Maximum safe length of a Groq provider error message.
 *
 * The logging service applies an additional persistence limit, but
 * bounding provider messages here prevents large SDK responses from
 * propagating through the application.
 */
const MAX_GROQ_ERROR_MESSAGE_LENGTH = 500;

/**
 * AI provider adapter for GroqCloud.
 *
 * Groq exposes an OpenAI-compatible Chat Completions API and provides
 * an official TypeScript SDK. This adapter translates Nexora AI's
 * provider-independent generation contract into Groq requests and
 * normalizes Groq responses before returning them to the execution
 * layer.
 *
 * Responsibilities:
 * - Resolve Groq credentials securely.
 * - Build Groq chat-completion requests.
 * - Support plain-text and JSON responses.
 * - Forward request cancellation through AbortSignal.
 * - Normalize token usage and finish reasons.
 * - Translate Groq SDK errors into AiProviderError.
 * - Preserve safe provider error details for diagnostics.
 *
 * This provider does not:
 * - Select models.
 * - Apply retries or fallback.
 * - Persist external API logs.
 * - Validate business output schemas.
 * - Calculate provider costs.
 *
 * @author Malak
 */
@Injectable()
export class GroqProvider implements AiProvider {
  private readonly client: Groq;

  constructor(credentialsService: AiProviderCredentialsService) {
    this.client = new Groq({
      apiKey: credentialsService.getApiKey(AiProviderType.GROQ),
    });
  }

  /**
   * Generates one response through Groq.
   *
   * @param input Provider-independent generation request.
   * @returns Normalized provider result.
   *
   * @throws AiProviderError When Groq rejects or fails the request.
   */
  async generate(
    input: AiProviderGenerateInput,
  ): Promise<AiProviderGenerateResult> {
    const startedAt = Date.now();

    try {
      const messages: Groq.Chat.Completions.ChatCompletionMessageParam[] = [];

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

          max_completion_tokens: input.maxOutputTokens,

          ...(input.temperature !== undefined
            ? {
                temperature: input.temperature,
              }
            : {}),

          ...(input.responseFormat === AiResponseFormat.JSON
            ? {
                response_format: {
                  type: 'json_object' as const,
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
          'Groq returned an empty response.',
          AiProviderErrorCode.EMPTY_RESPONSE,
          false,
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

  /**
   * Maps Groq completion reasons into the application-level enum.
   *
   * @param finishReason Groq finish reason.
   * @returns Normalized Nexora AI finish reason.
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
   * Converts a Groq SDK error into a normalized application error.
   *
   * Raw SDK objects, response headers, credentials, and stack traces
   * are never exposed through the normalized message.
   *
   * @param error Unknown Groq SDK or network error.
   * @returns Normalized provider error.
   */
  private normalizeError(error: unknown): AiProviderError {
    const statusCode = this.readStatusCode(error);

    const requestId = this.readRequestId(error);

    const providerCode = this.readProviderErrorCode(error);

    const providerMessage = this.readSafeProviderMessage(error);

    if (this.isAbortError(error)) {
      return new AiProviderError(
        'Groq request was cancelled.',
        AiProviderErrorCode.CANCELLED,
        false,
        statusCode,
        requestId,
        error,
      );
    }

    /**
     * Some provider responses may use status 400 or 429 when the
     * account has no remaining quota. Quota detection must happen
     * before generic status-code classification.
     */
    if (this.indicatesInsufficientQuota(providerCode, providerMessage)) {
      return new AiProviderError(
        this.buildErrorMessage(
          'Groq account quota is unavailable or exhausted.',
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
        return this.normalizeInvalidRequestError(
          error,
          statusCode,
          requestId,
          providerMessage,
        );

      case 401:
        return new AiProviderError(
          this.buildErrorMessage(
            'Groq credentials are invalid.',
            providerMessage,
          ),
          AiProviderErrorCode.INVALID_CREDENTIALS,
          false,
          statusCode,
          requestId,
          error,
        );

      case 403:
        return new AiProviderError(
          this.buildErrorMessage(
            'Groq credentials do not have permission to execute this request.',
            providerMessage,
          ),
          AiProviderErrorCode.FORBIDDEN,
          false,
          statusCode,
          requestId,
          error,
        );

      case 404:
        return new AiProviderError(
          this.buildErrorMessage(
            'The configured Groq model was not found.',
            providerMessage,
          ),
          AiProviderErrorCode.MODEL_NOT_FOUND,
          false,
          statusCode,
          requestId,
          error,
        );

      case 408:
        return new AiProviderError(
          this.buildErrorMessage('Groq request timed out.', providerMessage),
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
            'Groq rate limit was exceeded.',
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
          this.buildErrorMessage(
            'Groq is temporarily unavailable.',
            providerMessage,
          ),
          AiProviderErrorCode.PROVIDER_UNAVAILABLE,
          true,
          statusCode,
          requestId,
          error,
        );

      default:
        break;
    }

    if (this.isNetworkError(error)) {
      return new AiProviderError(
        this.buildErrorMessage(
          'A network error occurred while contacting Groq.',
          providerMessage,
        ),
        AiProviderErrorCode.NETWORK,
        true,
        statusCode,
        requestId,
        error,
      );
    }

    return new AiProviderError(
      this.buildErrorMessage(
        'An unexpected Groq provider error occurred.',
        providerMessage,
      ),
      AiProviderErrorCode.UNKNOWN,
      isRetryableAiProviderStatus(statusCode),
      statusCode,
      requestId,
      error,
    );
  }

  /**
   * Classifies HTTP 400 and 422 Groq errors.
   *
   * Model identifiers, unsupported parameters, response-format
   * settings, and token-limit errors are classified as invalid model
   * configuration. Other rejected input is classified as an invalid
   * prompt.
   *
   * @param error Original provider error.
   * @param statusCode Provider status code.
   * @param requestId Optional provider request identifier.
   * @param providerMessage Safe provider error message.
   * @returns Normalized application error.
   */
  private normalizeInvalidRequestError(
    error: unknown,
    statusCode: number,
    requestId: string | undefined,
    providerMessage: string | undefined,
  ): AiProviderError {
    const normalizedMessage = providerMessage?.toLowerCase() ?? '';

    const isModelConfigurationError = [
      'model',
      'unsupported',
      'parameter',
      'response_format',
      'response format',
      'max_tokens',
      'max_completion_tokens',
      'temperature',
      'json mode',
      'json_object',
      'context window',
      'token limit',
    ].some((indicator) => normalizedMessage.includes(indicator));

    if (isModelConfigurationError) {
      return new AiProviderError(
        this.buildErrorMessage(
          'Groq rejected the generation request or model configuration.',
          providerMessage,
        ),
        AiProviderErrorCode.INVALID_MODEL_CONFIGURATION,
        false,
        statusCode,
        requestId,
        error,
      );
    }

    return new AiProviderError(
      this.buildErrorMessage(
        'Groq rejected the generation prompt.',
        providerMessage,
      ),
      AiProviderErrorCode.INVALID_PROMPT,
      false,
      statusCode,
      requestId,
      error,
    );
  }

  /**
   * Determines whether a failure was caused by request cancellation.
   *
   * @param error Unknown provider error.
   * @returns True when the request was aborted.
   */
  private isAbortError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const normalizedMessage = error.message.toLowerCase();

    return (
      error.name === 'AbortError' ||
      normalizedMessage.includes('aborted') ||
      normalizedMessage.includes('abort error')
    );
  }

  /**
   * Determines whether an unknown error represents a transport-level
   * failure.
   *
   * @param error Unknown provider error.
   * @returns True when the error appears network-related.
   */
  private isNetworkError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const normalized = `${error.name} ${error.message}`.toLowerCase();

    return [
      'network',
      'fetch failed',
      'connection',
      'socket',
      'econnreset',
      'econnrefused',
      'enotfound',
      'etimedout',
      'dns',
    ].some((value) => normalized.includes(value));
  }

  /**
   * Determines whether the provider response indicates exhausted
   * quota or unavailable account credit.
   *
   * @param providerCode Optional provider error code.
   * @param providerMessage Optional safe provider message.
   * @returns True when the failure is quota-related.
   */
  private indicatesInsufficientQuota(
    providerCode: string | undefined,
    providerMessage: string | undefined,
  ): boolean {
    const normalizedCode = providerCode?.toLowerCase() ?? '';

    const normalizedMessage = providerMessage?.toLowerCase() ?? '';

    return [
      'insufficient_quota',
      'quota',
      'credit',
      'billing',
      'balance',
      'payment required',
    ].some(
      (indicator) =>
        normalizedCode.includes(indicator) ||
        normalizedMessage.includes(indicator),
    );
  }

  /**
   * Reads the HTTP status code from an unknown Groq SDK error.
   *
   * @param error Unknown provider error.
   * @returns Status code when available.
   */
  private readStatusCode(error: unknown): number | undefined {
    return (
      this.readNumericProperty(error, 'status') ??
      this.readNumericProperty(error, 'statusCode')
    );
  }

  /**
   * Reads the provider request identifier from common Groq SDK error
   * shapes.
   *
   * @param error Unknown provider error.
   * @returns Request identifier when available.
   */
  private readRequestId(error: unknown): string | undefined {
    const directRequestId =
      this.readStringProperty(error, 'request_id') ??
      this.readStringProperty(error, 'requestId');

    if (directRequestId) {
      return directRequestId;
    }

    const headers = this.readObjectProperty(error, 'headers');

    if (!headers) {
      return undefined;
    }

    const directHeaderRequestId =
      this.readStringProperty(headers, 'x-request-id') ??
      this.readStringProperty(headers, 'request-id');

    if (directHeaderRequestId) {
      return directHeaderRequestId;
    }

    if (!this.hasHeaderGetter(headers)) {
      return undefined;
    }

    try {
      const requestId =
        headers.get('x-request-id') ?? headers.get('request-id');

      return requestId?.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Determines whether an object exposes a typed Headers-compatible
   * getter.
   *
   * This type guard avoids invoking an untyped Function value, which
   * would otherwise produce an unsafe any result.
   *
   * @param value Unknown headers object.
   * @returns True when the object has a compatible get method.
   */
  private hasHeaderGetter(value: Record<string, unknown>): value is Record<
    string,
    unknown
  > & {
    get(name: string): string | null;
  } {
    return typeof value.get === 'function';
  }

  /**
   * Reads a provider-specific error code from supported SDK error
   * response shapes.
   *
   * Supported examples:
   * - error.error.code
   * - error.body.error.code
   *
   * @param value Unknown provider error.
   * @returns Provider error code when available.
   */
  private readProviderErrorCode(value: unknown): string | undefined {
    const directError = this.readObjectProperty(value, 'error');

    const directCode = this.readStringProperty(directError, 'code');

    if (directCode) {
      return directCode;
    }

    const body = this.readObjectProperty(value, 'body');

    const bodyError = this.readObjectProperty(body, 'error');

    return this.readStringProperty(bodyError, 'code');
  }

  /**
   * Extracts a safe provider error message from common Groq SDK error
   * response shapes.
   *
   * Supported examples:
   * - error.error.message
   * - error.body.error.message
   * - error.message
   *
   * @param error Unknown provider error.
   * @returns Safe provider error message when available.
   */
  private readSafeProviderMessage(error: unknown): string | undefined {
    const directError = this.readObjectProperty(error, 'error');

    const directMessage = this.readStringProperty(directError, 'message');

    if (directMessage) {
      return this.normalizeProviderMessage(directMessage);
    }

    const body = this.readObjectProperty(error, 'body');

    const bodyError = this.readObjectProperty(body, 'error');

    const bodyMessage = this.readStringProperty(bodyError, 'message');

    if (bodyMessage) {
      return this.normalizeProviderMessage(bodyMessage);
    }

    if (error instanceof Error && error.message.trim()) {
      return this.normalizeProviderMessage(error.message);
    }

    return undefined;
  }

  /**
   * Normalizes and limits a provider message.
   *
   * @param message Raw provider message.
   * @returns Safe normalized message.
   */
  private normalizeProviderMessage(message: string): string {
    return message
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_GROQ_ERROR_MESSAGE_LENGTH);
  }

  /**
   * Combines an application-level message with an optional safe
   * provider explanation.
   *
   * @param fallback Application-level fallback message.
   * @param providerMessage Safe provider message.
   * @returns Final normalized error message.
   */
  private buildErrorMessage(
    fallback: string,
    providerMessage?: string,
  ): string {
    if (!providerMessage) {
      return fallback;
    }

    if (fallback.toLowerCase().includes(providerMessage.toLowerCase())) {
      return fallback;
    }

    return `${fallback} Provider details: ${providerMessage}`;
  }

  /**
   * Safely reads one object property from an unknown value.
   *
   * Arrays are excluded because provider error sections are expected
   * to be key-value objects.
   *
   * @param value Unknown parent value.
   * @param property Property name.
   * @returns Object property when available.
   */
  private readObjectProperty(
    value: unknown,
    property: string,
  ): Record<string, unknown> | undefined {
    if (typeof value !== 'object' || value === null || !(property in value)) {
      return undefined;
    }

    const result = (value as Record<string, unknown>)[property];

    if (
      typeof result !== 'object' ||
      result === null ||
      Array.isArray(result)
    ) {
      return undefined;
    }

    return result as Record<string, unknown>;
  }

  /**
   * Safely reads one string property from an unknown object.
   *
   * @param value Unknown parent value.
   * @param property Property name.
   * @returns String value when available.
   */
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

  /**
   * Safely reads one numeric property from an unknown object.
   *
   * @param value Unknown parent value.
   * @param property Property name.
   * @returns Finite number when available.
   */
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
