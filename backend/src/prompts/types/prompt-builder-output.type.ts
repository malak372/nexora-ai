import { PromptType } from '@prisma/client';

/**
 * Final prompt produced by PromptBuilderService.
 *
 * This object is returned to the caller (typically IdeasService),
 * which is responsible for:
 * - Saving prompt history.
 * - Sending the prompt to the AI provider.
 * - Persisting the generated AI response.
 *
 * @author Malak
 */
export type PromptBuilderOutput = {
  /**
   * Prompt category used for auditing and prompt history.
   */
  readonly promptType: PromptType;

  /**
   * Final rendered prompt that will be sent to the AI provider.
   */
  readonly promptText: string;

  /**
   * Approximate number of input tokens.
   *
   * Used for:
   * - Monitoring
   * - Cost estimation
   * - AI analytics
   */
  readonly estimatedInputTokens: number;

  /**
   * SHA-256 hash of the template used to build this prompt.
   *
   * Allows tracking which template version generated
   * a specific AI response without storing duplicate templates.
   */
  readonly templateHash: string;
};