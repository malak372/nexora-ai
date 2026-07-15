import {
  CollectionJobStatus,
  LanguageCode,
} from '@prisma/client';

import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * Query DTO for filtering collection jobs.
 *
 * @author Malak
 */
export class GetCollectionJobsQueryDto
  extends ListQueryDto
{
  @IsOptional()
  @IsUUID('4')
  domainId?: string;

  @IsOptional()
  @IsEnum(CollectionJobStatus)
  status?: CollectionJobStatus;

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
  @IsEnum(LanguageCode)
  language?: LanguageCode;

  /**
   * Filters jobs by DataSource.key.
   */
  @IsOptional()
  @IsString()
  @Matches(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  )
  dataSourceKey?: string;
}