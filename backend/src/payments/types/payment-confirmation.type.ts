import { PaymentProvider, PaymentStatus } from '@prisma/client';

/**
 * Represents a verified and normalized payment event received from an
 * external payment provider.
 *
 * Each payment gateway is responsible for validating the provider-specific
 * webhook signature and converting the original payload into this common
 * structure before the event reaches the payment-processing service.
 *
 * A successful confirmation may result in one of two business operations:
 * - Adding purchased credits to the user's balance.
 * - Unlocking advanced features for one existing free idea.
 *
 * A direct-unlock payment does not generate a new idea and does not add
 * credits. It only grants access to advanced content and features associated
 * with the selected free idea.
 *
 * Payment processing must rely only on verified provider confirmations and
 * must never trust client-side redirects as proof of successful payment.
 *
 * @author Eman
 */
export type PaymentConfirmation = {
  /**
   * External payment provider that issued the payment event.
   */
  provider: PaymentProvider;

  /**
   * Internal Nexora AI payment identifier.
   *
   * This value is recovered from provider metadata and is used to locate
   * the corresponding Payment record.
   */
  paymentId: string;

  /**
   * External payment, capture, transaction, or charge identifier.
   *
   * This identifier is stored for auditing, reconciliation, and idempotent
   * payment processing.
   */
  providerPaymentId: string;

  /**
   * External checkout-session or order identifier, when available.
   *
   * This value helps correlate the confirmation event with the checkout
   * session created earlier.
   */
  providerSessionId?: string;

  /**
   * Normalized internal payment status.
   *
   * Only supported PaymentStatus values may leave the gateway
   * normalization layer.
   */
  status: PaymentStatus;

  /**
   * Confirmed payment amount represented as a normalized decimal string.
   *
   * Example:
   * "10.00"
   *
   * Before granting credits or unlocking advanced idea features, the
   * processing service must compare this value with the amount stored
   * on the internal Payment record.
   */
  amount: string;

  /**
   * Confirmed ISO 4217 currency code.
   *
   * Example:
   * USD
   *
   * The processing service must verify that this value matches the currency
   * stored on the internal Payment record.
   */
  currency: string;

  /**
   * Unique provider event identifier, when available.
   *
   * This value supports diagnostics, distributed tracing, auditing, and
   * duplicate-event detection.
   */
  providerEventId?: string;

  /**
   * Sanitized failure reason returned by the payment provider.
   *
   * This field is normally present only when the normalized payment status
   * is FAILED.
   */
  failureReason?: string;

  /**
   * Timestamp at which the external provider reports that the payment event
   * occurred.
   */
  occurredAt: Date;

  /**
   * Sanitized provider metadata returned with the payment event.
   *
   * Metadata may be used for correlation and diagnostics. It must never
   * contain payment-card details, API credentials, access tokens, webhook
   * secrets, passwords, or other sensitive information.
   */
  metadata: Readonly<Record<string, string>>;
};
