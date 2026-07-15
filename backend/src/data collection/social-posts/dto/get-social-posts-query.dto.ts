import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * Query DTO for filtering collected posts.
 *
 * @author Malak
 */
export class GetSocialPostsQueryDto
  extends ListQueryDto
{
  @IsOptional()
  @IsUUID('4')
  collectionJobId?: string;

  @IsOptional()
  @IsUUID('4')
  dataSourceId?: string;

  /**
   * Filters posts using DataSource.key.
   */
  @IsOptional()
  @IsString()
  @Matches(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  )
  dataSourceKey?: string;

  @IsOptional()
  @IsString()
  languageCode?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  author?: string;
}