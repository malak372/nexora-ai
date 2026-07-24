import { IdeaGenerationType } from '@prisma/client';

import type { IdeaOpportunityRanking } from '../../ideas/generation/types/idea-opportunity-ranking.type';

/**
 * Input required to generate a new idea prompt.
 *
 * @author Malak
 */
export type IdeaGenerationPromptInput = {
  /**
   * Indicates that a new idea must be generated.
   */
  readonly purpose: 'IDEA_GENERATION';

  /**
   * Collection job containing the persisted NLP analysis.
   */
  readonly collectionJobId: string;

  /**
   * Determines the user's access level and response schema.
   */
  readonly generationType: IdeaGenerationType;

  /**
   * Existing ideas are not valid for new generation.
   */
  readonly existingIdeaId?: never;

  /**
   * Optional registered-user identifier used to load recent ideas and
   * require semantic diversity from the new generation.
   */
  readonly requesterUserId?: string;

  /**
   * Deterministic opportunity ranking resolved before prompt construction.
   */
  readonly opportunityRanking?: IdeaOpportunityRanking;
};

/**
 * Input required to expand an existing free-tier idea.
 *
 * @author Malak
 */
export type IdeaUnlockPromptInput = {
  /**
   * Indicates that an existing idea must be expanded.
   */
  readonly purpose: 'IDEA_UNLOCK';

  /**
   * Collection job originally used to generate the idea.
   */
  readonly collectionJobId: string;

  /**
   * Existing idea to expand.
   */
  readonly existingIdeaId: string;

  /**
   * Authenticated user requesting the unlock.
   */
  readonly requesterUserId: string;

  /**
   * Unlock output does not depend on a caller-provided
   * generation type.
   */
  readonly generationType?: never;
};

/**
 * Type-safe input accepted by PromptBuilderService.
 *
 * TypeScript prevents generation-only fields from being used
 * with unlock requests and vice versa.
 */
export type PromptBuilderInput =
  | IdeaGenerationPromptInput
  | IdeaUnlockPromptInput;