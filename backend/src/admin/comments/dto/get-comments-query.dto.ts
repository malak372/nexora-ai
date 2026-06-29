import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * DTO for filtering, searching, sorting, and paginating collected comments.
 *
 * Used with:
 * GET /admin/comments
 * GET /admin/comments/summary
 * GET /admin/comments/charts
 *
 * Supports:
 * - Pagination through page and limit.
 * - Sorting through sortBy and sortOrder.
 * - Date filtering through fromDate and toDate.
 * - Search within comment content.
 * - Filter by platform.
 * - Filter by language.
 * - Filter by region.
 *
 * @author Malak
 */
export class GetCommentsQueryDto extends ListQueryDto {
  /**
   * Optional platform identifier.
   *
   * Filters comments collected from a specific supported platform.
   *
   * Must be a valid UUID.
   */
  @IsOptional()
  @IsUUID()
  platformId?: string;

  /**
   * Optional language filter.
   *
   * Supports values such as:
   * - ar
   * - en
   *
   * The service applies this filter as a case-insensitive
   * string filter.
   */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  language?: string;

  /**
   * Optional region filter.
   *
   * Examples:
   * - Palestine
   * - Jordan
   *
   * The service applies this filter as a case-insensitive
   * string filter.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  region?: string;
}