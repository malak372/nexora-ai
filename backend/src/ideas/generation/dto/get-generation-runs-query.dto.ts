import {
  IdeaGenerationRunStatus,
  IdeaGenerationType,
} from '@prisma/client';

import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

/**
 * Query parameters used to list generation runs owned by the
 * authenticated user.
 *
 * All filters are optional and pagination defaults are applied by the
 * query service when a value is omitted.
 *
 * @author Malak
 */
export class GetGenerationRunsQueryDto {
  /** Page number, starting from one. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  /** Maximum number of runs returned per page. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  /** Optional generation-run status filter. */
  @IsOptional()
  @IsEnum(IdeaGenerationRunStatus)
  status?: IdeaGenerationRunStatus;

  /** Optional entitlement/generation type filter. */
  @IsOptional()
  @IsEnum(IdeaGenerationType)
  generationType?: IdeaGenerationType;

  /** Optional generated-idea identifier filter. */
  @IsOptional()
  @IsUUID('4')
  ideaId?: string;

  /** Optional software-domain identifier filter. */
  @IsOptional()
  @IsUUID('4')
  domainId?: string;
}