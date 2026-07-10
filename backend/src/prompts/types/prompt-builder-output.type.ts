import { PromptType } from '@prisma/client';

import { JsonSchema } from './json-schema.type';

/**
 * Final prompt contract produced by PromptBuilderService.
 *
 * The caller is responsible for:
 * - Saving prompt history.
 * - Sending the prompt to an AI provider.
 * - Passing the response schema to the provider adapter.
 * - Validating and persisting the generated response.
 *
 * @author Malak
 */
export type PromptBuilderOutput = {
  /**
   * Prompt category used by persistence and audit logic.
   */
  readonly promptType: PromptType;

  /**
   * Final rendered prompt sent to the AI provider.
   */
  readonly promptText: string;

  /**
   * Approximate number of input tokens.
   *
   * Used for monitoring, cost estimation, and analytics.
   */
  readonly estimatedInputTokens: number;

  /**
   * SHA-256 hash of the source template.
   *
   * Identifies the template version used to generate
   * this prompt without duplicating template content.
   */
  readonly templateHash: string;

  /**
   * Stable identifier for the expected response schema.
   *
   * Example:
   * - guest_idea
   * - free_idea
   * - premium_idea
   * - idea_unlock
   */
  readonly responseSchemaName: string;

  /**
   * Provider-neutral structured-output schema describing
   * the expected AI response.
   */
  readonly responseSchema: JsonSchema;
};
