import { Injectable } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GetPaymentsQueryDto } from './dto/get-payments-query.dto';

/**
 * Service responsible for Admin payment management operations.
 *
 * This service allows administrators to view, filter, sort,
 * analyze, and export payment transactions made by users.
 *
 * @author Malak
 */
@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) { }

  /**
 * Builds the Prisma sorting configuration for payment queries.
 *
 * Maps the requested sorting field and direction
 * from the query parameters into a Prisma-compatible
 * orderBy object.
 *
 * If no sorting field is provided, payments are
 * sorted by creation date in descending order.
 *
 * @param query Query parameters containing the optional
 * sorting field and sorting direction.
 * @returns Prisma orderBy object used when retrieving payments.
 *
 */
  private buildPaymentsOrderBy(query: GetPaymentsQueryDto) {
    const sortOrder: Prisma.SortOrder = query.sortOrder ?? 'desc';

    switch (query.sortBy) {
      case 'amount':
        return { amount: sortOrder };

      case 'status':
        return { status: sortOrder };

      case 'paymentMethod':
        return { paymentMethod: sortOrder };

      case 'paymentPurpose':
        return { paymentPurpose: sortOrder };

      case 'creditsAmount':
        return { creditsAmount: sortOrder };

      case 'createdAt':
      default:
        return { createdAt: sortOrder };
    }
  }

  private buildPaymentsWhere(query: GetPaymentsQueryDto) {
    const where: Prisma.PaymentWhereInput = {};

    if (query.fromDate || query.toDate) {
      where.createdAt = {
        ...(query.fromDate && { gte: new Date(query.fromDate) }),
        ...(query.toDate && { lte: new Date(query.toDate) }),
      };
    }

    if (query.status) where.status = query.status;
    if (query.purpose) where.paymentPurpose = query.purpose;
    if (query.method) where.paymentMethod = query.method;

    if (query.search) {
      where.user = {
        OR: [
          { fullName: { contains: query.search, mode: 'insensitive' } },
          { email: { contains: query.search, mode: 'insensitive' } },
        ],
      };
    }

    return where;
  }

  async getPayments(query: GetPaymentsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const where = this.buildPaymentsWhere(query);


    const [payments, total, topPayingUsers] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        skip,
        take: limit,
        orderBy: this.buildPaymentsOrderBy(query),
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

      this.prisma.payment.count({
        where,
      }),

      this.prisma.payment.groupBy({
        by: ['userId'],
        where: {
          ...where,
          status: PaymentStatus.SUCCESS,
        },
        _sum: {
          amount: true,
        },
        _count: true,
        orderBy: {
          _sum: {
            amount: 'desc',
          },
        },
        take: 5,
      }),
    ]);

const topUserIds = topPayingUsers.map((item) => item.userId);

const topUsers = await this.prisma.user.findMany({
  where: {
    id: {
      in: topUserIds,
    },
  },
  select: {
    id: true,
    fullName: true,
    email: true,
  },
});

const userMap = new Map(topUsers.map(u => [u.id, u]));

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
      typeof item._count === 'number'
        ? item._count
        : 0,
  })),
};
  }

  async exportPaymentsCsv(query: GetPaymentsQueryDto) {
    const where = this.buildPaymentsWhere(query);

    const payments = await this.prisma.payment.findMany({
      where,
      orderBy: this.buildPaymentsOrderBy(query),
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

    const rows = payments.map((payment) => [
      payment.id,
      payment.user?.fullName ?? '',
      payment.user?.email ?? '',
      payment.amount,
      payment.currency,
      payment.paymentMethod,
      payment.paymentPurpose,
      payment.status,
      payment.creditsAmount ?? '',
      payment.creditPriceAtPurchase ?? '',
      payment.transactionReference ?? '',
      payment.idea?.title ?? '',
      payment.createdAt.toISOString(),
    ]);

    const escapeCsvValue = (value: unknown) => {
      const stringValue = String(value ?? '');
      return `"${stringValue.replace(/"/g, '""')}"`;
    };

    return [headers, ...rows]
      .map((row) => row.map(escapeCsvValue).join(','))
      .join('\n');
  }
}