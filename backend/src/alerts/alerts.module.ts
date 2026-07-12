import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';

import { AuditModule } from '../audit-logs/audit-logs.module';
import { MailModule } from '../mail/mail.module';
import { PrismaModule } from '../prisma/prisma.module';

import { AdminAlertsController } from './controllers/admin-alerts.controller';
import { UserNotificationsController } from './controllers/user-notifications.controller';

import { AdminAlertsService } from './services/admin-alerts.service';
import { SystemAlertsService } from './services/system-alerts.service';
import { UserNotificationsService } from './services/user-notifications.service';

/**
 * Shared alerts and notifications module.
 *
 * Provides:
 * - Administrator alert management.
 * - Administrator email alert delivery.
 * - Authenticated-user notification access.
 * - Notification read-state management.
 * - Internal system-generated alerts.
 *
 * Business modules such as Ideas and Payments should depend on
 * SystemAlertsService instead of depending on AdminModule or UsersModule.
 *
 * @author Malak
 */
@Module({
  imports: [
    PrismaModule,
    AuditModule,
    MailModule,

    /**
     * Provides CACHE_MANAGER for notification cache invalidation.
     *
     * If CacheModule is already configured globally inside AppModule,
     * this import may be omitted.
     */
    CacheModule.register(),
  ],

  controllers: [AdminAlertsController, UserNotificationsController],

  providers: [
    AdminAlertsService,
    UserNotificationsService,
    SystemAlertsService,
  ],

  exports: [
    /**
     * Used by IdeasModule, PaymentsModule, and other
     * business modules to create alerts.
     */
    SystemAlertsService,
  ],
})
export class AlertsModule {}
