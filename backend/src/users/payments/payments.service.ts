import { Injectable } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { GetUserPaymentsQueryDto } from './dto/get-user-payments-query.dto';
import { UserValidationService } from '../validation/validation.service';

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

/**
 * Service responsible for user payment operations.
 *
 * Handles:
 * - Payment history.
 * - Payment reports.
 * - Payment chart analytics.
 * - CSV export.
 *
 * Used by authenticated users to review their own payment activity,
 * including direct idea unlocks and credit package purchases.
 *
 * @author Eman
 */
@Injectable()
export class UserPaymentsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly userCommonService: UserValidationService,
    ) { }

    /**
     * Retrieves the authenticated user's payment history.
     */
    async getPaymentHistory(userId: string, query: GetUserPaymentsQueryDto) {
        await this.userCommonService.findUserOrThrow(userId);

        const { page, limit, skip } = buildPagination(query);
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
                take: limit,
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
            this.prisma.payment.count({ where }),
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
     * Returns payment summary for the authenticated user.
     */
    async getPaymentSummary(userId: string, query: GetUserPaymentsQueryDto) {
        await this.userCommonService.findUserOrThrow(userId);

        const where = this.buildWhere(userId, query);

        const [totalPayments, successfulPayments, failedPayments, totalSpent] =
            await Promise.all([
                this.prisma.payment.count({ where }),
                this.prisma.payment.count({
                    where: { ...where, status: PaymentStatus.SUCCESS },
                }),
                this.prisma.payment.count({
                    where: { ...where, status: PaymentStatus.FAILED },
                }),
                this.prisma.payment.aggregate({
                    where: { ...where, status: PaymentStatus.SUCCESS },
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
     * Returns chart-ready payment analytics.
     */
    async getPaymentCharts(userId: string, query: GetUserPaymentsQueryDto) {
        await this.userCommonService.findUserOrThrow(userId);

        const where = this.buildWhere(userId, query);

        const [byStatus, byPaymentMethod, byPaymentPurpose] = await Promise.all([
            this.prisma.payment.groupBy({
                by: ['status'],
                where,
                _count: { status: true },
            }),
            this.prisma.payment.groupBy({
                by: ['paymentMethod'],
                where,
                _count: { paymentMethod: true },
            }),
            this.prisma.payment.groupBy({
                by: ['paymentPurpose'],
                where,
                _count: { paymentPurpose: true },
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
        await this.userCommonService.findUserOrThrow(userId);

        const where = this.buildWhere(userId, query);

        const payments = await this.prisma.payment.findMany({
            where,
            orderBy: { createdAt: 'desc' },
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
     * Builds the shared Prisma filter for user payment queries.
     */
    private buildWhere(
        userId: string,
        query: GetUserPaymentsQueryDto,
    ): Prisma.PaymentWhereInput {
        return {
            userId,
            ...buildDateFilter(query),
            ...buildSearchFilter(
                ['currency', 'transactionReference'],
                query.search,
            ),
            ...buildExactFilter('status', query.status),
            ...buildExactFilter('paymentMethod', query.paymentMethod),
            ...buildExactFilter('paymentPurpose', query.paymentPurpose),
        };
    }
}