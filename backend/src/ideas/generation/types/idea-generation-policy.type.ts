import {
  AccountStatus,
  IdeaGenerationType,
  UnlockMethod,
  UserRole,
  UserType,
} from '@prisma/client';

/**
 * Minimal registered-user data required to evaluate
 * idea-generation eligibility.
 *
 * This type intentionally includes only the fields required by
 * the generation-policy service. It prevents the policy layer
 * from depending on the complete Prisma User model.
 *
 * @author Malak
 */
export type IdeaGenerationPolicyUser = {
  /**
   * Unique registered-user identifier.
   */
  id: string;

  /**
   * Application role assigned to the user.
   */
  role: UserRole;

  /**
   * Subscription or account type assigned to the user.
   */
  userType: UserType;

  /**
   * Current account status.
   */
  accountStatus: AccountStatus;

  /**
   * Indicates whether the account is currently active.
   */
  isActive: boolean;

  /**
   * Indicates whether the user has verified their email address.
   */
  isVerified: boolean;

  /**
   * Current number of available premium credits.
   */
  creditBalance: number;

  /**
   * Maximum number of free generations available to the user.
   */
  freeGenerationLimit: number;

  /**
   * Number of free generations already consumed by the user.
   */
  freeGenerationsUsed: number;
};

/**
 * Minimal guest-session data required to evaluate
 * guest-generation eligibility.
 *
 * @author Malak
 */
export type IdeaGenerationPolicyGuest = {
  /**
   * Unique guest-session identifier.
   */
  id: string;

  /**
   * Indicates whether the guest session has already consumed
   * its single permitted idea generation.
   */
  hasGenerated: boolean;

  /**
   * Date and time after which the guest session becomes invalid.
   *
   * A null value represents a session without an explicitly
   * configured expiration timestamp.
   */
  expiresAt: Date | null;
};

/**
 * Generation-policy input for an authenticated registered user.
 *
 * Registered users may request:
 * - NORMAL_FREE
 * - PREMIUM_CREDIT
 *
 * GUEST_FREE is intentionally excluded at the type level.
 *
 * @author Malak
 */
export type RegisteredIdeaGenerationPolicyInput = {
  /**
   * Discriminator used to identify registered-user input.
   */
  ownerType: 'USER';

  /**
   * Generation type requested by the authenticated user.
   */
  requestedGenerationType: Exclude<
    IdeaGenerationType,
    typeof IdeaGenerationType.GUEST_FREE
  >;

  /**
   * Registered-user data required by the policy rules.
   */
  user: IdeaGenerationPolicyUser;
};

/**
 * Generation-policy input for a guest session.
 *
 * Guest sessions may only request GUEST_FREE generation.
 *
 * @author Malak
 */
export type GuestIdeaGenerationPolicyInput = {
  /**
   * Discriminator used to identify guest input.
   */
  ownerType: 'GUEST';

  /**
   * The only generation type available to guest sessions.
   */
  requestedGenerationType:
    typeof IdeaGenerationType.GUEST_FREE;

  /**
   * Guest-session data required by the policy rules.
   */
  guestSession: IdeaGenerationPolicyGuest;
};

/**
 * Complete input accepted by the idea-generation policy service.
 *
 * The ownerType discriminator enables safe TypeScript narrowing
 * between registered-user and guest-session requests.
 *
 * @author Malak
 */
export type IdeaGenerationPolicyInput =
  | RegisteredIdeaGenerationPolicyInput
  | GuestIdeaGenerationPolicyInput;

/**
 * Entitlement decision returned before starting the
 * idea-generation pipeline.
 *
 * The policy service calculates this object without changing
 * database state.
 *
 * Credit deduction, free-generation consumption and guest-session
 * consumption must be performed later inside the persistence
 * transaction after the generation output has been validated.
 *
 * @author Malak
 */
export type IdeaGenerationPolicy = {
  /**
   * Final generation type authorized by the policy service.
   */
  generationType: IdeaGenerationType;

  /**
   * Indicates whether the pipeline must generate premium and
   * advanced outputs.
   */
  includePremiumOutputs: boolean;

  /**
   * Indicates whether the generated idea should be marked as
   * unlocked immediately after successful generation.
   */
  unlockOnGeneration: boolean;

  /**
   * Method through which the idea becomes unlocked.
   *
   * This value is null for guest-free and normal-free ideas.
   * Premium-credit generation uses CREDIT_GENERATION.
   */
  unlockMethod: UnlockMethod | null;

  /**
   * Number of credits that must be consumed when the generated
   * premium idea is persisted successfully.
   */
  creditsToConsume: number;

  /**
   * Indicates whether one registered-user free generation must
   * be consumed when generation succeeds.
   */
  consumesFreeGeneration: boolean;

  /**
   * Indicates whether the guest session must be marked as having
   * consumed its permitted generation.
   */
  consumesGuestGeneration: boolean;

  /**
   * Indicates whether the requester may immediately view
   * advanced generated outputs.
   */
  canViewAdvancedOutputs: boolean;

  /**
   * Indicates whether the requester may view community data and
   * NLP analysis associated with the generated idea.
   */
  canViewCommunityData: boolean;

  /**
   * Indicates whether AI chat is available for the generated
   * idea.
   */
  canUseAiChat: boolean;

  /**
   * Expected number of free generations remaining after the
   * current generation succeeds.
   *
   * This value is null for guest and premium-credit generation.
   */
  remainingFreeGenerations: number | null;

  /**
   * Expected credit balance after the required credit deduction.
   *
   * This is an informational preview only. The persistence layer
   * must validate the current balance again before deducting
   * credits atomically.
   *
   * This value is null when generation does not consume credits.
   */
  expectedCreditBalance: number | null;
};