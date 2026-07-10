import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { AuditAction, AuditTargetType, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { GetUserNotificationsQueryDto } from './dto/get-user-notifications-query.dto';
import { UserValidationService } from '../validation/validation.service';
import { AuditService } from '../../audit-logs/audit-logs.service';
import { userCacheKeys } from '../cache/user-cache.keys';

import {
  buildDateFilter,
  buildExactFilter,
  buildOrderBy,
  buildPagination,
  buildSearchFilter,
} from '../../utilities/base-query/builder';

/**
 * Service responsible for authenticated user notification operations.
 *
 * This service manages the notification workflow for registered users
 * in Nexora AI. Notifications are used to inform users about important
 * platform events such as:
 * - System announcements.
 * - Payment updates.
 * - Credit balance warnings.
 * - Credit exhaustion alerts.
 * - Administrative messages.
 *
 * Responsibilities:
 * - Retrieve the authenticated user's own notifications.
 * - Support pagination, searching, filtering, date filtering, and sorting.
 * - Mark a single notification as read.
 * - Mark all unread notifications as read.
 * - Record notification read actions in the audit log.
 * - Invalidate cached dashboard summary data when notification state changes.
 *
 * Security rules:
 * - Users can only view notifications that belong to their own account.
 * - Users can only mark their own notifications as read.
 * - Notification actions require JWT authentication at the controller level.
 *
 * Cache behavior:
 * - The user dashboard summary contains unreadNotificationsCount.
 * - The user recent activity may contain the latest alert state.
 * - When a notification is marked as read, the cached summary is invalidated
 *   to prevent showing an outdated unread notification count.
 * - The cached recent activity is also invalidated to prevent showing an
 *   outdated latestAlert.isRead value.
 *
 *
 * Audit behavior:
 * - Single notification read operations are logged using:
 *   USER_MARK_NOTIFICATION_READ.
 * - Bulk read operations are logged using:
 *   USER_MARK_ALL_NOTIFICATIONS_READ.
 *
 * @author Eman
 */
@Injectable()
export class UserNotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userCommonService: UserValidationService,
    private readonly auditService: AuditService,

    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  /**
   * Retrieves notifications for the authenticated user.
   *
   * Supports:
   * - Pagination.
   * - Search by notification title or message.
   * - Date range filtering.
   * - Filtering by read status.
   * - Filtering by notification type.
   * - Sorting by allowed fields.
   *
   * The query is always scoped by userId to ensure that users
   * cannot access notifications that belong to other accounts.
   *
   * @param userId - Authenticated user ID extracted from the JWT token.
   * @param query - Query parameters used for filtering, sorting, and pagination.
   * @returns Paginated list of user notifications with pagination metadata.
   *
   * @throws NotFoundException if the authenticated user does not exist.
   */
  async getNotifications(userId: string, query: GetUserNotificationsQueryDto) {
    await this.userCommonService.findUserOrThrow(userId);

    const { page, limit, skip } = buildPagination(query);

    const where: Prisma.AlertWhereInput = {
      userId,
      ...buildDateFilter(query),
      ...buildSearchFilter(['title', 'message'], query.search),
      ...buildExactFilter('isRead', query.isRead),
      ...buildExactFilter('type', query.type),
    };

    const orderBy = buildOrderBy(
      query,
      ['createdAt', 'title', 'type'] as const,
      'createdAt',
    );

    const [notifications, total] = await Promise.all([
      this.prisma.alert.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        select: {
          id: true,
          title: true,
          message: true,
          type: true,
          isRead: true,
          createdAt: true,
        },
      }),
      this.prisma.alert.count({ where }),
    ]);

    return {
      data: notifications,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Marks a single notification as read for the authenticated user.
   *
   * The notification must belong to the current user. This prevents
   * users from changing notification state for other accounts.
   *
   * After the notification is updated:
   * - The operation is recorded in the audit log.
   * - The cached dashboard summary is invalidated because it includes
   *   unreadNotificationsCount.
   *
   * @param userId - Authenticated user ID.
   * @param notificationId - Notification ID to mark as read.
   * @returns The updated notification.
   *
   * @throws NotFoundException if the user does not exist.
   * @throws NotFoundException if the notification does not belong to the user.
   */
  async markNotificationAsRead(userId: string, notificationId: string) {
    await this.userCommonService.findUserOrThrow(userId);

    const notification = await this.prisma.alert.findFirst({
      where: {
        id: notificationId,
        userId,
      },
      select: {
        id: true,
        title: true,
        message: true,
        type: true,
        isRead: true,
        createdAt: true,
      },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    const updatedNotification = await this.prisma.alert.update({
      where: { id: notificationId },
      data: {
        isRead: true,
      },
      select: {
        id: true,
        title: true,
        message: true,
        type: true,
        isRead: true,
        createdAt: true,
      },
    });

    await this.auditService.createLog({
      actorId: userId,
      action: AuditAction.USER_MARK_NOTIFICATION_READ,
      targetType: AuditTargetType.ALERT,
      targetId: notificationId,
      oldValue: {
        isRead: notification.isRead,
      },
      newValue: {
        isRead: updatedNotification.isRead,
      },
    });

    await this.cacheManager.del(userCacheKeys.summary(userId));
    await this.cacheManager.del(userCacheKeys.activity(userId));

    return updatedNotification;
  }

  /**
   * Marks all unread notifications as read for the authenticated user.
   *
   * This method updates only notifications that belong to the current user
   * and are still unread.
   *
   * After the bulk update:
   * - The previous unread notification count is recorded.
   * - The number of updated notifications is recorded.
   * - The operation is saved in the audit log.
   * - The cached dashboard summary is invalidated so the dashboard can
   *   display the correct unreadNotificationsCount.
   *
   * @param userId - Authenticated user ID.
   * @returns Success message and number of updated notifications.
   *
   * @throws NotFoundException if the authenticated user does not exist.
   */
  async markAllNotificationsAsRead(userId: string) {
    await this.userCommonService.findUserOrThrow(userId);

    const unreadNotificationsCount = await this.prisma.alert.count({
      where: {
        userId,
        isRead: false,
      },
    });

    const result = await this.prisma.alert.updateMany({
      where: {
        userId,
        isRead: false,
      },
      data: {
        isRead: true,
      },
    });

    await this.auditService.createLog({
      actorId: userId,
      action: AuditAction.USER_MARK_ALL_NOTIFICATIONS_READ,
      targetType: AuditTargetType.ALERT,
      targetId: userId,
      oldValue: {
        unreadNotificationsCount,
      },
      newValue: {
        updatedCount: result.count,
      },
    });

    await this.cacheManager.del(userCacheKeys.summary(userId));
    await this.cacheManager.del(userCacheKeys.activity(userId));

    return {
      message: 'All notifications marked as read',
      updatedCount: result.count,
    };
  }
}
