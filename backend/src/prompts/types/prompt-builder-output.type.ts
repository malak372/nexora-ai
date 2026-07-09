import { PromptType } from '@prisma/client';

/**
 * Final prompt output prepared for the AI provider.
 *
 * @author Malak
 */
export type PromptBuilderOutput = {
  /**
   * Prompt type used for audit/history.
   */
  promptType: PromptType;

  /**
   * Final prompt text sent to OpenAI.
   */
  promptText: string;

  /**
   * Rough token estimation used for monitoring.
   */
  estimatedInputTokens: number;
};