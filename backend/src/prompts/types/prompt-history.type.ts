import { Prisma } from '@prisma/client';

/**
 * Shared relation selection used by PromptHistoryService.
 *
 * The selected relations provide the administrator with enough
 * context to inspect how and why a prompt was generated without
 * exposing sensitive authentication data.
 *
 * Sensitive values intentionally excluded:
 * - User password hashes.
 * - Guest session tokens.
 * - Guest fingerprints.
 * - Authentication tokens.
 *
 * @author Malak
 */
export const PROMPT_HISTORY_INCLUDE = {
  /**
   * Authenticated user who requested the prompt.
   *
   * Null for:
   * - Guest-generation prompts.
   * - Internal system prompts.
   */
  user: {
    select: {
      id: true,
      fullName: true,
      email: true,
      accountStatus: true,
      isActive: true,
      deletedAt: true,
    },
  },

  /**
   * Guest session that requested the prompt.
   *
   * The sensitive sessionToken and fingerprintHash fields
   * are intentionally excluded.
   */
  guestSession: {
    select: {
      id: true,
      hasGenerated: true,
      createdAt: true,
      expiresAt: true,
    },
  },

  /**
   * Idea generated from or expanded by the prompt.
   *
   * Null when:
   * - AI generation has not completed.
   * - The prompt represents an internal operation.
   */
  idea: {
    select: {
      id: true,
      title: true,
      generationType: true,
      isUnlocked: true,
      unlockMethod: true,
      deletedAt: true,
      createdAt: true,
    },
  },

  /**
   * Collection job that supplied the persisted NLP analysis.
   */
  collectionJob: {
    select: {
      id: true,
      country: true,
      city: true,
      region: true,
      language: true,
      status: true,
      totalPosts: true,
      totalComments: true,
      createdAt: true,
      completedAt: true,

      domain: {
        select: {
          id: true,
          name: true,
        },
      },

      /**
       * Selected platforms are represented through
       * CollectionJobSource and DataSource.
       *
       * CollectionJob does not contain a direct platforms field.
       */
      sources: {
        orderBy: {
          dataSource: {
            displayName: Prisma.SortOrder.asc,
          },
        },
        select: {
          status: true,
          totalPosts: true,
          totalComments: true,
          failureReason: true,

          dataSource: {
            select: {
              id: true,
              key: true,
              displayName: true,
              isActive: true,
              isImplemented: true,
            },
          },
        },
      },
    },
  },
} as const satisfies Prisma.PromptHistoryInclude;

/**
 * Prompt-history record including administrator-facing relations.
 *
 * The type is inferred directly from PROMPT_HISTORY_INCLUDE.
 */
export type PromptHistoryWithRelations = Prisma.PromptHistoryGetPayload<{
  include: typeof PROMPT_HISTORY_INCLUDE;
}>;

/**
 * Paginated prompt-history response.
 *
 * @author Malak
 */
export type PaginatedPromptHistory = {
  /**
   * Prompt-history records for the current page.
   */
  readonly data: PromptHistoryWithRelations[];

  /**
   * Pagination metadata.
   */
  readonly meta: {
    /**
     * Current page number.
     */
    readonly page: number;

    /**
     * Maximum records returned per page.
     */
    readonly limit: number;

    /**
     * Total matching records.
     */
    readonly total: number;

    /**
     * Total available pages.
     */
    readonly totalPages: number;
  };
};
