import { CreditTransactionType, Prisma } from '@prisma/client';

/**
 * Input required to change one user's credit balance.
 *
 * Used internally by:
 * - Administrator adjustments.
 * - Credit purchases.
 * - Bonus grants.
 * - Premium idea deductions.
 * - Publication advanced-output deductions.
 * - Refunds.
 *
 * @author Malak
 */
export type AdjustCreditBalanceInput = {
  /** Target user identifier. */
  readonly userId: string;

  /**
   * Signed balance change.
   *
   * Positive values add credits.
   * Negative values deduct credits.
   */
  readonly amount: number;

  /** Credit transaction category. */
  readonly type: CreditTransactionType;

  /** Optional related payment. */
  readonly paymentId?: string;

  /** Optional related idea. */
  readonly ideaId?: string;

  /**
   * Optional accepted publication whose advanced outputs
   * consumed credits.
   */
  readonly publicationAcceptanceId?: string;

  /** Optional transaction description. */
  readonly description?: string;

  /**
   * Explicitly activates Premium after a successful credit purchase.
   *
   * This must only be true when:
   * - The payment purpose is BUY_CREDITS.
   * - The payment succeeded.
   * - The user was NORMAL when the payment was created.
   * - The Premium activation fee was included in the payment.
   *
   * Adding credits through bonuses, refunds, or administrator adjustments
   * must not activate Premium automatically.
   */
  readonly activatePremium?: boolean;

  /** Optional existing Prisma transaction client. */
  readonly tx?: Prisma.TransactionClient;
};
