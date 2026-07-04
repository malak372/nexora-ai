import { Injectable } from '@nestjs/common';
import {
    AccountStatus,
    ComplaintStatus,
    IdeaGenerationType,
    PaymentStatus,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { UserValidationService } from '../validation/validation.service';

/**
 * Service responsible for authenticated user dashboard operations.
 *
 * Provides an account-level overview for the authenticated user,
 * including profile basics, credit status, free generation usage,
 * idea statistics, complaint counters, notifications, recent activity,
 * and payment data.
 *
 * Advanced paid idea features such as comment analysis, architecture,
 * database design, and feasibility reports are intentionally not exposed here.
 *
 * @author Eman
 */
@Injectable()
export class UserDashboardService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly userCommonService: UserValidationService,
    ) { }

    /**
     * Retrieves the authenticated user's dashboard summary.
     *
     * @param userId - Authenticated user ID.
     * @returns Account-level dashboard summary.
     */
    async getSummary(userId: string) {
        const user = await this.userCommonService.findUserOrThrow(userId);

        const [
            ideasCount,
            freeIdeasCount,
            premiumIdeasCount,
            unreadNotificationsCount,
            openComplaintsCount,
            resolvedComplaintsCount,
            totalPayments,
            successfulPayments,
            totalCreditsPurchased,
            latestIdea,
            latestPayment,
        ] = await Promise.all([
            this.prisma.idea.count({ where: { userId } }),

            this.prisma.idea.count({
                where: {
                    userId,
                    generationType: IdeaGenerationType.NORMAL_FREE,
                },
            }),

            this.prisma.idea.count({
                where: {
                    userId,
                    generationType: IdeaGenerationType.PREMIUM_CREDIT,
                },
            }),

            this.prisma.alert.count({
                where: {
                    userId,
                    isRead: false,
                },
            }),

            this.prisma.complaint.count({
                where: {
                    userId,
                    status: ComplaintStatus.OPEN,
                },
            }),

            this.prisma.complaint.count({
                where: {
                    userId,
                    status: ComplaintStatus.RESOLVED,
                },
            }),

            this.prisma.payment.count({ where: { userId } }),

            this.prisma.payment.count({
                where: {
                    userId,
                    status: PaymentStatus.SUCCESS,
                },
            }),

            this.prisma.payment.aggregate({
                where: {
                    userId,
                    status: PaymentStatus.SUCCESS,
                },
                _sum: {
                    creditsAmount: true,
                },
            }),

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
        ]);

        return {
            id: user.id,
            fullName: user.fullName,
            email: user.email,
            userType: user.userType,

            accountStatus: user.accountStatus,
            creditBalance: user.creditBalance,
            isPremium: user.accountStatus === AccountStatus.PREMIUM,

            freeGenerationLimit: user.freeGenerationLimit,
            freeGenerationsUsed: user.freeGenerationsUsed,
            remainingFreeGenerations: Math.max(
                0,
                user.freeGenerationLimit - user.freeGenerationsUsed,
            ),

            ideasCount,
            freeIdeasCount,
            premiumIdeasCount,

            unreadNotificationsCount,

            openComplaintsCount,
            resolvedComplaintsCount,

            totalPayments,
            successfulPayments,
            totalCreditsPurchased:
                totalCreditsPurchased._sum.creditsAmount ?? 0,

            latestIdea,
            latestPayment,
        };
    }
}