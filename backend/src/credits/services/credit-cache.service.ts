import {
  Inject,
  Injectable,
} from '@nestjs/common';

import { CACHE_MANAGER } from '@nestjs/cache-manager';

import type { Cache } from 'cache-manager';

import { userCacheKeys } from '../../users/cache/user-cache.keys';

/**
 * Service responsible for invalidating user caches affected
 * by credit-balance changes.
 *
 * Credit mutations can affect:
 * - The cached credit summary.
 * - The cached user dashboard summary.
 * - The cached recent user activity.
 *
 * Cache invalidation must be executed only after the related
 * database transaction has completed successfully.
 *
 * This service does not:
 * - Read or update credit balances.
 * - Create credit transactions.
 * - Manage Prisma transactions.
 *
 * @author Malak
 */
@Injectable()
export class CreditCacheService {
  constructor(
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  /**
   * Invalidates all user caches affected by a credit change.
   *
   * This method should be called after successfully committing:
   * - Credit purchases.
   * - Bonus credits.
   * - Premium-generation deductions.
   * - Refunds.
   * - Administrator adjustments.
   *
   * @param userId User whose credit-related caches must be invalidated.
   */
  async invalidateUserCreditCaches(
    userId: string,
  ): Promise<void> {
    await Promise.all([
      this.cacheManager.del(
        userCacheKeys.credits(userId),
      ),

      this.cacheManager.del(
        userCacheKeys.summary(userId),
      ),

      this.cacheManager.del(
        userCacheKeys.activity(userId),
      ),
    ]);
  }
}