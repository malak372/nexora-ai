import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { LanguageCode } from '@prisma/client';

import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * Query DTO for filtering, sorting, and paginating collected social posts.
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
  @IsEnum(LanguageCode)
  language?: LanguageCode;

  @IsOptional()
  @IsString()
  region?: string;
}