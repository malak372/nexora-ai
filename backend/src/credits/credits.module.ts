import { Module } from '@nestjs/common';

import { AlertsModule } from '../alerts/alerts.module';
import { AuditModule } from '../audit-logs/audit-logs.module';
import { MailModule } from '../mail/mail.module';
import { PrismaModule } from '../prisma/prisma.module';

import { AdminCreditsController } from './controllers/admin-credits.controller';
import { UserCreditsController } from './controllers/user-credits.controller';

import { AdminCreditsService } from './services/admin-credits.service';
import { CreditBalanceNotificationService } from './services/credit-balance-notification.service';
import { CreditBalanceService } from './services/credit-balance.service';
import { CreditCacheService } from './services/credit-cache.service';
import { UserCreditsService } from './services/user-credits.service';

/**
 * Shared credits domain module.
 *
 * Provides:
 * - Authenticated-user credit summaries.
 * - Authenticated-user credit transaction history.
 * - Administrator credit reports and analytics.
 * - Administrator credit adjustments.
 * - Centralized credit-balance mutations.
 * - Credit transaction persistence.
 * - Credit-related cache invalidation.
 * - Low and exhausted credit-balance in-app and email notifications.
 *
 * Exported services:
 * - CreditBalanceService is used by IdeasModule and PaymentsModule
 *   to add or deduct credits safely.
 * - CreditBalanceNotificationService sends post-commit balance notifications.
 * - CreditCacheService is used after successful credit-related
 *   transactions to invalidate affected user caches.
 *
 * @author Malak
 */
@Module({
  imports: [PrismaModule, AuditModule, MailModule, AlertsModule],

  controllers: [UserCreditsController, AdminCreditsController],

  providers: [
    UserCreditsService,
    AdminCreditsService,
    CreditBalanceService,
    CreditBalanceNotificationService,
    CreditCacheService,
  ],

  exports: [
    CreditBalanceService,
    CreditBalanceNotificationService,
    CreditCacheService,
  ],
})
export class CreditsModule {}