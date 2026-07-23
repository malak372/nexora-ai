import { PromptType } from '@prisma/client';

/**
 * Parameters required to persist one rendered prompt
 * in PromptHistory.
 *
 * A prompt may belong to:
 * - A registered user.
 * - A guest session.
 *
 * The related idea may not exist yet when the prompt is first saved.
 * In that case, PromptHistoryService.attachIdea() can associate the
 * history record with the generated idea after successful generation.
 *
 * @author Malak
 */
export type SavePromptParams = {
  /**
   * Registered user who requested the prompt.
   *
   * Undefined for guest generation.
   */
  readonly userId?: string | null;

  /**
   * Guest session that requested the prompt.
   *
   * Undefined for authenticated-user generation.
   */
  readonly guestSessionId?: string | null;

  /**
   * Idea-generation run that owns this prompt.
   *
   * This value is required for IDEA_GENERATION prompts so the
   * persistence stage can verify that the saved prompt belongs to
   * the same pipeline run that is creating the Idea.
   */
  readonly generationRunId?: string | null;

  /**
   * Collection job supplying the persisted NLP analysis.
   */
  readonly collectionJobId?: string | null;

  /**
   * Related idea identifier.
   *
   * This may be omitted when the prompt is saved before the Idea
   * record is created.
   */
  readonly ideaId?: string | null;

  /**
   * Prompt category used for filtering, monitoring, and auditing.
   */
  readonly promptType: PromptType;

  /**
   * Final rendered prompt prepared for the AI provider.
   */
  readonly promptText: string;

  /**
   * SHA-256 hash identifying the source prompt-template version.
   */
  readonly templateHash?: string | null;

  /**
   * Approximate number of input tokens.
   *
   * Exact usage should later be recorded from the AI provider
   * inside ExternalApiLog.
   */
  readonly estimatedInputTokens?: number | null;
};
