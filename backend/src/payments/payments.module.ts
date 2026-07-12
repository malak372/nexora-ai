import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { AdminPaymentsController } from './controllers/admin-payments.controller';
import { UserPaymentsController } from './controllers/user-payments.controller';

import { AdminPaymentsService } from './services/admin-payments.service';
import { UserPaymentsService } from './services/user-payments.service';

/**
 * Shared payments domain module.
 *
 * Provides:
 * - Authenticated-user payment history and analytics.
 * - Administrator payment monitoring and reports.
 * - Payment processing.
 * - Gateway integration.
 * - Payment fulfillment.
 * - Refund processing.
 * - Webhook handling.
 *
 * Reporting services remain separated from payment-processing
 * and gateway services.
 *
 * @author Malak
 */
@Module({
  imports: [
    PrismaModule,

    /*
     * Keep all existing module imports here, such as:
     * CreditsModule,
     * AlertsModule,
     * AuditModule,
     * MailModule,
     * HttpModule,
     * ConfigModule.
     */
  ],

  controllers: [
    UserPaymentsController,
    AdminPaymentsController,

    /*
     * Keep existing controllers such as:
     * PaymentController,
     * PaymentWebhookController,
     * PaymentCallbackController.
     */
  ],

  providers: [
    UserPaymentsService,
    AdminPaymentsService,

    /*
     * Keep all existing payment providers, such as:
     * PaymentProcessingService,
     * PaymentCreationService,
     * PaymentFulfillmentService,
     * PaymentRefundService,
     * CardPaymentGateway,
     * PaypalPaymentGateway,
     * PalPayPaymentGateway.
     */
  ],

  exports: [
    /*
     * Keep existing exported payment services.
     *
     * UserPaymentsService and AdminPaymentsService normally
     * do not need to be exported because their controllers
     * are located inside this module.
     */
  ],
})
export class PaymentsModule {}
