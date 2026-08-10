import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  AccountStatus,
  ComplaintStatus,
  CreditTransactionType,
  IdeaGenerationType,
  IdeaPublicationStatus,
  PaymentStatus,
} from '@prisma/client';
import type { Cache } from 'cache-manager';

import { PrismaService } from '../../prisma/prisma.service';
import { userCacheKeys } from '../cache/user-cache.keys';

const DASHBOARD_CACHE_TTL_MS = 2 * 60 * 1000;

/**
 * Builds the authenticated user's dashboard summary with a bounded number of
 * database operations. The previous implementation issued many independent
 * counts; that is expensive when PostgreSQL is remote and the Prisma pool is
 * small. Grouping related counts dramatically reduces database round trips.
 */
@Injectable()
export class UserDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  async getSummary(userId: string) {
    const cacheKey = userCacheKeys.summary(userId);
    const cachedSummary = await this.cacheManager.get(cacheKey);

    if (cachedSummary) {
      return cachedSummary;
    }

    const [
      user,
      freeIdeasCount,
      premiumIdeasCount,
      openComplaintsCount,
      resolvedComplaintsCount,
      totalPayments,
      successfulPayments,
      purchasedCredits,
    ] = await this.prisma.$transaction([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          fullName: true,
          email: true,
          userType: true,
          accountStatus: true,
          creditBalance: true,
          freeGenerationLimit: true,
          freeGenerationsUsed: true,
          _count: {
            select: {
              ideas: {
                where: { deletedAt: null },
              },
              favoriteIdeas: true,
              publishedIdeas: {
                where: { status: IdeaPublicationStatus.PUBLISHED },
              },
              alerts: {
                where: { isRead: false },
              },
            },
          },
          ideas: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              title: true,
              generationType: true,
              isUnlocked: true,
              createdAt: true,
            },
          },
          payments: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              amount: true,
              currency: true,
              paymentMethodKey: true,
              providerKey: true,
              status: true,
              paymentPurpose: true,
              createdAt: true,
            },
          },
        },
      }),

      this.prisma.idea.count({
        where: {
          userId,
          deletedAt: null,
          generationType: IdeaGenerationType.NORMAL_FREE,
        },
      }),

      this.prisma.idea.count({
        where: {
          userId,
          deletedAt: null,
          generationType: IdeaGenerationType.PREMIUM_CREDIT,
        },
      }),

      this.prisma.complaint.count({
        where: {
          userId,
          deletedAt: null,
          status: ComplaintStatus.OPEN,
        },
      }),

      this.prisma.complaint.count({
        where: {
          userId,
          deletedAt: null,
          status: ComplaintStatus.RESOLVED,
        },
      }),

      this.prisma.payment.count({
        where: { userId },
      }),

      this.prisma.payment.count({
        where: {
          userId,
          status: PaymentStatus.SUCCEEDED,
        },
      }),

      this.prisma.creditTransaction.aggregate({
        where: {
          userId,
          type: {
            in: [
              CreditTransactionType.PURCHASE,
              CreditTransactionType.BONUS,
            ],
          },
        },
        _sum: { amount: true },
      }),
    ]);

    if (!user) {
      throw new NotFoundException('User not found.');
    }

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
      ideasCount: user._count.ideas,
      freeIdeasCount,
      premiumIdeasCount,
      favoriteIdeasCount: user._count.favoriteIdeas,
      publishedIdeasCount: user._count.publishedIdeas,
      unreadNotificationsCount: user._count.alerts,
      openComplaintsCount,
      resolvedComplaintsCount,
      totalPayments,
      successfulPayments,
      totalCreditsPurchased: purchasedCredits._sum.amount ?? 0,
      latestIdea: user.ideas[0] ?? null,
      latestPayment: user.payments[0] ?? null,
    };

    await this.cacheManager.set(
      cacheKey,
      summary,
      DASHBOARD_CACHE_TTL_MS,
    );

    return summary;
  }
}