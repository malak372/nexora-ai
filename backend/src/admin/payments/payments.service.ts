import { Injectable } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GetPaymentsQueryDto } from './dto/get-payments-query.dto';

import {
  buildDateFilter,
  buildOrderBy,
  buildPagination,
  buildRelationSearchFilter,
} from '../../utilities/base-query/builder';

/**
 * Service responsible for Admin payment management operations.
 *
 * Supports:
 * - Filtering
 * - Sorting
 * - Pagination
 * - Analytics (top users)
 * - CSV export
 * @author Malak
 */
@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) { }

  /**
   * Build WHERE filter for payments (clean architecture version)
   */
  private buildPaymentsWhere(query: GetPaymentsQueryDto) {
    return {
      ...buildDateFilter(query),

      ...(query.status && { status: query.status }),
      ...(query.purpose && { paymentPurpose: query.purpose }),
      ...(query.method && { paymentMethod: query.method }),

      ...buildRelationSearchFilter(
        'user',
        ['fullName', 'email'],
        query.search,
      ),
    };
  }

  /**
   * GET payments (paginated + sorted + filtered)
   */
  async getPayments(query: GetPaymentsQueryDto) {
    const { page, limit, skip } = buildPagination(query);

    const where = this.buildPaymentsWhere(query);

    const orderBy = buildOrderBy(
      query,
      [
        'amount',
        'status',
        'paymentMethod',
        'paymentPurpose',
        'creditsAmount',
        'createdAt',
      ] as const,
      'createdAt',
    );

    const [payments, total, topPayingUsers] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        select: {
          id: true,
          amount: true,
          currency: true,
          paymentMethod: true,
          paymentPurpose: true,
          status: true,
          creditsAmount: true,
          creditPriceAtPurchase: true,
          transactionReference: true,
          createdAt: true,

          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
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

      this.prisma.payment.count({ where }),

      this.prisma.payment.groupBy({
        by: ['userId'],
        where: {
          ...where,
          status: PaymentStatus.SUCCESS,
        },
        _sum: { amount: true },
        _count: true,
        orderBy: {
          _sum: {
            amount: 'desc',
          },
        },
        take: 5,
      }),
    ]);

    const topUserIds = topPayingUsers.map((u) => u.userId);

    const topUsers = await this.prisma.user.findMany({
      where: {
        id: { in: topUserIds },
      },
      select: {
        id: true,
        fullName: true,
        email: true,
      },
    });

    const userMap = new Map(topUsers.map((u) => [u.id, u]));

    return {
      data: payments,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },

      topPayingUsers: topPayingUsers.map((item) => ({
        userId: item.userId,
        user: userMap.get(item.userId) ?? null,
        totalPaid: item._sum?.amount ?? 0,
        paymentsCount:
          typeof item._count === 'number' ? item._count : 0,
      })),
    };
  }

  /**
   * CSV Export (same filters reused)
   */
  async exportPaymentsCsv(query: GetPaymentsQueryDto) {
    const where = this.buildPaymentsWhere(query);

    const orderBy = buildOrderBy(
      query,
      [
        'amount',
        'status',
        'paymentMethod',
        'paymentPurpose',
        'creditsAmount',
        'createdAt',
      ] as const,
      'createdAt',
    );

    const payments = await this.prisma.payment.findMany({
      where,
      orderBy,
      select: {
        id: true,
        amount: true,
        currency: true,
        paymentMethod: true,
        paymentPurpose: true,
        status: true,
        creditsAmount: true,
        creditPriceAtPurchase: true,
        transactionReference: true,
        createdAt: true,

        user: {
          select: {
            fullName: true,
            email: true,
          },
        },

        idea: {
          select: {
            title: true,
          },
        },
      },
    });

    const headers = [
      'ID',
      'User Name',
      'User Email',
      'Amount',
      'Currency',
      'Payment Method',
      'Payment Purpose',
      'Status',
      'Credits Amount',
      'Credit Price',
      'Transaction Reference',
      'Idea Title',
      'Created At',
    ];

    const rows = payments.map((p) => [
      p.id,
      p.user?.fullName ?? '',
      p.user?.email ?? '',
      p.amount,
      p.currency,
      p.paymentMethod,
      p.paymentPurpose,
      p.status,
      p.creditsAmount ?? '',
      p.creditPriceAtPurchase ?? '',
      p.transactionReference ?? '',
      p.idea?.title ?? '',
      p.createdAt.toISOString(),
    ]);

    return [headers, ...rows]
      .map((row) =>
        row
          .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
          .join(','),
      )
      .join('\n');
  }
}