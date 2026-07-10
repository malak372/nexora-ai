import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';

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

import { PlatformsController } from './platforms/platforms.controller';
import { PlatformsService } from './platforms/platforms.service';

import { DomainsController } from './domains/domains.controller';
import { DomainsService } from './domains/domains.service';

import { ComplaintsController } from './complaints/complaints.controller';
import { ComplaintsService } from './complaints/complaints.service';

import { AlertsController } from './alerts/alerts.controller';
import { AlertsService } from './alerts/alerts.service';

import { IdeasController } from './ideas/ideas.controller';
import { IdeasService } from './ideas/ideas.service';

import { AiMonitoringController } from './ai-monitoring/ai-monitoring.controller';
import { AiMonitoringService } from './ai-monitoring/ai-monitoring.service';

import { FeedbackController } from './feedback/feedbacks.controller';
import { FeedbackService } from './feedback/feedbacks.service';

import { ContactMessagesController } from './contact-messages/contact-messages.controller';
import { ContactMessagesService } from './contact-messages/contact-messages.service';

import { PaymentsService } from './payments/payments.service';
import { PaymentsController } from './payments/payments.controller';
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
    PaymentsController,
    IdeasController,
    UsersController,
    SettingsController,
    FeedbackController,
    CreditsController,
    CommentsController,
    PlatformsController,
    DomainsController,
    ComplaintsController,
    AlertsController,
    ContactMessagesController,
  ],

  providers: [
    DashboardService,
    AiMonitoringService,
    IdeasService,
    UsersService,
    SettingsService,
    FeedbackService,
    CreditsService,
    CommentsService,
    PaymentsService,
    PlatformsService,
    DomainsService,
    ComplaintsService,
    AlertsService,
    ContactMessagesService,
  ],
})
export class AdminModule {}

export { MailModule };
