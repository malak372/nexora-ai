import { BadRequestException, Injectable } from '@nestjs/common';

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
 * Maximum provider-message length copied into a normalized application
 * error.
 *
 * This prevents unexpectedly large SDK or provider messages from being
 * propagated into logs and error responses.
 */
const MAX_OPENROUTER_ERROR_MESSAGE_LENGTH = 500;

/**
 * Instruction appended to the system message when JSON output is
 * requested.
 *
 * OpenRouter supports several model families with different levels of
 * response-format support. An explicit natural-language instruction is
 * retained even when response_format is provided.
 */
const OPENROUTER_JSON_SYSTEM_INSTRUCTION =
  'Return exactly one valid JSON object. Do not include Markdown, code fences, explanations, or text outside the JSON object.';

/**
 * Exact response_format property accepted by the installed OpenAI Chat
 * Completions SDK.
 */
type OpenRouterResponseFormat = NonNullable<
  OpenAI.Chat.Completions.ChatCompletionCreateParams['response_format']
>;

/**
 * Minimal record shape used when safely inspecting unknown SDK errors.
 */
type UnknownRecord = Record<string, unknown>;

/**
 * OpenRouter AI-provider adapter.
 *
 * OpenRouter exposes an OpenAI-compatible Chat Completions API and
 * provides access to multiple hosted model families.
 *
 * Responsibilities:
 * - Validate provider-neutral generation input.
 * - Convert provider-neutral requests into OpenRouter requests.
 * - Build system and user chat messages.
 * - Configure JSON response mode when requested.
 * - Forward request-cancellation signals.
 * - Normalize generated text, usage metadata, and finish reasons.
 * - Convert OpenRouter and OpenAI SDK exceptions into AiProviderError.
 *
 * Model selection remains database-driven through:
 * - AiModel.providerKey
 * - AiModel.apiModelId
 *
 * SDK retries are disabled because retries, retry backoff, model
 * fallback, and provider fallback are handled centrally by
 * AiExecutionService. This ensures every external attempt is timed,
 * logged, and included in provider-health decisions.
 *
 * This adapter does not:
 * - Select database models.
 * - Retry failed requests.
 * - Enforce the total operation timeout.
 * - Validate returned JSON against the business schema.
 * - Repair malformed structured output.
 * - Calculate provider cost.
 * - Persist external API logs.
 *
 * @author Malak
 */
@Injectable()
export class OpenRouterProvider implements AiProvider {
  /**
   * Stable backend provider-registry key.
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
       * Retries are managed by AiExecutionService so every actual
       * external request remains observable and auditable.
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
   * Generates one normalized response through OpenRouter.
   *
   * @param input Provider-neutral generation request.
   * @returns Normalized provider result.
   *
   * @throws BadRequestException when required generation input is
   * invalid.
   * @throws AiProviderError when OpenRouter rejects, cancels, times out,
   * filters, or otherwise fails the request.
   */
  async generate(
    input: AiProviderGenerateInput,
  ): Promise<AiProviderGenerateResult> {
    this.validateInput(input);

    const apiModelId = input.apiModelId.trim();

    const startedAt = Date.now();

    try {
      const messages = this.buildMessages(input);

      const responseFormat = this.buildResponseFormat(input);

      const completion = await this.client.chat.completions.create(
        {
          model: apiModelId,

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

      const firstChoice = completion.choices?.[0];

      if (!firstChoice) {
        throw new AiProviderError(
          'OpenRouter returned a response without any completion choices.',
          AiProviderErrorCode.EMPTY_RESPONSE,
          true,
          502,
          this.normalizeOptionalText(completion.id),
        );
      }

      const finishReason = this.mapFinishReason(firstChoice.finish_reason);

      const text = firstChoice.message?.content?.trim();

      if (!text) {
        if (finishReason === AiFinishReason.CONTENT_FILTER) {
          throw new AiProviderError(
            'OpenRouter blocked the generated response because of content-safety policies.',
            AiProviderErrorCode.CONTENT_FILTERED,
            false,
            403,
            this.normalizeOptionalText(completion.id),
          );
        }

        throw new AiProviderError(
          'OpenRouter returned an empty textual response.',
          AiProviderErrorCode.EMPTY_RESPONSE,
          true,
          502,
          this.normalizeOptionalText(completion.id),
        );
      }

      return {
        providerKey: this.providerKey,

        apiModelId,

        text,

        requestId: this.normalizeOptionalText(completion.id),

        inputTokens: this.normalizeTokenCount(completion.usage?.prompt_tokens),

        outputTokens: this.normalizeTokenCount(
          completion.usage?.completion_tokens,
        ),

        finishReason,

        providerLatencyMs: Date.now() - startedAt,
      };
    } catch (error: unknown) {
      /*
       * Preserve provider-independent errors that were intentionally
       * created by this adapter.
       */
      if (error instanceof AiProviderError) {
        throw error;
      }

      throw this.normalizeError(error);
    }
  }

  /**
   * Builds OpenRouter chat-completion messages.
   *
   * When JSON output is requested, the JSON-only instruction is:
   * - Used as the system instruction when no caller instruction exists.
   * - Appended to the caller instruction when one already exists.
   *
   * Appending the instruction ensures JSON requirements are not lost
   * merely because the calling operation supplied its own system
   * context.
   *
   * @param input Provider-neutral generation input.
   * @returns OpenAI-compatible message list.
   */
  private buildMessages(
    input: AiProviderGenerateInput,
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

    const callerSystemInstruction = input.systemInstruction?.trim();

    const systemInstruction = this.buildSystemInstruction(
      callerSystemInstruction,
      input.responseFormat,
    );

    if (systemInstruction) {
      messages.push({
        role: 'system',
        content: systemInstruction,
      });
    }

    messages.push({
      role: 'user',
      content: input.userPrompt.trim(),
    });

    return messages;
  }

  /**
   * Builds the final system instruction for one request.
   *
   * @param callerInstruction Optional caller-supplied instruction.
   * @param responseFormat Requested response format.
   * @returns Final system instruction or undefined.
   */
  private buildSystemInstruction(
    callerInstruction: string | undefined,
    responseFormat: AiResponseFormat | undefined,
  ): string | undefined {
    if (responseFormat !== AiResponseFormat.JSON) {
      return callerInstruction;
    }

    if (!callerInstruction) {
      return OPENROUTER_JSON_SYSTEM_INSTRUCTION;
    }

    return [callerInstruction, OPENROUTER_JSON_SYSTEM_INSTRUCTION].join('\n\n');
  }

  /**
   * Builds the OpenAI-compatible response_format configuration.
   *
   * json_object is intentionally used for broad compatibility across
   * OpenRouter model families. Some OpenRouter models may not support
   * OpenAI-style json_schema structured outputs consistently.
   *
   * The returned JSON remains subject to mandatory runtime validation
   * against the complete business schema by AiStructuredOutputService.
   *
   * @param input Provider-neutral generation input.
   * @returns OpenAI-compatible response format or undefined.
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
   * Validates input required by the OpenRouter adapter.
   *
   * Runtime validation supplements TypeScript and protects the provider
   * boundary from JavaScript callers, unsafe casts, and dynamically
   * constructed objects.
   *
   * @param input Candidate generation input.
   * @throws BadRequestException when required values are invalid.
   */
  private validateInput(input: AiProviderGenerateInput): void {
    if (typeof input !== 'object' || input === null) {
      throw new BadRequestException('OpenRouter generation input is required.');
    }

    if (typeof input.apiModelId !== 'string' || !input.apiModelId.trim()) {
      throw new BadRequestException('OpenRouter apiModelId is required.');
    }

    if (typeof input.userPrompt !== 'string' || !input.userPrompt.trim()) {
      throw new BadRequestException('OpenRouter userPrompt is required.');
    }

    if (
      !Number.isSafeInteger(input.maxOutputTokens) ||
      input.maxOutputTokens <= 0
    ) {
      throw new BadRequestException(
        'OpenRouter maxOutputTokens must be a positive safe integer.',
      );
    }

    if (
      input.temperature !== undefined &&
      (!Number.isFinite(input.temperature) ||
        input.temperature < 0 ||
        input.temperature > 2)
    ) {
      throw new BadRequestException(
        'OpenRouter temperature must be a finite number between 0 and 2.',
      );
    }

    if (
      input.systemInstruction !== undefined &&
      typeof input.systemInstruction !== 'string'
    ) {
      throw new BadRequestException(
        'OpenRouter systemInstruction must be a string when provided.',
      );
    }

    if (input.signal !== undefined && !this.isAbortSignal(input.signal)) {
      throw new BadRequestException(
        'OpenRouter signal must be a valid AbortSignal when provided.',
      );
    }

    if (
      input.responseFormat === AiResponseFormat.JSON &&
      input.responseSchema !== undefined &&
      (typeof input.responseSchema !== 'object' ||
        input.responseSchema === null)
    ) {
      throw new BadRequestException(
        'OpenRouter responseSchema must be an object when provided.',
      );
    }
  }

  /**
   * Performs a structural AbortSignal check.
   *
   * instanceof AbortSignal is avoided because signals may originate
   * from another JavaScript realm.
   *
   * @param value Candidate cancellation signal.
   * @returns True when the value has AbortSignal behavior.
   */
  private isAbortSignal(value: unknown): value is AbortSignal {
    if (!this.isRecord(value)) {
      return false;
    }

    return (
      typeof value.aborted === 'boolean' &&
      typeof value.addEventListener === 'function' &&
      typeof value.removeEventListener === 'function'
    );
  }

  /**
   * Converts an OpenRouter finish reason into the provider-neutral
   * application enum.
   *
   * @param finishReason OpenRouter/OpenAI finish reason.
   * @returns Provider-neutral finish reason.
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
   * Converts an OpenRouter or OpenAI SDK exception into a normalized
   * provider-independent error.
   *
   * Classification precedence:
   * 1. Explicit timeout.
   * 2. Explicit cancellation.
   * 3. Quota and account-credit exhaustion.
   * 4. Network or transport failure.
   * 5. HTTP status mapping.
   * 6. Unknown fallback.
   *
   * @param error Unknown SDK exception.
   * @returns Normalized AiProviderError.
   */
  private normalizeError(error: unknown): AiProviderError {
    const statusCode = this.readStatusCode(error);

    const requestId = this.readRequestId(error);

    const providerMessage = this.readSafeProviderMessage(error);

    if (this.isTimeoutError(error)) {
      return new AiProviderError(
        this.buildErrorMessage(
          'OpenRouter request timed out.',
          providerMessage,
        ),
        AiProviderErrorCode.TIMEOUT,
        true,
        statusCode,
        requestId,
        error,
      );
    }

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

    if (statusCode === undefined && this.isNetworkError(error)) {
      return new AiProviderError(
        this.buildErrorMessage(
          'OpenRouter network request failed.',
          providerMessage,
        ),
        AiProviderErrorCode.NETWORK,
        true,
        undefined,
        requestId,
        error,
      );
    }

    switch (statusCode) {
      case 400:
      case 422: {
        const errorCode = this.resolveInvalidRequestCode(providerMessage);

        return new AiProviderError(
          this.buildErrorMessage(
            errorCode === AiProviderErrorCode.INVALID_PROMPT
              ? 'OpenRouter rejected the supplied prompt.'
              : 'OpenRouter rejected the configured model or generation parameters.',
            providerMessage,
          ),
          errorCode,
          false,
          statusCode,
          requestId,
          error,
        );
      }

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
          this.buildErrorMessage(
            'OpenRouter credentials do not have permission for this request.',
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
          'The configured OpenRouter model was not found.',
          AiProviderErrorCode.MODEL_NOT_FOUND,
          false,
          statusCode,
          requestId,
          error,
        );

      case 408:
      case 504:
        return new AiProviderError(
          this.buildErrorMessage(
            'OpenRouter request timed out.',
            providerMessage,
          ),
          AiProviderErrorCode.TIMEOUT,
          true,
          statusCode,
          requestId,
          error,
        );

      case 409:
      case 425:
        return new AiProviderError(
          this.buildErrorMessage(
            'OpenRouter could not process the request temporarily.',
            providerMessage,
          ),
          AiProviderErrorCode.PROVIDER_UNAVAILABLE,
          true,
          statusCode,
          requestId,
          error,
        );

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
      case 529:
        return new AiProviderError(
          this.buildErrorMessage(
            'OpenRouter is temporarily unavailable.',
            providerMessage,
          ),
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
          statusCode === undefined
            ? this.isNetworkError(error)
            : isRetryableAiProviderStatus(statusCode),
          statusCode,
          requestId,
          error,
        );
    }
  }

  /**
   * Distinguishes prompt failures from application-controlled model or
   * generation-configuration failures.
   *
   * @param message Optional provider error message.
   * @returns Normalized invalid-request error code.
   */
  private resolveInvalidRequestCode(message?: string): AiProviderErrorCode {
    if (this.isPromptError(message)) {
      return AiProviderErrorCode.INVALID_PROMPT;
    }

    return AiProviderErrorCode.INVALID_MODEL_CONFIGURATION;
  }

  /**
   * Detects failures caused primarily by prompt or message content.
   *
   * Context-window and oversized-input failures are treated as prompt
   * errors because changing the request content may resolve them without
   * changing model configuration.
   *
   * @param message Optional normalized provider message.
   * @returns True when the failure likely originates from prompt input.
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
      'too many tokens',
      'token limit exceeded',
    ].some((term) => normalizedMessage.includes(term));
  }

  /**
   * Detects credit, quota, and billing exhaustion.
   *
   * OpenRouter may represent these failures through HTTP 402, HTTP 429,
   * or provider-specific error text.
   *
   * @param message Optional normalized provider message.
   * @returns True when the account lacks usable credit or quota.
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
      'free models per day',
      'daily quota',
      'billing',
      'limit: 0',
    ].some((term) => normalizedMessage.includes(term));
  }

  /**
   * Detects explicit request timeouts.
   *
   * Timeout errors are intentionally separated from cancellation:
   * - TimeoutError represents an exceeded request duration.
   * - AbortError represents an externally cancelled request.
   *
   * @param error Unknown SDK exception.
   * @returns True when the error represents a timeout.
   */
  private isTimeoutError(error: unknown): boolean {
    if (error instanceof Error && error.name === 'TimeoutError') {
      return true;
    }

    const transportCode = this.readTransportErrorCode(error);

    return [
      'ETIMEDOUT',
      'ESOCKETTIMEDOUT',
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_HEADERS_TIMEOUT',
      'UND_ERR_BODY_TIMEOUT',
    ].includes(transportCode ?? '');
  }

  /**
   * Detects intentional request cancellation.
   *
   * Generic message matching is deliberately conservative so unrelated
   * provider messages containing the word "aborted" are not
   * misclassified.
   *
   * @param error Unknown SDK exception.
   * @returns True when the request was explicitly cancelled.
   */
  private isAbortError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    return error.name === 'AbortError' || error.name === 'APIUserAbortError';
  }

  /**
   * Detects temporary network and transport failures.
   *
   * A generic TypeError is not automatically considered a network
   * failure because TypeError may indicate an application programming
   * bug. It is accepted only when its message matches common Fetch
   * transport failures.
   *
   * @param error Unknown SDK exception.
   * @returns True when the error likely represents a network failure.
   */
  private isNetworkError(error: unknown): boolean {
    const transportCode = this.readTransportErrorCode(error);

    if (
      [
        'ECONNRESET',
        'ECONNREFUSED',
        'ENOTFOUND',
        'EAI_AGAIN',
        'EHOSTUNREACH',
        'ENETUNREACH',
        'ECONNABORTED',
        'UND_ERR_SOCKET',
      ].includes(transportCode ?? '')
    ) {
      return true;
    }

    if (error instanceof Error && error.name === 'FetchError') {
      return true;
    }

    if (error instanceof TypeError) {
      const message = error.message.toLowerCase();

      return [
        'fetch failed',
        'failed to fetch',
        'network request failed',
        'networkerror',
        'load failed',
      ].some((term) => message.includes(term));
    }

    return false;
  }

  /**
   * Reads a transport error code from an exception or its nested cause.
   *
   * @param error Unknown SDK exception.
   * @returns Normalized uppercase transport error code or undefined.
   */
  private readTransportErrorCode(error: unknown): string | undefined {
    if (!this.isRecord(error)) {
      return undefined;
    }

    const directCode = this.normalizeTransportCode(error.code);

    if (directCode) {
      return directCode;
    }

    if (!this.isRecord(error.cause)) {
      return undefined;
    }

    return this.normalizeTransportCode(error.cause.code);
  }

  /**
   * Normalizes one transport error-code value.
   *
   * Numeric HTTP status values are ignored because status mapping is
   * handled separately.
   *
   * @param value Candidate transport error code.
   * @returns Uppercase code or undefined.
   */
  private normalizeTransportCode(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const normalizedCode = value.trim().toUpperCase();

    return normalizedCode || undefined;
  }

  /**
   * Reads a valid HTTP status code from an unknown SDK exception.
   *
   * Supported locations include:
   * - error.status
   * - error.statusCode
   * - numeric error.code
   * - error.response.status
   * - error.cause.status
   *
   * Only integer HTTP status codes from 100 through 599 are accepted.
   *
   * @param error Unknown SDK exception.
   * @returns Valid HTTP status code or undefined.
   */
  private readStatusCode(error: unknown): number | undefined {
    if (!this.isRecord(error)) {
      return undefined;
    }

    const directStatus =
      this.normalizeHttpStatus(error.status) ??
      this.normalizeHttpStatus(error.statusCode) ??
      this.normalizeHttpStatus(error.code);

    if (directStatus !== undefined) {
      return directStatus;
    }

    if (this.isRecord(error.response)) {
      const responseStatus =
        this.normalizeHttpStatus(error.response.status) ??
        this.normalizeHttpStatus(error.response.statusCode);

      if (responseStatus !== undefined) {
        return responseStatus;
      }
    }

    if (this.isRecord(error.cause)) {
      return (
        this.normalizeHttpStatus(error.cause.status) ??
        this.normalizeHttpStatus(error.cause.statusCode)
      );
    }

    return undefined;
  }

  /**
   * Normalizes one candidate HTTP status value.
   *
   * Three-digit numeric strings are accepted because some transport
   * libraries expose status values as strings.
   *
   * @param value Candidate status value.
   * @returns Valid HTTP status code or undefined.
   */
  private normalizeHttpStatus(value: unknown): number | undefined {
    const numericValue =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && /^\d{3}$/.test(value.trim())
          ? Number(value.trim())
          : undefined;

    if (
      numericValue === undefined ||
      !Number.isInteger(numericValue) ||
      numericValue < 100 ||
      numericValue > 599
    ) {
      return undefined;
    }

    return numericValue;
  }

  /**
   * Reads an optional request identifier from an unknown OpenAI SDK
   * exception.
   *
   * Supported locations include:
   * - request_id
   * - requestId
   * - requestID
   * - response request-ID headers
   *
   * @param error Unknown SDK exception.
   * @returns Normalized request ID or undefined.
   */
  private readRequestId(error: unknown): string | undefined {
    if (!this.isRecord(error)) {
      return undefined;
    }

    const directRequestId =
      this.normalizeOptionalText(error.request_id) ??
      this.normalizeOptionalText(error.requestId) ??
      this.normalizeOptionalText(error.requestID);

    if (directRequestId) {
      return directRequestId;
    }

    if (!this.isRecord(error.response)) {
      return undefined;
    }

    const responseRequestId =
      this.normalizeOptionalText(error.response.request_id) ??
      this.normalizeOptionalText(error.response.requestId) ??
      this.normalizeOptionalText(error.response.requestID);

    if (responseRequestId) {
      return responseRequestId;
    }

    return this.readRequestIdFromHeaders(error.response.headers);
  }

  /**
   * Reads a request ID from Fetch Headers-like objects or plain header
   * records.
   *
   * @param headers Unknown response-header collection.
   * @returns Normalized request ID or undefined.
   */
  private readRequestIdFromHeaders(headers: unknown): string | undefined {
    if (this.isRecord(headers) && typeof headers.get === 'function') {
      const getHeader = (headers as { get: (name: string) => unknown }).get;

      return (
        this.normalizeOptionalText(getHeader.call(headers, 'x-request-id')) ??
        this.normalizeOptionalText(
          getHeader.call(headers, 'x-openrouter-request-id'),
        ) ??
        this.normalizeOptionalText(getHeader.call(headers, 'request-id'))
      );
    }

    if (!this.isRecord(headers)) {
      return undefined;
    }

    return (
      this.normalizeOptionalText(headers['x-request-id']) ??
      this.normalizeOptionalText(headers['x-openrouter-request-id']) ??
      this.normalizeOptionalText(headers['request-id'])
    );
  }

  /**
   * Returns a bounded provider error message suitable for internal
   * diagnostics.
   *
   * Supported message locations include:
   * - Error.message
   * - error.message
   * - error.error.message
   * - error.response.data.message
   * - error.response.data.error.message
   *
   * The message is whitespace-normalized and truncated before being
   * copied into AiProviderError.
   *
   * @param error Unknown SDK exception.
   * @returns Bounded provider message or undefined.
   */
  private readSafeProviderMessage(error: unknown): string | undefined {
    const candidates: unknown[] = [];

    if (error instanceof Error) {
      candidates.push(error.message);
    }

    if (this.isRecord(error)) {
      candidates.push(error.message);

      if (this.isRecord(error.error)) {
        candidates.push(error.error.message);
      }

      if (this.isRecord(error.response) && this.isRecord(error.response.data)) {
        candidates.push(error.response.data.message);

        if (this.isRecord(error.response.data.error)) {
          candidates.push(error.response.data.error.message);
        } else {
          candidates.push(error.response.data.error);
        }
      }
    }

    for (const candidate of candidates) {
      const normalizedMessage = this.normalizeOptionalText(candidate);

      if (normalizedMessage) {
        return normalizedMessage.slice(0, MAX_OPENROUTER_ERROR_MESSAGE_LENGTH);
      }
    }

    return undefined;
  }

  /**
   * Combines a stable application-owned message with bounded provider
   * details.
   *
   * Provider details are intended for controlled internal diagnostics.
   * AiProviderError serialization should avoid exposing sensitive
   * provider details directly to public clients.
   *
   * @param fallback Stable normalized application message.
   * @param providerMessage Optional bounded provider detail.
   * @returns Combined error message.
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
   * Normalizes a provider-reported token count.
   *
   * Missing, negative, fractional, or unsafe token values become zero
   * instead of propagating invalid usage metadata.
   *
   * @param value Candidate token count.
   * @returns Non-negative safe integer.
   */
  private normalizeTokenCount(value: unknown): number {
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < 0
    ) {
      return 0;
    }

    return value;
  }

  /**
   * Normalizes an optional textual value.
   *
   * Repeated whitespace is collapsed and blank values become undefined.
   *
   * @param value Candidate textual value.
   * @returns Normalized text or undefined.
   */
  private normalizeOptionalText(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const normalizedValue = value.replace(/\s+/g, ' ').trim();

    return normalizedValue || undefined;
  }

  /**
   * Determines whether an unknown value is a non-null object record.
   *
   * @param value Candidate value.
   * @returns True when the value can safely be inspected as a record.
   */
  private isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null;
  }
}