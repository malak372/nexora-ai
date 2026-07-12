import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { CACHE_MANAGER } from '@nestjs/cache-manager';

import type { Cache } from 'cache-manager';

import { AuditAction, AuditTargetType, Prisma } from '@prisma/client';

import { AuditService } from '../../audit-logs/audit-logs.service';
import { PrismaService } from '../../prisma/prisma.service';

import { userCacheKeys } from '../../users/cache/user-cache.keys';

import {
  buildDateFilter,
  buildExactFilter,
  buildOrderBy,
  buildPagination,
  buildSearchFilter,
} from '../../utilities/base-query/builder';

import { GetUserNotificationsQueryDto } from '../dto/get-user-notifications-query.dto';

/**
 * Service responsible for authenticated-user notification operations.
 *
 * Responsibilities:
 * - Retrieve the authenticated user's notifications.
 * - Filter, search, sort, and paginate notifications.
 * - Mark one notification as read.
 * - Mark all unread notifications as read.
 * - Record read actions in audit logs.
 * - Invalidate affected user dashboard caches.
 *
 * Security:
 * - Every notification query is scoped by userId.
 * - Users cannot access or modify another user's notifications.
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
   * Retrieves notifications belonging to one authenticated user.
   */
  async getNotifications(userId: string, query: GetUserNotificationsQueryDto) {
    await this.ensureUserExists(userId);

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
      ['createdAt', 'title', 'type'] as const,
      'createdAt',
    );

    const [notifications, total] = await Promise.all([
      this.prisma.alert.findMany({
        where,
        skip,
        take,
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

      this.prisma.alert.count({
        where,
      }),
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
   * Marks one owned notification as read.
   */
  async markNotificationAsRead(userId: string, notificationId: string) {
    await this.ensureUserExists(userId);

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

    if (notification.isRead) {
      return notification;
    }

    const updatedNotification = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.alert.update({
        where: {
          id: notificationId,
        },

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

      await this.auditService.createLog(
        {
          actorId: userId,
          action: AuditAction.USER_MARK_NOTIFICATION_READ,
          targetType: AuditTargetType.ALERT,
          targetId: notificationId,

          oldValue: {
            isRead: notification.isRead,
          },

          newValue: {
            isRead: updated.isRead,
          },
        },
        tx,
      );

      return updated;
    });

    await this.invalidateNotificationCaches(userId);

    return updatedNotification;
  }

  /**
   * Marks all unread notifications as read.
   */
  async markAllNotificationsAsRead(userId: string) {
    await this.ensureUserExists(userId);

    const unreadNotificationsCount = await this.prisma.alert.count({
      where: {
        userId,
        isRead: false,
      },
    });

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

      await this.auditService.createLog(
        {
          actorId: userId,
          action: AuditAction.USER_MARK_ALL_NOTIFICATIONS_READ,
          targetType: AuditTargetType.ALERT,
          targetId: userId,

          oldValue: {
            unreadNotificationsCount,
          },

          newValue: {
            updatedCount: updateResult.count,
          },
        },
        tx,
      );

      return updateResult;
    });

    await this.invalidateNotificationCaches(userId);

    return {
      message: 'All notifications marked as read',
      updatedCount: result.count,
    };
  }

  /**
   * Ensures the authenticated user still exists.
   */
  private async ensureUserExists(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },

      select: {
        id: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }
  }

  /**
   * Invalidates notification-dependent user caches.
   */
  private async invalidateNotificationCaches(userId: string): Promise<void> {
    await Promise.all([
      this.cacheManager.del(userCacheKeys.summary(userId)),

      this.cacheManager.del(userCacheKeys.activity(userId)),
    ]);
  }
}
