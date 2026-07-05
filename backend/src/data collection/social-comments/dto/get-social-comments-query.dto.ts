import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { LanguageCode } from '@prisma/client';

import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * Query DTO for filtering, sorting, and paginating social comments.
 *
 * Used with:
 * - GET /data-collection/comments
 *
 * Supports:
 * - Pagination.
 * - Sorting.
 * - Search.
 * - Filter by post ID.
 * - Filter by collection job ID.
 * - Filter by language.
 *
 * @author Malak
 */
export class GetSocialCommentsQueryDto extends ListQueryDto {
  /**
   * Filters comments that belong to a specific social post.
   */
  @IsOptional()
  @IsUUID()
  postId?: string;

  /**
   * Filters comments that belong to posts collected by a specific collection job.
   */
  @IsOptional()
  @IsUUID()
  collectionJobId?: string;

  /**
   * Filters comments by detected language.
   */
  @IsOptional()
  @IsEnum(LanguageCode)
  language?: LanguageCode;

  /**
   * Filters comments by sentiment value.
   */
  @IsOptional()
  @IsString()
  sentiment?: string;
}