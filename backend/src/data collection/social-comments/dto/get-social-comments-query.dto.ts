import { IsOptional, IsString, IsUUID } from 'class-validator';

import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * Query DTO for filtering, sorting, and paginating social comments.
 *
 * @author Malak
 */
export class GetSocialCommentsQueryDto extends ListQueryDto {
  @IsOptional()
  @IsUUID()
  postId?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  sentiment?: string;
}