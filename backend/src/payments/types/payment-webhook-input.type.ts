/**
 * Represents the raw webhook request information passed from the
 * payment-webhook controller to a provider-specific payment gateway.
 *
 * Each payment provider uses a different webhook payload structure and
 * signature-verification mechanism. Therefore, the parsed payload remains
 * unknown until the responsible gateway validates and normalizes it.
 *
 * The original raw request body is preserved because some providers require
 * the exact request bytes to verify the webhook signature correctly.
 *
 * @author Eman
 */
export type PaymentWebhookInput = Readonly<{
    /**
     * Parsed webhook payload received by the application.
     *
     * This value must be treated as untrusted input until the selected gateway
     * verifies the provider signature and validates the payload structure.
     */
    payload: unknown;

    /**
     * Original unmodified webhook request body.
     *
     * Some providers, including Stripe, require the exact raw bytes used in the
     * incoming HTTP request to verify the webhook signature.
     *
     * This field may be omitted only when the provider does not require raw-body
     * signature verification.
     */
    rawBody?: Buffer;

    /**
     * Incoming HTTP request headers.
     *
     * Provider-specific gateways use these headers to read signatures,
     * transmission identifiers, event identifiers, or other values required
     * during webhook verification.
     */
    headers: Readonly<
        Record<string, string | string[] | undefined>
    >;
}>;