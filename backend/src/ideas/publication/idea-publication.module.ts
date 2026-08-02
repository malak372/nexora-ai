import { forwardRef, Module } from '@nestjs/common';

import { AiModule } from '../../ai/ai.module';
import { AlertsModule } from '../../alerts/alerts.module';
import { AuditModule } from '../../audit-logs/audit-logs.module';
import { CreditsModule } from '../../credits/credits.module';
import { PaymentsModule } from '../../payments/payments.module';
import { PrismaModule } from '../../prisma/prisma.module';

import { PublicationCacheService } from './cache/publication-cache.service';
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

/**
 * Configures the idea-publication feature.
 *
 * This module provides the controllers and services responsible for:
 * - Public publication discovery and detail retrieval.
 * - User publication creation and management.
 * - Publication acceptance and advanced-content unlocking.
 * - User and administrator publication reports.
 * - Administrator moderation operations.
 * - Publication discovery and dashboard caching.
 *
 * The payments module is imported using `forwardRef` because publication
 * acceptance and payment fulfillment may depend on each other.
 *
 * Core publication services are exported so they can be reused by other
 * application modules without duplicating publication business logic.
 *
 * @author Eman
 */
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
    PublicationCacheService,
  ],
  exports: [
    IdeaPublicationService,
    IdeaPublicationQueryService,
    IdeaPublicationAcceptanceService,
    PublicationCacheService,
  ],
})
export class IdeaPublicationModule { }