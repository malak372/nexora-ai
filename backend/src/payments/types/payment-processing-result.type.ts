import { PaymentPurpose, PaymentStatus, UnlockMethod } from '@prisma/client';

/**
 * Normalized result returned after processing a payment confirmation.
 *
 * The optional fields depend on the payment purpose and final status:
 * - BUY_CREDITS returns credit-balance information.
 * - DIRECT_UNLOCK returns idea-unlock information.
 * - ACCEPT_PUBLICATION returns publication-acceptance information.
 * - FAILED payments may return a failure reason.
 */
export type PaymentProcessingResult = {
  readonly paymentId: string;
  readonly userId: string;

  readonly paymentPurpose: PaymentPurpose;
  readonly status: PaymentStatus;

  readonly alreadyProcessed: boolean;
  readonly creditBalanceChanged: boolean;

  /*
   * Credit-purchase result fields.
   */
  readonly creditsAdded?: number;
  readonly bonusCreditsAdded?: number;
  readonly totalCreditsAdded?: number;
  readonly balanceAfter?: number;

  /*
   * Direct-unlock result fields.
   */
  readonly ideaId?: string;
  readonly ideaUnlocked?: boolean;
  readonly unlockCompletedNow?: boolean;
  readonly unlockInProgress?: boolean;
  readonly unlockMethod?: UnlockMethod;
  readonly unlockedAt?: Date;

  /*
   * Publication-acceptance result fields.
   */
  readonly publicationId?: string;
  readonly publicationAccepted?: boolean;
  readonly acceptanceId?: string;
  readonly advancedPublicationAccess?: boolean;

  /*
   * Failed-payment result field.
   */
  readonly failureReason?: string;
};