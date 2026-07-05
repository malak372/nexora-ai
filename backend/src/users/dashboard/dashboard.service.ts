import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import {
    AccountStatus,
    ComplaintStatus,
    IdeaGenerationType,
    PaymentStatus,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { UserValidationService } from '../validation/validation.service';
import { userCacheKeys } from '../cache/user-cache.keys';

/**
 * Service responsible for authenticated user dashboard operations.
 *
 * Provides a cached account-level overview for the authenticated user.
 *
 * Frequently requested dashboard data is cached to reduce
 * repeated database queries and improve response time,
 * including profile information, credit status, free generation usage,
 * idea statistics, favorite ideas, complaint counters,
 * notifications, payment statistics, and recent account activity.
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

        @Inject(CACHE_MANAGER)
        private readonly cacheManager: Cache,
    ) { }

    /**
     * Retrieves the authenticated user's dashboard summary.
     *
     * Uses cache to reduce repeated database reads for frequently
     * requested dashboard data.
     *
     * @param userId - Authenticated user ID.
     * @returns Account-level dashboard summary.
     */
    async getSummary(userId: string) {
        const cacheKey = userCacheKeys.summary(userId);
        const cachedSummary = await this.cacheManager.get(cacheKey);

        if (cachedSummary) {
            return cachedSummary;
        }

        const user = await this.userCommonService.findUserOrThrow(userId);

        const [
            ideasCount,
            freeIdeasCount,
            premiumIdeasCount,
            favoriteIdeasCount,
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

            this.prisma.favoriteIdea.count({
                where: { userId },
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

        const summary = {
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
            favoriteIdeasCount,

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

        await this.cacheManager.set(cacheKey, summary);

        return summary;
    }
}