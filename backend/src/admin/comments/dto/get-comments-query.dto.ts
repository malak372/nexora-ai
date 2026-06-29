import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * DTO for filtering, searching, sorting, and paginating collected comments.
 *
 * Used with:
 * GET /admin/comments
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
 * Example:
 * GET /admin/comments?page=1&limit=10&platformId=PLATFORM_ID&language=en&region=Palestine&search=AI
 *
 * @author Malak
 */
export class GetCommentsQueryDto extends ListQueryDto {
  /**
   * Optional platform identifier.
   *
   * Filters comments collected from a specific platform.
   *
   * Must be a valid UUID.
   */
  @IsOptional()
  @IsUUID()
  platformId?: string;

  /**
   * Optional language filter.
   *
   * Example:
   * ar, en
   */
  @IsOptional()
  @MaxLength(20)
  @IsString()
  language?: string;

  /**
   * Optional region filter.
   *
   * Example:
   * Palestine, Jordan
   */
  @IsOptional()
  @MaxLength(100)
  @IsString()
  region?: string;
}