import { Module } from '@nestjs/common';

import { AuditModule } from '../audit-logs/audit-logs.module';
import { PrismaModule } from '../prisma/prisma.module';

import { AdminCreditsController } from './controllers/admin-credits.controller';
import { UserCreditsController } from './controllers/user-credits.controller';

import { AdminCreditsService } from './services/admin-credits.service';
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
 *
 * Exported services:
 * - CreditBalanceService is used by IdeasModule and PaymentsModule
 *   to add or deduct credits safely.
 * - CreditCacheService is used after successful credit-related
 *   transactions to invalidate affected user caches.
 *
 * @author Malak
 */
@Module({
  imports: [PrismaModule, AuditModule],

  controllers: [UserCreditsController, AdminCreditsController],

  providers: [
    UserCreditsService,
    AdminCreditsService,
    CreditBalanceService,
    CreditCacheService,
  ],

  exports: [CreditBalanceService, CreditCacheService],
})
export class CreditsModule { }
