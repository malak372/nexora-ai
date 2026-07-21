import { Injectable, Logger } from '@nestjs/common';

import {
  PaymentPurpose,
  PaymentStatus,
  Prisma,
  UnlockMethod,
} from '@prisma/client';

import { CreditCacheService } from '../../credits/services/credit-cache.service';
import { IdeaUnlockService } from '../../ideas/outputs/services/idea-unlock.service';
import { PrismaService } from '../../prisma/prisma.service';

import { PaymentErrorCode } from '../errors/payment-error-code.enum';
import { PaymentProcessingError } from '../errors/payment-processing.error';

import type { PaymentConfirmation } from '../types/payment-confirmation.type';
import type { PaymentProcessingResult } from '../types/payment-processing-result.type';

import { CreditPurchaseService } from './credit-purchase.service';
import { DirectUnlockPaymentService } from './direct-unlock-payment.service';
import { PaymentNotificationService } from './payment-notification.service';

/**
 * Internal payment representation required while processing
 * a verified provider confirmation.
 *
 * This type intentionally includes only the fields required
 * by the payment-processing workflow.
 */
type ProcessablePayment = {
  readonly id: string;
  readonly userId: string;
  readonly ideaId: string | null;

  readonly amount: Prisma.Decimal;
  readonly currency: string;

  readonly providerKey: string;
  readonly paymentPurpose: PaymentPurpose;
  readonly status: PaymentStatus;

  readonly creditsAmount: number;
  readonly bonusCreditsAmount: number;

  readonly providerPaymentId: string | null;
  readonly providerSessionId: string | null;
};

/**
 * Processes verified and normalized payment confirmations.
 *
 * Responsibilities:
 * - Retrieve the corresponding internal payment.
 * - Validate provider, amount, currency, and external identifiers.
 * - Prevent duplicate fulfillment.
 * - Protect against concurrent webhook processing.
 * - Update the internal payment status.
 * - Delegate credit-purchase fulfillment.
 * - Delegate direct-unlock fulfillment.
 * - Invalidate credit-related caches after successful commits.
 * - Dispatch payment email notifications after successful commits.
 *
 * Provider-specific webhook verification remains owned by
 * PaymentGateway implementations and PaymentWebhookService.
 *
 * @author Eman
 */
@Injectable()
export class PaymentProcessingService {
  /**
   * Logger used for post-commit notification failures that must not
   * change the result of an already committed payment operation.
   */
  private readonly logger = new Logger(PaymentProcessingService.name);

  constructor(
    private readonly prisma: PrismaService,

    private readonly creditPurchaseService: CreditPurchaseService,

    private readonly directUnlockPaymentService: DirectUnlockPaymentService,

    private readonly ideaUnlockService: IdeaUnlockService,

    private readonly creditCacheService: CreditCacheService,

    private readonly paymentNotificationService: PaymentNotificationService,
  ) {}

  /**
   * Processes one verified provider payment confirmation.
   *
   * Payment status changes and business fulfillment are committed
   * atomically inside one Prisma transaction.
   *
   * Repeated successful or failed webhook events are handled
   * idempotently and do not repeat business fulfillment.
   *
   * @param confirmation Verified normalized provider confirmation.
   * @returns Final payment-processing result.
   */
  async processConfirmation(
    confirmation: PaymentConfirmation,
  ): Promise<PaymentProcessingResult> {
    try {
      const result = await this.prisma.$transaction(
        async (tx): Promise<PaymentProcessingResult> => {
          const payment = await this.findPayment(tx, confirmation.paymentId);

          this.validateProviderKey(
            payment.providerKey,
            confirmation.providerKey,
          );

          this.validateAmount(payment.amount, confirmation.amount);

          this.validateCurrency(payment.currency, confirmation.currency);

          await this.validateExternalIdentifiers(
            tx,
            payment.id,
            confirmation.providerPaymentId,
            confirmation.providerSessionId,
          );

          /*
           * Repeated successful webhook:
           * return the existing result without fulfilling
           * the payment again.
           */
          if (
            payment.status === PaymentStatus.SUCCEEDED &&
            confirmation.status === PaymentStatus.SUCCEEDED
          ) {
            return this.buildAlreadyProcessedSuccessResult(
              payment,
              confirmation,
            );
          }

          this.validateStatusTransition(payment.status, confirmation.status);

          switch (confirmation.status) {
            case PaymentStatus.SUCCEEDED:
              return this.processSuccessfulPayment(tx, payment, confirmation);

            case PaymentStatus.FAILED:
              return this.processFailedPayment(tx, payment, confirmation);

            case PaymentStatus.PENDING:
              throw new PaymentProcessingError(
                PaymentErrorCode.INVALID_PAYMENT_STATUS_TRANSITION,
                'A pending provider event does not complete payment processing.',
                {
                  details: {
                    paymentId: payment.id,
                    currentStatus: payment.status,
                    requestedStatus: confirmation.status,
                  },
                },
              );

            case PaymentStatus.REFUNDED:
              throw new PaymentProcessingError(
                PaymentErrorCode.INVALID_PAYMENT_STATUS_TRANSITION,
                'Refund events must be processed through the dedicated refund workflow.',
                {
                  details: {
                    paymentId: payment.id,
                    currentStatus: payment.status,
                    requestedStatus: confirmation.status,
                  },
                },
              );

            default:
              throw new PaymentProcessingError(
                PaymentErrorCode.INVALID_PAYMENT_STATUS_TRANSITION,
                'The provider returned an unsupported payment status.',
                {
                  details: {
                    paymentId: payment.id,
                    requestedStatus: confirmation.status,
                  },
                },
              );
          }
        },
      );

      const completedResult =
        await this.completeDirectUnlockAfterCommit(result);

      /*
       * Cache invalidation occurs only after the database
       * transaction commits successfully.
       */
      if (completedResult.creditBalanceChanged) {
        await this.creditCacheService.invalidateUserCreditCaches(
          completedResult.userId,
        );
      }

      /*
       * Notification delivery occurs only after the payment transaction
       * commits. Repeated webhook events do not resend notifications.
       */
      if (
        !completedResult.alreadyProcessed ||
        completedResult.unlockCompletedNow === true
      ) {
        await this.notifyPaymentResultSafely(completedResult);
      }

      return completedResult;
    } catch (error) {
      this.rethrowKnownPaymentError(error);
    }
  }

  /**
   * Completes advanced-output generation after the payment transaction commits.
   *
   * A repeated successful webhook also enters this method. This intentionally
   * allows a previously paid unlock whose AI generation failed to be retried
   * without charging the user again.
   */
  private async completeDirectUnlockAfterCommit(
    result: PaymentProcessingResult,
  ): Promise<PaymentProcessingResult> {
    if (
      result.status !== PaymentStatus.SUCCEEDED ||
      result.paymentPurpose !== PaymentPurpose.DIRECT_UNLOCK
    ) {
      return result;
    }

    const ideaId =
      result.ideaId ??
      (await this.findDirectUnlockIdeaId(result.paymentId, result.userId));

    try {
      const unlockResult = await this.ideaUnlockService.unlockPaidIdea({
        paymentId: result.paymentId,
        userId: result.userId,
        ideaId,
      });

      return {
        ...result,
        ideaId: unlockResult.ideaId,
        ideaUnlocked: true,
        unlockCompletedNow: unlockResult.completedNow,
        unlockMethod: UnlockMethod.DIRECT_PAYMENT,
        unlockedAt: unlockResult.unlockedAt,
      };
    } catch (error) {
      throw new PaymentProcessingError(
        PaymentErrorCode.DIRECT_UNLOCK_PROCESSING_FAILED,
        'The payment succeeded, but advanced idea outputs could not be generated. The unlock can be retried safely.',
        {
          cause: error,
          details: {
            paymentId: result.paymentId,
            ideaId,
            userId: result.userId,
          },
        },
      );
    }
  }

  /** Resolves the idea attached to a successfully paid direct unlock. */
  private async findDirectUnlockIdeaId(
    paymentId: string,
    userId: string,
  ): Promise<string> {
    const payment = await this.prisma.payment.findFirst({
      where: {
        id: paymentId,
        userId,
        paymentPurpose: PaymentPurpose.DIRECT_UNLOCK,
        status: PaymentStatus.SUCCEEDED,
      },
      select: {
        ideaId: true,
      },
    });

    if (!payment?.ideaId) {
      throw new PaymentProcessingError(
        PaymentErrorCode.IDEA_NOT_FOUND,
        'The successful direct-unlock payment does not reference an idea.',
        {
          details: {
            paymentId,
            userId,
          },
        },
      );
    }

    return payment.ideaId;
  }

  /**
   * Sends the email notification associated with a newly processed
   * payment result.
   *
   * Notification data is read only after the payment transaction commits.
   * Any lookup or delivery failure is logged and suppressed because it must
   * not change the outcome of an already committed payment operation.
   *
   * @param result Newly processed payment result.
   */
  private async notifyPaymentResultSafely(
    result: PaymentProcessingResult,
  ): Promise<void> {
    try {
      const payment = await this.prisma.payment.findUnique({
        where: {
          id: result.paymentId,
        },

        select: {
          id: true,
          amount: true,
          currency: true,
          paymentMethodKey: true,
          paymentPurpose: true,
          transactionReference: true,
          failureReason: true,

          user: {
            select: {
              email: true,
            },
          },
        },
      });

      if (!payment) {
        this.logger.error(
          `Payment notification data was not found for payment ${result.paymentId}.`,
        );

        return;
      }

      const notificationInput = {
        paymentId: payment.id,
        recipientEmail: payment.user.email,
        amount: payment.amount.toNumber(),
        currency: payment.currency,
        paymentMethodKey: payment.paymentMethodKey,
        paymentPurpose: payment.paymentPurpose,
        transactionReference: payment.transactionReference ?? undefined,
      };

      switch (result.status) {
        case PaymentStatus.SUCCEEDED:
          await this.paymentNotificationService.notifyPaymentSucceeded(
            notificationInput,
          );
          return;

        case PaymentStatus.FAILED:
          await this.paymentNotificationService.notifyPaymentFailed({
            ...notificationInput,
            failureReason:
              payment.failureReason ?? result.failureReason ?? undefined,
          });
          return;

        default:
          return;
      }
    } catch (error) {
      this.logger.error(
        `Failed to prepare payment notification for payment ${result.paymentId}.`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * Retrieves the internal payment record associated with
   * the provider confirmation.
   */
  private async findPayment(
    tx: Prisma.TransactionClient,
    paymentId: string,
  ): Promise<ProcessablePayment> {
    const payment = await tx.payment.findUnique({
      where: {
        id: paymentId,
      },

      select: {
        id: true,
        userId: true,
        ideaId: true,

        amount: true,
        currency: true,

        providerKey: true,
        paymentPurpose: true,
        status: true,

        creditsAmount: true,
        bonusCreditsAmount: true,

        providerPaymentId: true,
        providerSessionId: true,
      },
    });

    if (!payment) {
      throw new PaymentProcessingError(
        PaymentErrorCode.PAYMENT_NOT_FOUND,
        'The requested payment record does not exist.',
        {
          details: {
            paymentId,
          },
        },
      );
    }

    return payment;
  }

  /**
   * Atomically claims and fulfills one successful payment.
   *
   * The conditional update ensures that only one concurrent
   * webhook can transition the payment to SUCCEEDED and execute
   * its business fulfillment.
   */
  private async processSuccessfulPayment(
    tx: Prisma.TransactionClient,
    payment: ProcessablePayment,
    confirmation: PaymentConfirmation,
  ): Promise<PaymentProcessingResult> {
    const claimResult = await tx.payment.updateMany({
      where: {
        id: payment.id,

        status: {
          in: [PaymentStatus.PENDING, PaymentStatus.FAILED],
        },
      },

      data: {
        status: PaymentStatus.SUCCEEDED,

        providerPaymentId: confirmation.providerPaymentId,

        providerSessionId:
          confirmation.providerSessionId ?? payment.providerSessionId,

        transactionReference: confirmation.providerPaymentId,

        failureReason: null,

        paidAt: confirmation.occurredAt,

        failedAt: null,
        refundedAt: null,
      },
    });

    /*
     * Another concurrent process may have already changed
     * the payment status before this transaction claimed it.
     */
    if (claimResult.count === 0) {
      return this.resolveUnclaimedSuccess(tx, payment.id, confirmation);
    }

    switch (payment.paymentPurpose) {
      case PaymentPurpose.BUY_CREDITS: {
        const fulfillment = await this.creditPurchaseService.fulfill(
          {
            id: payment.id,
            userId: payment.userId,

            creditsAmount: payment.creditsAmount,

            bonusCreditsAmount: payment.bonusCreditsAmount,
          },
          tx,
        );

        return {
          paymentId: payment.id,
          userId: payment.userId,

          paymentPurpose: PaymentPurpose.BUY_CREDITS,

          status: PaymentStatus.SUCCEEDED,

          alreadyProcessed: false,
          creditBalanceChanged: true,

          creditsAdded: fulfillment.purchasedCreditsAdded,

          bonusCreditsAdded: fulfillment.bonusCreditsAdded,

          totalCreditsAdded: fulfillment.totalCreditsAdded,

          balanceAfter: fulfillment.balanceAfter,
        };
      }

      case PaymentPurpose.DIRECT_UNLOCK: {
        const fulfillment =
          await this.directUnlockPaymentService.validateForFulfillment(
            {
              id: payment.id,
              userId: payment.userId,
              ideaId: payment.ideaId,
            },
            tx,
          );

        return {
          paymentId: payment.id,
          userId: payment.userId,

          paymentPurpose: PaymentPurpose.DIRECT_UNLOCK,

          status: PaymentStatus.SUCCEEDED,

          alreadyProcessed: false,
          creditBalanceChanged: false,

          ideaId: fulfillment.ideaId,

          ideaUnlocked: false,
          unlockCompletedNow: false,
        };
      }

      default:
        throw new PaymentProcessingError(
          PaymentErrorCode.INVALID_PAYMENT_PURPOSE,
          'The payment purpose is not supported.',
          {
            details: {
              paymentId: payment.id,
              paymentPurpose: payment.paymentPurpose,
            },
          },
        );
    }
  }

  /**
   * Resolves a successful webhook that could not claim
   * the payment because another process already changed it.
   */
  private async resolveUnclaimedSuccess(
    tx: Prisma.TransactionClient,
    paymentId: string,
    confirmation: PaymentConfirmation,
  ): Promise<PaymentProcessingResult> {
    const currentPayment = await tx.payment.findUnique({
      where: {
        id: paymentId,
      },

      select: {
        id: true,
        userId: true,
        paymentPurpose: true,
        status: true,
        providerPaymentId: true,
        providerSessionId: true,
      },
    });

    if (currentPayment?.status === PaymentStatus.SUCCEEDED) {
      this.validateCompletedPaymentIdentifiers(
        currentPayment.providerPaymentId,
        currentPayment.providerSessionId,
        confirmation.providerPaymentId,
        confirmation.providerSessionId,
      );

      return {
        paymentId: currentPayment.id,

        userId: currentPayment.userId,

        paymentPurpose: currentPayment.paymentPurpose,

        status: PaymentStatus.SUCCEEDED,

        alreadyProcessed: true,
        creditBalanceChanged: false,
      };
    }

    throw new PaymentProcessingError(
      PaymentErrorCode.INVALID_PAYMENT_STATUS_TRANSITION,
      'The payment could not be claimed for successful processing.',
      {
        details: {
          paymentId,
          currentStatus: currentPayment?.status ?? null,
        },
      },
    );
  }

  /**
   * Marks one payment as failed.
   *
   * Failed payments do not add credits and do not unlock ideas.
   */
  private async processFailedPayment(
    tx: Prisma.TransactionClient,
    payment: ProcessablePayment,
    confirmation: PaymentConfirmation,
  ): Promise<PaymentProcessingResult> {
    const failureReason =
      confirmation.failureReason?.trim() || 'Payment failed.';

    const updateResult = await tx.payment.updateMany({
      where: {
        id: payment.id,
        status: PaymentStatus.PENDING,
      },

      data: {
        status: PaymentStatus.FAILED,

        providerPaymentId: confirmation.providerPaymentId,

        providerSessionId:
          confirmation.providerSessionId ?? payment.providerSessionId,

        transactionReference: confirmation.providerPaymentId,

        failureReason,

        failedAt: confirmation.occurredAt,
      },
    });

    /*
     * Handle repeated failed webhook events idempotently.
     */
    if (updateResult.count === 0) {
      const currentPayment = await tx.payment.findUnique({
        where: {
          id: payment.id,
        },

        select: {
          id: true,
          userId: true,
          paymentPurpose: true,
          status: true,
          failureReason: true,
        },
      });

      if (currentPayment?.status === PaymentStatus.FAILED) {
        return {
          paymentId: currentPayment.id,

          userId: currentPayment.userId,

          paymentPurpose: currentPayment.paymentPurpose,

          status: PaymentStatus.FAILED,

          alreadyProcessed: true,
          creditBalanceChanged: false,

          failureReason: currentPayment.failureReason ?? failureReason,
        };
      }

      throw new PaymentProcessingError(
        PaymentErrorCode.INVALID_PAYMENT_STATUS_TRANSITION,
        'The payment could not be marked as failed.',
        {
          details: {
            paymentId: payment.id,
            currentStatus: currentPayment?.status ?? null,
          },
        },
      );
    }

    return {
      paymentId: payment.id,
      userId: payment.userId,

      paymentPurpose: payment.paymentPurpose,

      status: PaymentStatus.FAILED,

      alreadyProcessed: false,
      creditBalanceChanged: false,

      failureReason,
    };
  }

  /**
   * Builds an idempotent result for a payment that
   * was already completed successfully.
   */
  private buildAlreadyProcessedSuccessResult(
    payment: ProcessablePayment,
    confirmation: PaymentConfirmation,
  ): PaymentProcessingResult {
    this.validateCompletedPaymentIdentifiers(
      payment.providerPaymentId,
      payment.providerSessionId,
      confirmation.providerPaymentId,
      confirmation.providerSessionId,
    );

    return {
      paymentId: payment.id,
      userId: payment.userId,

      paymentPurpose: payment.paymentPurpose,

      status: PaymentStatus.SUCCEEDED,

      alreadyProcessed: true,
      creditBalanceChanged: false,
    };
  }

  /**
   * Validates that the provider confirmation belongs
   * to the same provider stored on the payment.
   */
  private validateProviderKey(
    storedProviderKey: string,
    confirmedProviderKey: string,
  ): void {
    const normalizedStoredProviderKey = storedProviderKey.trim().toLowerCase();
    const normalizedConfirmedProviderKey = confirmedProviderKey
      .trim()
      .toLowerCase();

    if (normalizedStoredProviderKey !== normalizedConfirmedProviderKey) {
      throw new PaymentProcessingError(
        PaymentErrorCode.PAYMENT_PROVIDER_MISMATCH,
        'The payment provider does not match the internal payment record.',
        {
          details: {
            storedProviderKey: normalizedStoredProviderKey,
            confirmedProviderKey: normalizedConfirmedProviderKey,
          },
        },
      );
    }
  }

  /**
   * Validates the confirmed payment amount.
   */
  private validateAmount(
    storedAmount: Prisma.Decimal,
    confirmedAmount: string,
  ): void {
    let normalizedAmount: Prisma.Decimal;

    try {
      normalizedAmount = new Prisma.Decimal(confirmedAmount);
    } catch (error) {
      throw new PaymentProcessingError(
        PaymentErrorCode.INVALID_PAYMENT_AMOUNT,
        'The provider returned an invalid payment amount.',
        {
          cause: error,

          details: {
            confirmedAmount,
          },
        },
      );
    }

    if (normalizedAmount.lte(0)) {
      throw new PaymentProcessingError(
        PaymentErrorCode.INVALID_PAYMENT_AMOUNT,
        'The confirmed payment amount must be greater than zero.',
        {
          details: {
            confirmedAmount,
          },
        },
      );
    }

    if (!storedAmount.equals(normalizedAmount)) {
      throw new PaymentProcessingError(
        PaymentErrorCode.PAYMENT_AMOUNT_MISMATCH,
        'The confirmed payment amount does not match the internal payment amount.',
        {
          details: {
            storedAmount: storedAmount.toFixed(2),

            confirmedAmount: normalizedAmount.toFixed(2),
          },
        },
      );
    }
  }

  /**
   * Validates the confirmed payment currency.
   */
  private validateCurrency(
    storedCurrency: string,
    confirmedCurrency: string,
  ): void {
    const normalizedStoredCurrency = storedCurrency.trim().toUpperCase();

    const normalizedConfirmedCurrency = confirmedCurrency.trim().toUpperCase();

    if (normalizedStoredCurrency !== normalizedConfirmedCurrency) {
      throw new PaymentProcessingError(
        PaymentErrorCode.PAYMENT_CURRENCY_MISMATCH,
        'The confirmed payment currency does not match the internal payment currency.',
        {
          details: {
            storedCurrency: normalizedStoredCurrency,

            confirmedCurrency: normalizedConfirmedCurrency,
          },
        },
      );
    }
  }

  /**
   * Prevents one provider payment or checkout-session identifier
   * from being associated with multiple internal payment records.
   */
  private async validateExternalIdentifiers(
    tx: Prisma.TransactionClient,
    paymentId: string,
    providerPaymentId: string,
    providerSessionId?: string,
  ): Promise<void> {
    const paymentIdentifierOwner = await tx.payment.findFirst({
      where: {
        providerPaymentId,

        id: {
          not: paymentId,
        },
      },

      select: {
        id: true,
      },
    });

    if (paymentIdentifierOwner) {
      throw new PaymentProcessingError(
        PaymentErrorCode.DUPLICATE_PROVIDER_PAYMENT,
        'The external payment identifier is already associated with another payment.',
        {
          details: {
            paymentId,

            conflictingPaymentId: paymentIdentifierOwner.id,
          },
        },
      );
    }

    if (!providerSessionId) {
      return;
    }

    const sessionIdentifierOwner = await tx.payment.findFirst({
      where: {
        providerSessionId,

        id: {
          not: paymentId,
        },
      },

      select: {
        id: true,
      },
    });

    if (sessionIdentifierOwner) {
      throw new PaymentProcessingError(
        PaymentErrorCode.DUPLICATE_PROVIDER_SESSION,
        'The external checkout-session identifier is already associated with another payment.',
        {
          details: {
            paymentId,

            conflictingPaymentId: sessionIdentifierOwner.id,
          },
        },
      );
    }
  }

  /**
   * Ensures that a repeated successful webhook contains
   * the same external identifiers already stored.
   */
  private validateCompletedPaymentIdentifiers(
    storedProviderPaymentId: string | null,
    storedProviderSessionId: string | null,
    confirmedProviderPaymentId: string,
    confirmedProviderSessionId?: string,
  ): void {
    if (
      storedProviderPaymentId &&
      storedProviderPaymentId !== confirmedProviderPaymentId
    ) {
      throw new PaymentProcessingError(
        PaymentErrorCode.PAYMENT_ALREADY_COMPLETED,
        'The payment was already completed using a different provider payment identifier.',
      );
    }

    if (
      storedProviderSessionId &&
      confirmedProviderSessionId &&
      storedProviderSessionId !== confirmedProviderSessionId
    ) {
      throw new PaymentProcessingError(
        PaymentErrorCode.PAYMENT_ALREADY_COMPLETED,
        'The payment was already completed using a different provider session identifier.',
      );
    }
  }

  /**
   * Validates supported payment-status transitions.
   */
  private validateStatusTransition(
    currentStatus: PaymentStatus,
    requestedStatus: PaymentStatus,
  ): void {
    if (currentStatus === PaymentStatus.REFUNDED) {
      throw new PaymentProcessingError(
        PaymentErrorCode.INVALID_PAYMENT_STATUS_TRANSITION,
        'A refunded payment cannot transition to another status.',
        {
          details: {
            currentStatus,
            requestedStatus,
          },
        },
      );
    }

    if (
      currentStatus === PaymentStatus.SUCCEEDED &&
      requestedStatus !== PaymentStatus.SUCCEEDED
    ) {
      throw new PaymentProcessingError(
        PaymentErrorCode.INVALID_PAYMENT_STATUS_TRANSITION,
        'A successful payment cannot transition through the standard confirmation workflow.',
        {
          details: {
            currentStatus,
            requestedStatus,
          },
        },
      );
    }

    if (
      currentStatus === PaymentStatus.FAILED &&
      requestedStatus === PaymentStatus.PENDING
    ) {
      throw new PaymentProcessingError(
        PaymentErrorCode.INVALID_PAYMENT_STATUS_TRANSITION,
        'A failed payment cannot return to pending status.',
        {
          details: {
            currentStatus,
            requestedStatus,
          },
        },
      );
    }
  }

  /**
   * Converts known Prisma errors into stable
   * payment-domain errors.
   */
  private rethrowKnownPaymentError(error: unknown): never {
    if (error instanceof PaymentProcessingError) {
      throw error;
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const rawTarget = error.meta?.target;

      const target = Array.isArray(rawTarget)
        ? rawTarget
            .filter((value): value is string => typeof value === 'string')
            .join(',')
        : typeof rawTarget === 'string'
          ? rawTarget
          : '';

      const errorCode =
        target.includes('provider_session_id') ||
        target.includes('providerSessionId')
          ? PaymentErrorCode.DUPLICATE_PROVIDER_SESSION
          : PaymentErrorCode.DUPLICATE_PROVIDER_PAYMENT;

      throw new PaymentProcessingError(
        errorCode,
        'The external payment identifier is already associated with another payment.',
        {
          cause: error,

          details: {
            target,
          },
        },
      );
    }

    throw new PaymentProcessingError(
      PaymentErrorCode.PAYMENT_PROCESSING_FAILED,
      'The payment could not be processed due to an unexpected failure.',
      {
        cause: error,
      },
    );
  }
}
