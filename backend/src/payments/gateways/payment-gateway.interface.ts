import type { CreatePaymentSessionInput } from '../types/create-payment-session.type';
import type { PaymentConfirmation } from '../types/payment-confirmation.type';
import type { PaymentSessionResult } from '../types/payment-session-result.type';
import type { PaymentWebhookInput } from '../types/payment-webhook-input.type';

/**
 * Defines the contract implemented by every external payment gateway.
 *
 * The Payment module depends on this abstraction instead of depending
 * directly on provider-specific SDKs or APIs.
 *
 * Each gateway implementation is responsible for:
 * - Declaring its provider key.
 * - Creating an external checkout session.
 * - Verifying provider-specific webhook signatures.
 * - Validating provider payloads.
 * - Normalizing provider responses into internal payment contracts.
 *
 * This keeps application services independent from Stripe, PayPal,
 * or any future payment provider.
 *
 * @author Eman
 */
export interface PaymentGateway {
  /**
   * Stable key identifying the payment provider.
   *
   * Examples:
   * - stripe
   * - paypal
   */
  readonly providerKey: string;

  /**
   * Creates an external checkout session for a pending internal payment.
   *
   * Implementations must convert the normalized input into the format
   * required by the provider SDK or API, then return a provider-independent
   * result.
   *
   * Creating a checkout session does not confirm that payment succeeded.
   * Payment completion must be established only through a verified
   * provider webhook.
   *
   * @param input Normalized checkout-session input.
   * @returns External checkout-session details.
   */
  createPaymentSession(
    input: CreatePaymentSessionInput,
  ): Promise<PaymentSessionResult>;

  /**
   * Verifies and normalizes an incoming provider webhook.
   *
   * Implementations must reject invalid signatures, malformed payloads,
   * unsupported events, and incomplete payment data before returning a
   * normalized confirmation.
   *
   * The returned confirmation must never expose sensitive provider data
   * such as payment-card details, credentials, access tokens, or webhook secrets.
   *
   * @param input Raw webhook request information.
   * @returns Verified and normalized payment confirmation.
   */
  verifyWebhook(
    input: PaymentWebhookInput,
  ): Promise<PaymentConfirmation>;
}