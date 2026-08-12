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
 * database operations while preserving the existing response shape.
 *
 * Related counters are grouped into single Prisma queries and concurrent cache
 * misses for the same user share one in-flight promise. This reduces remote
 * PostgreSQL round trips without changing dashboard business rules.
 */
@Injectable()
export class UserDashboardService {
  private readonly inFlight = new Map<string, Promise<unknown>>();

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

    const existingRequest = this.inFlight.get(userId);
    if (existingRequest) {
      return existingRequest;
    }

    const request = this.buildSummary(userId).finally(() => {
      if (this.inFlight.get(userId) === request) {
        this.inFlight.delete(userId);
      }
    });

    this.inFlight.set(userId, request);
    return request;
  }

  private async buildSummary(userId: string) {
    const [
      user,
      ideaGenerationGroups,
      complaintStatusGroups,
      paymentStatusGroups,
      purchasedCredits,
    ] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          fullName: true,
          email: true,
          avatarUrl: true,
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

      this.prisma.idea.groupBy({
        by: ['generationType'],
        where: {
          userId,
          deletedAt: null,
          generationType: {
            in: [
              IdeaGenerationType.NORMAL_FREE,
              IdeaGenerationType.PREMIUM_CREDIT,
            ],
          },
        },
        _count: { _all: true },
      }),

      this.prisma.complaint.groupBy({
        by: ['status'],
        where: {
          userId,
          deletedAt: null,
          status: {
            in: [
              ComplaintStatus.OPEN,
              ComplaintStatus.RESOLVED,
            ],
          },
        },
        _count: { _all: true },
      }),

      this.prisma.payment.groupBy({
        by: ['status'],
        where: { userId },
        _count: { _all: true },
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

    const freeIdeasCount =
      ideaGenerationGroups.find(
        (row) => row.generationType === IdeaGenerationType.NORMAL_FREE,
      )?._count._all ?? 0;

    const premiumIdeasCount =
      ideaGenerationGroups.find(
        (row) => row.generationType === IdeaGenerationType.PREMIUM_CREDIT,
      )?._count._all ?? 0;

    const openComplaintsCount =
      complaintStatusGroups.find(
        (row) => row.status === ComplaintStatus.OPEN,
      )?._count._all ?? 0;

    const resolvedComplaintsCount =
      complaintStatusGroups.find(
        (row) => row.status === ComplaintStatus.RESOLVED,
      )?._count._all ?? 0;

    const totalPayments = paymentStatusGroups.reduce(
      (sum, row) => sum + row._count._all,
      0,
    );

    const successfulPayments =
      paymentStatusGroups.find(
        (row) => row.status === PaymentStatus.SUCCEEDED,
      )?._count._all ?? 0;

    const summary = {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      avatarUrl: user.avatarUrl,
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
      userCacheKeys.summary(userId),
      summary,
      DASHBOARD_CACHE_TTL_MS,
    );

    return summary;
  }
}