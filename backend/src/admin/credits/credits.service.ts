import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountStatus,
  AdminAction,
  AdminTargetType,
  CreditTransactionType,
  Prisma,
  UserRole,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { GetCreditHistoryQueryDto } from './dto/get-credit-history-query.dto';
import { AdjustUserCreditsDto } from './dto/adjust-user-credits.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

import {
  buildDateFilter,
  buildExactFilter,
  buildOrderBy,
  buildPagination,
  buildRelationSearchFilter,
} from '../../utilities/base-query/builder';

import {
  buildCsv,
  calculateTotalPages,
} from '../../utilities/analytics/analytics.helper';

/**
 * Service responsible for managing user credit operations
 * in the admin panel.
 *
 * Provides:
 * - Credit transaction history.
 * - Credit summary reports.
 * - Credit chart analytics.
 * - CSV export.
 * - Manual credit adjustments.
 * - Automatic account status updates.
 * - Audit logging for admin adjustments.
 *
 * @author Malak
 */
@Injectable()
export class CreditsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  /**
   * Builds the shared Prisma where filter for credit reports.
   */
  private buildCreditHistoryWhere(
    query: GetCreditHistoryQueryDto,
  ): Prisma.CreditTransactionWhereInput {
    return {
      ...buildDateFilter(query),
      ...buildExactFilter('type', query.type),

      ...buildRelationSearchFilter(
        'user',
        ['fullName', 'email'],
        query.search,
      ),
    };
  }

  /**
   * Retrieves paginated credit transaction history.
   */
  async getCreditHistory(query: GetCreditHistoryQueryDto) {
    const { page, limit, skip } = buildPagination(query);
    const where = this.buildCreditHistoryWhere(query);

    const orderBy = buildOrderBy(
      query,
      ['amount', 'balanceAfter', 'type', 'createdAt'] as const,
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

          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },

          payment: {
            select: {
              id: true,
              amount: true,
              paymentMethod: true,
              status: true,
            },
          },

          idea: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      }),

      this.prisma.creditTransaction.count({ where }),
    ]);

    return {
      data: transactions,
      meta: {
        page,
        limit,
        total,
        totalPages: calculateTotalPages(total, limit),
      },
    };
  }

  /**
   * Retrieves credit summary statistics.
   */
  async getCreditsSummary(query: GetCreditHistoryQueryDto) {
    const where = this.buildCreditHistoryWhere(query);

    const [
      totalTransactions,
      purchasedCredits,
      bonusCredits,
      deductedCredits,
      refundedCredits,
      adminAdjustments,
    ] = await Promise.all([
      this.prisma.creditTransaction.count({ where }),

      this.prisma.creditTransaction.aggregate({
        where: {
          ...where,
          type: CreditTransactionType.PURCHASE,
        },
        _sum: { amount: true },
      }),

      this.prisma.creditTransaction.aggregate({
        where: {
          ...where,
          type: CreditTransactionType.BONUS,
        },
        _sum: { amount: true },
      }),

      this.prisma.creditTransaction.aggregate({
        where: {
          ...where,
          type: CreditTransactionType.DEDUCTION_GENERATION,
        },
        _sum: { amount: true },
      }),

      this.prisma.creditTransaction.aggregate({
        where: {
          ...where,
          type: CreditTransactionType.REFUND,
        },
        _sum: { amount: true },
      }),

      this.prisma.creditTransaction.aggregate({
        where: {
          ...where,
          type: CreditTransactionType.ADMIN_ADJUSTMENT,
        },
        _sum: { amount: true },
      }),
    ]);

    return {
      totalTransactions,
      purchasedCredits: purchasedCredits._sum.amount ?? 0,
      bonusCredits: bonusCredits._sum.amount ?? 0,
      deductedCredits: Math.abs(deductedCredits._sum.amount ?? 0),
      refundedCredits: refundedCredits._sum.amount ?? 0,
      adminAdjustments: adminAdjustments._sum.amount ?? 0,
    };
  }

  /**
   * Retrieves chart-ready credit analytics.
   */
  async getCreditsCharts(query: GetCreditHistoryQueryDto) {
    const where = this.buildCreditHistoryWhere(query);

    const transactionsByType =
      await this.prisma.creditTransaction.groupBy({
        by: ['type'],
        where,
        _count: {
          type: true,
        },
        _sum: {
          amount: true,
        },
        orderBy: {
          _count: {
            type: 'desc',
          },
        },
      });

    return {
      transactionsByType: transactionsByType.map((item) => ({
        label: item.type,
        type: item.type,
        count: item._count.type,
        totalAmount: item._sum.amount ?? 0,
      })),
    };
  }

  /**
   * Exports filtered credit transaction history as CSV.
   */
  async exportCreditsCsv(query: GetCreditHistoryQueryDto) {
    const where = this.buildCreditHistoryWhere(query);

    const orderBy = buildOrderBy(
      query,
      ['amount', 'balanceAfter', 'type', 'createdAt'] as const,
      'createdAt',
    );

    const transactions = await this.prisma.creditTransaction.findMany({
      where,
      orderBy,
      select: {
        id: true,
        type: true,
        amount: true,
        balanceAfter: true,
        description: true,
        createdAt: true,

        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },

        payment: {
          select: {
            id: true,
            amount: true,
            paymentMethod: true,
            status: true,
          },
        },

        idea: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    });

    const headers = [
      'Transaction ID',
      'User ID',
      'User Name',
      'User Email',
      'Type',
      'Amount',
      'Balance After',
      'Description',
      'Payment ID',
      'Payment Amount',
      'Payment Method',
      'Payment Status',
      'Idea ID',
      'Idea Title',
      'Created At',
    ];

    const rows = transactions.map((transaction) => [
      transaction.id,
      transaction.user.id,
      transaction.user.fullName,
      transaction.user.email,
      transaction.type,
      transaction.amount,
      transaction.balanceAfter,
      transaction.description ?? '',
      transaction.payment?.id ?? '',
      transaction.payment?.amount ?? '',
      transaction.payment?.paymentMethod ?? '',
      transaction.payment?.status ?? '',
      transaction.idea?.id ?? '',
      transaction.idea?.title ?? '',
      transaction.createdAt.toISOString(),
    ]);

    return buildCsv(headers, rows);
  }

  /**
   * Manually adjusts a user's credit balance.
   *
   * Rules:
   * - Only USER accounts can have credits adjusted.
   * - Positive amount adds credits.
   * - Negative amount deducts credits.
   * - Final balance cannot be negative.
   * - Account status becomes PREMIUM when balance > 0.
   * - Account status becomes NORMAL when balance = 0.
   */
  async adjustUserCredits(body: AdjustUserCreditsDto, adminId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: {
          id: body.userId,
        },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      if (user.role !== UserRole.USER) {
        throw new BadRequestException(
          'Credits can only be adjusted for normal users',
        );
      }

      const newBalance = user.creditBalance + body.amount;

      if (newBalance < 0) {
        throw new BadRequestException('Credit balance cannot be negative');
      }

      const newStatus =
        newBalance > 0
          ? AccountStatus.PREMIUM
          : AccountStatus.NORMAL;

      const updatedUser = await tx.user.update({
        where: {
          id: body.userId,
        },
        data: {
          creditBalance: newBalance,
          accountStatus: newStatus,
        },
      });

      const creditTransaction = await tx.creditTransaction.create({
        data: {
          userId: body.userId,
          type: CreditTransactionType.ADMIN_ADJUSTMENT,
          amount: body.amount,
          balanceAfter: newBalance,
          description: body.description,
        },
      });

      return {
        oldUser: user,
        updatedUser,
        creditTransaction,
      };
    });

    await this.auditLogsService.createLog({
      adminId,
      action: AdminAction.ADMIN_ADJUST_USER_CREDITS,
      targetType: AdminTargetType.CREDIT_TRANSACTION,
      targetId: result.creditTransaction.id,
      oldValue: {
        userId: result.oldUser.id,
        creditBalance: result.oldUser.creditBalance,
        accountStatus: result.oldUser.accountStatus,
      },
      newValue: {
        userId: result.updatedUser.id,
        creditBalance: result.updatedUser.creditBalance,
        accountStatus: result.updatedUser.accountStatus,
        amount: body.amount,
        description: body.description,
      },
    });

    return {
      message: 'User credits adjusted successfully',
      user: result.updatedUser,
      transaction: result.creditTransaction,
    };
  }
}