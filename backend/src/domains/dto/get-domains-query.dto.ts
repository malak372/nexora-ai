import { IsBooleanString, IsOptional } from 'class-validator';
import { ListQueryDto } from '../../utilities/dto/list-query.dto';

/**
 * DTO for querying project domains.
 *
 * Extends the shared ListQueryDto to provide:
 * - Pagination.
 * - Date range filtering.
 * - Search.
 * - Sorting.
 *
 * Additionally supports filtering domains
 * by their active status.
 *
 * Endpoint:
 * GET /admin/domains
 *
 * Notes:
 * - This DTO is intended for administrative list endpoints.
 * - It can also be reused by reports and dashboard tables
 *   that display project domains.
 *
 * @author Malak
 */
export class GetDomainsQueryDto extends ListQueryDto {
  /**
   * Optional domain active status filter.
   *
   * Accepted values:
   * - "true"
   * - "false"
   *
   * Example:
   * GET /admin/domains?isActive=true
   */
  @IsOptional()
  @IsBooleanString()
  isActive?: string;
}
