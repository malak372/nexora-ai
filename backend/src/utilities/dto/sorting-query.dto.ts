import { IsIn, IsOptional, IsString } from 'class-validator';

/**
 * DTO for sorting list endpoint results.
 *
 * This DTO provides optional sorting parameters that can be
 * reused across admin list endpoints.
 *
 * Supported sorting:
 * - sortBy: Specifies the field used for sorting.
 * - sortOrder: Specifies the sorting direction.
 *
 * Default behavior:
 * - If omitted, each endpoint applies its default sorting field
 *   and descending order.
 *
 * Example:
 * GET /admin/payments?sortBy=createdAt&sortOrder=desc
 *
 * @author Malak
 */
export class SortingQueryDto {
  /**
   * Optional sorting field.
   *
   * The supported fields depend on the endpoint.
   *
   * Example:
   * createdAt
   */
  @IsOptional()
  @IsString()
  sortBy?: string;

  /**
   * Optional sorting direction.
   *
   * Accepted values:
   * - asc
   * - desc
   *
   * Default:
   * desc
   */
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
