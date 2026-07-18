import {
  IdeaGenerationRunStatus,
  IdeaGenerationType,
} from '@prisma/client';

import {
  IsEnum,
  IsOptional,
  IsUUID,
} from 'class-validator';

import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * Query parameters used to retrieve idea-generation runs.
 *
 * This DTO may be used by user-facing or administrative
 * run-listing endpoints.
 *
 * Ownership constraints must always be applied by the service.
 *
 * @author Malak
 */
export class GetGenerationRunsQueryDto extends ListQueryDto {
  /**
   * Filters runs by pipeline status.
   */
  @IsOptional()
  @IsEnum(IdeaGenerationRunStatus)
  status?: IdeaGenerationRunStatus;

  /**
   * Filters runs by generation entitlement.
   */
  @IsOptional()
  @IsEnum(IdeaGenerationType)
  generationType?: IdeaGenerationType;

  /**
   * Filters runs associated with one generated idea.
   */
  @IsOptional()
  @IsUUID('4')
  ideaId?: string;

  /**
   * Filters runs associated with one software domain.
   */
  @IsOptional()
  @IsUUID('4')
  domainId?: string;
}