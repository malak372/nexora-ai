import { IDEA_OWNER_TYPES } from '../constants/ideas.constants';

/**
 * Supported idea-owner categories.
 *
 * Registered ideas belong to a User, while guest-generated
 * ideas temporarily belong to a GuestSession.
 */
export type IdeaOwnerType =
  (typeof IDEA_OWNER_TYPES)[keyof typeof IDEA_OWNER_TYPES];

/**
 * Owner identity used across the ideas module.
 *
 * Exactly one identifier should be provided:
 * - userId for registered users.
 * - guestSessionId for guests.
 */
export type IdeaOwner =
  | {
      type: typeof IDEA_OWNER_TYPES.USER;
      userId: string;
      guestSessionId?: never;
    }
  | {
      type: typeof IDEA_OWNER_TYPES.GUEST;
      userId?: never;
      guestSessionId: string;
    };
