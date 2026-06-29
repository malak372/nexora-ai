import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';

import { DashboardController } from './dashboard/dashboard.controller';
import { DashboardService } from './dashboard/dashboard.service';

import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';

import { SettingsController } from './settings/settings.controller';
import { SettingsService } from './settings/settings.service';

import { CreditsController } from './credits/credits.controller';
import { CreditsService } from './credits/credits.service';

import { CommentsController } from './comments/comments.controller';
import { CommentsService } from './comments/comments.service';

import { DataCollectionController } from './data-collection/data-collection.controller';
import { DataCollectionService } from './data-collection/data-collection.service';

import { PlatformsController } from './platforms/platforms.controller';
import { PlatformsService } from './platforms/platforms.service';

import { DomainsController } from './domains/domains.controller';
import { DomainsService } from './domains/domains.service';

import { PromptsController } from './prompts/prompts.controller';
import { PromptsService } from './prompts/prompts.service';

import { ComplaintsController } from './complaints/complaints.controller';
import { ComplaintsService } from './complaints/complaints.service';

import { AlertsController } from './alerts/alerts.controller';
import { AlertsService } from './alerts/alerts.service';

import { IdeasController } from './ideas/ideas.controller';
import { IdeasService } from './ideas/ideas.service';

import { AuditLogsController } from './audit-logs/audit-logs.controller';
import { AuditLogsService } from './audit-logs/audit-logs.service';
import { MailModule } from '../../mail/mail.module';

@Module({
  imports: [PrismaModule],
  controllers: [
    DashboardController,
    AuditLogsController,
    IdeasController,
    UsersController,
    SettingsController,
    PaymentsController,
    CreditsController,
    CommentsController,
    DataCollectionController,
    PlatformsController,
    DomainsController,
    PromptsController,
    AiMonitoringController,
    ComplaintsController,
    AlertsController,
  ],
  providers: [
    DashboardService,
    AuditLogsService,
    IdeasService,
    UsersService,
    SettingsService,
    PaymentsService,
    CreditsService,
    CommentsService,
    DataCollectionService,
    PlatformsService,
    DomainsService,
    PromptsService,
    AiMonitoringService,
    ComplaintsService,
    AlertsService,
  ],
})
export class AdminModule { }