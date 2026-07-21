import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import {
  AccountStatus,
  ComplaintStatus,
  CreditTransactionType,
  IdeaGenerationType,
  PaymentStatus,
} from '@prisma/client';
import type { Cache } from 'cache-manager';

import { PrismaService } from '../../prisma/prisma.service';
import { userCacheKeys } from '../cache/user-cache.keys';
import { UserValidationService } from '../validation/validation.service';

/**
 * Builds the authenticated-user dashboard summary.
 *
 * The service only exposes account-level summaries. Paid idea outputs are
 * intentionally retrieved through the dedicated ideas and outputs modules.
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

  /** Returns a cached dashboard summary for one authenticated user. */
  async getSummary(userId: string) {
    const cacheKey = userCacheKeys.summary(userId);
    const cached = await this.cacheManager.get(cacheKey);

    if (cached) {
      return cached;
    }

    const user = await this.userValidationService.findUserOrThrow(userId);

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
      purchasedCredits,
      latestIdea,
      latestPayment,
    ] = await Promise.all([
      this.prisma.idea.count({ where: { userId, deletedAt: null } }),
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
      this.prisma.favoriteIdea.count({ where: { userId } }),
      this.prisma.alert.count({ where: { userId, isRead: false } }),
      this.prisma.complaint.count({
        where: { userId, deletedAt: null, status: ComplaintStatus.OPEN },
      }),
      this.prisma.complaint.count({
        where: { userId, deletedAt: null, status: ComplaintStatus.RESOLVED },
      }),
      this.prisma.payment.count({ where: { userId } }),
      this.prisma.payment.count({
        where: { userId, status: PaymentStatus.SUCCEEDED },
      }),
      this.prisma.creditTransaction.aggregate({
        where: {
          userId,
          type: {
            in: [CreditTransactionType.PURCHASE, CreditTransactionType.BONUS],
          },
        },
        _sum: { amount: true },
      }),
      this.prisma.idea.findFirst({
        where: { userId, deletedAt: null },
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
