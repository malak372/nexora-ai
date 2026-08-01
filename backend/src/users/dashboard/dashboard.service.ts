import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
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
import { UserValidationService } from '../validation/validation.service';

/**
 * Builds the authenticated user's dashboard summary.
 *
 * Dashboard reads are intentionally executed through one Prisma batch
 * transaction. This prevents a single dashboard request from starting many
 * database queries concurrently and exhausting a small connection pool.
 *
 * Paid idea outputs remain available only through the dedicated ideas and
 * outputs modules.
 *
 * @author Eman
 */
@Injectable()
export class UserDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userValidationService: UserValidationService,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  /**
   * Returns a cached dashboard summary for one authenticated user.
   *
   * @param userId - Authenticated user's UUID.
   * @returns Account and workspace summary.
   */
  async getSummary(userId: string) {
    const cacheKey = userCacheKeys.summary(userId);
    const cachedSummary = await this.cacheManager.get(cacheKey);

    if (cachedSummary) {
      return cachedSummary;
    }

    const user = await this.userValidationService.findUserOrThrow(userId);

    /*
     * Do not use Promise.all here.
     *
     * The database pool in the current environment is limited to 15 clients.
     * Running all dashboard queries concurrently can consume most of that pool
     * in one HTTP request, especially when more than one Nest process is open.
     * Prisma's batch transaction executes these reads using one transaction
     * context instead of creating a large burst of parallel requests.
     */
    const [
      ideasCount,
      freeIdeasCount,
      premiumIdeasCount,
      favoriteIdeasCount,
      publishedIdeasCount,
      unreadNotificationsCount,
      openComplaintsCount,
      resolvedComplaintsCount,
      totalPayments,
      successfulPayments,
      purchasedCredits,
      latestIdea,
      latestPayment,
    ] = await this.prisma.$transaction([
      this.prisma.idea.count({
        where: {
          userId,
          deletedAt: null,
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

      this.prisma.favoriteIdea.count({
        where: {
          userId,
        },
      }),

      this.prisma.ideaPublication.count({
        where: {
          publisherId: userId,
          status: IdeaPublicationStatus.PUBLISHED,
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
        where: {
          userId,
        },
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
        _sum: {
          amount: true,
        },
      }),

      this.prisma.idea.findFirst({
        where: {
          userId,
          deletedAt: null,
        },
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          id: true,
          title: true,
          generationType: true,
          isUnlocked: true,
          createdAt: true,
        },
      }),

      this.prisma.payment.findFirst({
        where: {
          userId,
        },
        orderBy: {
          createdAt: 'desc',
        },
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
      publishedIdeasCount,
      unreadNotificationsCount,
      openComplaintsCount,
      resolvedComplaintsCount,
      totalPayments,
      successfulPayments,
      totalCreditsPurchased: purchasedCredits._sum.amount ?? 0,
      latestIdea,
      latestPayment,
    };

    await this.cacheManager.set(cacheKey, summary);

    return summary;
  }
}