import { PaymentMethod, PaymentPurpose, PaymentStatus } from '@prisma/client';

import { IsEnum, IsOptional } from 'class-validator';

import { ListQueryDto } from '../../utilities/dto/list-query.dto';

/**
 * Query DTO used by authenticated users to retrieve
 * their own payment history and analytics.
 *
 * Supports:
 * - Pagination.
 * - Date filtering.
 * - Search.
 * - Sorting.
 * - Payment-status filtering.
 * - Payment-method filtering.
 * - Payment-purpose filtering.
 *
 * @author Eman
 */
export class GetUserPaymentsQueryDto extends ListQueryDto {
  /**
   * Optional payment-status filter.
   */
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  /**
   * Optional payment-method filter.
   */
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  /**
   * Optional payment-purpose filter.
   */
  @IsOptional()
  @IsEnum(PaymentPurpose)
  paymentPurpose?: PaymentPurpose;
}
