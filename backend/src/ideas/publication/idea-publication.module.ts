import { Module } from '@nestjs/common';
import { AiModule } from '../../ai/ai.module';
import { AuditModule } from '../../audit-logs/audit-logs.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { AdminPublicationModerationController } from './controllers/admin-publication-moderation.controller';
import {
  AdminPublicationReportsController,
  UserPublicationReportsController,
} from './controllers/publication-reports.controller';
import { PublicPublicationsController } from './controllers/public-publications.controller';
import { UserPublicationsController } from './controllers/user-publications.controller';
import { AdminPublicationModerationService } from './services/admin-publication-moderation.service';
import { IdeaPublicationAiService } from './services/idea-publication-ai.service';
import { IdeaPublicationQueryService } from './services/idea-publication-query.service';
import { IdeaPublicationService } from './services/idea-publication.service';
import { PublicationReportService } from './services/publication-report.service';

/** Publication management, discovery, reports, and moderation. @author Malak */
@Module({
  imports: [PrismaModule, AiModule, AuditModule],
  controllers: [
    PublicPublicationsController,
    UserPublicationsController,
    UserPublicationReportsController,
    AdminPublicationReportsController,
    AdminPublicationModerationController,
  ],
  providers: [
    IdeaPublicationService,
    IdeaPublicationQueryService,
    IdeaPublicationAiService,
    PublicationReportService,
    AdminPublicationModerationService,
  ],
  exports: [IdeaPublicationService, IdeaPublicationQueryService],
})
export class IdeaPublicationModule {}
