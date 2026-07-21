import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { CreditsModule } from '../credits/credits.module';
import { IdeaOutputsModule } from '../ideas/outputs/idea-outputs.module';
import { MailModule } from '../mail/mail.module';
import { PrismaModule } from '../prisma/prisma.module';

import { PAYMENT_GATEWAYS } from './constants/payment-gateway.tokens';

import { AdminPaymentsController } from './controllers/admin-payments.controller';
import { PaymentCheckoutController } from './controllers/payment-checkout.controller';
import { PaymentWebhooksController } from './controllers/payment-webhooks.controller';
import { UserPaymentsController } from './controllers/user-payments.controller';

import { PayPalPaymentGateway } from './gateways/paypal-payment.gateway';
import { PaymentGatewayFactory } from './gateways/payment-gateway.factory';
import type { PaymentGateway } from './gateways/payment-gateway.interface';
import { StripePaymentGateway } from './gateways/stripe-payment.gateway';

import { AdminPaymentsService } from './services/admin-payments.service';
import { CreditPurchaseService } from './services/credit-purchase.service';
import { DirectUnlockPaymentService } from './services/direct-unlock-payment.service';
import { PaymentCheckoutService } from './services/payment-checkout.service';
import { PaymentNotificationService } from './services/payment-notification.service';
import { PaymentProcessingService } from './services/payment-processing.service';
import { PaymentWebhookService } from './services/payment-webhook.service';
import { UserPaymentsService } from './services/user-payments.service';

/**
 * Shared payment-domain module.
 *
 * Responsibilities:
 * - Provide authenticated-user payment history and analytics.
 * - Provide administrator payment monitoring and reports.
 * - Create external checkout sessions.
 * - Process verified payment confirmations.
 * - Fulfill successful credit purchases.
 * - Fulfill successful direct idea-unlock payments.
 * - Send payment-related email notifications.
 * - Receive and verify provider webhook events.
 * - Resolve provider-specific payment gateways.
 *
 * Credit-balance mutations and cache invalidation are delegated
 * to CreditsModule.
 *
 * Email delivery is delegated to MailModule.
 *
 * Enabled payment gateways:
 * - Stripe.
 * - PayPal.
 *
 * @author Eman
 */
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    CreditsModule,
    MailModule,
    IdeaOutputsModule,
  ],

  controllers: [
    UserPaymentsController,
    PaymentCheckoutController,
    AdminPaymentsController,
    PaymentWebhooksController,
  ],

  providers: [
    UserPaymentsService,
    AdminPaymentsService,

    CreditPurchaseService,
    DirectUnlockPaymentService,

    PaymentCheckoutService,
    PaymentNotificationService,
    PaymentProcessingService,
    PaymentWebhookService,

    StripePaymentGateway,
    PayPalPaymentGateway,

    /**
     * Registers all enabled payment gateways as one collection.
     *
     * New gateways can be added here without changing
     * PaymentGatewayFactory or payment business services.
     */
    {
      provide: PAYMENT_GATEWAYS,

      inject: [StripePaymentGateway, PayPalPaymentGateway],

      useFactory: (
        stripePaymentGateway: StripePaymentGateway,
        payPalPaymentGateway: PayPalPaymentGateway,
      ): readonly PaymentGateway[] => [
        stripePaymentGateway,
        payPalPaymentGateway,
      ],
    },

    PaymentGatewayFactory,
  ],

  exports: [
    PaymentCheckoutService,
    PaymentProcessingService,
    PaymentWebhookService,
    PaymentGatewayFactory,
  ],
})
export class PaymentsModule {}
