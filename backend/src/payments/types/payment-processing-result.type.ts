import { PaymentPurpose, PaymentStatus, UnlockMethod } from '@prisma/client';

/**
 * Result returned after processing a verified payment confirmation.
 *
 * Direct-unlock results are returned only after advanced outputs have been
 * generated, persisted, and the idea has been marked unlocked atomically.
 *
 * @author Eman
 */
export type PaymentProcessingResult = {
  readonly paymentId: string;
  readonly userId: string;
  readonly paymentPurpose: PaymentPurpose;
  readonly status: PaymentStatus;
  readonly alreadyProcessed: boolean;
  readonly creditBalanceChanged: boolean;

  readonly creditsAdded?: number;
  readonly bonusCreditsAdded?: number;
  readonly totalCreditsAdded?: number;
  readonly balanceAfter?: number;

  readonly ideaId?: string;
  readonly ideaUnlocked?: boolean;
  readonly unlockCompletedNow?: boolean;
  readonly unlockMethod?: UnlockMethod;
  readonly unlockedAt?: Date;

  readonly failureReason?: string;
};