import type { IdeaGenerationType, User } from '@prisma/client';

/**
 * Authenticated generation types.
 *
 * Guest generation is managed separately.
 *
 * @author Malak
 */
export type AuthenticatedIdeaGenerationType = Extract<
  IdeaGenerationType,
  'NORMAL_FREE' | 'PREMIUM_CREDIT'
>;

/**
 * Resolved authenticated-user generation policy.
 *
 * @author Malak
 */
export type AuthenticatedIdeaGenerationPolicy = {
  readonly generationType: AuthenticatedIdeaGenerationType;

  readonly user: Pick<
    User,
    | 'id'
    | 'role'
    | 'isActive'
    | 'isVerified'
    | 'freeGenerationLimit'
    | 'freeGenerationsUsed'
    | 'creditBalance'
  >;
};
