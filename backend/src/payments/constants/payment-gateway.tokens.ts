/**
 * Dependency-injection token used to register all
 * supported payment-gateway implementations.
 *
 * PaymentGateway is a TypeScript interface and therefore
 * does not exist at runtime. A custom injection token is
 * required to inject gateway implementations as a collection.
 *
 * @author Eman
 */
export const PAYMENT_GATEWAYS = Symbol('PAYMENT_GATEWAYS');
