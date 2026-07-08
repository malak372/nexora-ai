import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit-logs/audit-logs.module';

import { UserProfileController } from './profile/profile.controller';
import { UserCreditsController } from './credits/credits.controller';
import { UserPaymentsController } from './payments/payments.controller';
import { UserIdeasController } from './ideas/ideas.controller';
import { UserNotificationsController } from './notifications/notifications.controller';
import { UserDashboardController } from './dashboard/dashboard.controller';
import { UserActivityController } from './activity/activity.controller';
import { UserComplaintsController } from './complaints/complaints.controller';
import { UserFavoritesController } from './favorites/favorites.controller';
import { UserFeedbackController } from './feedback/feedback.controller';
import { UserSavedSearchesController } from './saved-searches/saved-searches.controller';

import { UserProfileService } from './profile/profile.service';
import { UserCreditsService } from './credits/credits.service';
import { UserPaymentsService } from './payments/payments.service';
import { UserIdeasService } from './ideas/ideas.service';
import { UserValidationService } from './validation/validation.service';
import { UserNotificationsService } from './notifications/notifications.service';
import { UserDashboardService } from './dashboard/dashboard.service';
import { UserActivityService } from './activity/activity.service';
import { UserPermissionsService } from './permissions/permissions.service';
import { UserComplaintsService } from './complaints/complaints.service';
import { UserFavoritesService } from './favorites/favorites.service';
import { UserFeedbackService } from './feedback/feedback.service';
import { UserSavedSearchesService } from './saved-searches/saved-searches.service';
import { ContactController } from './contact-message/contact.controller';
import { ContactService } from './contact-message/contact.service';


/**
 * User management module.
 *
 * Groups all authenticated user-facing features in Nexora AI.
 *
 * Responsibilities:
 * - Manage user profile data.
 * - Track free generation usage.
 * - Display credit balance and credit history.
 * - Display payment history and payment reports.
 * - Display generated ideas with access-aware responses.
 * - Manage user notifications.
 * - Provide dashboard summary and recent activity.
 *
 * Integrations:
 * - PrismaModule provides database access.
 * - AuditModule records user-related activities such as
 *   profile updates and notification read operations.
 *
 * Business rules:
 * - Users cannot modify system-controlled fields such as role,
 *   account status, credit balance, or free generation counters.
 * - Premium access is derived from available credits.
 * - Advanced idea features are exposed only when the idea is
 *   unlocked or generated through the premium credit flow.
 *
 * @author Eman
 */
@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [
    UserProfileController,
    UserCreditsController,
    UserPaymentsController,
    UserIdeasController,
    UserNotificationsController,
    UserDashboardController,
    UserActivityController,
    UserComplaintsController,
    UserFavoritesController,
    UserFeedbackController,
    UserSavedSearchesController,
    ContactController,
  ],
  providers: [
    UserValidationService,
    UserPermissionsService,
    UserProfileService,
    UserCreditsService,
    UserPaymentsService,
    UserIdeasService,
    UserNotificationsService,
    UserDashboardService,
    UserActivityService,
    UserComplaintsService,
    UserFavoritesService,
    UserFeedbackService,
    UserSavedSearchesService,
    ContactService
    ],
  exports: [
    UserValidationService,
    UserPermissionsService,
    UserProfileService,
    UserCreditsService,
    UserPaymentsService,
    UserIdeasService,
    UserNotificationsService,
    UserDashboardService,
    UserActivityService,
    UserComplaintsService,
    UserFavoritesService,
    UserFeedbackService,
    UserSavedSearchesService,
    ContactService,
  ],
})
export class UsersModule { }