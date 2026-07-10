import { IsEnum, IsOptional } from 'class-validator';
import { CreditTransactionType } from '@prisma/client';
import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * DTO for filtering, searching, sorting, and paginating
 * credit transaction history.
 *
 * Used with:
 * GET /admin/credits/history
 * GET /admin/credits/export/csv
 *
 * Supports:
 * - Pagination through page and limit.
 * - Sorting through sortBy and sortOrder.
 * - Date filtering through fromDate and toDate.
 * - Search.
 * - Filter by credit transaction type.
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
   * Must be one of the values defined in
   * the CreditTransactionType enum.
   *
   * Example:
   * PURCHASE
   * ADMIN_ADJUSTMENT
   * DEDUCTION_GENERATION
   */
  @IsOptional()
  @IsEnum(CreditTransactionType)
  type?: CreditTransactionType;
}
