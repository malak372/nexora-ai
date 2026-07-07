import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { LanguageCode } from '@prisma/client';

import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * Query DTO for filtering, searching, sorting,
 * date filtering, and paginating social comments.
 *
 * Inherits from ListQueryDto:
 * - page
 * - limit
 * - search
 * - sortBy
 * - sortOrder
 * - fromDate
 * - toDate
 *
 * @author Malak
 */
export class GetSocialCommentsQueryDto extends ListQueryDto {
  @IsOptional()
  @IsUUID()
  postId?: string;

  @IsOptional()
  @IsUUID()
  collectionJobId?: string;

  @IsOptional()
  @IsEnum(LanguageCode)
  language?: LanguageCode;

  @IsOptional()
  @IsString()
  sentiment?: string;

  @IsOptional()
  @IsString()
  author?: string;
}