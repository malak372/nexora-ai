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
 * Shared alerts and notifications domain module.
 *
 * Provides:
 * - Administrator in-app alert management.
 * - Administrator email-alert delivery.
 * - Authenticated-user notification retrieval.
 * - Notification read-state management.
 * - Centralized internal system-alert persistence.
 *
 * Business modules should use SystemAlertsService to create
 * in-app alerts instead of accessing the Alert model directly.
 *
 * @author Malak
 */
@Module({
  imports: [PrismaModule, AuditModule, MailModule],

  controllers: [AdminAlertsController, UserNotificationsController],

  providers: [
    AdminAlertsService,
    UserNotificationsService,
    SystemAlertsService,
  ],

  exports: [SystemAlertsService],
})
export class AlertsModule {}
