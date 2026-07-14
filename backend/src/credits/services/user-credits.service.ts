import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { CACHE_MANAGER } from '@nestjs/cache-manager';

import type { Cache } from 'cache-manager';

import { AccountStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import { userCacheKeys } from '../../users/cache/user-cache.keys';

import {
  buildDateFilter,
  buildExactFilter,
  buildOrderBy,
  buildPagination,
  buildSearchFilter,
} from '../../utilities/base-query/builder';

import { GetUserCreditHistoryQueryDto } from '../dto/get-user-credit-history-query.dto';

/**
 * Handles authenticated-user credit queries.
 *
 * Responsibilities:
 * - Return current credit balance.
 * - Return account status.
 * - Return credit transaction history.
 * - Cache the credit summary.
 *
 * Credit mutation logic remains owned by CreditBalanceService.
 *
 * @author Eman
 */
@Injectable()
export class UserCreditsService {
  constructor(
    private readonly prisma: PrismaService,

    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) { }

  /**
   * Returns the user's credit summary.
   */
  async getCredits(userId: string) {
    const cacheKey = userCacheKeys.credits(userId);

    const cachedCredits = await this.cacheManager.get<{
      creditBalance: number;
      accountStatus: AccountStatus;
      isPremium: boolean;
    }>(cacheKey);

    if (cachedCredits) {
      return cachedCredits;
    }

    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },

      select: {
        creditBalance: true,
        accountStatus: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const credits = {
      creditBalance: user.creditBalance,
      accountStatus: user.accountStatus,
      isPremium: user.accountStatus === AccountStatus.PREMIUM,
    };

    await this.cacheManager.set(cacheKey, credits);

    return credits;
  }

  /**
   * Returns the user's own credit transaction history.
   */
  async getCreditHistory(userId: string, query: GetUserCreditHistoryQueryDto) {
    await this.ensureUserExists(userId);

    const { page, limit, skip, take } = buildPagination(query);

    const where: Prisma.CreditTransactionWhereInput = {
      userId,

      ...(buildDateFilter(query) ?? {}),

      ...(buildSearchFilter(['description'], query.search) ?? {}),

      ...(buildExactFilter('type', query.type) ?? {}),
    };

    const orderBy = buildOrderBy(
      query,
      ['createdAt', 'amount', 'type'] as const,
      'createdAt',
    );

    const [transactions, total] = await Promise.all([
      this.prisma.creditTransaction.findMany({
        where,
        skip,
        take,
        orderBy,

        select: {
          id: true,
          type: true,
          amount: true,
          balanceAfter: true,
          description: true,
          createdAt: true,
          ideaId: true,
          paymentId: true,
        },
      }),

      this.prisma.creditTransaction.count({
        where,
      }),
    ]);

    return {
      data: transactions,

      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Ensures that the user exists.
   */
  private async ensureUserExists(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },

      select: {
        id: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }
  }
}
