import type { AiProviderKey } from '../constants/ai-provider.constants';
import type { AiJsonSchema } from './ai-json-schema.type';

/**
 * High-level response format requested from an external AI provider.
 *
 * Provider adapters translate this provider-neutral value into the
 * equivalent SDK-specific response-format configuration.
 *
 * @author Malak
 */
export enum AiResponseFormat {
  /**
   * Requests an unstructured plain-text response.
   */
  TEXT = 'TEXT',

  /**
   * Requests a structured JSON response.
   *
   * Central parsing and schema validation must still run after the
   * provider response, even when the provider supports native
   * structured-output generation.
   */
  JSON = 'JSON',
}

/**
 * Provider-neutral reason explaining why generation stopped.
 *
 * Every AI-provider adapter must translate its SDK-specific completion
 * or finish reason into one of these values before returning the result
 * to AiExecutionService.
 *
 * @author Malak
 */
export enum AiFinishReason {
  /**
   * Generation completed normally.
   */
  STOP = 'STOP',

  /**
   * Generation stopped after reaching the configured output-token
   * limit.
   *
   * The returned text may be incomplete and should not automatically be
   * accepted as a valid structured response.
   */
  MAX_TOKENS = 'MAX_TOKENS',

  /**
   * The provider blocked or filtered the generated response because of
   * safety or content-policy restrictions.
   */
  CONTENT_FILTER = 'CONTENT_FILTER',

  /**
   * The provider attempted or completed a tool or function call.
   *
   * Nexora AI currently does not execute provider tool calls, so the
   * runtime must not treat this value as a normal textual completion.
   */
  TOOL_CALL = 'TOOL_CALL',

  /**
   * Generation ended because of an explicit provider-side error.
   */
  ERROR = 'ERROR',

  /**
   * The provider finish reason was missing or could not be mapped to a
   * known provider-neutral value.
   */
  UNKNOWN = 'UNKNOWN',
}

/**
 * Provider-neutral generation request accepted by every AI-provider
 * adapter.
 *
 * AiExecutionService constructs this object and passes it to Google,
 * OpenRouter, or any future provider implementation without depending
 * on provider-specific SDK request types.
 *
 * @author Malak
 */
export type AiProviderGenerateInput = {
  /**
   * Exact model identifier expected by the external provider.
   *
   * Examples:
   * - gemini-2.0-flash
   * - google/gemini-2.0-flash-exp:free
   */
  readonly apiModelId: string;

  /**
   * Main rendered prompt containing the operation-specific user
   * request and business context.
   */
  readonly userPrompt: string;

  /**
   * Optional system-level instruction used to define the model's role,
   * constraints, tone, and output behavior.
   *
   * Provider adapters may represent this value differently depending
   * on the capabilities of their SDK.
   */
  readonly systemInstruction?: string;

  /**
   * Maximum number of output tokens requested from the selected model.
   *
   * This value is resolved from the selected AiModel configuration
   * before provider execution.
   */
  readonly maxOutputTokens: number;

  /**
   * Optional model sampling temperature.
   *
   * Lower values generally produce more stable output, while higher
   * values allow greater variation.
   */
  readonly temperature?: number;

  /**
   * High-level response format expected from the provider.
   *
   * When omitted, provider adapters may default to plain text unless a
   * response schema requires structured output.
   */
  readonly responseFormat?: AiResponseFormat;

  /**
   * Optional provider-neutral JSON Schema describing the expected
   * structured response.
   *
   * Providers supporting native structured output may use this schema
   * when constructing their requests.
   *
   * Native provider enforcement is not considered sufficient by itself.
   * Central parsing and AJV schema validation must still run after the
   * response is received.
   */
  readonly responseSchema?: AiJsonSchema;

  /**
   * Stable application-level name assigned to responseSchema.
   *
   * Some providers require a schema name when requesting structured
   * output.
   */
  readonly responseSchemaName?: string;

  /**
   * Abort signal created by AiTimeoutService.
   *
   * Provider adapters must pass this signal to their HTTP client or SDK
   * whenever cancellation is supported.
   */
  readonly signal?: AbortSignal;
};

/**
 * Normalized result returned by one successful external AI-provider
 * request.
 *
 * Provider-specific SDK response objects must not escape through this
 * contract. Every adapter is responsible for extracting and normalizing
 * only the information required by the central AI runtime.
 *
 * @author Malak
 */
export type AiProviderGenerateResult = {
  /**
   * Stable backend registry key identifying the provider that executed
   * the request.
   *
   * This value must match the adapter's AiProvider.providerKey value.
   */
  readonly providerKey: AiProviderKey;

  /**
   * Exact provider-side model identifier used to execute the request.
   */
  readonly apiModelId: string;

  /**
   * Provider-generated textual response.
   *
   * For JSON operations, this remains the raw textual JSON response
   * until central parsing and schema validation succeed.
   */
  readonly text: string;

  /**
   * Provider-generated request identifier when exposed by the SDK or
   * response headers.
   *
   * This identifier may be persisted in ExternalApiLog to help trace
   * provider requests during debugging and monitoring.
   */
  readonly requestId?: string;

  /**
   * Number of input tokens reported by the provider.
   *
   * Provider adapters must normalize this value to zero when token
   * usage metadata is unavailable.
   *
   * A zero value means usage was not reported; it does not necessarily
   * mean that the request consumed no input tokens.
   */
  readonly inputTokens: number;

  /**
   * Number of output tokens reported by the provider.
   *
   * Provider adapters must normalize this value to zero when token
   * usage metadata is unavailable.
   *
   * A zero value means usage was not reported; it does not necessarily
   * mean that the response consumed no output tokens.
   */
  readonly outputTokens: number;

  /**
   * Provider-neutral reason describing why generation stopped.
   *
   * AiExecutionService uses this value to determine whether the
   * response can be accepted, rejected, repaired, or retried through
   * another model.
   */
  readonly finishReason: AiFinishReason;

  /**
   * Duration of this individual provider request in milliseconds.
   *
   * This value includes only the provider adapter invocation. It does
   * not include retry delays, previous model attempts, fallback
   * execution, or structured-output repair requests.
   */
  readonly providerLatencyMs: number;
};