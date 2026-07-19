/**
 * User-facing access capabilities for an idea.
 *
 * Services should return these capabilities to the frontend
 * instead of requiring the frontend to reproduce backend
 * entitlement logic.
 */
export type IdeaAccess = {
  /**
   * Indicates whether advanced generated outputs can be viewed.
   */
  canViewAdvancedOutputs: boolean;

  /**
   * Indicates whether the complete abstract can be viewed.
   */
  canViewFullAbstract: boolean;

  /**
   * Indicates whether NLP analysis can be viewed.
   */
  canViewNlpAnalysis: boolean;

  /**
   * Indicates whether collected posts and comments can be viewed.
   */
  canViewCommunityData: boolean;

  /**
   * Indicates whether AI chat can be used for the idea.
   */
  canUseAiChat: boolean;

  /**
   * Indicates whether the owner may publish the idea.
   */
  canPublish: boolean;

  /**
   * Indicates whether the idea can be unlocked through
   * a direct payment.
   */
  canDirectUnlock: boolean;

  /**
   * Indicates whether advanced access is currently locked.
   */
  requiresUnlock: boolean;
};

/**
 * Minimal data required to calculate idea access.
 */
export type IdeaAccessSource = {
  isUnlocked: boolean;

  /**
   * Whether the requesting user owns the idea.
   */
  isOwner: boolean;

  /**
   * Whether the idea has been soft-deleted.
   */
  isDeleted?: boolean;

  /**
   * Whether the idea is eligible for direct unlocking.
   *
   * Premium-credit ideas are normally already unlocked.
   */
  supportsDirectUnlock?: boolean;
};