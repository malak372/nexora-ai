import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { CollectionJobStatus } from '@prisma/client';

import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * Query DTO for filtering, sorting, and paginating collection jobs.
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
  region?: string;
}