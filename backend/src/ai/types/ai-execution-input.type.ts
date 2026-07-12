import {
  AiRoutingStrategy,
  ApiRequestType,
  IdeaGenerationType,
  PromptType,
} from '@prisma/client';

import type { AiJsonSchema } from './ai-json-schema.type';
import { AiResponseFormat } from './ai-provider.type';

/**
 * Input required to execute one logical AI operation.
 *
 * This contract is consumed by AiExecutionService.
 *
 * Model selection, provider selection, retries, fallback,
 * timeout management, response repair, and structured-output
 * validation are handled centrally by the AI runtime.
 *
 * Business modules remain responsible for:
 * - Building the prompt.
 * - Defining the expected response schema.
 * - Selecting the request and prompt categories.
 * - Persisting the final business result.
 *
 * @author Malak
 */
export type AiExecutionInput = {
  /**
   * Final rendered user prompt sent to the selected AI provider.
   */
  readonly userPrompt: string;

  /**
   * Optional system-level instruction.
   */
  readonly systemInstruction?: string;

  /**
   * Business category used by ExternalApiLog.
   *
   * Examples:
   * - IDEA_GENERATION
   * - NLP_ENHANCEMENT
   * - AI_CHAT
   */
  readonly requestType: ApiRequestType;

  /**
   * Prompt category used by prompt history and business flows.
   *
   * Examples:
   * - IDEA_GENERATION
   * - IDEA_UNLOCK
   * - NLP_ANALYSIS
   */
  readonly promptType?: PromptType;

  /**
   * Guest, registered-free, or premium idea tier.
   *
   * This remains useful business metadata for idea-generation
   * flows, but structured-output validation is no longer coupled
   * to this field.
   */
  readonly generationType?: IdeaGenerationType;

  /**
   * Expected high-level provider response format.
   *
   * JSON responses require responseSchema and responseSchemaName.
   */
  readonly responseFormat?: AiResponseFormat;

  /**
   * Provider-neutral JSON Schema describing the expected output.
   *
   * Required when responseFormat is JSON.
   *
   * The schema is supplied by the calling business module instead
   * of being resolved internally from PromptType. This allows the
   * central AI runtime to support any structured response.
   */
  readonly responseSchema?: AiJsonSchema;

  /**
   * Stable diagnostic identifier for responseSchema.
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
   * Optional authenticated user related to the operation.
   */
  readonly userId?: string;

  /**
   * Optional guest session related to the operation.
   *
   * This field is business metadata and is not written directly
   * to ExternalApiLog because the log model currently has no
   * guest-session relation.
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
   * Maximum number of output tokens requested from the provider.
   *
   * AiExecutionService never exceeds the selected model's
   * configured maximum.
   */
  readonly maxOutputTokens?: number;

  /**
   * Optional model sampling temperature.
   */
  readonly temperature?: number;

  /**
   * Estimated output token count used only for routing and
   * pre-request cost estimation.
   */
  readonly estimatedOutputTokens?: number;
};
