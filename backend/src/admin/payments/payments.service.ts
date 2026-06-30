import { Injectable } from '@nestjs/common';
import { PaymentPurpose, PaymentStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { GetPaymentsQueryDto } from './dto/get-payments-query.dto';

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
  toNumber,
} from '../../utilities/analytics/analytics.helper';

/**
 * Service responsible for Admin payment management operations.
 *
 * Provides:
 * - Paginated payment listing.
 * - Search by user full name or email.
 * - Filtering by status, purpose, method, and date range.
 * - Safe sorting using whitelisted fields.
 * - Payment summary reports.
 * - Chart-ready payment analytics.
 * - Top paying users analytics.
 * - CSV export.
 *
 * @author Malak
 */
@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Builds the shared Prisma where filter for payment list,
   * summary, charts, and CSV export.
   *
   * @param query - Payment query filters.
   * @returns Prisma PaymentWhereInput object.
   */
  private buildPaymentsWhere(
    query: GetPaymentsQueryDto,
  ): Prisma.PaymentWhereInput {
    return {
      ...buildDateFilter(query),
      ...buildExactFilter('status', query.status),
      ...buildExactFilter('paymentPurpose', query.purpose),
      ...buildExactFilter('paymentMethod', query.method),

      ...buildRelationSearchFilter(
        'user',
        ['fullName', 'email'],
        query.search,
      ),
    };
  }

  /**
   * Retrieves payment records with filtering, searching,
   * sorting, and pagination.
   *
   * Endpoint:
   * GET /admin/payments
   *
   * @param query - Query parameters for payment listing.
   * @returns Paginated payment records with metadata.
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

    const [payments, total] = await Promise.all([
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
          updatedAt: true,

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
    ]);

    return {
      data: payments.map((payment) => ({
        ...payment,
        amount: toNumber(payment.amount),
        creditPriceAtPurchase: toNumber(
          payment.creditPriceAtPurchase,
        ),
      })),

      meta: {
        page,
        limit,
        total,
        totalPages: calculateTotalPages(total, limit),
      },
    };
  }

  /**
   * Retrieves payment summary statistics.
   *
   * Endpoint:
   * GET /admin/payments/summary
   *
   * Summary includes:
   * - Total payments.
   * - Successful payments.
   * - Failed payments.
   * - Pending payments.
   * - Refunded payments.
   * - Total revenue.
   * - Total refunds.
   * - Credits sold.
   * - Direct unlock payments.
   * - Credit purchase payments.
   *
   * @param query - Optional filters used to scope the summary.
   * @returns Payment summary report.
   */
  async getPaymentsSummary(query: GetPaymentsQueryDto) {
    const where = this.buildPaymentsWhere(query);

    const [
      totalPayments,
      successfulPayments,
      failedPayments,
      pendingPayments,
      refundedPayments,
      revenueAggregate,
      refundsAggregate,
      creditsSoldAggregate,
      creditPurchasePayments,
      directUnlockPayments,
    ] = await Promise.all([
      this.prisma.payment.count({ where }),

      this.prisma.payment.count({
        where: {
          ...where,
          status: PaymentStatus.SUCCESS,
        },
      }),

      this.prisma.payment.count({
        where: {
          ...where,
          status: PaymentStatus.FAILED,
        },
      }),

      this.prisma.payment.count({
        where: {
          ...where,
          status: PaymentStatus.PENDING,
        },
      }),

      this.prisma.payment.count({
        where: {
          ...where,
          status: PaymentStatus.REFUNDED,
        },
      }),

      this.prisma.payment.aggregate({
        where: {
          ...where,
          status: PaymentStatus.SUCCESS,
        },
        _sum: {
          amount: true,
        },
      }),

      this.prisma.payment.aggregate({
        where: {
          ...where,
          status: PaymentStatus.REFUNDED,
        },
        _sum: {
          amount: true,
        },
      }),

      this.prisma.payment.aggregate({
        where: {
          ...where,
          status: PaymentStatus.SUCCESS,
        },
        _sum: {
          creditsAmount: true,
        },
      }),

      this.prisma.payment.count({
        where: {
          ...where,
          paymentPurpose: PaymentPurpose.BUY_CREDITS,
        },
      }),

      this.prisma.payment.count({
        where: {
          ...where,
          paymentPurpose: PaymentPurpose.DIRECT_UNLOCK,
        },
      }),
    ]);

    return {
      totalPayments,
      successfulPayments,
      failedPayments,
      pendingPayments,
      refundedPayments,
      totalRevenue: toNumber(revenueAggregate._sum.amount),
      totalRefunds: toNumber(refundsAggregate._sum.amount),
      creditsSold: creditsSoldAggregate._sum.creditsAmount ?? 0,
      creditPurchasePayments,
      directUnlockPayments,
    };
  }

  /**
   * Retrieves chart-ready payment analytics.
   *
   * Endpoint:
   * GET /admin/payments/charts
   *
   * Charts include:
   * - Payments by status.
   * - Payments by method.
   * - Payments by purpose.
   * - Top paying users.
   *
   * @param query - Optional filters used to scope the charts.
   * @returns Chart-ready payment analytics.
   */
  async getPaymentsCharts(query: GetPaymentsQueryDto) {
    const where = this.buildPaymentsWhere(query);

    const [
      paymentsByStatus,
      paymentsByMethod,
      paymentsByPurpose,
      topPayingUsers,
    ] = await Promise.all([
      this.prisma.payment.groupBy({
        by: ['status'],
        where,
        _count: {
          status: true,
        },
        _sum: {
          amount: true,
        },
        orderBy: {
          _count: {
            status: 'desc',
          },
        },
      }),

      this.prisma.payment.groupBy({
        by: ['paymentMethod'],
        where,
        _count: {
          paymentMethod: true,
        },
        _sum: {
          amount: true,
        },
        orderBy: {
          _count: {
            paymentMethod: 'desc',
          },
        },
      }),

      this.prisma.payment.groupBy({
        by: ['paymentPurpose'],
        where,
        _count: {
          paymentPurpose: true,
        },
        _sum: {
          amount: true,
        },
        orderBy: {
          _count: {
            paymentPurpose: 'desc',
          },
        },
      }),

      this.prisma.payment.groupBy({
        by: ['userId'],
        where: {
          ...where,
          status: PaymentStatus.SUCCESS,
        },
        _count: {
          userId: true,
        },
        _sum: {
          amount: true,
        },
        orderBy: {
          _sum: {
            amount: 'desc',
          },
        },
        take: 5,
      }),
    ]);

    const userIds = topPayingUsers.map((item) => item.userId);

    const users = await this.prisma.user.findMany({
      where: {
        id: {
          in: userIds,
        },
      },
      select: {
        id: true,
        fullName: true,
        email: true,
      },
    });

    const userMap = new Map(users.map((user) => [user.id, user]));

    return {
      paymentsByStatus: paymentsByStatus.map((item) => ({
        label: item.status,
        status: item.status,
        count: item._count.status,
        totalAmount: toNumber(item._sum.amount),
      })),

      paymentsByMethod: paymentsByMethod.map((item) => ({
        label: item.paymentMethod,
        paymentMethod: item.paymentMethod,
        count: item._count.paymentMethod,
        totalAmount: toNumber(item._sum.amount),
      })),

      paymentsByPurpose: paymentsByPurpose.map((item) => ({
        label: item.paymentPurpose,
        paymentPurpose: item.paymentPurpose,
        count: item._count.paymentPurpose,
        totalAmount: toNumber(item._sum.amount),
      })),

      topPayingUsers: topPayingUsers.map((item) => {
        const user = userMap.get(item.userId) ?? null;

        return {
          label: user?.fullName ?? user?.email ?? 'Unknown User',
          userId: item.userId,
          user,
          paymentsCount: item._count.userId,
          totalPaid: toNumber(item._sum.amount),
        };
      }),
    };
  }

  /**
   * Exports filtered payment records as CSV.
   *
   * Endpoint:
   * GET /admin/payments/export/csv
   *
   * Uses the same filters and sorting rules as the list endpoint.
   *
   * @param query - Query parameters used to filter exported records.
   * @returns CSV string.
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
    });

    const headers = [
      'Payment ID',
      'User ID',
      'User Name',
      'User Email',
      'Amount',
      'Currency',
      'Payment Method',
      'Payment Purpose',
      'Status',
      'Credits Amount',
      'Credit Price At Purchase',
      'Transaction Reference',
      'Idea ID',
      'Idea Title',
      'Created At',
    ];

    const rows = payments.map((payment) => [
      payment.id,
      payment.user.id,
      payment.user.fullName,
      payment.user.email,
      toNumber(payment.amount),
      payment.currency,
      payment.paymentMethod,
      payment.paymentPurpose,
      payment.status,
      payment.creditsAmount,
      toNumber(payment.creditPriceAtPurchase),
      payment.transactionReference ?? '',
      payment.idea?.id ?? '',
      payment.idea?.title ?? '',
      payment.createdAt.toISOString(),
    ]);

    return buildCsv(headers, rows);
  }
}