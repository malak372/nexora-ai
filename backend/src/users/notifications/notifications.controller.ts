import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { GetUserNotificationsQueryDto } from './dto/get-user-notifications-query.dto';
import { UserNotificationsService } from './notifications.service';

/**
 * Controller responsible for authenticated user notifications.
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
   */
  @Get()
  getNotifications(
    @CurrentUser() user: { id: string },
    @Query() query: GetUserNotificationsQueryDto,
  ) {
    return this.userNotificationsService.getNotifications(user.id, query);
  }

  /**
   * Marks a specific notification as read.
   */
  @Patch(':id/read')
  markNotificationAsRead(
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) notificationId: string,
  ) {
    return this.userNotificationsService.markNotificationAsRead(
      user.id,
      notificationId,
    );
  }

  /**
   * Marks all unread notifications as read.
   */
  @Patch('read-all')
  markAllNotificationsAsRead(@CurrentUser() user: { id: string }) {
    return this.userNotificationsService.markAllNotificationsAsRead(user.id);
  }
}
