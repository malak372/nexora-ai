import { forwardRef, Module } from '@nestjs/common';

import { AiModule } from '../../ai/ai.module';
import { AlertsModule } from '../../alerts/alerts.module';
import { AuditModule } from '../../audit-logs/audit-logs.module';
import { CreditsModule } from '../../credits/credits.module';
import { PaymentsModule } from '../../payments/payments.module';
import { PrismaModule } from '../../prisma/prisma.module';

import { AdminPublicationModerationController } from './controllers/admin-publication-moderation.controller';
import { PublicPublicationsController } from './controllers/public-publications.controller';
import { PublicationAcceptancesController } from './controllers/publication-acceptances.controller';
import {
  AdminPublicationReportsController,
  UserPublicationReportsController,
} from './controllers/publication-reports.controller';
import { UserPublicationsController } from './controllers/user-publications.controller';

import { AdminPublicationModerationService } from './services/admin-publication-moderation.service';
import { IdeaPublicationAcceptanceService } from './services/idea-publication-acceptance.service';
import { IdeaPublicationAiService } from './services/idea-publication-ai.service';
import { IdeaPublicationQueryService } from './services/idea-publication-query.service';
import { IdeaPublicationService } from './services/idea-publication.service';
import { PublicationReportService } from './services/publication-report.service';

/** Publication management, discovery, acceptance, reports, and moderation. */
@Module({
  imports: [
    PrismaModule,
    AiModule,
    AuditModule,
    AlertsModule,
    CreditsModule,
    forwardRef(() => PaymentsModule),
  ],
  controllers: [
    PublicPublicationsController,
    UserPublicationsController,
    PublicationAcceptancesController,
    UserPublicationReportsController,
    AdminPublicationReportsController,
    AdminPublicationModerationController,
  ],
  providers: [
    IdeaPublicationService,
    IdeaPublicationQueryService,
    IdeaPublicationAcceptanceService,
    IdeaPublicationAiService,
    PublicationReportService,
    AdminPublicationModerationService,
  ],
  exports: [
    IdeaPublicationService,
    IdeaPublicationQueryService,
    IdeaPublicationAcceptanceService,
  ],
})
export class IdeaPublicationModule {}
