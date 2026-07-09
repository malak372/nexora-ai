import { IdeaGenerationType } from '@prisma/client';

/**
 * Defines the reason for building an AI prompt.
 *
 * IDEA_GENERATION:
 * Used when generating a new idea for Guest, Free User, or Premium Credit.
 *
 * IDEA_UNLOCK:
 * Used when unlocking advanced details for an already generated free idea.
 *
 * @author Malak
 */
export type PromptPurpose = 'IDEA_GENERATION' | 'IDEA_UNLOCK';

/**
 * Input required to build an AI prompt.
 *
 * The Prompt Builder intentionally receives only identifiers and access metadata.
 * It reads CollectionJob, NLP analysis, and existing idea data directly from
 * the database to keep the database as the single source of truth.
 *
 * @author Malak
 */
export type PromptBuilderInput = {
  /**
   * Prompt purpose.
   */
  purpose: PromptPurpose;

  /**
   * Collection job ID containing collected data and NLP analysis.
   */
  collectionJobId: string;

  /**
   * Generation access type.
   */
  generationType: IdeaGenerationType;

  /**
   * Existing idea ID.
   *
   * Required only for IDEA_UNLOCK.
   */
  existingIdeaId?: string;
};