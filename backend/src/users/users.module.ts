import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersController } from './users.controller';
import { UserProfileService } from './services/user-profile.service';
import { UserCreditsService } from './services/user-credits.service';
import { UserPaymentsService } from './services/user-payments.service';
import { UserIdeasService } from './services/user-ideas.service';
import { UserCommonService } from './services/user-common.service';
import { UserNotificationsService } from './services/user-notifications.service';
import { UserSummaryService } from './services/user-summary.service';
import { UserActivityService } from './services/user-activity.service';

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
    UserCommonService,
    UserProfileService,
    UserCreditsService,
    UserPaymentsService,
    UserIdeasService,
    UserNotificationsService,
    UserSummaryService,
    UserActivityService,
  ],
  exports: [
    UserCommonService,
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