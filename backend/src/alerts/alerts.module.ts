import { Module } from '@nestjs/common';

import { AuditModule } from '../audit-logs/audit-logs.module';
import { MailModule } from '../mail/mail.module';
import { PrismaModule } from '../prisma/prisma.module';

import { AdminAlertsController } from './controllers/admin-alerts.controller';
import { UserDevicesController } from './controllers/user-devices.controller';
import { UserNotificationsController } from './controllers/user-notifications.controller';

import { AdminAlertsService } from './services/admin-alerts.service';
import { FirebaseService } from './services/firebase.service';
import { PushNotificationService } from './services/push-notification.service';
import { SystemAlertsService } from './services/system-alerts.service';
import { UserDeviceService } from './services/user-device.service';
import { UserNotificationsService } from './services/user-notifications.service';

/**
 * Shared alerts and notifications domain module.
 *
 * Provides:
 * - Administrator in-app alert management.
 * - Administrator email-alert delivery.
 * - Authenticated-user notification retrieval.
 * - Notification read-state management.
 * - Push-notification device registration and management.
 * - Firebase Cloud Messaging delivery.
 * - Centralized internal system-alert persistence.
 *
 * Business modules should use SystemAlertsService to create
 * persisted in-app alerts instead of accessing the Alert model directly.
 *
 * Business modules that require push delivery should use
 * PushNotificationService instead of accessing Firebase directly.
 *
 * @author Malak
 * @author Eman
 */
@Module({
  imports: [
    PrismaModule,
    AuditModule,
    MailModule,
  ],

  controllers: [
    AdminAlertsController,
    UserNotificationsController,
    UserDevicesController,
  ],

  providers: [
    AdminAlertsService,
    UserNotificationsService,
    UserDeviceService,
    FirebaseService,
    PushNotificationService,
    SystemAlertsService,
  ],

  exports: [
    SystemAlertsService,
    PushNotificationService,
  ],
})
export class AlertsModule { }