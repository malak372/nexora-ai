import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

import { GetUserNotificationsQueryDto } from '../dto/get-user-notifications-query.dto';

import { UserNotificationsService } from '../services/user-notifications.service';

/**
 * Handles notification operations for authenticated users.
 *
 * Base route:
 * /users/notifications
 *
 * Supported operations:
 * - Retrieve the authenticated user's notifications.
 * - Mark one notification as read.
 * - Mark all unread notifications as read.
 *
 * @author Eman
 */
@Controller('users/notifications')
@UseGuards(JwtAuthGuard)
export class UserNotificationsController {
  constructor(
    private readonly userNotificationsService: UserNotificationsService,
  ) {}

  /**
   * Retrieves the authenticated user's paginated notifications.
   *
   * GET /users/notifications
   */
  @Get()
  getNotifications(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query() query: GetUserNotificationsQueryDto,
  ) {
    return this.userNotificationsService.getNotifications(
      currentUser.id,
      query,
    );
  }

  /**
   * Marks all unread notifications belonging to the
   * authenticated user as read.
   *
   * PATCH /users/notifications/read-all
   */
  @Patch('read-all')
  markAllNotificationsAsRead(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.userNotificationsService.markAllNotificationsAsRead(
      currentUser.id,
    );
  }

  /**
   * Marks one notification belonging to the
   * authenticated user as read.
   *
   * PATCH /users/notifications/:id/read
   */
  @Patch(':id/read')
  markNotificationAsRead(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' }))
    notificationId: string,
  ) {
    return this.userNotificationsService.markNotificationAsRead(
      currentUser.id,
      notificationId,
    );
  }
}
