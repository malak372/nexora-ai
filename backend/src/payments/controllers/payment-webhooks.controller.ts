import {
  Body,
  Controller,
  Headers,
  Param,
  ParseEnumPipe,
  Post,
  Req,
} from '@nestjs/common';

import type { RawBodyRequest } from '@nestjs/common';

import { PaymentProvider } from '@prisma/client';

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
 * Webhook endpoints remain public because payment providers
 * cannot authenticate using the application's JWT.
 *
 * Provider-specific signature verification remains owned by
 * the corresponding PaymentGateway implementation.
 *
 * @author Eman
 */
@Controller('payments/webhooks')
export class PaymentWebhooksController {
  constructor(private readonly paymentWebhookService: PaymentWebhookService) {}

  /**
   * Receives one payment-provider webhook.
   */
  @Post(':provider')
  handleWebhook(
    @Param('provider', new ParseEnumPipe(PaymentProvider))
    provider: PaymentProvider,

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

    return this.paymentWebhookService.handleWebhook(provider, input);
  }
}
