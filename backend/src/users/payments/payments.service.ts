import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GetUserPaymentsQueryDto } from './dto/get-user-payments-query.dto';
import {
    buildDateFilter,
    buildExactFilter,
    buildOrderBy,
    buildPagination,
    buildSearchFilter,
} from '../../utilities/base-query/builder';
import { UserValidationService } from '../validation/Validation.service';

/**
 * Service responsible for user payment operations.
 *
 * This service handles retrieving payment history
 * for the authenticated user.
 *
 * It supports pagination, filtering, searching,
 * and sorting for payment records.
 *
 * It uses UserCommonService for shared user validation logic.
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
     *
     * Supports pagination, date filtering, searching,
     * filtering by payment properties, and sorting.
     *
     * @param userId - Authenticated user ID.
     * @param query - Query parameters for listing payment history.
     * @returns Paginated payment history with pagination metadata.
     *
     * @throws NotFoundException if the user does not exist.
     */
    async getPaymentHistory(userId: string, query: GetUserPaymentsQueryDto) {
        await this.userCommonService.findUserOrThrow(userId);

        const { page, limit, skip } = buildPagination(query);

        const where: Prisma.PaymentWhereInput = {
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
                totalPages: Math.ceil(total / limit),
            },
        };
    }
}