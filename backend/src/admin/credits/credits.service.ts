import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import {
  AccountStatus,
  AdminAction,
  AdminTargetType,
  CreditTransactionType,
  Prisma,
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
  buildSearchFilter,
} from '../../utilities/base-query/builder';

/**
 * Service responsible for administrative credit management.
 *
 * This service allows administrators to retrieve, filter,
 * sort, export, and manually adjust user credit transactions.
 *
 * @author Malak
 */
@Injectable()
export class CreditsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) { }

  /**
   * Builds the WHERE filter for credit transaction queries.
   *
   * Supports:
   * - Date filtering (createdAt range)
   * - Exact match filtering for transaction type
   * - Search inside related user entity (fullName, email)
   *
   * @param query - Credit history query DTO
   * @returns Prisma CreditTransactionWhereInput
   */
  private buildCreditHistoryWhere(query: GetCreditHistoryQueryDto) {
    return {
      ...buildDateFilter(query),
      ...buildExactFilter('type', query.type),

      ...(query.search && {
        user: buildSearchFilter(
          ['fullName', 'email'],
          query.search,
        ),
      }),
    };
  }

  /**
   * Retrieves paginated credit transaction history.
   *
   * Supports:
   * - Pagination
   * - Sorting
   * - Filtering
   * - User search
   *
   * @param query - Query parameters for filtering and pagination
   * @returns Paginated list of credit transactions
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
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Exports credit transactions as CSV format.
   *
   * Uses same filters and sorting as listing endpoint.
   *
   * @param query - Query filters
   * @returns CSV string of credit transactions
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

    const header = [
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

    const rows = transactions.map((t) => [
      t.id,
      t.user.id,
      t.user.fullName,
      t.user.email,
      t.type,
      t.amount,
      t.balanceAfter,
      t.description ?? '',
      t.payment?.id ?? '',
      t.payment?.amount ?? '',
      t.payment?.paymentMethod ?? '',
      t.payment?.status ?? '',
      t.idea?.id ?? '',
      t.idea?.title ?? '',
      t.createdAt.toISOString(),
    ]);

    return [header, ...rows]
      .map((row) =>
        row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')
      )
      .join('\n');
  }

  /**
   * Adjusts a user's credit balance manually (Admin action).
   *
   * Steps:
   * - Validate user exists
   * - Calculate new balance
   * - Prevent negative balance
   * - Update user account status
   * - Create credit transaction record
   * - Log admin action in audit logs
   *
   * @param body - Adjustment data
   * @param adminId - ID of admin performing action
   * @returns Updated user + transaction record
   */
  async adjustUserCredits(body: AdjustUserCreditsDto, adminId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: body.userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const newBalance = user.creditBalance + body.amount;

    if (newBalance < 0) {
      throw new BadRequestException('Credit balance cannot be negative');
    }

    const newStatus =
      newBalance > 0 ? AccountStatus.PREMIUM : AccountStatus.NORMAL;

    const result = await this.prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: body.userId },
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

      return { updatedUser, creditTransaction };
    });

    await this.auditLogsService.createLog({
      adminId,
      action: AdminAction.ADMIN_ADJUST_USER_CREDITS,
      targetType: AdminTargetType.CREDIT_TRANSACTION,
      targetId: result.creditTransaction.id,
      oldValue: {
        userId: user.id,
        creditBalance: user.creditBalance,
        accountStatus: user.accountStatus,
      },
      newValue: {
        userId: result.updatedUser.id,
        creditBalance: result.updatedUser.creditBalance,
        accountStatus: result.updatedUser.accountStatus,
        amount: body.amount,
      },
    });

    return {
      message: 'User credits adjusted successfully',
      user: result.updatedUser,
      transaction: result.creditTransaction,
    };
  }
}