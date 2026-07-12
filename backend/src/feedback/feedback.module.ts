import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { AdminFeedbackController } from './controllers/admin-feedback.controller';
import { UserFeedbackController } from './controllers/user-feedback.controller';

import { AdminFeedbackService } from './services/admin-feedback.service';
import { UserFeedbackService } from './services/user-feedback.service';

/**
 * Shared idea-feedback domain module.
 *
 * Provides:
 * - User idea-rating submission.
 * - User feedback updates.
 * - User feedback retrieval.
 * - Administrator feedback monitoring.
 * - Feedback summaries and analytics.
 * - CSV export.
 * - Idea rating aggregate maintenance.
 *
 * @author Malak
 */
@Module({
  imports: [PrismaModule],

  controllers: [UserFeedbackController, AdminFeedbackController],

  providers: [UserFeedbackService, AdminFeedbackService],
})
export class FeedbackModule {}
