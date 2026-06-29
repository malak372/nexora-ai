import { IsEnum, IsOptional } from 'class-validator';
import {
  PaymentMethod,
  PaymentPurpose,
  PaymentStatus,
} from '@prisma/client';
import { ListQueryDto } from '../../utilities/dto/list-query.dto';

/**
 * DTO for filtering, searching, sorting, and paginating payment records.
 *
 * Used with:
 * GET /admin/payments
 * GET /admin/payments/summary
 * GET /admin/payments/charts
 * GET /admin/payments/export/csv
 *
 * Supports:
 * - Pagination.
 * - Sorting.
 * - Date range filtering.
 * - Search by user full name or email.
 * - Filter by payment status.
 * - Filter by payment purpose.
 * - Filter by payment method.
 *
 * @author Malak
 */
export class GetPaymentsQueryDto extends ListQueryDto {
  /**
   * Optional payment status filter.
   *
   * Examples:
   * - PENDING
   * - SUCCESS
   * - FAILED
   * - REFUNDED
   */
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  /**
   * Optional payment purpose filter.
   *
   * Examples:
   * - BUY_CREDITS
   * - DIRECT_UNLOCK
   */
  @IsOptional()
  @IsEnum(PaymentPurpose)
  purpose?: PaymentPurpose;

  /**
   * Optional payment method filter.
   *
   * Examples:
   * - CARD
   * - PAYPAL
   * - PALPAY
   */
  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;
}