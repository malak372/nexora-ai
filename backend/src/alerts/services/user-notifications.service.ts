import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { CACHE_MANAGER } from '@nestjs/cache-manager';

import type { Cache } from 'cache-manager';

import { AuditAction, AuditTargetType, Prisma } from '@prisma/client';

import { AuditService } from '../../audit-logs/audit-logs.service';
import { PrismaService } from '../../prisma/prisma.service';

import { userCacheKeys } from '../../users/cache/user-cache.keys';

import { calculateTotalPages } from '../../utilities/analytics/analytics.helper';

import {
  buildDateFilter,
  buildExactFilter,
  buildOrderBy,
  buildPagination,
  buildSearchFilter,
} from '../../utilities/base-query/builder';

import { GetUserNotificationsQueryDto } from '../dto/get-user-notifications-query.dto';

/**
 * Shared selection used when returning user notifications.
 */
const notificationSelect = {
  id: true,
  title: true,
  message: true,
  type: true,
  isRead: true,
  createdAt: true,
} satisfies Prisma.AlertSelect;

/**
 * Handles notification operations for authenticated users.
 *
 * Responsibilities:
 * - Retrieve notifications belonging to the authenticated user.
 * - Filter, search, sort, and paginate notifications.
 * - Mark one owned notification as read.
 * - Mark all unread notifications as read.
 * - Record notification-read operations in the audit log.
 * - Invalidate notification-dependent user caches.
 *
 * Security:
 * - Every notification operation is scoped by userId.
 * - Users cannot access or modify another user's notifications.
 * - Soft-deleted and inactive users are rejected.
 *
 * @author Eman
 */
@Injectable()
export class UserNotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,

    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  /**
   * Retrieves a paginated and filtered list of notifications
   * belonging to the authenticated user.
   */
  async getNotifications(userId: string, query: GetUserNotificationsQueryDto) {
    await this.ensureActiveUserExists(userId);

    const { page, limit, skip, take } = buildPagination(query);

    const where: Prisma.AlertWhereInput = {
      userId,

      ...(buildDateFilter(query) ?? {}),

      ...(buildSearchFilter(['title', 'message'], query.search) ?? {}),

      ...(buildExactFilter('isRead', query.isRead) ?? {}),

      ...(buildExactFilter('type', query.type) ?? {}),
    };

    const orderBy = buildOrderBy(
      query,
      ['createdAt', 'title', 'type', 'isRead'] as const,
      'createdAt',
    );

    const [notifications, total] = await Promise.all([
      this.prisma.alert.findMany({
        where,
        skip,
        take,
        orderBy,
        select: notificationSelect,
      }),

      this.prisma.alert.count({
        where,
      }),
    ]);

    return {
      data: notifications,

      meta: {
        page,
        limit,
        total,
        totalPages: calculateTotalPages(total, limit),
      },
    };
  }

  /**
   * Marks one notification belonging to the authenticated
   * user as read.
   *
   * Returns the existing notification without writing to the
   * database when it has already been marked as read.
   */
  async markNotificationAsRead(userId: string, notificationId: string) {
    await this.ensureActiveUserExists(userId);

    const notification = await this.prisma.alert.findFirst({
      where: {
        id: notificationId,
        userId,
      },

      select: notificationSelect,
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    if (notification.isRead) {
      return notification;
    }

    const updatedNotification = await this.prisma.$transaction(async (tx) => {
      /**
       * Scope the update by both notification ID and owner ID.
       *
       * updateMany is used because Prisma update() cannot use
       * userId unless a matching compound unique constraint exists.
       */
      const updateResult = await tx.alert.updateMany({
        where: {
          id: notificationId,
          userId,
          isRead: false,
        },

        data: {
          isRead: true,
        },
      });

      /**
       * Another concurrent request may have already marked the
       * notification as read. In that case, simply retrieve it
       * without creating a duplicate audit entry.
       */
      if (updateResult.count === 0) {
        const currentNotification = await tx.alert.findFirst({
          where: {
            id: notificationId,
            userId,
          },

          select: notificationSelect,
        });

        if (!currentNotification) {
          throw new NotFoundException('Notification not found');
        }

        return {
          notification: currentNotification,
          wasUpdated: false,
        };
      }

      const updated = await tx.alert.findFirst({
        where: {
          id: notificationId,
          userId,
        },

        select: notificationSelect,
      });

      if (!updated) {
        throw new NotFoundException('Notification not found');
      }

      await this.auditService.createLog(
        {
          actorId: userId,
          action: AuditAction.USER_MARK_NOTIFICATION_READ,
          targetType: AuditTargetType.ALERT,
          targetId: notificationId,

          oldValue: {
            isRead: false,
          },

          newValue: {
            isRead: true,
          },
        },
        tx,
      );

      return {
        notification: updated,
        wasUpdated: true,
      };
    });

    if (updatedNotification.wasUpdated) {
      await this.invalidateNotificationCaches(userId);
    }

    return updatedNotification.notification;
  }

  /**
   * Marks all unread notifications belonging to the
   * authenticated user as read.
   */
  async markAllNotificationsAsRead(userId: string) {
    await this.ensureActiveUserExists(userId);

    const result = await this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.alert.updateMany({
        where: {
          userId,
          isRead: false,
        },

        data: {
          isRead: true,
        },
      });

      /**
       * Avoid creating a meaningless audit record when the
       * user has no unread notifications.
       */
      if (updateResult.count > 0) {
        await this.auditService.createLog(
          {
            actorId: userId,
            action: AuditAction.USER_MARK_ALL_NOTIFICATIONS_READ,
            targetType: AuditTargetType.ALERT,
            targetId: userId,

            oldValue: {
              unreadNotificationsCount: updateResult.count,
            },

            newValue: {
              updatedCount: updateResult.count,
            },
          },
          tx,
        );
      }

      return updateResult;
    });

    if (result.count > 0) {
      await this.invalidateNotificationCaches(userId);
    }

    return {
      message:
        result.count > 0
          ? 'All notifications marked as read'
          : 'No unread notifications found',

      updatedCount: result.count,
    };
  }

  /**
   * Ensures the authenticated user exists, is active,
   * and has not been soft-deleted.
   */
  private async ensureActiveUserExists(userId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        isActive: true,
        deletedAt: null,
      },

      select: {
        id: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Active user not found');
    }
  }

  /**
   * Invalidates caches whose values depend on the
   * user's notification state.
   */
  private async invalidateNotificationCaches(userId: string): Promise<void> {
    await Promise.all([
      this.cacheManager.del(userCacheKeys.summary(userId)),

      this.cacheManager.del(userCacheKeys.activity(userId)),
    ]);
  }
}
