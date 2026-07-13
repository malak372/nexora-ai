import { PaymentMethod, PaymentPurpose } from '@prisma/client';

/**
 * Represents the normalized input required to create an external
 * payment checkout session.
 *
 * All payment gateway implementations receive this provider-independent
 * structure regardless of the underlying SDK or external API.
 *
 * Monetary values are represented as normalized decimal strings to avoid
 * JavaScript floating-point precision issues.
 *
 * @author Eman
 */
export type CreatePaymentSessionInput = {
  /**
   * Internal Nexora AI payment identifier.
   *
   * The payment record must be created before communicating with the
   * external payment provider.
   */
  paymentId: string;

  /**
   * Authenticated user who initiated the payment.
   */
  userId: string;

  /**
   * User-facing payment method selected during checkout.
   *
   * The PaymentGatewayFactory resolves this method to the corresponding
   * external provider:
   * - CARD to Stripe.
   * - PAYPAL to PayPal.
   */
  paymentMethod: PaymentMethod;

  /**
   * Business purpose of the payment.
   *
   * BUY_CREDITS purchases generation credits.
   * DIRECT_UNLOCK unlocks advanced features for one existing free idea.
   */
  paymentPurpose: PaymentPurpose;

  /**
   * Total payment amount represented as a normalized decimal string.
   *
   * Example:
   * "10.00"
   */
  amount: string;

  /**
   * ISO 4217 currency code.
   *
   * Example:
   * USD
   */
  currency: string;

  /**
   * URL to which the provider redirects the user after successful
   * checkout.
   *
   * This redirect must not be treated as final proof of payment.
   * Payment completion is confirmed only through a verified webhook.
   */
  successUrl: string;

  /**
   * URL to which the provider redirects the user when checkout is
   * cancelled.
   */
  cancelUrl: string;

  /**
   * Existing idea identifier associated with a direct-unlock payment.
   *
   * Required when paymentPurpose is DIRECT_UNLOCK and omitted when
   * purchasing credits.
   */
  ideaId?: string;

  /**
   * Number of generation credits requested by the user.
   *
   * Required when paymentPurpose is BUY_CREDITS and omitted for
   * direct-unlock payments.
   */
  creditsQuantity?: number;

  /**
   * Sanitized metadata attached to the external checkout session.
   *
   * Metadata is returned through provider webhooks and allows the system
   * to match the external transaction with its internal Payment record.
   *
   * Sensitive information such as passwords, API keys, access tokens,
   * webhook secrets, or payment-card data must never be included.
   */
  metadata: Readonly<Record<string, string>>;
};
