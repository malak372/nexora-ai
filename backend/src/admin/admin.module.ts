import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';

import { DashboardController } from './dashboard/dashboard.controller';
import { DashboardService } from './dashboard/dashboard.service';

import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';

import { SettingsController } from './settings/settings.controller';
import { SettingsService } from './settings/settings.service';

import { CommentsController } from './comments/comments.controller';
import { CommentsService } from './comments/comments.service';

import { PlatformsController } from './platforms/platforms.controller';
import { PlatformsService } from './platforms/platforms.service';

import { DomainsController } from './domains/domains.controller';
import { DomainsService } from './domains/domains.service';


import { AiMonitoringController } from './ai-monitoring/ai-monitoring.controller';
import { AiMonitoringService } from './ai-monitoring/ai-monitoring.service';

import { AuditModule } from '../audit-logs/audit-logs.module';

/**
 * Admin module.
 *
 * Groups all administrative functionality including:
 * - Dashboard analytics
 * - User management
 * - AI monitoring
 * - Credit management
 * - Payment monitoring
 * - Comments
 * - Data collection
 * - Domains
 * - Platforms
 * - Prompt management
 * - Alerts
 * - Complaints
 * - Audit logs
 * - System settings
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
    PlatformsController,
    DomainsController,
  ],

  providers: [
    DashboardService,
    AiMonitoringService,
    UsersService,
    SettingsService,
    CommentsService,
    PlatformsService,
    DomainsService,
  ],
})
export class AdminModule {}

export { MailModule };
