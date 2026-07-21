import { PaymentErrorCode } from './payment-error-code.enum';

/**
 * Optional sanitized diagnostic context attached to a payment error.
 *
 * This object must never contain sensitive information such as:
 * - Card data.
 * - Provider credentials.
 * - Access tokens.
 * - Webhook secrets.
 * - Raw authorization headers.
 */
export type PaymentErrorDetails = Readonly<Record<string, unknown>>;

/**
 * Options used when constructing a PaymentProcessingError.
 */
export interface PaymentProcessingErrorOptions {
  /**
   * Original error that caused the payment failure.
   */
  cause?: unknown;

  /**
   * Optional sanitized diagnostic context.
   */
  details?: PaymentErrorDetails;
}

/**
 * Represents a business or application error raised by the Payment module.
 *
 * This error remains independent from HTTP concerns and can be thrown
 * from payment gateways, application services, and payment-processing
 * workflows.
 *
 * Controllers or a global exception filter are responsible for mapping
 * this error to an appropriate HTTP response.
 *
 * @author Eman
 */
export class PaymentProcessingError extends Error {
  /**
   * Stable machine-readable identifier for the payment failure.
   */
  readonly code: PaymentErrorCode;

  /**
   * Optional sanitized contextual data used for diagnostics.
   */
  readonly details?: PaymentErrorDetails;

  constructor(
    code: PaymentErrorCode,
    message: string,
    options: PaymentProcessingErrorOptions = {},
  ) {
    super(message, {
      cause: options.cause,
    });

    this.name = PaymentProcessingError.name;
    this.code = code;
    this.details = options.details
      ? Object.freeze({ ...options.details })
      : undefined;

    Object.setPrototypeOf(this, new.target.prototype);

    Error.captureStackTrace?.(this, PaymentProcessingError);
  }

  /**
   * Checks whether an unknown value is a PaymentProcessingError.
   */
  static is(error: unknown): error is PaymentProcessingError {
    return error instanceof PaymentProcessingError;
  }
}
