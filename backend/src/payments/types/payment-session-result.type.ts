/**
 * Represents the normalized result returned after an external payment
 * provider creates a checkout session.
 *
 * Every payment gateway must return this provider-independent structure,
 * regardless of the underlying SDK or API response format.
 *
 * @author Eman
 */
export type PaymentSessionResult = {
  /**
   * External payment provider key that created the checkout session.
   *
   * Examples:
   * - stripe
   * - paypal
   */
  providerKey: string;

  /**
   * External checkout-session identifier returned by the provider.
   *
   * This value is stored on the internal Payment record and is later
   * used to correlate provider webhooks with the original checkout.
   */
  providerSessionId: string;

  /**
   * Provider-hosted checkout URL.
   *
   * The client application redirects the user to this URL to complete
   * the payment with the external provider.
   */
  checkoutUrl: string;

  /**
   * External payment identifier, when available.
   *
   * Some providers generate this identifier during checkout creation,
   * while others provide it only after the payment has been completed
   * and confirmed.
   */
  providerPaymentId?: string;

  /**
   * Optional expiration time of the external checkout session.
   *
   * This field is omitted when the provider does not expose a reliable
   * expiration timestamp.
   */
  expiresAt?: Date;
};