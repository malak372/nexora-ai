import { IsEnum, IsOptional, IsString } from 'class-validator';
import { CreditTransactionType } from '@prisma/client';
import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * DTO for filtering, searching, and paginating credit transaction history.
 *
 * This DTO is used with the GET /admin/credits/history endpoint.
 * It defines the optional query parameters that an administrator
 * can use to search, filter, and paginate credit transaction records.
 *
 * Supported features:
 * - Pagination.
 * - Filter by credit transaction type.
 * - Search by user full name or email.
 *
 * All properties are optional, allowing the administrator
 * to retrieve all credit transactions or apply one or more filters.
 *
 * Example:
 * GET /admin/credits/history?page=1&limit=10&type=PURCHASE&search=malak
 *
 * @author Malak
 */
export class GetCreditHistoryQueryDto extends ListQueryDto {
  /**
   * Optional credit transaction type filter.
   *
   * Must be one of the values defined in the
   * CreditTransactionType enum.
   *
   * Example:
   * PURCHASE
   */
  @IsOptional()
  @IsEnum(CreditTransactionType)
  type?: CreditTransactionType;

  /**
   * Optional search keyword.
   *
   * Used to search credit transaction records
   * by the user's full name or email address.
   */
  @IsOptional()
  @IsString()
  search?: string;
}