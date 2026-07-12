import { Injectable, NotFoundException } from '@nestjs/common';

import { PaymentStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import {
  buildDateFilter,
  buildExactFilter,
  buildOrderBy,
  buildPagination,
  buildSearchFilter,
} from '../../utilities/base-query/builder';

import {
  buildCsv,
  calculateTotalPages,
} from '../../utilities/analytics/analytics.helper';

import { GetUserPaymentsQueryDto } from '../dto/get-user-payments-query.dto';

/**
 * Handles authenticated-user payment queries.
 *
 * Responsibilities:
 * - Retrieve the authenticated user's payment history.
 * - Generate user payment summaries.
 * - Generate chart-ready payment analytics.
 * - Export user payment history as CSV.
 *
 * Security:
 * - Every payment query is scoped by userId.
 * - Users cannot view payments belonging to another account.
 *
 * Payment creation, gateway callbacks, refunds, and fulfillment
 * remain owned by the dedicated payment-processing services.
 *
 * @author Eman
 */
@Injectable()
export class UserPaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves the authenticated user's payment history.
   */
  async getPaymentHistory(userId: string, query: GetUserPaymentsQueryDto) {
    await this.ensureUserExists(userId);

    const { page, limit, skip, take } = buildPagination(query);

    const where = this.buildWhere(userId, query);

    const orderBy = buildOrderBy(
      query,
      ['createdAt', 'amount', 'status', 'paymentMethod'] as const,
      'createdAt',
    );

    const [payments, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        skip,
        take,
        orderBy,

        select: {
          id: true,
          amount: true,
          currency: true,
          paymentMethod: true,
          status: true,
          paymentPurpose: true,
          creditsAmount: true,
          transactionReference: true,
          ideaId: true,
          createdAt: true,
        },
      }),

      this.prisma.payment.count({
        where,
      }),
    ]);

    return {
      data: payments,

      meta: {
        total,
        page,
        limit,
        totalPages: calculateTotalPages(total, limit),
      },
    };
  }

  /**
   * Returns payment summary metrics for one authenticated user.
   */
  async getPaymentSummary(userId: string, query: GetUserPaymentsQueryDto) {
    await this.ensureUserExists(userId);

    const where = this.buildWhere(userId, query);

    const [totalPayments, successfulPayments, failedPayments, totalSpent] =
      await Promise.all([
        this.prisma.payment.count({
          where,
        }),

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

        this.prisma.payment.aggregate({
          where: {
            ...where,
            status: PaymentStatus.SUCCESS,
          },

          _sum: {
            amount: true,
            creditsAmount: true,
          },
        }),
      ]);

    return {
      totalPayments,
      successfulPayments,
      failedPayments,
      totalSpent: totalSpent._sum.amount ?? 0,
      totalCreditsPurchased: totalSpent._sum.creditsAmount ?? 0,
    };
  }

  /**
   * Returns chart-ready payment analytics for one user.
   */
  async getPaymentCharts(userId: string, query: GetUserPaymentsQueryDto) {
    await this.ensureUserExists(userId);

    const where = this.buildWhere(userId, query);

    const [byStatus, byPaymentMethod, byPaymentPurpose] = await Promise.all([
      this.prisma.payment.groupBy({
        by: ['status'],
        where,

        _count: {
          status: true,
        },
      }),

      this.prisma.payment.groupBy({
        by: ['paymentMethod'],
        where,

        _count: {
          paymentMethod: true,
        },
      }),

      this.prisma.payment.groupBy({
        by: ['paymentPurpose'],
        where,

        _count: {
          paymentPurpose: true,
        },
      }),
    ]);

    return {
      byStatus: byStatus.map((item) => ({
        status: item.status,
        count: item._count.status,
      })),

      byPaymentMethod: byPaymentMethod.map((item) => ({
        paymentMethod: item.paymentMethod,
        count: item._count.paymentMethod,
      })),

      byPaymentPurpose: byPaymentPurpose.map((item) => ({
        paymentPurpose: item.paymentPurpose,
        count: item._count.paymentPurpose,
      })),
    };
  }

  /**
   * Exports the authenticated user's payment history as CSV.
   */
  async exportPaymentsCsv(userId: string, query: GetUserPaymentsQueryDto) {
    await this.ensureUserExists(userId);

    const where = this.buildWhere(userId, query);

    const orderBy = buildOrderBy(
      query,
      ['createdAt', 'amount', 'status', 'paymentMethod'] as const,
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
        status: true,
        paymentPurpose: true,
        creditsAmount: true,
        transactionReference: true,
        ideaId: true,
        createdAt: true,
      },
    });

    return buildCsv(
      [
        'ID',
        'Amount',
        'Currency',
        'Method',
        'Status',
        'Purpose',
        'Credits Amount',
        'Transaction Reference',
        'Idea ID',
        'Created At',
      ],

      payments.map((payment) => [
        payment.id,
        payment.amount.toString(),
        payment.currency,
        payment.paymentMethod,
        payment.status,
        payment.paymentPurpose,
        payment.creditsAmount,
        payment.transactionReference ?? '',
        payment.ideaId ?? '',
        payment.createdAt.toISOString(),
      ]),
    );
  }

  /**
   * Builds a payment filter scoped to one authenticated user.
   */
  private buildWhere(
    userId: string,
    query: GetUserPaymentsQueryDto,
  ): Prisma.PaymentWhereInput {
    return {
      userId,

      ...(buildDateFilter(query) ?? {}),

      ...(buildSearchFilter(
        ['currency', 'transactionReference'],
        query.search,
      ) ?? {}),

      ...(buildExactFilter('status', query.status) ?? {}),

      ...(buildExactFilter('paymentMethod', query.paymentMethod) ?? {}),

      ...(buildExactFilter('paymentPurpose', query.paymentPurpose) ?? {}),
    };
  }

  /**
   * Ensures the authenticated user still exists.
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
      throw new NotFoundException('User not found');
    }
  }
}
