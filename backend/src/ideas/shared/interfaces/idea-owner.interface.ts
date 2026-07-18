import type { IdeaOwnerType } from '../types/idea-owner.type';

/**
 * Common owner representation returned by idea services.
 *
 * This interface is intended for API-safe owner metadata.
 * It must not contain private authentication or account data.
 */
export interface IdeaOwnerView {
  type: IdeaOwnerType;

  /**
   * Registered user identifier.
   *
   * Null when the idea belongs to a guest session.
   */
  userId: string | null;

  /**
   * Guest-session identifier.
   *
   * Null when the idea belongs to a registered user.
   */
  guestSessionId: string | null;

  /**
   * Display name of a registered user.
   *
   * Null for guest ideas.
   */
  displayName: string | null;
}