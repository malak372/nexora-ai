import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GetUserNotificationsQueryDto } from '../dto/get-user-notifications-query.dto';
import {
    buildDateFilter,
    buildExactFilter,
    buildOrderBy,
    buildPagination,
    buildSearchFilter,
} from '../../utilities/base-query/builder';
import { UserCommonService } from './user-common.service';

/**
 * Service responsible for user notification operations.
 *
 * This service handles retrieving notifications and
 * marking notifications as read for the authenticated user.
 *
 * It supports pagination, filtering, searching,
 * and sorting for user notifications.
 *
 * It uses UserCommonService for shared user validation logic.
 *
 * @author Eman
 */
@Injectable()
export class UserNotificationsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly userCommonService: UserCommonService,
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
        });

        if (!notification) {
            throw new NotFoundException('Notification not found');
        }

        return this.prisma.alert.update({
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
    }

    /**
     * Marks all notifications as read for the authenticated user.
     *
     * @param userId - Authenticated user ID.
     * @returns Success message and number of updated notifications.
     *
     * @throws NotFoundException if the user does not exist.
     */
    async markAllNotificationsAsRead(userId: string) {
        await this.userCommonService.findUserOrThrow(userId);

        const result = await this.prisma.alert.updateMany({
            where: {
                userId,
                isRead: false,
            },
            data: {
                isRead: true,
            },
        });

        return {
            message: 'All notifications marked as read',
            updatedCount: result.count,
        };
    }
}