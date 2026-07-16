import { UserRole } from '@prisma/client';

/**
 * Authentication context used to enforce ownership rules
 * for collection jobs and their collected content.
 *
 * Administrators can access all collection jobs, posts,
 * and comments.
 *
 * Registered users can access only collection jobs created
 * by their authenticated account and the collected content
 * associated with those jobs.
 *
 * @author Malak
 */
export type CollectionAccessContext = {
  /**
   * Authenticated user identifier.
   */
  readonly userId: string;

  /**
   * Authenticated user's application role.
   */
  readonly role: UserRole;
};