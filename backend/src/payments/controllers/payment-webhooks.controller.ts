import { Body, Controller, Headers, Param, Post, Req } from '@nestjs/common';

import type { RawBodyRequest } from '@nestjs/common';

import type { Request } from 'express';

import { PaymentWebhookService } from '../services/payment-webhook.service';

import type { PaymentProcessingResult } from '../types/payment-processing-result.type';
import type { PaymentWebhookInput } from '../types/payment-webhook-input.type';

/**
 * Handles incoming external payment-provider webhooks.
 *
 * Base route:
 * /payments/webhooks
 *
 * Webhook endpoints remain public because external payment
 * providers cannot authenticate using the application's JWT.
 *
 * Provider resolution and webhook-signature verification remain
 * the responsibility of the payment webhook workflow and the
 * corresponding PaymentGateway implementation.
 *
 * @author Eman
 */
@Controller('payments/webhooks')
export class PaymentWebhooksController {
  constructor(private readonly paymentWebhookService: PaymentWebhookService) {}

  /**
   * Receives and processes one payment-provider webhook.
   *
   * The provider key is matched dynamically against the
   * registered payment-gateway implementations.
   *
   * POST /payments/webhooks/:providerKey
   */
  @Post(':providerKey')
  handleWebhook(
    @Param('providerKey')
    providerKey: string,

    @Req()
    request: RawBodyRequest<Request>,

    @Body()
    payload: unknown,

    @Headers()
    headers: Readonly<Record<string, string | string[] | undefined>>,
  ): Promise<PaymentProcessingResult> {
    const input: PaymentWebhookInput = {
      payload,
      rawBody: request.rawBody,
      headers,
    };

    return this.paymentWebhookService.handleWebhook(providerKey, input);
  }
}
