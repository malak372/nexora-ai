/**
 * Stable, machine-readable error codes used by the Payment module.
 *
 * These codes allow services, controllers, exception filters, logs,
 * and automated tests to identify payment failures without relying on
 * human-readable messages.
 *
 * Error messages may change for localization or clarity, while these
 * codes must remain stable to preserve API and test compatibility.
 *
 * @author Eman
 */
export enum PaymentErrorCode {
  /**
   * The requested internal payment record does not exist.
   */
  PAYMENT_NOT_FOUND = 'PAYMENT_NOT_FOUND',

  /**
   * The payment has already been completed successfully.
   *
   * This prevents credits or direct-unlock access from being granted
   * more than once when the same provider event is received repeatedly.
   */
  PAYMENT_ALREADY_COMPLETED = 'PAYMENT_ALREADY_COMPLETED',

  /**
   * The requested payment-state transition is not allowed.
   */
  INVALID_PAYMENT_STATUS_TRANSITION = 'INVALID_PAYMENT_STATUS_TRANSITION',

  /**
   * The payment amount is missing, invalid, or not greater than zero.
   */
  INVALID_PAYMENT_AMOUNT = 'INVALID_PAYMENT_AMOUNT',

  /**
   * The amount confirmed by the payment provider does not match
   * the amount stored on the internal payment record.
   */
  PAYMENT_AMOUNT_MISMATCH = 'PAYMENT_AMOUNT_MISMATCH',

  /**
   * The currency confirmed by the payment provider does not match
   * the currency stored on the internal payment record.
   */
  PAYMENT_CURRENCY_MISMATCH = 'PAYMENT_CURRENCY_MISMATCH',

  /**
   * The requested payment purpose is not supported.
   */
  INVALID_PAYMENT_PURPOSE = 'INVALID_PAYMENT_PURPOSE',

  /**
   * The provided payment-method key has an invalid format.
   */
  INVALID_PAYMENT_METHOD_KEY = 'INVALID_PAYMENT_METHOD_KEY',

  /**
   * The selected payment-method key is not registered or enabled.
   */
  UNSUPPORTED_PAYMENT_METHOD = 'UNSUPPORTED_PAYMENT_METHOD',

  /**
   * The provided payment-provider key has an invalid format.
   */
  INVALID_PAYMENT_PROVIDER_KEY = 'INVALID_PAYMENT_PROVIDER_KEY',

  /**
   * No payment gateway implementation is registered for the
   * selected payment-provider key.
   */
  UNSUPPORTED_PAYMENT_PROVIDER = 'UNSUPPORTED_PAYMENT_PROVIDER',

  /**
   * The selected payment method cannot be processed by the
   * resolved payment provider.
   */
  PAYMENT_METHOD_PROVIDER_MISMATCH = 'PAYMENT_METHOD_PROVIDER_MISMATCH',

  /**
   * A provided checkout redirect URL is invalid or not allowed.
   */
  INVALID_PAYMENT_REDIRECT_URL = 'INVALID_PAYMENT_REDIRECT_URL',

  /**
   * The external payment provider could not create a checkout session.
   */
  PAYMENT_SESSION_CREATION_FAILED = 'PAYMENT_SESSION_CREATION_FAILED',

  /**
   * The external provider returned an invalid or incomplete
   * checkout-session response.
   */
  INVALID_PAYMENT_SESSION_RESPONSE = 'INVALID_PAYMENT_SESSION_RESPONSE',

  /**
   * The payment-provider webhook signature could not be verified.
   */
  PAYMENT_WEBHOOK_VERIFICATION_FAILED = 'PAYMENT_WEBHOOK_VERIFICATION_FAILED',

  /**
   * The provider webhook payload could not be parsed or normalized.
   */
  INVALID_PAYMENT_WEBHOOK_PAYLOAD = 'INVALID_PAYMENT_WEBHOOK_PAYLOAD',

  /**
   * The webhook payload does not contain the internal payment ID
   * required to match it with an internal payment record.
   */
  PAYMENT_REFERENCE_MISSING = 'PAYMENT_REFERENCE_MISSING',

  /**
   * The provider key received in the webhook does not match the
   * provider key stored on the internal payment record.
   */
  PAYMENT_PROVIDER_MISMATCH = 'PAYMENT_PROVIDER_MISMATCH',

  /**
   * The external payment identifier has already been associated
   * with another internal payment.
   */
  DUPLICATE_PROVIDER_PAYMENT = 'DUPLICATE_PROVIDER_PAYMENT',

  /**
   * The external checkout-session identifier has already been
   * associated with another internal payment.
   */
  DUPLICATE_PROVIDER_SESSION = 'DUPLICATE_PROVIDER_SESSION',

  /**
   * More than one gateway implementation was registered for
   * the same payment-provider key.
   */
  DUPLICATE_PAYMENT_GATEWAY = 'DUPLICATE_PAYMENT_GATEWAY',

  /**
   * The global system-settings record could not be found.
   */
  SYSTEM_SETTINGS_NOT_FOUND = 'SYSTEM_SETTINGS_NOT_FOUND',

  /**
   * The configured price of one credit is missing or invalid.
   */
  INVALID_CREDIT_PRICE = 'INVALID_CREDIT_PRICE',

  /**
   * The configured direct-unlock price is missing or invalid.
   */
  INVALID_DIRECT_UNLOCK_PRICE = 'INVALID_DIRECT_UNLOCK_PRICE',

  /**
   * The configured bonus-credit threshold or bonus amount is invalid.
   */
  INVALID_BONUS_CONFIGURATION = 'INVALID_BONUS_CONFIGURATION',

  /**
   * The requested credit quantity is outside the supported range.
   */
  INVALID_CREDIT_QUANTITY = 'INVALID_CREDIT_QUANTITY',

  /**
   * Purchased credits could not be applied consistently to the
   * user's balance and credit-transaction history.
   */
  CREDIT_PURCHASE_PROCESSING_FAILED = 'CREDIT_PURCHASE_PROCESSING_FAILED',

  /**
   * The requested idea does not exist.
   */
  IDEA_NOT_FOUND = 'IDEA_NOT_FOUND',

  /**
   * The authenticated user does not own the requested idea.
   */
  IDEA_ACCESS_DENIED = 'IDEA_ACCESS_DENIED',

  /**
   * The selected idea has already been unlocked.
   */
  IDEA_ALREADY_UNLOCKED = 'IDEA_ALREADY_UNLOCKED',

  /**
   * The selected idea is not eligible for direct-payment unlock.
   */
  IDEA_NOT_ELIGIBLE_FOR_DIRECT_UNLOCK = 'IDEA_NOT_ELIGIBLE_FOR_DIRECT_UNLOCK',

  /**
   * The selected idea could not be unlocked consistently after
   * successful payment confirmation.
   */
  DIRECT_UNLOCK_PROCESSING_FAILED = 'DIRECT_UNLOCK_PROCESSING_FAILED',

  /**
   * The payment could not be processed because of an unexpected
   * internal or external failure.
   */
  PAYMENT_PROCESSING_FAILED = 'PAYMENT_PROCESSING_FAILED',
}
