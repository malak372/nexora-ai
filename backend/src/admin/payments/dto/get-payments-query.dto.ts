import { IsEnum, IsOptional, IsString } from 'class-validator';
import {
  PaymentStatus,
  PaymentPurpose,
  PaymentMethod,
} from '@prisma/client';
import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * DTO for filtering, searching, and paginating payment records.
 *
 * This DTO is used with the GET /admin/payments endpoint.
 * It defines the optional query parameters that an administrator
 * can use to search, filter, and paginate payment transactions.
 *
 * Supported features:
 * - Pagination.
 * - Filter by payment status.
 * - Filter by payment purpose.
 * - Filter by payment method.
 * - Search by user full name or email.
 *
 * All properties are optional, allowing the administrator
 * to retrieve all payment records or apply one or more filters.
 *
 * Example:
 * GET /admin/payments?page=1&limit=10&status=SUCCESS&method=PAYPAL&search=malak
 *
 * @author Malak
 */
export class GetPaymentsQueryDto extends ListQueryDto {
  /**
   * Optional payment status filter.
   *
   * Must be one of the values defined in the
   * PaymentStatus enum.
   *
   * Example:
   * SUCCESS
   */
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  /**
   * Optional payment purpose filter.
   *
   * Must be one of the values defined in the
   * PaymentPurpose enum.
   *
   * Example:
   * BUY_CREDITS
   */
  @IsOptional()
  @IsEnum(PaymentPurpose)
  purpose?: PaymentPurpose;

  /**
   * Optional payment method filter.
   *
   * Must be one of the values defined in the
   * PaymentMethod enum.
   *
   * Example:
   * PAYPAL
   */
  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;
}