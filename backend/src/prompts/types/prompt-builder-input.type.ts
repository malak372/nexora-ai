import { IdeaGenerationType } from '@prisma/client';

import type { IdeaOpportunityRanking } from '../../ideas/generation/types/idea-opportunity-ranking.type';
import type {
  IdeaGenerationDomainEvidence,
  IdeaGenerationNlpContext,
  SelectedGenerationDomain,
} from '../../ideas/generation/types/idea-generation-context.type';


/**
 * Trusted collection metadata already resolved by the generation pipeline.
 *
 * Supplying this snapshot avoids re-reading CollectionJob/Domain/DataSource
 * rows during IDEA_GENERATION. It is intentionally unavailable to unlock
 * flows, which still validate persisted ownership from the database.
 */
export type IdeaGenerationPromptCollectionContext = {
  readonly id: string;
  readonly createdById: string | null;
  readonly country: string | null;
  readonly city: string | null;
  readonly region: string | null;
  readonly domain: {
    readonly id: string;
    readonly name: string;
  };
  readonly sources: readonly {
    readonly dataSource: {
      readonly key: string;
      readonly displayName: string;
      readonly isActive: boolean;
      readonly isImplemented: boolean;
    };
  }[];
};

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

  /** Ordered domains that must contribute evidence-backed problems. */
  readonly selectedDomains?: readonly SelectedGenerationDomain[];

  /**
   * In-memory merged NLP context produced by parallel multi-domain collection.
   * When supplied, it takes precedence over the primary job's persisted NLP
   * row so the prompt receives evidence from every completed domain.
   */
  readonly analysisOverride?: IdeaGenerationNlpContext;

  /** Trusted collection metadata already present in the pipeline context. */
  readonly collectionContextOverride?: IdeaGenerationPromptCollectionContext;

  /**
   * Domain-attributed evidence map used to keep samples and counts attached to
   * the domain that produced them.
   */
  readonly domainEvidence?: readonly IdeaGenerationDomainEvidence[];
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