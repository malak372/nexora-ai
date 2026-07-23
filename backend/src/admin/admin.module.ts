import { Module } from '@nestjs/common';

import { AuditModule } from '../audit-logs/audit-logs.module';
import { MailModule } from '../mail/mail.module';
import { PrismaModule } from '../prisma/prisma.module';

import { AiMonitoringController } from './ai-monitoring/ai-monitoring.controller';
import { AiMonitoringService } from './ai-monitoring/ai-monitoring.service';
import { CommentsController } from './comments/comments.controller';
import { CommentsService } from './comments/comments.service';
import { DashboardController } from './dashboard/dashboard.controller';
import { DashboardService } from './dashboard/dashboard.service';
import { SettingsController } from './settings/settings.controller';
import { SettingsService } from './settings/settings.service';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';

/**
 * Groups administrative dashboard, users, settings, comments, domains and AI
 * monitoring features.
 *
 * Data-source administration is intentionally owned by DataSourcesModule at
 * /admin/data-sources. The removed legacy Platforms service depended on a
 * Prisma Platform model that no longer exists.
 *
 * @author Malak
 */
@Module({
  imports: [PrismaModule, MailModule, AuditModule],
  controllers: [
    DashboardController,
    AiMonitoringController,
    UsersController,
    SettingsController,
    CommentsController,
  ],
  providers: [
    DashboardService,
    AiMonitoringService,
    UsersService,
    SettingsService,
    CommentsService,
  ],
})
export class AdminModule {}
