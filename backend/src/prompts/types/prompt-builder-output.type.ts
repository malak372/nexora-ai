import { PromptType } from '@prisma/client';

/**
 * Result returned by the Prompt Builder after constructing
 * a complete AI-ready prompt.
 *
 * The generated prompt can be sent directly to the AI provider
 * and stored in PromptHistory for auditing and analytics.
 *
 * @author Malak
 */
export type PromptBuilderOutput = {
  /**
   * Type of prompt that was generated.
   *
   * Example:
   * - IDEA_GENERATION
   * - IDEA_UNLOCK
   * - CHAT_RESPONSE
   * - NLP_ANALYSIS
   * - ABSTRACT_GENERATION
   */
  promptType: PromptType;

  /**
   * Fully constructed prompt text ready to be sent
   * to the AI model.
   */
  promptText: string;

  /**
   * Estimated number of input tokens.
   *
   * Used for:
   * - AI cost estimation
   * - request validation
   * - monitoring prompt size
   * - future token usage analytics
   */
  estimatedInputTokens: number;
};