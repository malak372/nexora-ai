import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

import { PrismaService } from '../../prisma/prisma.service';
import { UserValidationService } from '../validation/validation.service';
import { userCacheKeys } from '../cache/user-cache.keys';

/**
 * Service responsible for authenticated user recent activity operations.
 *
 * This service provides a compact activity overview for the current user.
 * It is designed for dashboard, home screen, and account overview pages
 * where the system needs to display the latest user-related actions.
 *
 * Recent activity includes:
 * - Latest generated idea.
 * - Latest payment.
 * - Latest credit transaction.
 * - Latest complaint.
 * - Latest alert or notification.
 *
 * Security rules:
 * - The activity query is always scoped by the authenticated user ID.
 * - Users can only view their own activity.
 * - Authentication is enforced at the controller level using JwtAuthGuard.
 *
 * Cache behavior:
 * - Recent activity is cached using a centralized user cache key.
 * - Caching reduces repeated database reads when the dashboard is opened
 *   multiple times in a short period.
 * - Any service that creates or updates ideas, payments, credits,
 *   complaints, or alerts should invalidate userCacheKeys.activity(userId)
 *   to prevent stale activity data.
 *
 * @author Eman
 */
@Injectable()
export class UserActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userCommonService: UserValidationService,

    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  /**
   * Retrieves the authenticated user's recent activity.
   *
   * The method first checks the cache. If cached activity exists,
   * it returns the cached response directly. Otherwise, it validates
   * the user, loads the latest activity records from the database,
   * stores the result in cache, and returns the fresh response.
   *
   * @param userId - Authenticated user ID extracted from the JWT token.
   * @returns Recent activity overview for the authenticated user.
   *
   * @throws NotFoundException if the authenticated user does not exist.
   */
  async getActivity(userId: string) {
    const cacheKey = userCacheKeys.activity(userId);

    const cachedActivity = await this.cacheManager.get(cacheKey);

    if (cachedActivity) {
      return cachedActivity;
    }

    await this.userCommonService.findUserOrThrow(userId);

    const [
      latestIdea,
      latestPayment,
      latestCreditTransaction,
      latestComplaint,
      latestAlert,
    ] = await Promise.all([
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
          paymentMethodKey: true,
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

      this.prisma.complaint.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          subject: true,
          status: true,
          priority: true,
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

    const activity = {
      latestIdea,
      latestPayment,
      latestCreditTransaction,
      latestComplaint,
      latestAlert,
    };

    await this.cacheManager.set(cacheKey, activity);

    return activity;
  }
}
