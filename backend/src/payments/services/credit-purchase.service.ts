import { Injectable } from '@nestjs/common';

import { CreditTransactionType, Prisma } from '@prisma/client';

import { CreditBalanceService } from '../../credits/services/credit-balance.service';

import { PaymentErrorCode } from '../errors/payment-error-code.enum';
import { PaymentProcessingError } from '../errors/payment-processing.error';

/**
 * Payment data required to fulfill a successful
 * credit-purchase payment.
 */
type CreditPurchasePayment = {
  readonly id: string;
  readonly userId: string;
  readonly creditsAmount: number;
  readonly bonusCreditsAmount: number;
};

/**
 * Result returned after fulfilling a credit purchase.
 */
export type CreditPurchaseFulfillmentResult = {
  readonly purchasedCreditsAdded: number;
  readonly bonusCreditsAdded: number;
  readonly totalCreditsAdded: number;
  readonly balanceAfter: number;
};

/**
 * Fulfills successful credit-purchase payments.
 *
 * Responsibilities:
 * - Validate purchased and bonus-credit quantities.
 * - Add purchased credits to the user's balance.
 * - Add bonus credits as a separate transaction.
 * - Preserve a complete credit audit history.
 * - Participate in the caller's Prisma transaction.
 *
 * This service does not:
 * - Verify provider webhooks.
 * - Update payment status.
 * - Create checkout sessions.
 * - Invalidate caches.
 *
 * @author Eman
 */
@Injectable()
export class CreditPurchaseService {
  constructor(private readonly creditBalanceService: CreditBalanceService) {}

  /**
   * Applies purchased and bonus credits after successful
   * provider payment confirmation.
   *
   * Purchased and bonus credits are stored as separate
   * CreditTransaction records for accurate reporting
   * and auditing.
   */
  async fulfill(
    payment: CreditPurchasePayment,
    tx: Prisma.TransactionClient,
  ): Promise<CreditPurchaseFulfillmentResult> {
    this.validateCreditAmounts(payment);

    const purchaseResult = await this.creditBalanceService.adjustBalance({
      userId: payment.userId,
      paymentId: payment.id,

      amount: payment.creditsAmount,

      type: CreditTransactionType.PURCHASE,

      description: 'Credits added after successful purchase payment.',

      tx,
    });

    let finalBalance = purchaseResult.balanceAfter;

    if (payment.bonusCreditsAmount > 0) {
      const bonusResult = await this.creditBalanceService.adjustBalance({
        userId: payment.userId,
        paymentId: payment.id,

        amount: payment.bonusCreditsAmount,

        type: CreditTransactionType.BONUS,

        description: 'Bonus credits added after successful credit purchase.',

        tx,
      });

      finalBalance = bonusResult.balanceAfter;
    }

    return {
      purchasedCreditsAdded: payment.creditsAmount,

      bonusCreditsAdded: payment.bonusCreditsAmount,

      totalCreditsAdded: payment.creditsAmount + payment.bonusCreditsAmount,

      balanceAfter: finalBalance,
    };
  }

  /**
   * Validates quantities stored on the internal payment.
   */
  private validateCreditAmounts(payment: CreditPurchasePayment): void {
    if (
      !Number.isInteger(payment.creditsAmount) ||
      payment.creditsAmount <= 0
    ) {
      throw new PaymentProcessingError(
        PaymentErrorCode.INVALID_CREDIT_QUANTITY,
        'A successful credit-purchase payment must contain at least one purchased credit.',
        {
          details: {
            paymentId: payment.id,
            creditsAmount: payment.creditsAmount,
          },
        },
      );
    }

    if (
      !Number.isInteger(payment.bonusCreditsAmount) ||
      payment.bonusCreditsAmount < 0
    ) {
      throw new PaymentProcessingError(
        PaymentErrorCode.INVALID_BONUS_CONFIGURATION,
        'The payment contains an invalid bonus-credit quantity.',
        {
          details: {
            paymentId: payment.id,
            bonusCreditsAmount: payment.bonusCreditsAmount,
          },
        },
      );
    }
  }
}
