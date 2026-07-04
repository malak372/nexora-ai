import { Injectable } from '@nestjs/common';
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

/**
 * Service responsible for user credit operations.
 *
 * This service handles the authenticated user's credit
 * balance and credit transaction history.
 *
 * It supports pagination, filtering, searching,
 * and sorting for credit transaction history.
 *
 * It uses UserValidationService for shared user validation logic.
 *
 * @author Eman
 */
@Injectable()
export class UserCreditsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userCommonService: UserValidationService,
  ) { }

  /**
   * Retrieves the authenticated user's credit information.
   *
   * Returns the current credit balance,
   * account status, and whether the user currently has
   * premium credit-based access.
   *
   * @param userId - Authenticated user ID.
   * @returns User credit information.
   *
   * @throws NotFoundException if the user does not exist.
   */
  async getCredits(userId: string) {
    const user = await this.userCommonService.findUserOrThrow(userId);

    return {
      creditBalance: user.creditBalance,
      accountStatus: user.accountStatus,
      isPremium: user.accountStatus === AccountStatus.PREMIUM,
    };
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