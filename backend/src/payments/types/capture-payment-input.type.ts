/**
 * Input required to capture an externally approved payment.
 *
 * Used by payment providers whose checkout flow requires
 * a separate server-side capture operation after buyer approval,
 * such as PayPal.
 *
 * @author Eman
 */
export type CapturePaymentInput = {
  /**
   * Internal Nexora AI payment identifier.
   */
  readonly paymentId: string;

  /**
   * External provider checkout session or order identifier.
   *
   * For PayPal, this value represents the PayPal Order ID.
   */
  readonly providerSessionId: string;
};
