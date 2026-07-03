import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UserValidationService } from '../validation/Validation.service';

/**
 * Service responsible for user activity operations.
 *
 * This service provides a recent activity overview
 * for the authenticated user.
 *
 * It uses UserValidationService for shared user validation logic.
 *
 * @author Eman
 */
@Injectable()
export class UserActivityService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly userCommonService: UserValidationService,
    ) { }

    /**
     * Retrieves the authenticated user's recent activity.
     *
     * The activity includes the latest generated idea,
     * latest payment, latest credit transaction,
     * latest alert or notification.
     *
     * @param userId - Authenticated user ID.
     * @returns Recent user activity overview.
     *
     * @throws NotFoundException if the user does not exist.
     */
    async getActivity(userId: string) {
        await this.userCommonService.findUserOrThrow(userId);

        const [latestIdea, latestPayment, latestCreditTransaction, latestAlert] =
            await Promise.all([
                this.prisma.idea.findFirst({
                    where: { userId },
                    orderBy: { createdAt: 'desc' },
                    select: {
                        id: true,
                        title: true,
                        generationType: true,
                        isUnlocked: true,
                        createdAt: true,
                    },
                }),

                this.prisma.payment.findFirst({
                    where: { userId },
                    orderBy: { createdAt: 'desc' },
                    select: {
                        id: true,
                        amount: true,
                        currency: true,
                        paymentMethod: true,
                        status: true,
                        paymentPurpose: true,
                        createdAt: true,
                    },
                }),

                this.prisma.creditTransaction.findFirst({
                    where: { userId },
                    orderBy: { createdAt: 'desc' },
                    select: {
                        id: true,
                        type: true,
                        amount: true,
                        balanceAfter: true,
                        description: true,
                        createdAt: true,
                    },
                }),

                this.prisma.alert.findFirst({
                    where: { userId },
                    orderBy: { createdAt: 'desc' },
                    select: {
                        id: true,
                        title: true,
                        message: true,
                        type: true,
                        isRead: true,
                        createdAt: true,
                    },
                }),
            ]);

        return {
            latestIdea,
            latestPayment,
            latestCreditTransaction,
            latestAlert,
        };
    }
}