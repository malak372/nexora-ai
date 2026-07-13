import { Inject, Injectable } from '@nestjs/common';

import { PaymentProvider } from '@prisma/client';

import { PAYMENT_GATEWAYS } from '../constants/payment-gateway.tokens';

import { PaymentErrorCode } from '../errors/payment-error-code.enum';
import { PaymentProcessingError } from '../errors/payment-processing.error';

import type { PaymentGateway } from './payment-gateway.interface';

/**
 * Resolves registered payment-gateway implementations
 * by external payment provider.
 *
 * Responsibilities:
 * - Receive all registered PaymentGateway implementations.
 * - Build an immutable provider-to-gateway lookup map.
 * - Detect duplicate provider registrations during application startup.
 * - Resolve the correct gateway for a payment provider.
 * - Reject unsupported providers using stable payment-domain errors.
 *
 * Application services depend on this factory instead of depending
 * directly on Stripe, PayPal, or any future provider-specific
 * gateway implementation.
 *
 * @author Eman
 */
@Injectable()
export class PaymentGatewayFactory {
  /**
   * Immutable lookup map used to resolve gateways in constant time.
   */
  private readonly gatewaysByProvider: ReadonlyMap<
    PaymentProvider,
    PaymentGateway
  >;

  constructor(
    @Inject(PAYMENT_GATEWAYS)
    gateways: readonly PaymentGateway[],
  ) {
    this.gatewaysByProvider = this.buildGatewayMap(gateways);
  }

  /**
   * Resolves the gateway registered for one payment provider.
   *
   * @param provider External payment provider.
   * @returns Matching payment gateway implementation.
   * @throws PaymentProcessingError when no gateway is registered.
   */
  getGateway(provider: PaymentProvider): PaymentGateway {
    const gateway = this.gatewaysByProvider.get(provider);

    if (!gateway) {
      throw new PaymentProcessingError(
        PaymentErrorCode.UNSUPPORTED_PAYMENT_PROVIDER,
        'No payment gateway is registered for the selected provider.',
        {
          details: {
            provider,
          },
        },
      );
    }

    return gateway;
  }

  /**
   * Determines whether a gateway is registered
   * for the specified provider.
   *
   * @param provider External payment provider.
   * @returns True when a matching gateway exists.
   */
  supports(provider: PaymentProvider): boolean {
    return this.gatewaysByProvider.has(provider);
  }

  /**
   * Returns all currently registered payment providers.
   *
   * This can be used for diagnostics, health checks,
   * or administrative provider-status endpoints.
   */
  getSupportedProviders(): readonly PaymentProvider[] {
    return Array.from(this.gatewaysByProvider.keys());
  }

  /**
   * Builds the provider-to-gateway lookup map.
   *
   * Duplicate provider registrations are rejected during
   * application initialization because resolving more than
   * one gateway for the same provider would make payment
   * behavior ambiguous and unsafe.
   *
   * @param gateways Registered gateway implementations.
   * @returns Immutable provider-to-gateway map.
   */
  private buildGatewayMap(
    gateways: readonly PaymentGateway[],
  ): ReadonlyMap<PaymentProvider, PaymentGateway> {
    const gatewayMap = new Map<PaymentProvider, PaymentGateway>();

    for (const gateway of gateways) {
      this.validateGateway(gateway);

      if (gatewayMap.has(gateway.provider)) {
        throw new PaymentProcessingError(
          PaymentErrorCode.DUPLICATE_PAYMENT_GATEWAY,
          'More than one payment gateway is registered for the same provider.',
          {
            details: {
              provider: gateway.provider,
            },
          },
        );
      }

      gatewayMap.set(gateway.provider, gateway);
    }

    return gatewayMap;
  }

  /**
   * Validates the minimum runtime contract expected
   * from a registered gateway implementation.
   *
   * TypeScript interfaces are erased at runtime, so this
   * defensive validation protects against malformed custom
   * providers or incorrect dependency-injection registration.
   */
  private validateGateway(gateway: PaymentGateway): void {
    if (
      !gateway ||
      !gateway.provider ||
      typeof gateway.createPaymentSession !== 'function' ||
      typeof gateway.verifyWebhook !== 'function'
    ) {
      throw new PaymentProcessingError(
        PaymentErrorCode.UNSUPPORTED_PAYMENT_PROVIDER,
        'An invalid payment gateway implementation was registered.',
        {
          details: {
            provider: gateway?.provider ?? null,
          },
        },
      );
    }
  }
}
