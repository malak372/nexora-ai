import { PaymentProvider } from '@prisma/client';

import { CreatePaymentSessionInput } from '../types/create-payment-session.type';
import { PaymentConfirmation } from '../types/payment-confirmation.type';
import { PaymentSessionResult } from '../types/payment-session-result.type';
import { PaymentWebhookInput } from '../types/payment-webhook-input.type';

/**
 * Defines the contract implemented by every external payment gateway.
 *
 * The Payment module depends on this abstraction instead of depending
 * directly on provider-specific SDKs or APIs.
 *
 * Each gateway implementation is responsible for:
 * - Declaring the external provider it represents.
 * - Creating an external checkout session.
 * - Verifying provider-specific webhook signatures.
 * - Validating provider payloads.
 * - Normalizing provider responses into internal payment contracts.
 *
 * This keeps the application services independent from Stripe, PayPal,
 * or any future payment provider.
 *
 * @author Eman
 */
export interface PaymentGateway {
  /**
   * External payment provider represented by this gateway.
   */
  readonly provider: PaymentProvider;

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
   * The returned confirmation must not expose payment-card details,
   * provider credentials, access tokens, webhook secrets, or other
   * sensitive information.
   *
   * @param input Raw webhook request information.
   * @returns Verified and normalized payment confirmation.
   */
  verifyWebhook(input: PaymentWebhookInput): Promise<PaymentConfirmation>;
}
