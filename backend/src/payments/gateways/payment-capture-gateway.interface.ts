import type { CapturePaymentInput } from '../types/capture-payment-input.type';
import type { PaymentConfirmation } from '../types/payment-confirmation.type';

/**
 * Contract implemented by payment gateways that require
 * an explicit server-side capture operation.
 *
 * This interface remains separate from PaymentGateway because:
 * - Stripe Checkout does not require a separate capture request
 *   in the standard checkout flow.
 * - PayPal requires an approved order to be captured.
 * - Future providers may use different completion workflows.
 *
 * Implementations must:
 * - Validate the external order or session identifier.
 * - Capture the approved payment through the provider API.
 * - Normalize the provider response.
 * - Never grant credits or unlock ideas directly.
 *
 * Payment fulfillment remains owned by PaymentProcessingService.
 *
 * @author Eman
 */
export interface PaymentCaptureGateway {
  /**
   * Captures one provider-approved payment.
   *
   * @param input Internal and external payment identifiers.
   * @returns Verified and normalized payment confirmation.
   */
  capturePayment(input: CapturePaymentInput): Promise<PaymentConfirmation>;
}
