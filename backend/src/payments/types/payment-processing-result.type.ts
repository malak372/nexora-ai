import { PaymentPurpose, PaymentStatus, UnlockMethod } from '@prisma/client';

/**
 * Result returned after processing a verified payment confirmation.
 *
 * Supports:
 * - Successful credit purchases.
 * - Successful direct idea unlocks.
 * - Failed payment confirmations.
 * - Repeated idempotent webhook events.
 *
 * This contract exposes only the information required by callers
 * and does not expose the complete Prisma Payment model.
 *
 * @author Eman
 */
export type PaymentProcessingResult = {
  /**
   * Internal payment identifier.
   */
  readonly paymentId: string;

  /**
   * User associated with the payment.
   */
  readonly userId: string;

  /**
   * Business purpose of the payment.
   */
  readonly paymentPurpose: PaymentPurpose;

  /**
   * Final normalized payment status.
   */
  readonly status: PaymentStatus;

  /**
   * Indicates that the same provider event or payment
   * had already been processed previously.
   */
  readonly alreadyProcessed: boolean;

  /**
   * Indicates whether the user's credit balance changed.
   */
  readonly creditBalanceChanged: boolean;

  /**
   * Purchased credits added to the balance.
   */
  readonly creditsAdded?: number;

  /**
   * Bonus credits added to the balance.
   */
  readonly bonusCreditsAdded?: number;

  /**
   * Total purchased and bonus credits added.
   */
  readonly totalCreditsAdded?: number;

  /**
   * User balance after successful credit fulfillment.
   */
  readonly balanceAfter?: number;

  /**
   * Idea associated with a direct-unlock payment.
   */
  readonly ideaId?: string;

  /**
   * Indicates that the selected idea was unlocked.
   */
  readonly ideaUnlocked?: boolean;

  /**
   * Method used to unlock the idea.
   */
  readonly unlockMethod?: UnlockMethod;

  /**
   * Time at which the idea was unlocked.
   */
  readonly unlockedAt?: Date;

  /**
   * Sanitized reason for a failed payment.
   */
  readonly failureReason?: string;
};
