import type { PaymentConfirmation } from './payment-confirmation.type';

/**
 * Trusted server-to-server inspection result for an existing provider session.
 *
 * This is used as a recovery path when the customer completed payment but the
 * local webhook was delayed, missed during local development, or the browser
 * returned before fulfillment finished.
 *
 * The browser is never trusted as proof of payment. Gateways must retrieve the
 * session directly from the payment provider using server credentials.
 */
export type PaymentSessionInspectionResult =
  | {
      readonly state: 'OPEN';
      readonly checkoutUrl: string;
      readonly expiresAt?: Date;
    }
  | {
      readonly state: 'SUCCEEDED' | 'FAILED';
      readonly confirmation: PaymentConfirmation;
    };