import {
  AiRoutingStrategy,
  ApiRequestType,
  IdeaGenerationType,
  PromptType,
} from '@prisma/client';

import { AiResponseFormat } from './ai-provider.type';

/**
 * Input required to execute one AI request.
 *
 * This contract is consumed by AiExecutionService.
 * It contains business-level information only.
 *
 * Model selection, provider selection, retries,
 * fallback execution, timeout management, and
 * structured-output validation are handled internally.
 *
 * @author Malak
 */
export type AiExecutionInput = {
  /**
   * Rendered user prompt.
   */
  readonly userPrompt: string;

  /**
   * Optional system instruction.
   */
  readonly systemInstruction?: string;

  /**
   * Type of API request being executed.
   */
  readonly requestType: ApiRequestType;

  /**
   * Prompt category for analytics and history.
   */
  readonly promptType?: PromptType;

  /**
   * Guest / Free / Premium generation.
   */
  readonly generationType?: IdeaGenerationType;

  /**
   * Expected response format.
   */
  readonly responseFormat?: AiResponseFormat;

  /**
   * Authenticated user.
   */
  readonly userId?: string;

  /**
   * Guest session.
   */
  readonly guestSessionId?: string;

  /**
   * Related idea.
   */
  readonly ideaId?: string;

  /**
   * AI routing strategy.
   */
  readonly strategy?: AiRoutingStrategy;

  /**
   * Maximum output tokens.
   */
  readonly maxOutputTokens?: number;

  /**
   * Model temperature.
   */
  readonly temperature?: number;

  /**
   * Estimated output tokens.
   *
   * Used only for cost-aware routing.
   */
  readonly estimatedOutputTokens?: number;
};
