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
 * Controller responsible for authenticated-user notifications.
 *
 * Base route:
 * /users/notifications
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
   * Retrieves the authenticated user's notifications.
   *
   * GET /users/notifications
   */
  @Get()
  getNotifications(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GetUserNotificationsQueryDto,
  ) {
    return this.userNotificationsService.getNotifications(user.id, query);
  }

  /**
   * Marks all unread notifications as read.
   *
   * PATCH /users/notifications/read-all
   */
  @Patch('read-all')
  markAllNotificationsAsRead(@CurrentUser() user: AuthenticatedUser) {
    return this.userNotificationsService.markAllNotificationsAsRead(user.id);
  }

  /**
   * Marks one notification as read.
   *
   * PATCH /users/notifications/:id/read
   */
  @Patch(':id/read')
  markNotificationAsRead(
    @CurrentUser() user: AuthenticatedUser,

    @Param(
      'id',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    notificationId: string,
  ) {
    return this.userNotificationsService.markNotificationAsRead(
      user.id,
      notificationId,
    );
  }
}
