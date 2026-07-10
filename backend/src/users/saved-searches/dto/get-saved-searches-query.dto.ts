import { IsOptional, IsUUID } from 'class-validator';

import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * DTO for retrieving authenticated user's saved generation searches.
 *
 * Supports:
 * - Pagination.
 * - Searching.
 * - Date range filtering.
 * - Sorting.
 * - Filtering by domain.
 *
 * @author Eman
 */
export class GetSavedSearchesQueryDto extends ListQueryDto {
  /**
   * Optional domain filter.
   */
  @IsOptional()
  @IsUUID()
  domainId?: string;
}
