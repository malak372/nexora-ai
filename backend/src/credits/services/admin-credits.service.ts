import { Injectable } from '@nestjs/common';

import {
  AuditAction,
  AuditTargetType,
  CreditTransactionType,
  Prisma,
} from '@prisma/client';

import { AuditService } from '../../audit-logs/audit-logs.service';
import { PrismaService } from '../../prisma/prisma.service';

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

import { AdjustUserCreditsDto } from '../dto/adjust-user-credits.dto';
import { GetAdminCreditHistoryQueryDto } from '../dto/get-admin-credit-history-query.dto';

import { CreditBalanceService } from './credit-balance.service';
import { CreditCacheService } from './credit-cache.service';

/**
 * Handles administrator credit management and analytics.
 *
 * Responsibilities:
 * - Retrieve credit transaction history.
 * - Generate credit summary reports.
 * - Generate chart-ready credit analytics.
 * - Export credit transactions as CSV.
 * - Perform manual credit adjustments.
 * - Record administrator credit adjustments in audit logs.
 * - Invalidate affected user caches after successful adjustments.
 *
 * Credit-balance mutations are delegated to CreditBalanceService.
 *
 * @author Malak
 */
@Injectable()
export class AdminCreditsService {
  constructor(
    private readonly prisma: PrismaService,

    private readonly creditBalanceService: CreditBalanceService,

    private readonly creditCacheService: CreditCacheService,

    private readonly auditService: AuditService,
  ) {}

  /**
   * Shared Prisma selection used by administrator
   * credit-history and CSV operations.
   */
  private readonly creditTransactionSelect = {
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
  } satisfies Prisma.CreditTransactionSelect;

  /**
   * Retrieves paginated credit transaction history.
   */
  async getCreditHistory(query: GetAdminCreditHistoryQueryDto) {
    const { page, limit, skip, take } = buildPagination(query);

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
        take,
        orderBy,
        select: this.creditTransactionSelect,
      }),

      this.prisma.creditTransaction.count({
        where,
      }),
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
  async getCreditsSummary(query: GetAdminCreditHistoryQueryDto) {
    const where = this.buildCreditHistoryWhere(query);

    const [
      totalTransactions,
      purchasedCredits,
      bonusCredits,
      deductedCredits,
      refundedCredits,
      adminAdjustments,
    ] = await Promise.all([
      this.prisma.creditTransaction.count({
        where,
      }),

      this.sumCreditsByType(where, CreditTransactionType.PURCHASE),

      this.sumCreditsByType(where, CreditTransactionType.BONUS),

      this.sumCreditsByType(where, CreditTransactionType.DEDUCTION_GENERATION),

      this.sumCreditsByType(where, CreditTransactionType.REFUND),

      this.sumCreditsByType(where, CreditTransactionType.ADMIN_ADJUSTMENT),
    ]);

    return {
      totalTransactions,
      purchasedCredits,
      bonusCredits,
      deductedCredits: Math.abs(deductedCredits),
      refundedCredits,
      adminAdjustments,
    };
  }

  /**
   * Retrieves chart-ready analytics grouped by
   * credit transaction type.
   */
  async getCreditsCharts(query: GetAdminCreditHistoryQueryDto) {
    const where = this.buildCreditHistoryWhere(query);

    const transactionsByType = await this.prisma.creditTransaction.groupBy({
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
   * Exports filtered credit transactions as CSV.
   */
  async exportCreditsCsv(query: GetAdminCreditHistoryQueryDto) {
    const where = this.buildCreditHistoryWhere(query);

    const orderBy = buildOrderBy(
      query,
      ['amount', 'balanceAfter', 'type', 'createdAt'] as const,
      'createdAt',
    );

    const transactions = await this.prisma.creditTransaction.findMany({
      where,
      orderBy,
      select: this.creditTransactionSelect,
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
   * Manually adjusts one user's credit balance.
   *
   * The balance change, transaction record, and audit log
   * are committed atomically inside one Prisma transaction.
   *
   * Credit-dependent caches are invalidated only after
   * the transaction completes successfully.
   */
  async adjustUserCredits(dto: AdjustUserCreditsDto, adminId: string) {
    const description = dto.description.trim();
    const result = await this.prisma.$transaction(async (tx) => {
      const adjustment = await this.creditBalanceService.adjustBalance({
        userId: dto.userId,
        amount: dto.amount,
        type: CreditTransactionType.ADMIN_ADJUSTMENT,
        description: description,
        tx,
      });

      await this.auditService.createLog(
        {
          actorId: adminId,

          action: AuditAction.ADMIN_ADJUST_USER_CREDITS,

          targetType: AuditTargetType.CREDIT_TRANSACTION,

          targetId: adjustment.transaction.id,

          oldValue: {
            userId: dto.userId,
            creditBalance: adjustment.previousBalance,
            accountStatus: adjustment.previousAccountStatus,
          },

          newValue: {
            userId: dto.userId,
            creditBalance: adjustment.balanceAfter,
            accountStatus: adjustment.accountStatus,
            amount: dto.amount,
            description: description,
          },
        },
        tx,
      );

      const updatedUser = await tx.user.findUniqueOrThrow({
        where: {
          id: dto.userId,
        },

        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
          accountStatus: true,
          creditBalance: true,
          isActive: true,
          isVerified: true,
          userType: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return {
        adjustment,
        updatedUser,
      };
    });

    /*
     * Cache invalidation intentionally occurs after the
     * database transaction has committed successfully.
     */
    await this.creditCacheService.invalidateUserCreditCaches(dto.userId);

    return {
      message: 'User credits adjusted successfully',

      user: result.updatedUser,

      transaction: result.adjustment.transaction,
    };
  }

  /**
   * Builds the shared administrator credit-history filter.
   */
  private buildCreditHistoryWhere(
    query: GetAdminCreditHistoryQueryDto,
  ): Prisma.CreditTransactionWhereInput {
    return {
      ...(buildDateFilter(query) ?? {}),

      ...(buildExactFilter('type', query.type) ?? {}),

      ...(buildRelationSearchFilter(
        'user',
        ['fullName', 'email'],
        query.search,
      ) ?? {}),
    };
  }

  /**
   * Returns the signed sum of credit amounts
   * for one transaction type.
   */
  private async sumCreditsByType(
    where: Prisma.CreditTransactionWhereInput,
    type: CreditTransactionType,
  ): Promise<number> {
    const result = await this.prisma.creditTransaction.aggregate({
      where: {
        ...where,
        type,
      },

      _sum: {
        amount: true,
      },
    });

    return result._sum.amount ?? 0;
  }
}
