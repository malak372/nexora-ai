import { Module } from '@nestjs/common';

import { AuditModule } from '../audit-logs/audit-logs.module';
import { MailModule } from '../mail/mail.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminInvitationAcceptanceController } from './administrators/controllers/admin-invitation-acceptance.controller';
import { AdministratorsController } from './administrators/controllers/administrators.controller';
import { AdministratorsService } from './administrators/administrators.service';
import { AiMonitoringController } from './ai-monitoring/ai-monitoring.controller';
import { AiMonitoringService } from './ai-monitoring/ai-monitoring.service';
import { CommentsController } from './comments/comments.controller';
import { CommentsService } from './comments/comments.service';
import { DashboardController } from './dashboard/dashboard.controller';
import { DashboardService } from './dashboard/dashboard.service';
import { AdminSensitiveAccessController } from './sensitive-access/admin-sensitive-access.controller';
import { AdminSensitiveAccessService } from './sensitive-access/admin-sensitive-access.service';
import { SettingsController } from './settings/settings.controller';
import { SettingsService } from './settings/settings.service';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';

@Module({
  imports: [PrismaModule, MailModule, AuditModule],
  controllers: [
    AdminSensitiveAccessController,
    AdministratorsController,
    AdminInvitationAcceptanceController,
    DashboardController,
    AiMonitoringController,
    UsersController,
    SettingsController,
    CommentsController,
  ],
  providers: [
    AdminSensitiveAccessService,
    AdministratorsService,
    DashboardService,
    AiMonitoringService,
    UsersService,
    SettingsService,
    CommentsService,
  ],
})
export class AdminModule {}