import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import {
  CollectionJobStatus,
  CollectionSourceType,
  LanguageCode,
} from '@prisma/client';

import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * Query DTO for filtering, searching, sorting,
 * date filtering, and paginating collection jobs.
 *
 * Inherits common list query parameters from ListQueryDto:
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
export class GetCollectionJobsQueryDto extends ListQueryDto {
  @IsOptional()
  @IsUUID()
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

  @IsOptional()
  @IsEnum(CollectionSourceType)
  platform?: CollectionSourceType;
}