import {
  PaymentMethod,
  PaymentPurpose,
  PaymentStatus,
} from '@prisma/client';

import {
  IsEnum,
  IsOptional,
} from 'class-validator';

import { ListQueryDto } from '../../utilities/dto/list-query.dto';

/**
 * Query DTO used by administrators to retrieve and analyze payments.
 *
 * Used by:
 * - Payment listing.
 * - Payment summary.
 * - Payment charts.
 * - CSV export.
 *
 * Supports:
 * - Pagination.
 * - Sorting.
 * - Date filtering.
 * - Search by user name or email.
 * - Payment-status filtering.
 * - Payment-purpose filtering.
 * - Payment-method filtering.
 *
 * @author Malak
 */
export class GetAdminPaymentsQueryDto extends ListQueryDto {
  /**
   * Optional payment-status filter.
   */
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  /**
   * Optional payment-purpose filter.
   */
  @IsOptional()
  @IsEnum(PaymentPurpose)
  purpose?: PaymentPurpose;

  /**
   * Optional payment-method filter.
   */
  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;
}