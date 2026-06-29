import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
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
  buildRelationSearchFilter,
} from '../../utilities/base-query/builder';

/**
 * Service responsible for managing user credit operations
 * in the admin panel.
 *
 * Features:
 * - View credit transaction history.
 * - Filter, search, sort, and paginate transactions.
 * - Export credit history as CSV.
 * - Adjust user credit balance.
 * - Update user account status automatically.
 * - Record audit logs for admin credit adjustments.
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
   * Builds the Prisma where filter for credit history queries.
   *
   * Supported filters:
   * - Date range
   * - Transaction type
   * - User full name or email search
   *
   * @param query Credit history query parameters.
   * @returns Prisma where filter object.
   */
  private buildCreditHistoryWhere(query: GetCreditHistoryQueryDto) {
    const search = query.search?.trim() || undefined;

    if (!search) {
      return {
        ...buildDateFilter(query),
        ...buildExactFilter('type', query.type),
      };
    }

    return {
      ...buildDateFilter(query),
      ...buildExactFilter('type', query.type),
      ...buildRelationSearchFilter('user', ['fullName', 'email'], search),
    };
  }

  /**
   * Retrieves paginated credit transaction history.
   *
   * Supports:
   * - Pagination
   * - Searching
   * - Filtering
   * - Sorting
   *
   * Each transaction includes its related user,
   * payment, and generated idea (if available).
   *
   * @param query Credit history query parameters.
   * @returns Paginated credit transaction list with metadata.
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
   * Exports credit transaction history as a CSV file.
   *
   * The exported data includes:
   * - Transaction information
   * - User details
   * - Payment details
   * - Related idea information
   * - Transaction creation date
   *
   * Values are escaped to ensure valid CSV formatting.
   *
   * @param query Credit history query parameters.
   * @returns CSV formatted string.
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
        row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','),
      )
      .join('\n');
  }

  /**
   * Adjusts a user's credit balance.
   *
   * Validation:
   * - User must exist.
   * - Amount cannot be zero.
   * - Credit balance cannot become negative.
   *
   * Business rules:
   * - Users with a balance greater than zero become PREMIUM.
   * - Users with zero balance become NORMAL.
   *
   * The update and transaction creation are executed
   * atomically using a database transaction.
   *
   * An audit log is created after the adjustment.
   *
   * @param body Credit adjustment request.
   * @param adminId ID of the administrator performing the action.
   * @returns Updated user and created credit transaction.
   *
   * @throws NotFoundException If the user does not exist.
   * @throws BadRequestException If the amount is zero or the balance becomes negative.
   */
  async adjustUserCredits(body: AdjustUserCreditsDto, adminId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: body.userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (body.amount === 0) {
      throw new BadRequestException('Amount cannot be zero');
    }

    const newBalance = Number(user.creditBalance) + Number(body.amount);

    if (newBalance < 0) {
      throw new BadRequestException('Credit balance cannot be negative');
    }

    let newStatus: AccountStatus;

    if (newBalance <= 0) {
      newStatus = AccountStatus.NORMAL;
    } else {
      newStatus = AccountStatus.PREMIUM;
    }

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