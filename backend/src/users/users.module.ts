import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit-logs/audit-logs.module';

import { UserProfileController } from './profile/profile.controller';
import { UserDashboardController } from './dashboard/dashboard.controller';
import { UserActivityController } from './activity/activity.controller';
import { UserFavoritesController } from './favorites/favorites.controller';
import { UserSavedSearchesController } from './saved-searches/saved-searches.controller';

import { UserProfileService } from './profile/profile.service';
import { UserValidationService } from './validation/validation.service';
import { UserDashboardService } from './dashboard/dashboard.service';
import { UserActivityService } from './activity/activity.service';
import { UserPermissionsService } from './permissions/permissions.service';
import { UserFavoritesService } from './favorites/favorites.service';
import { UserSavedSearchesService } from './saved-searches/saved-searches.service';


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
    UserDashboardController,
    UserActivityController,
    UserFavoritesController,
    UserSavedSearchesController,
  ],
  providers: [
    UserValidationService,
    UserPermissionsService,
    UserProfileService,
    UserDashboardService,
    UserActivityService,
    UserFavoritesService,
    UserSavedSearchesService,
  ],
  exports: [
    UserValidationService,
    UserPermissionsService,
    UserProfileService,
    UserDashboardService,
    UserActivityService,
    UserFavoritesService,
    UserSavedSearchesService,
  ],
})
export class UsersModule {}
