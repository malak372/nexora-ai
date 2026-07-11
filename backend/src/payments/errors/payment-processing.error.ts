import { PaymentErrorCode } from './payment-error-code.enum';

/**
 * Represents a business error raised by the Payment module.
 *
 * This error remains independent from HTTP concerns and can be thrown
 * from payment gateways, application services, and domain-level payment
 * operations. Controllers or a global exception filter are responsible
 * for translating it into an appropriate API response.
 *
 * The stable error code identifies the failure, while the message is
 * intended for diagnostics and logging.
 *
 * Optional contextual details must never contain sensitive information
 * such as card data, API credentials, access tokens, or webhook secrets.
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
    readonly details?: Readonly<Record<string, unknown>>;

    constructor(
        code: PaymentErrorCode,
        message: string,
        options?: {
            cause?: unknown;
            details?: Readonly<Record<string, unknown>>;
        },
    ) {
        super(message, {
            cause: options?.cause,
        });

        this.name = PaymentProcessingError.name;
        this.code = code;
        this.details = options?.details;

        Object.setPrototypeOf(
            this,
            PaymentProcessingError.prototype,
        );
    }
}