import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersController } from './users.controller';
import { UserProfileService } from './profile/profile.service';
import { UserCreditsService } from './credits/credits.service';
import { UserPaymentsService } from './payments/payments.service';
import { UserIdeasService } from './ideas/ideas.service';
import { UserValidationService } from './validation/Validation.service';
import { UserNotificationsService } from './notifications/notifications.service';
import { UserSummaryService } from './dashboard/dashboard.service';
import { UserActivityService } from './activity/activity.service';

/**
 * User management module.
 *
 * This module groups together all components responsible
 * for authenticated user management, including:
 *
 * - User profile management
 * - Free generation tracking
 * - Credit management
 * - Payment history
 * - Generated ideas
 * - Notifications
 * - User summary
 * - Recent activity
 *
 * The module imports PrismaModule to provide database
 * access through PrismaService and registers the
 * user-related controllers and services.
 *
 * @author Eman
 */
@Module({
  imports: [PrismaModule],
  controllers: [UsersController],
  providers: [
    UserValidationService,
    UserProfileService,
    UserCreditsService,
    UserPaymentsService,
    UserIdeasService,
    UserNotificationsService,
    UserSummaryService,
    UserActivityService,
  ],
  exports: [
    UserValidationService,
    UserProfileService,
    UserCreditsService,
    UserPaymentsService,
    UserIdeasService,
    UserNotificationsService,
    UserSummaryService,
    UserActivityService,
  ],
})
export class UsersModule { }