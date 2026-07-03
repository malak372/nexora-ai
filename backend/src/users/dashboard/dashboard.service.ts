import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UserValidationService } from '../validation/Validation.service';

/**
 * Service responsible for user summary operations.
 *
 * This service provides a dashboard-style summary
 * for the authenticated user using existing user,
 * idea, and notification data.
 *
 * It uses UserValidationService for shared user validation logic.
 *
 * @author Eman
 */
@Injectable()
export class UserSummaryService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly userCommonService: UserValidationService,
    ) { }

    /**
     * Retrieves a summary of the authenticated user's account.
     *
     * The summary includes profile basics, credit balance,
     * free generation usage, generated ideas count,
     * and unread notifications count.
     *
     * @param userId - Authenticated user ID.
     * @returns User account summary.
     *
     * @throws NotFoundException if the user does not exist.
     */
    async getSummary(userId: string) {
        const user = await this.userCommonService.findUserOrThrow(userId);

        const ideasCount = await this.prisma.idea.count({
            where: { userId },
        });

        const unreadNotificationsCount = await this.prisma.alert.count({
            where: {
                userId,
                isRead: false,
            },
        });

        return {
            id: user.id,
            fullName: user.fullName,
            email: user.email,
            accountStatus: user.accountStatus,
            creditBalance: user.creditBalance,
            freeGenerationLimit: user.freeGenerationLimit,
            freeGenerationsUsed: user.freeGenerationsUsed,
            remainingFreeGenerations: Math.max(
                0,
                user.freeGenerationLimit - user.freeGenerationsUsed,
            ),
            ideasCount,
            unreadNotificationsCount,
        };
    }
}