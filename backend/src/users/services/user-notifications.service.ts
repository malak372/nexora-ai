import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UserCommonService } from './user-common.service';

/**
 * Service responsible for user notification operations.
 *
 * This service handles retrieving notifications and
 * marking notifications as read for the authenticated user.
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
     * Returns notifications ordered from newest to oldest.
     *
     * @param userId - Authenticated user ID.
     * @returns List of user notifications.
     *
     * @throws NotFoundException if the user does not exist.
     */
    async getNotifications(userId: string) {
        await this.userCommonService.findUserOrThrow(userId);

        return this.prisma.alert.findMany({
            where: { userId },
            orderBy: {
                createdAt: 'desc',
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