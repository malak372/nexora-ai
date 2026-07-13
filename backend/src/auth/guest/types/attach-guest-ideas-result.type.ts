/**
 * Result returned after transferring guest-owned idea activity.
 *
 * @author Eman
 */
export type AttachGuestIdeasResult = {
  /**
   * Number of ideas successfully transferred.
   */
  readonly transferredCount: number;

  /**
   * Identifiers of the transferred ideas.
   */
  readonly ideaIds: string[];
};
