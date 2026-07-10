import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { CollectionSourceType, LanguageCode } from '@prisma/client';

import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * Query DTO for filtering, searching, sorting,
 * date filtering, and paginating collected social posts.
 *
 * @author Malak
 */
export class GetSocialPostsQueryDto extends ListQueryDto {
  @IsOptional()
  @IsUUID()
  collectionJobId?: string;

  @IsOptional()
  @IsUUID()
  platformId?: string;

  @IsOptional()
  @IsEnum(CollectionSourceType)
  sourceType?: CollectionSourceType;

  @IsOptional()
  @IsEnum(LanguageCode)
  language?: LanguageCode;

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
