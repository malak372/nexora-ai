import { IdeaGenerationType } from '@prisma/client';

/**
 * Defines why the system is building an AI prompt.
 *
 * @author Malak
 */
export type PromptPurpose = 'IDEA_GENERATION' | 'IDEA_UNLOCK';

/**
 * Input required by PromptBuilderService to build an AI prompt.
 *
 * The builder receives only identifiers and access metadata.
 * It reads CollectionJob, NLP analysis, and existing idea data directly
 * from the database to keep the database as the single source of truth.
 *
 * @author Malak
 */
export type PromptBuilderInput = {
  /**
   * Determines whether the prompt is for a new idea
   * or unlocking an existing one.
   */
  readonly purpose: PromptPurpose;

  /**
   * Collection job identifier containing the collected data
   * and NLP analysis.
   */
  readonly collectionJobId: string;

  /**
   * Determines the user's access level and
   * the required AI output format.
   */
  readonly generationType: IdeaGenerationType;

  /**
   * Existing idea identifier.
   *
   * Required only when the purpose is IDEA_UNLOCK.
   */
  readonly existingIdeaId?: string;
};