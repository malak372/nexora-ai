import type {
  AiRoutingStrategy,
  ApiRequestType,
  IdeaGenerationType,
  PromptType,
} from '@prisma/client';

import type { AiJsonSchema } from './ai-json-schema.type';
import type { AiResponseFormat } from './ai-provider.type';

/**
 * Input required to execute one logical AI operation.
 *
 * This contract is consumed by AiExecutionService.
 *
 * Model selection, provider selection, retries, fallback, timeout
 * management, response repair, and structured-output validation are
 * handled centrally by the AI runtime.
 *
 * Business modules remain responsible for:
 * - Building the final prompt.
 * - Defining the expected response schema.
 * - Selecting request and prompt categories.
 * - Persisting the final business result.
 *
 * @author Malak
 */
export type AiExecutionInput = {
  /**
   * Final rendered user prompt sent to the selected provider.
   */
  readonly userPrompt: string;

  /**
   * Optional system-level instruction.
   */
  readonly systemInstruction?: string;

  /**
   * Business category stored in ExternalApiLog.
   *
   * Examples:
   * - IDEA_GENERATION
   * - NLP_ENHANCEMENT
   * - AI_CHAT
   */
  readonly requestType: ApiRequestType;

  /**
   * Optional business prompt category.
   *
   * Examples:
   * - IDEA_GENERATION
   * - IDEA_UNLOCK
   * - NLP_ANALYSIS
   */
  readonly promptType?: PromptType;

  /**
   * Optional idea-generation access level.
   *
   * Structured-output validation does not depend directly on this
   * value. The calling business module supplies the required schema.
   */
  readonly generationType?: IdeaGenerationType;

  /**
   * Requested high-level provider response format.
   *
   * JSON responses require:
   * - responseSchema
   * - responseSchemaName
   */
  readonly responseFormat?: AiResponseFormat;

  /**
   * Provider-neutral JSON Schema describing the expected response.
   *
   * Required when responseFormat is JSON.
   */
  readonly responseSchema?: AiJsonSchema;

  /**
   * Stable identifier assigned to responseSchema.
   *
   * Examples:
   * - guest_idea
   * - free_idea
   * - premium_idea
   * - idea_unlock
   * - nlp_enhancement
   *
   * Required when responseFormat is JSON.
   */
  readonly responseSchemaName?: string;

  /**
   * Optional authenticated user associated with the operation.
   */
  readonly userId?: string;

  /**
   * Optional guest session associated with the operation.
   *
   * ExternalApiLog currently does not persist guestSessionId directly.
   */
  readonly guestSessionId?: string;

  /**
   * Optional idea associated with the operation.
   */
  readonly ideaId?: string;

  /**
   * AI-model routing strategy.
   */
  readonly strategy?: AiRoutingStrategy;

  /**
   * Requested maximum output-token count.
   *
   * AiExecutionService limits this value using the selected model's
   * configured maxOutputTokens.
   */
  readonly maxOutputTokens?: number;

  /**
   * Optional model sampling temperature.
   */
  readonly temperature?: number;

  /**
   * Estimated output-token count used only for routing and
   * pre-request cost calculations.
   */
  readonly estimatedOutputTokens?: number;
};
