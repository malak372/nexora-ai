import { IsBooleanString, IsOptional } from 'class-validator';
import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * DTO for filtering, searching, sorting, and paginating platforms.
 *
 * Used with:
 * GET /admin/platforms
 * GET /admin/platforms/summary
 * GET /admin/platforms/charts
 *
 * Supports:
 * - Pagination.
 * - Sorting.
 * - Date range filtering.
 * - Search by platform name.
 * - Filter by active status.
 *
 * @author Malak
 */
export class GetPlatformsQueryDto extends ListQueryDto {
  /**
   * Optional active status filter.
   *
   * Accepted values:
   * - "true"
   * - "false"
   *
   * Example:
   * ?isActive=true
   */
  @IsOptional()
  @IsBooleanString()
  isActive?: string;
}
