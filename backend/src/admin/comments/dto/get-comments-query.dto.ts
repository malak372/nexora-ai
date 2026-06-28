import { IsOptional, IsString } from 'class-validator';
import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * DTO for filtering, searching, and paginating collected comments.
 *
 * This DTO is used with the GET /admin/comments endpoint.
 * It defines the optional query parameters that an administrator
 * can use to search, filter, and paginate collected comments.
 *
 * Supported features:
 * - Pagination.
 * - Filter by platform.
 * - Filter by language.
 * - Filter by region.
 * - Search within comment content.
 *
 * All properties are optional, allowing the administrator
 * to retrieve all comments or apply one or more filters.
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
   */
  @IsOptional()
  @IsString()
  platformId?: string;

  /**
   * Optional language filter.
   *
   * Filters comments by their detected language.
   *
   * Example:
   * ar, en
   */
  @IsOptional()
  @IsString()
  language?: string;

  /**
   * Optional region filter.
   *
   * Filters comments based on the detected region.
   *
   * Example:
   * Palestine, Jordan
   */
  @IsOptional()
  @IsString()
  region?: string;

  /**
   * Optional search keyword.
   *
   * Used to search within the collected comment content.
   */
  @IsOptional()
  @IsString()
  search?: string;
}