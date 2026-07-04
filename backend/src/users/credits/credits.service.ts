import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { AccountStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { GetUserCreditHistoryQueryDto } from './dto/get-user-credit-history-query.dto';
import {
  buildDateFilter,
  buildExactFilter,
  buildOrderBy,
  buildPagination,
  buildSearchFilter,
} from '../../utilities/base-query/builder';
import { UserValidationService } from '../validation/validation.service';
import { userCacheKeys } from '../cache/user-cache.keys';

/**
 * Service responsible for user credit operations.
 *
 * Handles the authenticated user's credit balance,
 * premium credit-based access status, and credit
 * transaction history.
 *
 * Frequently requested credit summary data is cached to reduce
 * repeated database queries and improve response time.
 *
 * Credit transaction history remains uncached because it supports
 * dynamic filtering, searching, sorting, and pagination.
 *
 * @author Eman
 */
@Injectable()
export class UserCreditsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userCommonService: UserValidationService,

    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) { }

  /**
   * Retrieves the authenticated user's credit information.
   *
   * Returns the current credit balance, account status,
   * and whether the user currently has premium credit-based access.
   *
   * @param userId - Authenticated user ID.
   * @returns User credit information.
   *
   * @throws NotFoundException if the user does not exist.
   */
  async getCredits(userId: string) {
    const cacheKey = userCacheKeys.credits(userId);
    const cachedCredits = await this.cacheManager.get(cacheKey);

    if (cachedCredits) {
      return cachedCredits;
    }

    const user = await this.userCommonService.findUserOrThrow(userId);

    const credits = {
      creditBalance: user.creditBalance,
      accountStatus: user.accountStatus,
      isPremium: user.accountStatus === AccountStatus.PREMIUM,
    };

    await this.cacheManager.set(cacheKey, credits);

    return credits;
  }

  /**
   * Retrieves the authenticated user's credit transaction history.
   *
   * Supports pagination, date filtering, searching,
   * filtering by transaction type, and sorting.
   *
   * @param userId - Authenticated user ID.
   * @param query - Query parameters for listing credit transactions.
   * @returns Paginated credit transaction history with pagination metadata.
   *
   * @throws NotFoundException if the user does not exist.
   */
  async getCreditHistory(
    userId: string,
    query: GetUserCreditHistoryQueryDto,
  ) {
    await this.userCommonService.findUserOrThrow(userId);

    const { page, limit, skip } = buildPagination(query);

    const where: Prisma.CreditTransactionWhereInput = {
      userId,

      ...buildDateFilter(query),

      ...buildSearchFilter(['description'], query.search),

      ...buildExactFilter('type', query.type),
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
        take: limit,
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
      this.prisma.creditTransaction.count({ where }),
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
}