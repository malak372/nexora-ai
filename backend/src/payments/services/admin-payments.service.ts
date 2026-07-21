import { Injectable } from '@nestjs/common';

import { PaymentPurpose, PaymentStatus, Prisma } from '@prisma/client';

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
  toNumber,
} from '../../utilities/analytics/analytics.helper';

import { GetAdminPaymentsQueryDto } from '../dto/get-admin-payments-query.dto';

/**
 * Handles administrator payment monitoring and analytics.
 *
 * Responsibilities:
 * - Retrieve payment records.
 * - Search, filter, sort, and paginate payments.
 * - Generate payment summary reports.
 * - Generate chart-ready payment analytics.
 * - Identify top-paying users.
 * - Export filtered payments as CSV.
 *
 * Payment processing and gateway interaction remain owned by
 * the dedicated processing services inside PaymentsModule.
 *
 * @author Malak
 */
@Injectable()
export class AdminPaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Shared selection used by payment list operations.
   */
  private readonly paymentSelect = {
    id: true,
    amount: true,
    currency: true,
    paymentMethodKey: true,
    providerKey: true,
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
  } satisfies Prisma.PaymentSelect;

  /**
   * Retrieves paginated payment records.
   */
  async getPayments(query: GetAdminPaymentsQueryDto) {
    const { page, limit, skip, take } = buildPagination(query);

    const where = this.buildPaymentsWhere(query);

    const orderBy = buildOrderBy(
      query,
      [
        'amount',
        'status',
        'paymentMethodKey',
        'providerKey',
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
        take,
        orderBy,
        select: this.paymentSelect,
      }),

      this.prisma.payment.count({
        where,
      }),
    ]);

    return {
      data: payments.map((payment) => ({
        ...payment,

        amount: toNumber(payment.amount),

        creditPriceAtPurchase: toNumber(payment.creditPriceAtPurchase),
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
   */
  async getPaymentsSummary(query: GetAdminPaymentsQueryDto) {
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
      this.prisma.payment.count({
        where,
      }),

      this.prisma.payment.count({
        where: {
          ...where,
          status: PaymentStatus.SUCCEEDED,
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
          status: PaymentStatus.SUCCEEDED,
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
          status: PaymentStatus.SUCCEEDED,
          paymentPurpose: PaymentPurpose.BUY_CREDITS,
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
   */
  async getPaymentsCharts(query: GetAdminPaymentsQueryDto) {
    const where = this.buildPaymentsWhere(query);

    const [
      paymentsByStatus,
      paymentsByPaymentMethod,
      paymentsByProvider,
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
        by: ['paymentMethodKey'],
        where,

        _count: {
          paymentMethodKey: true,
        },

        _sum: {
          amount: true,
        },

        orderBy: {
          _count: {
            paymentMethodKey: 'desc',
          },
        },
      }),

      this.prisma.payment.groupBy({
        by: ['providerKey'],
        where,

        _count: {
          providerKey: true,
        },

        _sum: {
          amount: true,
        },

        orderBy: {
          _count: {
            providerKey: 'desc',
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
          status: PaymentStatus.SUCCEEDED,
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

      paymentsByPaymentMethod: paymentsByPaymentMethod.map((item) => ({
        label: item.paymentMethodKey,
        paymentMethodKey: item.paymentMethodKey,
        count: item._count.paymentMethodKey,

        totalAmount: toNumber(item._sum.amount),
      })),

      paymentsByProvider: paymentsByProvider.map((item) => ({
        label: item.providerKey,
        providerKey: item.providerKey,
        count: item._count.providerKey,

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
   */
  async exportPaymentsCsv(query: GetAdminPaymentsQueryDto) {
    const where = this.buildPaymentsWhere(query);

    const orderBy = buildOrderBy(
      query,
      [
        'amount',
        'status',
        'paymentMethodKey',
        'providerKey',
        'paymentPurpose',
        'creditsAmount',
        'createdAt',
      ] as const,
      'createdAt',
    );

    const payments = await this.prisma.payment.findMany({
      where,
      orderBy,
      select: this.paymentSelect,
    });

    const headers = [
      'Payment ID',
      'User ID',
      'User Name',
      'User Email',
      'Amount',
      'Currency',
      'Payment Method Key',
      'Provider Key',
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
      payment.paymentMethodKey,
      payment.providerKey,
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

  /**
   * Builds the shared administrator payment filter.
   */
  private buildPaymentsWhere(
    query: GetAdminPaymentsQueryDto,
  ): Prisma.PaymentWhereInput {
    return {
      ...(buildDateFilter(query) ?? {}),

      ...(buildExactFilter('status', query.status) ?? {}),

      ...(buildExactFilter('paymentPurpose', query.paymentPurpose) ?? {}),

      ...(buildExactFilter('paymentMethodKey', query.paymentMethodKey) ?? {}),

      ...(buildExactFilter('providerKey', query.providerKey) ?? {}),

      ...(buildRelationSearchFilter(
        'user',
        ['fullName', 'email'],
        query.search,
      ) ?? {}),
    };
  }
}
