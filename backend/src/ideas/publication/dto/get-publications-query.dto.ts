import {
  IdeaPublicationStatus,
  IdeaPublicationVisibility,
} from '@prisma/client';

import { IsEnum, IsOptional } from 'class-validator';

import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * Query DTO used to retrieve published idea publications.
 *
 * Extends the common list query to support:
 * - Pagination.
 * - Search.
 * - Sorting.
 * - Date filtering.
 *
 * Additional publication-specific filters allow clients to narrow
 * the results by publication status and visibility.
 *
 * @author Malak
 */
export class GetPublicationsQueryDto extends ListQueryDto {
  /**
   * Optional publication-status filter.
   */
  @IsOptional()
  @IsEnum(IdeaPublicationStatus)
  status?: IdeaPublicationStatus;

  /**
   * Optional publication-visibility filter.
   */
  @IsOptional()
  @IsEnum(IdeaPublicationVisibility)
  visibility?: IdeaPublicationVisibility;
}
