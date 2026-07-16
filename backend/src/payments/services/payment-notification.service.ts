import { Injectable, Logger } from '@nestjs/common';

import { PaymentMethod, PaymentPurpose } from '@prisma/client';

import { MailService } from '../../mail/mail.service';

/**
 * Common payment-notification details shared by successful
 * and failed payment email notifications.
 */
type BasePaymentNotificationInput = {
  /**
   * Internal payment identifier used for logging and tracing.
   */
  readonly paymentId: string;

  /**
   * Recipient email address.
   */
  readonly recipientEmail: string;

  /**
   * Payment amount.
   */
  readonly amount: number;

  /**
   * ISO payment currency code.
   */
  readonly currency: string;

  /**
   * Payment method used by the customer.
   */
  readonly paymentMethod: PaymentMethod;

  /**
   * Business purpose associated with the payment.
   */
  readonly paymentPurpose: PaymentPurpose;

  /**
   * Optional external provider transaction reference.
   */
  readonly transactionReference?: string;
};

/**
 * Input required to send a successful-payment notification.
 */
export type NotifyPaymentSucceededInput = BasePaymentNotificationInput;

/**
 * Input required to send a failed-payment notification.
 */
export type NotifyPaymentFailedInput = BasePaymentNotificationInput & {
  /**
   * Optional safe failure reason shown to the customer.
   *
   * Internal provider errors and sensitive technical details
   * must not be exposed through this field.
   */
  readonly failureReason?: string;
};

/**
 * Central service responsible for payment-related email notifications.
 *
 * Responsibilities:
 * - Send successful payment notifications.
 * - Send failed payment notifications.
 * - Isolate notification logic from payment-processing logic.
 * - Prevent payment services from depending directly on
 *   email implementation details.
 * - Handle notification-delivery failures without affecting
 *   completed payment operations.
 *
 * Business services remain responsible for deciding
 * when a notification should be triggered.
 *
 * This service is responsible only for notification delivery.
 *
 * @author Eman
 */
@Injectable()
export class PaymentNotificationService {
  /**
   * Logger used to record notification-delivery failures
   * without exposing recipient personal information.
   */
  private readonly logger = new Logger(PaymentNotificationService.name);

  constructor(private readonly mailService: MailService) {}

  /**
   * Sends a payment-success email notification.
   *
   * Email delivery failures are logged and intentionally suppressed
   * because notification delivery must not reverse or interrupt an
   * already completed payment operation.
   *
   * @param input Successful-payment notification details.
   */
  async notifyPaymentSucceeded(
    input: NotifyPaymentSucceededInput,
  ): Promise<void> {
    try {
      await this.mailService.sendPaymentReceipt(
        input.recipientEmail,
        input.amount,
        input.currency,
        input.paymentMethod,
        input.paymentPurpose,
        input.transactionReference,
      );
    } catch (error) {
      this.logDeliveryFailure('payment-success', input.paymentId, error);
    }
  }

  /**
   * Sends a payment-failure email notification.
   *
   * Email delivery failures are logged and intentionally suppressed
   * because notification delivery must not interrupt or alter the
   * confirmed failed-payment workflow.
   *
   * @param input Failed-payment notification details.
   */
  async notifyPaymentFailed(input: NotifyPaymentFailedInput): Promise<void> {
    try {
      await this.mailService.sendPaymentFailedEmail(
        input.recipientEmail,
        input.amount,
        input.currency,
        input.paymentMethod,
        input.paymentPurpose,
        input.failureReason,
        input.transactionReference,
      );
    } catch (error) {
      this.logDeliveryFailure('payment-failure', input.paymentId, error);
    }
  }

  /**
   * Records notification-delivery failures without exposing
   * recipient personal information or interrupting payment flows.
   *
   * @param notificationType Notification category.
   * @param paymentId Internal payment identifier.
   * @param error Delivery error.
   */
  private logDeliveryFailure(
    notificationType: 'payment-success' | 'payment-failure',
    paymentId: string,
    error: unknown,
  ): void {
    this.logger.error(
      `Failed to deliver ${notificationType} notification for payment ${paymentId}.`,
      error instanceof Error ? error.stack : undefined,
    );
  }
}
