import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { AdminFeedbackController } from './controllers/admin-feedback.controller';
import { UserFeedbackController } from './controllers/user-feedback.controller';

import { AdminFeedbackService } from './services/admin-feedback.service';
import { UserFeedbackService } from './services/user-feedback.service';

/**
 * Publication feedback and rating domain module.
 *
 * Provides:
 * - Publication-rating creation and updates.
 * - Publication-rating deletion.
 * - Textual-feedback creation and updates.
 * - Textual-feedback deletion.
 * - Publication aggregate maintenance.
 * - Administrator monitoring and analytics.
 * - CSV exports.
 *
 * @author Malak
 */
@Module({
  imports: [PrismaModule],

  controllers: [
    UserFeedbackController,
    AdminFeedbackController,
  ],

  providers: [
    UserFeedbackService,
    AdminFeedbackService,
  ],
})
export class FeedbackModule { }