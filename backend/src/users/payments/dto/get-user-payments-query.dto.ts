import { IsEnum, IsOptional } from 'class-validator';
import {
    PaymentMethod,
    PaymentPurpose,
    PaymentStatus,
} from '@prisma/client';

import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * DTO for retrieving the authenticated user's payment history.
 *
 * Extends the shared list query DTO to support:
 * - Pagination
 * - Date range filtering
 * - Search
 * - Sorting
 *
 * Additional filters:
 * - Payment status
 * - Payment method
 * - Payment purpose
 *
 * @author Eman
 */
export class GetUserPaymentsQueryDto extends ListQueryDto {
    /**
     * Optional payment status filter.
     */
    @IsOptional()
    @IsEnum(PaymentStatus)
    status?: PaymentStatus;

    /**
     * Optional payment method filter.
     */
    @IsOptional()
    @IsEnum(PaymentMethod)
    paymentMethod?: PaymentMethod;

    /**
     * Optional payment purpose filter.
     */
    @IsOptional()
    @IsEnum(PaymentPurpose)
    paymentPurpose?: PaymentPurpose;
}