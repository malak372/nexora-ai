import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, AuditTargetType, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { GetUserNotificationsQueryDto } from './dto/get-user-notifications-query.dto';
import { UserValidationService } from '../validation/validation.service';
import { AuditService } from '../../audit-logs/audit-logs.service';

import {
    buildDateFilter,
    buildExactFilter,
    buildOrderBy,
    buildPagination,
    buildSearchFilter,
} from '../../utilities/base-query/builder';

/**
 * Service responsible for user notification operations.
 *
 * This service handles retrieving notifications and
 * marking notifications as read for the authenticated user.
 *
 * It supports pagination, filtering, searching,
 * and sorting for user notifications.
 *
 * Notification read operations are recorded in the shared
 * audit log to support traceability and administrative review.
 *
 * It uses UserValidation Service for shared user validation logic.
 *
 * @author Eman
 */
@Injectable()
export class UserNotificationsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly userCommonService: UserValidationService,
        private readonly auditService: AuditService,
    ) { }

    /**
     * Retrieves the authenticated user's notifications.
     *
     * Supports pagination, date filtering, searching,
     * filtering by read status and notification type, and sorting.
     *
     * @param userId - Authenticated user ID.
     * @param query - Query parameters for listing notifications.
     * @returns Paginated user notifications with pagination metadata.
     *
     * @throws NotFoundException if the user does not exist.
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
     * Marks a specific notification as read.
     *
     * The notification must belong to the authenticated user.
     *
     * The operation is recorded in the shared audit log using:
     * - USER_MARK_NOTIFICATION_READ
     * - ALERT target type
     *
     * @param userId - Authenticated user ID.
     * @param notificationId - Notification ID.
     * @returns Updated notification.
     *
     * @throws NotFoundException if the user or notification does not exist.
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

        return updatedNotification;
    }

    /**
     * Marks all notifications as read for the authenticated user.
     *
     * The operation is recorded in the shared audit log using:
     * - USER_MARK_ALL_NOTIFICATIONS_READ
     * - ALERT target type
     *
     * @param userId - Authenticated user ID.
     * @returns Success message and number of updated notifications.
     *
     * @throws NotFoundException if the user does not exist.
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

        return {
            message: 'All notifications marked as read',
            updatedCount: result.count,
        };
    }
}