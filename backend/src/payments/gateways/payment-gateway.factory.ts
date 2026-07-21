import { Inject, Injectable } from '@nestjs/common';

import { PAYMENT_GATEWAYS } from '../constants/payment-gateway.tokens';

import { PaymentErrorCode } from '../errors/payment-error-code.enum';
import { PaymentProcessingError } from '../errors/payment-processing.error';

import type { PaymentGateway } from './payment-gateway.interface';

/**
 * Resolves registered payment gateways by provider key.
 *
 * Responsibilities:
 * - Receive all registered PaymentGateway implementations.
 * - Build a provider-key-to-gateway lookup map.
 * - Detect duplicate provider registrations during application startup.
 * - Resolve the correct gateway for a provider key.
 * - Reject unsupported or invalid provider keys.
 *
 * Application services depend on this factory instead of depending
 * directly on Stripe, PayPal, or any future provider implementation.
 *
 * @author Eman
 */
@Injectable()
export class PaymentGatewayFactory {
  /**
   * Lookup map used to resolve gateways by provider key.
   */
  private readonly gatewaysByProviderKey: ReadonlyMap<string, PaymentGateway>;

  constructor(
    @Inject(PAYMENT_GATEWAYS)
    gateways: readonly PaymentGateway[],
  ) {
    this.gatewaysByProviderKey = this.buildGatewayMap(gateways);
  }

  /**
   * Resolves the gateway registered for one provider key.
   *
   * @param providerKey External payment-provider key.
   * @returns Matching payment gateway implementation.
   * @throws PaymentProcessingError when no gateway is registered.
   */
  getGateway(providerKey: string): PaymentGateway {
    const normalizedProviderKey = this.normalizeProviderKey(providerKey);

    const gateway = this.gatewaysByProviderKey.get(normalizedProviderKey);

    if (!gateway) {
      throw new PaymentProcessingError(
        PaymentErrorCode.UNSUPPORTED_PAYMENT_PROVIDER,
        'No payment gateway is registered for the selected provider key.',
        {
          details: {
            providerKey: normalizedProviderKey,
          },
        },
      );
    }

    return gateway;
  }

  /**
   * Determines whether a gateway is registered
   * for the specified provider key.
   */
  supports(providerKey: string): boolean {
    const normalizedProviderKey = this.normalizeProviderKey(providerKey);

    return this.gatewaysByProviderKey.has(normalizedProviderKey);
  }

  /**
   * Returns all currently registered provider keys.
   */
  getSupportedProviderKeys(): readonly string[] {
    return Array.from(this.gatewaysByProviderKey.keys());
  }

  /**
   * Builds the provider-key-to-gateway lookup map.
   */
  private buildGatewayMap(
    gateways: readonly PaymentGateway[],
  ): ReadonlyMap<string, PaymentGateway> {
    const gatewayMap = new Map<string, PaymentGateway>();

    for (const gateway of gateways) {
      this.validateGateway(gateway);

      const providerKey = this.normalizeProviderKey(gateway.providerKey);

      if (gatewayMap.has(providerKey)) {
        throw new PaymentProcessingError(
          PaymentErrorCode.DUPLICATE_PAYMENT_GATEWAY,
          'More than one payment gateway is registered for the same provider key.',
          {
            details: {
              providerKey,
            },
          },
        );
      }

      gatewayMap.set(providerKey, gateway);
    }

    return gatewayMap;
  }

  /**
   * Validates the minimum runtime gateway contract.
   */
  private validateGateway(gateway: PaymentGateway): void {
    if (
      !gateway ||
      typeof gateway.providerKey !== 'string' ||
      !gateway.providerKey.trim() ||
      typeof gateway.createPaymentSession !== 'function' ||
      typeof gateway.verifyWebhook !== 'function'
    ) {
      throw new PaymentProcessingError(
        PaymentErrorCode.UNSUPPORTED_PAYMENT_PROVIDER,
        'An invalid payment gateway implementation was registered.',
        {
          details: {
            providerKey:
              typeof gateway?.providerKey === 'string'
                ? gateway.providerKey
                : null,
          },
        },
      );
    }
  }

  /**
   * Normalizes and validates one provider key.
   */
  private normalizeProviderKey(providerKey: string): string {
    const normalizedProviderKey = providerKey?.trim().toLowerCase();

    if (
      !normalizedProviderKey ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalizedProviderKey)
    ) {
      throw new PaymentProcessingError(
        PaymentErrorCode.UNSUPPORTED_PAYMENT_PROVIDER,
        'The payment provider key is invalid.',
        {
          details: {
            providerKey: providerKey ?? null,
          },
        },
      );
    }

    return normalizedProviderKey;
  }
}
