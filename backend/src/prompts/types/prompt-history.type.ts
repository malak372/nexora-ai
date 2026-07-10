import { Prisma } from '@prisma/client';

/**
 * Shared relation selection used by PromptHistoryService.
 *
 * Defining the include object once keeps:
 * - The Prisma query.
 * - The selected relations.
 * - The inferred TypeScript result type.
 *
 * synchronized with each other.
 *
 * Sensitive data such as:
 * - User password hashes.
 * - Guest session tokens.
 * - Authentication details.
 *
 * is intentionally excluded.
 *
 * @author Malak
 */
export const PROMPT_HISTORY_INCLUDE = {
  /**
   * Authenticated user who requested the prompt.
   *
   * Null for guest-generated prompts or internal system prompts.
   */
  user: {
    select: {
      id: true,
      fullName: true,
      email: true,
      accountStatus: true,
      isActive: true,
    },
  },

  /**
   * Guest session that requested the prompt.
   *
   * The sensitive sessionToken field is intentionally excluded.
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
   * - The prompt represents an internal system operation.
   */
  idea: {
    select: {
      id: true,
      title: true,
      generationType: true,
      isUnlocked: true,
      unlockMethod: true,
      createdAt: true,
    },
  },

  /**
   * Collection job that supplied the persisted NLP analysis
   * used to build the prompt.
   */
  collectionJob: {
    select: {
      id: true,
      country: true,
      city: true,
      region: true,
      language: true,
      platforms: true,
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
    },
  },
} as const satisfies Prisma.PromptHistoryInclude;

/**
 * Prompt-history record including the relations required
 * by the administrative history view.
 *
 * The result type is inferred directly from
 * PROMPT_HISTORY_INCLUDE to prevent query/type mismatches.
 *
 * @author Malak
 */
export type PromptHistoryWithRelations = Prisma.PromptHistoryGetPayload<{
  include: typeof PROMPT_HISTORY_INCLUDE;
}>;

/**
 * Paginated prompt-history response returned to administrators.
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
     * Maximum number of records per page.
     */
    readonly limit: number;

    /**
     * Total number of matching records.
     */
    readonly total: number;

    /**
     * Total number of available pages.
     */
    readonly totalPages: number;
  };
};
