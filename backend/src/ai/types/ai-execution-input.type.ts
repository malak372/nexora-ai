import type {
  AiRoutingStrategy,
  ApiRequestType,
  IdeaGenerationType,
  PromptType,
} from '@prisma/client';

import type { AiJsonSchema } from './ai-json-schema.type';
import { AiResponseFormat } from './ai-provider.type';

/**
 * Common input fields shared by every logical AI operation.
 *
 * These fields describe:
 * - The prompt submitted by the calling business module.
 * - The operation category used for monitoring and logging.
 * - The owner or business entity associated with the operation.
 * - The routing and generation configuration.
 *
 * Response-format-specific fields are defined separately to ensure that
 * JSON operations always provide a schema and schema name.
 *
 * @author Malak
 */
type AiExecutionBaseInput = {
  /**
   * Final rendered user prompt submitted to the selected AI provider.
   *
   * Prompt rendering and placeholder replacement must be completed by
   * the calling business module before invoking AiExecutionService.
   */
  readonly userPrompt: string;

  /**
   * Optional system-level instruction used to define the model's role,
   * behavior, tone, and global constraints.
   */
  readonly systemInstruction?: string;

  /**
   * Business operation category persisted in ExternalApiLog.
   *
   * Examples:
   * - IDEA_GENERATION
   * - NLP_ENHANCEMENT
   * - AI_CHAT
   */
  readonly requestType: ApiRequestType;

  /**
   * Optional prompt category associated with the operation.
   *
   * This value describes why the prompt was built and may be used by
   * prompt-history or business workflow services.
   *
   * Examples:
   * - IDEA_GENERATION
   * - IDEA_UNLOCK
   * - NLP_ANALYSIS
   * - CHAT_RESPONSE
   */
  readonly promptType?: PromptType;

  /**
   * Optional idea-generation entitlement or access level.
   *
   * This value identifies whether an idea is being generated for:
   * - A guest.
   * - A registered user using a free generation.
   * - A premium user consuming a credit.
   *
   * Structured-output validation does not derive its schema directly
   * from this value. The calling business module remains responsible for
   * supplying the correct response schema.
   */
  readonly generationType?: IdeaGenerationType;

  /**
   * Optional authenticated user associated with the logical operation.
   *
   * This identifier may be persisted in ExternalApiLog and used for
   * monitoring, authorization-aware tracing, and usage analytics.
   */
  readonly userId?: string;

  /**
   * Optional guest session associated with the logical operation.
   *
   * ExternalApiLog currently does not persist guestSessionId directly,
   * but the value may still be used by the surrounding generation
   * workflow for tracing and ownership validation.
   */
  readonly guestSessionId?: string;

  /**
   * Optional idea associated with the logical operation.
   *
   * This identifier may be persisted in ExternalApiLog and links the AI
   * request to its related generated idea.
   */
  readonly ideaId?: string;

  /**
   * Optional AI-model routing strategy.
   *
   * When omitted, AiExecutionService uses the configured default routing
   * strategy.
   */
  readonly strategy?: AiRoutingStrategy;

  /**
   * Requested maximum output-token count.
   *
   * AiExecutionService must bound this value using the selected model's
   * configured maxOutputTokens before invoking the provider.
   */
  readonly maxOutputTokens?: number;

  /**
   * Optional model sampling temperature.
   *
   * AiExecutionService or the provider adapter must validate this value
   * against the supported runtime range before sending the request.
   */
  readonly temperature?: number;

  /**
   * Estimated number of output tokens expected from the operation.
   *
   * This value is used only before provider execution for:
   * - Cost-aware model routing.
   * - Preliminary cost estimation.
   *
   * It does not limit the actual provider response.
   */
  readonly estimatedOutputTokens?: number;
};

/**
 * Response-format configuration for plain-text AI operations.
 *
 * Plain-text operations do not accept a JSON Schema because no central
 * structured-output validation is required.
 */
type AiTextExecutionFormat = {
  /**
   * Requests a plain-text response.
   *
   * When omitted, the execution runtime treats the operation as a
   * plain-text request.
   */
  readonly responseFormat?: AiResponseFormat.TEXT;

  /**
   * JSON Schema is not permitted for plain-text operations.
   */
  readonly responseSchema?: never;

  /**
   * Schema name is not permitted for plain-text operations.
   */
  readonly responseSchemaName?: never;
};

/**
 * Response-format configuration for structured JSON AI operations.
 *
 * Both responseSchema and responseSchemaName are mandatory whenever
 * JSON output is requested.
 */
type AiJsonExecutionFormat = {
  /**
   * Requests a structured JSON response.
   */
  readonly responseFormat: AiResponseFormat.JSON;

  /**
   * Provider-neutral JSON Schema describing the required response.
   *
   * Providers supporting native structured output may use this schema
   * when constructing their requests.
   *
   * Central parsing and AJV validation must still run after receiving
   * the provider response.
   */
  readonly responseSchema: AiJsonSchema;

  /**
   * Stable application-level name assigned to responseSchema.
   *
   * Examples:
   * - guest_idea
   * - free_idea
   * - premium_idea
   * - idea_unlock
   * - nlp_enhancement
   *
   * Some providers require this name when requesting native structured
   * output.
   */
  readonly responseSchemaName: string;
};

/**
 * Input required to execute one complete logical AI operation.
 *
 * This contract is consumed by AiExecutionService.
 *
 * AiExecutionService is responsible for:
 * - Selecting an eligible model.
 * - Resolving the provider adapter.
 * - Applying routing strategy.
 * - Enforcing timeouts.
 * - Retrying temporary failures.
 * - Falling back to another model.
 * - Repairing invalid structured output.
 * - Parsing and validating JSON responses.
 * - Recording external API execution logs.
 *
 * Calling business modules remain responsible for:
 * - Building the final rendered prompt.
 * - Selecting the request and prompt categories.
 * - Defining the expected JSON Schema.
 * - Associating the request with its user, guest, or idea.
 * - Persisting the final business result.
 *
 * The response-format union guarantees that:
 * - JSON operations provide both a schema and schema name.
 * - Plain-text operations cannot accidentally provide JSON metadata.
 *
 * @author Malak
 */
export type AiExecutionInput = AiExecutionBaseInput &
  (AiTextExecutionFormat | AiJsonExecutionFormat);
