import { Injectable } from '@nestjs/common';

import { PaymentProvider } from '@prisma/client';

import { PaymentErrorCode } from '../errors/payment-error-code.enum';
import { PaymentProcessingError } from '../errors/payment-processing.error';

import { PaymentGatewayFactory } from '../gateways/payment-gateway.factory';

import type { PaymentProcessingResult } from '../types/payment-processing-result.type';
import type { PaymentWebhookInput } from '../types/payment-webhook-input.type';

import { PaymentProcessingService } from './payment-processing.service';

/**
 * Handles incoming payment-provider webhooks.
 *
 * Responsibilities:
 * - Resolve the gateway associated with the requested provider.
 * - Delegate provider-specific signature verification.
 * - Delegate provider-specific payload validation and normalization.
 * - Ensure the normalized confirmation belongs to the requested provider.
 * - Forward verified confirmations to PaymentProcessingService.
 *
 * This service does not:
 * - Trust unverified webhook payloads.
 * - Parse provider-specific payload structures directly.
 * - Update payment records directly.
 * - Add credits directly.
 * - Unlock ideas directly.
 *
 * Provider-specific verification remains owned by PaymentGateway
 * implementations, while business fulfillment remains owned by
 * PaymentProcessingService.
 *
 * @author Eman
 */
@Injectable()
export class PaymentWebhookService {
  constructor(
    private readonly paymentGatewayFactory: PaymentGatewayFactory,

    private readonly paymentProcessingService: PaymentProcessingService,
  ) {}

  /**
   * Verifies, normalizes, and processes one provider webhook.
   *
   * The provider is resolved from the trusted webhook route,
   * while the payload, headers, and raw body remain untrusted
   * until the selected gateway verifies them.
   *
   * @param provider Provider identified by the webhook endpoint.
   * @param input Raw incoming webhook request data.
   * @returns Final payment-processing result.
   */
  async handleWebhook(
    provider: PaymentProvider,
    input: PaymentWebhookInput,
  ): Promise<PaymentProcessingResult> {
    try {
      const gateway = this.paymentGatewayFactory.getGateway(provider);

      const confirmation = await gateway.verifyWebhook(input);

      this.validateNormalizedProvider(provider, confirmation.provider);

      return await this.paymentProcessingService.processConfirmation(
        confirmation,
      );
    } catch (error) {
      this.rethrowWebhookError(error, provider);
    }
  }

  /**
   * Ensures that the provider returned by the gateway
   * matches the provider selected by the webhook route.
   *
   * This protects the system from malformed gateway output
   * or incorrectly routed webhook requests.
   */
  private validateNormalizedProvider(
    requestedProvider: PaymentProvider,
    confirmedProvider: PaymentProvider,
  ): void {
    if (requestedProvider !== confirmedProvider) {
      throw new PaymentProcessingError(
        PaymentErrorCode.PAYMENT_PROVIDER_MISMATCH,
        'The normalized webhook provider does not match the requested provider.',
        {
          details: {
            requestedProvider,
            confirmedProvider,
          },
        },
      );
    }
  }

  /**
   * Preserves known payment-domain errors and converts
   * unexpected provider failures into a stable webhook error.
   *
   * Sensitive provider payloads, credentials, signatures,
   * tokens, or raw request bodies must not be exposed through
   * error details.
   */
  private rethrowWebhookError(
    error: unknown,
    provider: PaymentProvider,
  ): never {
    if (error instanceof PaymentProcessingError) {
      throw error;
    }

    throw new PaymentProcessingError(
      PaymentErrorCode.INVALID_PAYMENT_WEBHOOK_PAYLOAD,
      'The payment webhook could not be verified or normalized.',
      {
        cause: error,

        details: {
          provider,
        },
      },
    );
  }
}
