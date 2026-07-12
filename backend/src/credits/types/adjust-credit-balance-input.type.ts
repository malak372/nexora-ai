import {
  CreditTransactionType,
  Prisma,
} from '@prisma/client';

/**
 * Input required to change one user's credit balance.
 *
 * Used internally by:
 * - Administrator adjustments.
 * - Credit purchases.
 * - Bonus grants.
 * - Premium idea deductions.
 * - Refunds.
 *
 * @author Malak
 */
export type AdjustCreditBalanceInput = {
  /**
   * Target user.
   */
  readonly userId: string;

  /**
   * Signed balance change.
   *
   * Positive values add credits.
   * Negative values deduct credits.
   */
  readonly amount: number;

  /**
   * Credit transaction category.
   */
  readonly type: CreditTransactionType;

  /**
   * Optional related payment.
   */
  readonly paymentId?: string;

  /**
   * Optional related idea.
   */
  readonly ideaId?: string;

  /**
   * Optional transaction description.
   */
  readonly description?: string;

  /**
   * Optional transaction client.
   */
  readonly tx?: Prisma.TransactionClient;
};