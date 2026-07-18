import {
  GoogleGenAI,
  type GenerateContentConfig,
} from '@google/genai';

import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';

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
 * Exact responseJsonSchema type expected by the installed Google Gen AI
 * SDK.
 *
 * AiJsonSchema remains provider-neutral throughout the application.
 * Conversion into Google's SDK-specific schema type is intentionally
 * isolated inside this provider adapter.
 */
type GoogleResponseJsonSchema = NonNullable<
  GenerateContentConfig['responseJsonSchema']
>;

/**
 * Minimal object structure used when inspecting unknown SDK errors.
 */
type UnknownRecord = Record<string, unknown>;

/**
 * Google Gemini AI-provider adapter.
 *
 * Responsibilities:
 * - Validate provider-neutral generation input.
 * - Convert provider-neutral requests into Google Gen AI requests.
 * - Attach system instructions, output limits, response formats, and
 *   cancellation signals.
 * - Normalize generated text and token-usage metadata.
 * - Normalize Google finish reasons.
 * - Detect prompt-level and candidate-level content filtering.
 * - Convert Google SDK exceptions into AiProviderError.
 *
 * Model selection remains database-driven through:
 * - AiModel.providerKey
 * - AiModel.apiModelId
 *
 * This adapter does not:
 * - Select a model from the database.
 * - Retry failed requests.
 * - Perform model or provider fallback.
 * - Enforce request timeouts directly.
 * - Validate returned JSON using AJV or Zod.
 * - Repair malformed structured output.
 * - Persist external API logs.
 *
 * Timeout enforcement is owned by AiTimeoutService. The abort signal
 * received through AiProviderGenerateInput is forwarded to the Google
 * SDK so the underlying request can be cancelled when possible.
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
   *
   * The client is created once when the provider adapter is
   * instantiated and reused for subsequent generation requests.
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
   * The method converts the provider-neutral input into the Google SDK
   * request shape, executes the external request, and normalizes the
   * result into AiProviderGenerateResult.
   *
   * @param input Provider-neutral generation request.
   * @returns Normalized Google provider result.
   *
   * @throws BadRequestException when required provider input is invalid.
   * @throws AiProviderError when Google rejects, blocks, cancels, or
   * fails the external request.
   */
  async generate(
    input: AiProviderGenerateInput,
  ): Promise<AiProviderGenerateResult> {
    this.validateInput(input);

    const apiModelId = input.apiModelId.trim();
    const userPrompt = input.userPrompt.trim();

    const startedAt = Date.now();

    try {
      const config = this.buildGenerateConfig(input);

      const response =
        await this.client.models.generateContent({
          model: apiModelId,
          contents: userPrompt,
          config,
        });

      /*
       * Google may reject the prompt before producing any candidate.
       * In that case, promptFeedback.blockReason is more useful than a
       * missing candidate finish reason.
       */
      const promptBlockReason =
        this.readPromptBlockReason(
          response.promptFeedback,
        );

      if (promptBlockReason) {
        throw new AiProviderError(
          this.buildContentFilterMessage(
            promptBlockReason,
          ),
          AiProviderErrorCode.CONTENT_FILTERED,
          false,
        );
      }

      const candidate =
        response.candidates?.[0];

      const finishReason =
        this.mapFinishReason(
          candidate?.finishReason,
        );

      const text = response.text?.trim();

      if (!text) {
        if (
          finishReason ===
          AiFinishReason.CONTENT_FILTER
        ) {
          throw new AiProviderError(
            'Google AI blocked the generated response because of content-safety policies.',
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
        providerKey: this.providerKey,

        apiModelId,

        text,

        /**
         * The current generateContent response does not consistently
         * expose one provider request identifier.
         *
         * Error responses are still inspected for request IDs when
         * available.
         */
        requestId: undefined,

        inputTokens:
          this.normalizeTokenCount(
            response.usageMetadata?.promptTokenCount,
          ),

        outputTokens:
          this.normalizeTokenCount(
            response.usageMetadata
              ?.candidatesTokenCount,
          ),

        finishReason,

        providerLatencyMs:
          Date.now() - startedAt,
      };
    } catch (error: unknown) {
      /*
       * Preserve normalized provider errors created by this adapter.
       */
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
          'Google AI request failed.',
        ),
        errorCode,
        this.isRetryableCode(errorCode),
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
   * adapter boundary. Runtime structured-output validation using AJV or
   * Zod remains mandatory after Google returns the response.
   *
   * @param input Provider-neutral generation input.
   * @returns Google SDK generation configuration.
   */
  private buildGenerateConfig(
    input: AiProviderGenerateInput,
  ): GenerateContentConfig {
    const systemInstruction =
      input.systemInstruction?.trim();

    return {
      ...(systemInstruction
        ? {
            systemInstruction,
          }
        : {}),

      maxOutputTokens: input.maxOutputTokens,

      ...(input.temperature !== undefined
        ? {
            temperature: input.temperature,
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
                   * The cast is isolated inside the Google adapter so
                   * application services do not depend on Google SDK
                   * schema types.
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
            abortSignal: input.signal,
          }
        : {}),
    };
  }

  /**
   * Validates the generation input required by this adapter.
   *
   * Runtime validation supplements TypeScript and protects the adapter
   * from JavaScript callers, unsafe casts, and dynamically constructed
   * request objects.
   *
   * Provider-independent business validation may also occur before this
   * adapter is called. These checks protect the Google SDK boundary.
   *
   * @param input Candidate generation input.
   * @throws BadRequestException when a required value is invalid.
   */
  private validateInput(
    input: AiProviderGenerateInput,
  ): void {
    if (
      typeof input !== 'object' ||
      input === null
    ) {
      throw new BadRequestException(
        'Google AI generation input is required.',
      );
    }

    if (
      typeof input.apiModelId !== 'string' ||
      !input.apiModelId.trim()
    ) {
      throw new BadRequestException(
        'Google AI apiModelId is required.',
      );
    }

    if (
      typeof input.userPrompt !== 'string' ||
      !input.userPrompt.trim()
    ) {
      throw new BadRequestException(
        'Google AI userPrompt is required.',
      );
    }

    if (
      !Number.isSafeInteger(
        input.maxOutputTokens,
      ) ||
      input.maxOutputTokens <= 0
    ) {
      throw new BadRequestException(
        'Google AI maxOutputTokens must be a positive safe integer.',
      );
    }

    if (
      input.temperature !== undefined &&
      (
        !Number.isFinite(
          input.temperature,
        ) ||
        input.temperature < 0 ||
        input.temperature > 2
      )
    ) {
      throw new BadRequestException(
        'Google AI temperature must be a finite number between 0 and 2.',
      );
    }

    if (
      input.systemInstruction !== undefined &&
      typeof input.systemInstruction !==
        'string'
    ) {
      throw new BadRequestException(
        'Google AI systemInstruction must be a string when provided.',
      );
    }

    if (
      input.signal !== undefined &&
      !this.isAbortSignal(input.signal)
    ) {
      throw new BadRequestException(
        'Google AI signal must be a valid AbortSignal when provided.',
      );
    }

    if (
      input.responseFormat ===
        AiResponseFormat.JSON &&
      input.responseSchema !== undefined &&
      (
        typeof input.responseSchema !==
          'object' ||
        input.responseSchema === null
      )
    ) {
      throw new BadRequestException(
        'Google AI responseSchema must be an object when provided.',
      );
    }
  }

  /**
   * Performs a runtime structural check for AbortSignal.
   *
   * instanceof AbortSignal is intentionally avoided because AbortSignal
   * objects may originate from another JavaScript realm.
   *
   * @param value Candidate cancellation signal.
   * @returns True when the value exposes the required signal behavior.
   */
  private isAbortSignal(
    value: unknown,
  ): value is AbortSignal {
    if (
      typeof value !== 'object' ||
      value === null
    ) {
      return false;
    }

    const record =
      value as UnknownRecord;

    return (
      typeof record.aborted === 'boolean' &&
      typeof record.addEventListener ===
        'function' &&
      typeof record.removeEventListener ===
        'function'
    );
  }

  /**
   * Maps a Google candidate finish reason into the provider-neutral
   * application enum.
   *
   * Unknown or newly introduced Google reasons are intentionally mapped
   * to UNKNOWN instead of causing the request to fail.
   *
   * @param finishReason Google SDK candidate finish reason.
   * @returns Provider-neutral finish reason.
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
   * Reads a prompt-level content block reason.
   *
   * Google can block a prompt before returning any candidates. The SDK
   * may expose that reason through promptFeedback.blockReason.
   *
   * @param promptFeedback Unknown Google prompt-feedback object.
   * @returns Normalized block reason or undefined.
   */
  private readPromptBlockReason(
    promptFeedback: unknown,
  ): string | undefined {
    if (!this.isRecord(promptFeedback)) {
      return undefined;
    }

    const blockReason =
      promptFeedback.blockReason;

    if (typeof blockReason !== 'string') {
      return undefined;
    }

    const normalizedBlockReason =
      blockReason.trim();

    if (
      !normalizedBlockReason ||
      normalizedBlockReason.toUpperCase() ===
        'BLOCK_REASON_UNSPECIFIED'
    ) {
      return undefined;
    }

    return normalizedBlockReason;
  }

  /**
   * Produces a safe content-filter message from one prompt-level block
   * reason.
   *
   * The reason is normalized and bounded before being included in the
   * provider error message.
   *
   * @param blockReason Google prompt block reason.
   * @returns Safe content-filter error message.
   */
  private buildContentFilterMessage(
    blockReason: string,
  ): string {
    const safeBlockReason =
      blockReason
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 100);

    return (
      'Google AI blocked the request because of ' +
      `content-safety policies (${safeBlockReason}).`
    );
  }

  /**
   * Converts a Google SDK exception into a provider-independent error
   * category.
   *
   * Classification precedence matters:
   *
   * 1. Explicit timeout errors.
   * 2. Explicit cancellation errors.
   * 3. Quota or billing exhaustion.
   * 4. Network and transport failures.
   * 5. HTTP-like status-code mapping.
   *
   * @param error Unknown Google SDK exception.
   * @param statusCode Optional normalized HTTP status code.
   * @returns Provider-neutral error code.
   */
  private resolveErrorCode(
    error: unknown,
    statusCode?: number,
  ): AiProviderErrorCode {
    if (this.isTimeoutError(error)) {
      return AiProviderErrorCode.TIMEOUT;
    }

    if (this.isAbortError(error)) {
      return AiProviderErrorCode.CANCELLED;
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
      return AiProviderErrorCode.NETWORK;
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
        return AiProviderErrorCode.FORBIDDEN;

      case 404:
        return AiProviderErrorCode
          .MODEL_NOT_FOUND;

      case 408:
      case 504:
        return AiProviderErrorCode.TIMEOUT;

      case 409:
        return AiProviderErrorCode
          .PROVIDER_UNAVAILABLE;

      case 429:
        return AiProviderErrorCode.RATE_LIMIT;

      default:
        if (
          statusCode !== undefined &&
          statusCode >= 500 &&
          statusCode <= 599
        ) {
          return AiProviderErrorCode
            .PROVIDER_UNAVAILABLE;
        }

        return AiProviderErrorCode.UNKNOWN;
    }
  }

  /**
   * Determines whether another request may reasonably be attempted
   * using the same Google model.
   *
   * Retryability describes the error category only. AiExecutionService
   * remains responsible for enforcing retry limits, backoff, health
   * policies, and fallback behavior.
   *
   * @param code Provider-neutral error code.
   * @returns True when the failure may be temporary.
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
        return this.assertNeverErrorCode(code);
    }
  }

  /**
   * Detects quota, credit, billing, and resource-exhaustion errors.
   *
   * Google may use HTTP 429 for both temporary rate limiting and
   * exhausted account quota. Message inspection is therefore performed
   * before the generic status-code mapping.
   *
   * @param error Unknown provider exception.
   * @returns True when the error likely represents exhausted quota or
   * unavailable billing capacity.
   */
  private isInsufficientQuotaError(
    error: unknown,
  ): boolean {
    const message = this.readMessage(
      error,
      '',
    ).toLowerCase();

    return [
      'quota exceeded',
      'insufficient quota',
      'resource exhausted',
      'resource_exhausted',
      'billing account',
      'billing disabled',
      'free tier quota',
      'daily quota',
      'monthly quota',
      'limit: 0',
    ].some((term) =>
      message.includes(term),
    );
  }

  /**
   * Detects likely model or generation-parameter configuration
   * failures.
   *
   * This distinction allows malformed user prompts to be classified
   * separately from application-controlled model configuration errors.
   *
   * @param error Unknown provider exception.
   * @returns True when the message likely refers to model configuration.
   */
  private isModelConfigurationError(
    error: unknown,
  ): boolean {
    const message = this.readMessage(
      error,
      '',
    ).toLowerCase();

    return [
      'unknown model',
      'unsupported model',
      'invalid model',
      'model not supported',
      'temperature',
      'maxoutputtokens',
      'max output tokens',
      'responsemimetype',
      'response mime type',
      'responsejsonschema',
      'response json schema',
      'unsupported parameter',
      'unsupported field',
      'invalid schema',
      'schema is invalid',
    ].some((term) =>
      message.includes(term),
    );
  }

  /**
   * Reads an HTTP-like status code from an unknown Google SDK exception.
   *
   * Supported locations include:
   * - error.status
   * - error.statusCode
   * - numeric error.code
   * - error.response.status
   * - error.cause.status
   *
   * Only valid HTTP status codes from 100 through 599 are accepted.
   *
   * @param error Unknown SDK exception.
   * @returns Valid HTTP status code or undefined.
   */
  private readStatusCode(
    error: unknown,
  ): number | undefined {
    if (!this.isRecord(error)) {
      return undefined;
    }

    const directStatus =
      this.readHttpStatusValue(
        error.status,
      ) ??
      this.readHttpStatusValue(
        error.statusCode,
      ) ??
      this.readHttpStatusValue(
        error.code,
      );

    if (directStatus !== undefined) {
      return directStatus;
    }

    if (this.isRecord(error.response)) {
      const responseStatus =
        this.readHttpStatusValue(
          error.response.status,
        ) ??
        this.readHttpStatusValue(
          error.response.statusCode,
        );

      if (responseStatus !== undefined) {
        return responseStatus;
      }
    }

    if (this.isRecord(error.cause)) {
      return (
        this.readHttpStatusValue(
          error.cause.status,
        ) ??
        this.readHttpStatusValue(
          error.cause.statusCode,
        )
      );
    }

    return undefined;
  }

  /**
   * Normalizes one candidate HTTP status value.
   *
   * Numeric strings are accepted because some SDK and transport layers
   * expose response status values as strings.
   *
   * @param value Candidate status value.
   * @returns Valid HTTP status code or undefined.
   */
  private readHttpStatusValue(
    value: unknown,
  ): number | undefined {
    const numericValue =
      typeof value === 'number'
        ? value
        : typeof value === 'string' &&
            /^\d{3}$/.test(value.trim())
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
   * Reads an optional provider request identifier from an unknown SDK
   * exception.
   *
   * Supported locations include:
   * - request_id
   * - requestId
   * - response request-ID headers
   *
   * @param error Unknown SDK exception.
   * @returns Normalized request ID or undefined.
   */
  private readRequestId(
    error: unknown,
  ): string | undefined {
    if (!this.isRecord(error)) {
      return undefined;
    }

    const directRequestId =
      this.normalizeOptionalText(
        error.request_id,
      ) ??
      this.normalizeOptionalText(
        error.requestId,
      );

    if (directRequestId) {
      return directRequestId;
    }

    if (!this.isRecord(error.response)) {
      return undefined;
    }

    const responseRequestId =
      this.normalizeOptionalText(
        error.response.request_id,
      ) ??
      this.normalizeOptionalText(
        error.response.requestId,
      );

    if (responseRequestId) {
      return responseRequestId;
    }

    return this.readRequestIdFromHeaders(
      error.response.headers,
    );
  }

  /**
   * Reads a provider request ID from response headers.
   *
   * Both Fetch Headers-like objects and plain header records are
   * supported.
   *
   * @param headers Unknown response-header collection.
   * @returns Request ID header value or undefined.
   */
  private readRequestIdFromHeaders(
    headers: unknown,
  ): string | undefined {
    if (
      typeof headers === 'object' &&
      headers !== null &&
      'get' in headers &&
      typeof (
        headers as {
          get?: unknown;
        }
      ).get === 'function'
    ) {
      const getHeader =
        (
          headers as {
            get: (
              name: string,
            ) => unknown;
          }
        ).get.bind(headers);

      return (
        this.normalizeOptionalText(
          getHeader('x-request-id'),
        ) ??
        this.normalizeOptionalText(
          getHeader('x-goog-request-id'),
        ) ??
        this.normalizeOptionalText(
          getHeader('request-id'),
        )
      );
    }

    if (!this.isRecord(headers)) {
      return undefined;
    }

    return (
      this.normalizeOptionalText(
        headers['x-request-id'],
      ) ??
      this.normalizeOptionalText(
        headers['x-goog-request-id'],
      ) ??
      this.normalizeOptionalText(
        headers['request-id'],
      )
    );
  }

  /**
   * Reads a human-readable provider error message.
   *
   * Supported values include:
   * - Error.message
   * - A direct string error.
   * - An object-level message.
   * - A nested response-data message.
   *
   * @param error Unknown provider error.
   * @param fallback Message returned when no safe message is available.
   * @returns Normalized provider message.
   */
  private readMessage(
    error: unknown,
    fallback: string,
  ): string {
    if (error instanceof Error) {
      const normalizedMessage =
        error.message
          .replace(/\s+/g, ' ')
          .trim();

      if (normalizedMessage) {
        return normalizedMessage;
      }
    }

    if (typeof error === 'string') {
      const normalizedMessage =
        error.replace(/\s+/g, ' ').trim();

      if (normalizedMessage) {
        return normalizedMessage;
      }
    }

    if (this.isRecord(error)) {
      const directMessage =
        this.normalizeOptionalText(
          error.message,
        );

      if (directMessage) {
        return directMessage;
      }

      if (
        this.isRecord(error.response) &&
        this.isRecord(
          error.response.data,
        )
      ) {
        const responseMessage =
          this.normalizeOptionalText(
            error.response.data.message,
          ) ??
          this.normalizeOptionalText(
            error.response.data.error,
          );

        if (responseMessage) {
          return responseMessage;
        }
      }
    }

    return fallback;
  }

  /**
   * Detects explicit provider or transport timeout failures.
   *
   * TimeoutError is intentionally separated from AbortError:
   * - TimeoutError represents an exceeded duration.
   * - AbortError represents external cancellation.
   *
   * Known timeout transport codes are also recognized.
   *
   * @param error Unknown provider exception.
   * @returns True when the error represents a timeout.
   */
  private isTimeoutError(
    error: unknown,
  ): boolean {
    if (
      error instanceof Error &&
      error.name === 'TimeoutError'
    ) {
      return true;
    }

    const transportCode =
      this.readTransportErrorCode(error);

    return [
      'ETIMEDOUT',
      'ESOCKETTIMEDOUT',
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_HEADERS_TIMEOUT',
      'UND_ERR_BODY_TIMEOUT',
    ].includes(transportCode ?? '');
  }

  /**
   * Detects explicit request cancellation.
   *
   * AiTimeoutService converts its own timeout race into
   * AiProviderErrorCode.TIMEOUT. A raw AbortError that reaches this
   * adapter therefore represents a non-timeout cancellation unless the
   * surrounding timeout service replaces it.
   *
   * @param error Unknown provider exception.
   * @returns True when the request was cancelled.
   */
  private isAbortError(
    error: unknown,
  ): boolean {
    return (
      error instanceof Error &&
      error.name === 'AbortError'
    );
  }

  /**
   * Detects temporary network and transport failures.
   *
   * Error codes are inspected on both the root error and its cause.
   *
   * A generic TypeError is not automatically classified as a network
   * failure because TypeError may also indicate an adapter programming
   * mistake. TypeError is considered a network failure only when its
   * message matches common Fetch transport failures.
   *
   * @param error Unknown provider exception.
   * @returns True when the error likely represents a network failure.
   */
  private isNetworkError(
    error: unknown,
  ): boolean {
    const transportCode =
      this.readTransportErrorCode(error);

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

    if (
      error instanceof Error &&
      error.name === 'FetchError'
    ) {
      return true;
    }

    if (
      error instanceof TypeError
    ) {
      const message =
        error.message.toLowerCase();

      return [
        'fetch failed',
        'failed to fetch',
        'network request failed',
        'networkerror',
        'load failed',
      ].some((term) =>
        message.includes(term),
      );
    }

    return false;
  }

  /**
   * Reads a transport error code from an exception or its nested cause.
   *
   * @param error Unknown provider exception.
   * @returns Normalized uppercase transport code or undefined.
   */
  private readTransportErrorCode(
    error: unknown,
  ): string | undefined {
    if (!this.isRecord(error)) {
      return undefined;
    }

    const directCode =
      this.normalizeTransportCode(
        error.code,
      );

    if (directCode) {
      return directCode;
    }

    if (!this.isRecord(error.cause)) {
      return undefined;
    }

    return this.normalizeTransportCode(
      error.cause.code,
    );
  }

  /**
   * Normalizes one transport error-code value.
   *
   * Numeric HTTP status codes are intentionally ignored because they
   * are handled separately by readStatusCode().
   *
   * @param value Candidate transport code.
   * @returns Uppercase transport code or undefined.
   */
  private normalizeTransportCode(
    value: unknown,
  ): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const normalizedCode =
      value.trim().toUpperCase();

    return normalizedCode || undefined;
  }

  /**
   * Normalizes a provider-reported token count.
   *
   * Missing, negative, fractional, or unsafe token counts become zero
   * rather than being persisted as invalid usage metadata.
   *
   * @param value Candidate token count.
   * @returns Non-negative safe integer.
   */
  private normalizeTokenCount(
    value: unknown,
  ): number {
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
   * Normalizes an unknown optional text value.
   *
   * Repeated whitespace is collapsed to keep provider error metadata
   * compact and safe for logging.
   *
   * @param value Candidate textual value.
   * @returns Normalized non-empty text or undefined.
   */
  private normalizeOptionalText(
    value: unknown,
  ): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const normalizedValue =
      value.replace(/\s+/g, ' ').trim();

    return normalizedValue || undefined;
  }

  /**
   * Determines whether an unknown value is a non-null object record.
   *
   * @param value Candidate value.
   * @returns True when the value can safely be inspected as a record.
   */
  private isRecord(
    value: unknown,
  ): value is UnknownRecord {
    return (
      typeof value === 'object' &&
      value !== null
    );
  }

  /**
   * Enforces exhaustive AiProviderErrorCode handling.
   *
   * Adding a new enum member causes a TypeScript error until its
   * retryability is explicitly classified.
   *
   * @param value Unhandled provider error code.
   */
  private assertNeverErrorCode(
    value: never,
  ): never {
    throw new Error(
      `Unsupported AI provider error code: ${String(value)}.`,
    );
  }
}