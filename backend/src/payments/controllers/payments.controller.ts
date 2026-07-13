import { Body, Controller, Post, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

import { CreateDirectUnlockPaymentDto } from '../dto/create-direct-unlock-payment.dto';
import { PurchaseCreditsDto } from '../dto/purchase-credits.dto';

import { PaymentCheckoutService } from '../services/payment-checkout.service';

import type { PaymentCheckoutResult } from '../services/payment-checkout.service';

/**
 * Handles authenticated-user payment checkout operations.
 *
 * Base route:
 * /users/payments
 *
 * Responsibilities:
 * - Create checkout sessions for purchasing credits.
 * - Create checkout sessions for directly unlocking free ideas.
 *
 * This controller does not:
 * - Confirm successful payments.
 * - Add credits.
 * - Unlock ideas directly.
 * - Trust frontend redirect URLs as payment confirmation.
 *
 * Payment completion and fulfillment occur only after verified
 * provider events are processed by the payment webhook workflow.
 *
 * @author Eman
 */
@Controller('users/payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(
    private readonly paymentCheckoutService: PaymentCheckoutService,
  ) {}

  /**
   * Creates a checkout session for purchasing
   * premium idea-generation credits.
   *
   * POST /users/payments/credits/checkout
   */
  @Post('credits/checkout')
  createCreditPurchaseCheckout(
    @CurrentUser()
    user: AuthenticatedUser,

    @Body()
    body: PurchaseCreditsDto,
  ): Promise<PaymentCheckoutResult> {
    return this.paymentCheckoutService.createCreditPurchaseCheckout(
      user.id,
      body,
    );
  }

  /**
   * Creates a checkout session for directly unlocking
   * advanced features of one NORMAL_FREE idea.
   *
   * POST /users/payments/direct-unlock/checkout
   */
  @Post('direct-unlock/checkout')
  createDirectUnlockCheckout(
    @CurrentUser()
    user: AuthenticatedUser,

    @Body()
    body: CreateDirectUnlockPaymentDto,
  ): Promise<PaymentCheckoutResult> {
    return this.paymentCheckoutService.createDirectUnlockCheckout(
      user.id,
      body,
    );
  }
}
