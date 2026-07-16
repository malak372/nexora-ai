import type { AiProviderKey } from '../constants/ai-provider.constants';
import type { AiJsonSchema } from './ai-json-schema.type';

/**
 * High-level response format requested from an AI provider.
 *
 * @author Malak
 */
export enum AiResponseFormat {
  /**
   * Unstructured plain-text response.
   */
  TEXT = 'TEXT',

  /**
   * Structured JSON response.
   */
  JSON = 'JSON',
}

/**
 * Provider-neutral reason explaining why generation stopped.
 *
 * Every provider adapter must convert provider-specific finish reasons
 * into this enum.
 *
 * @author Malak
 */
export enum AiFinishReason {
  /**
   * Normal successful completion.
   */
  STOP = 'STOP',

  /**
   * Generation stopped after reaching the token limit.
   */
  MAX_TOKENS = 'MAX_TOKENS',

  /**
   * The provider blocked or filtered the response.
   */
  CONTENT_FILTER = 'CONTENT_FILTER',

  /**
   * The provider attempted or completed a tool/function call.
   */
  TOOL_CALL = 'TOOL_CALL',

  /**
   * Generation ended because of an explicit provider-side error.
   */
  ERROR = 'ERROR',

  /**
   * Provider finish reason could not be mapped.
   */
  UNKNOWN = 'UNKNOWN',
}

/**
 * Provider-neutral generation request.
 *
 * AiExecutionService sends this contract to Google, OpenRouter, or any
 * future provider adapter.
 *
 * @author Malak
 */
export type AiProviderGenerateInput = {
  /**
   * Exact provider-side model identifier.
   */
  readonly apiModelId: string;

  /**
   * Main rendered user prompt.
   */
  readonly userPrompt: string;

  /**
   * Optional system-level instruction.
   */
  readonly systemInstruction?: string;

  /**
   * Maximum output-token count.
   */
  readonly maxOutputTokens: number;

  /**
   * Optional model sampling temperature.
   */
  readonly temperature?: number;

  /**
   * Expected provider response format.
   */
  readonly responseFormat?: AiResponseFormat;

  /**
   * Optional provider-neutral JSON Schema.
   *
   * Providers supporting native structured output may use this value.
   * Central AJV validation must still run after the response.
   */
  readonly responseSchema?: AiJsonSchema;

  /**
   * Stable name assigned to responseSchema.
   */
  readonly responseSchemaName?: string;

  /**
   * Abort signal created by AiTimeoutService.
   */
  readonly signal?: AbortSignal;
};

/**
 * Normalized result returned by one external provider request.
 *
 * Raw provider SDK responses must not escape through this contract.
 *
 * @author Malak
 */
export type AiProviderGenerateResult = {
  /**
   * Stable provider key that executed the request.
   */
  readonly providerKey: AiProviderKey;

  /**
   * Exact provider-side model identifier.
   */
  readonly apiModelId: string;

  /**
   * Provider-generated textual response.
   */
  readonly text: string;

  /**
   * Provider request identifier, when available.
   */
  readonly requestId?: string;

  /**
   * Provider-reported input-token count.
   */
  readonly inputTokens: number;

  /**
   * Provider-reported output-token count.
   */
  readonly outputTokens: number;

  /**
   * Normalized completion reason.
   */
  readonly finishReason: AiFinishReason;

  /**
   * Duration of this individual provider request in milliseconds.
   */
  readonly providerLatencyMs: number;
};
