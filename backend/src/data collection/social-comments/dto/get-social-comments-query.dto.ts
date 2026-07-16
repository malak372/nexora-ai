import { IsOptional, IsString, IsUUID } from 'class-validator';

import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * Query DTO for filtering collected comments.
 *
 * @author Malak
 */
export class GetSocialCommentsQueryDto extends ListQueryDto {
  @IsOptional()
  @IsUUID('4')
  postId?: string;

  @IsOptional()
  @IsUUID('4')
  collectionJobId?: string;

  @IsOptional()
  @IsString()
  languageCode?: string;

  @IsOptional()
  @IsString()
  sentiment?: string;

  @IsOptional()
  @IsString()
  author?: string;
}
