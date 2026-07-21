import {
  IdeaGenerationRunStatus,
  IdeaGenerationType,
  UnlockMethod,
  UserType,
} from '@prisma/client';

import {
  IsBooleanString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

import { ListQueryDto } from '../../../../utilities/dto/list-query.dto';

/**
 * Query parameters used by the administrative idea-management endpoints.
 *
 * Supports:
 * - Pagination.
 * - Sorting.
 * - Date-range filtering.
 * - Search by idea title and problem statement.
 * - Filtering by domain.
 * - Filtering by collection data-source key.
 * - Filtering by selected geographical region.
 * - Filtering by generation type.
 * - Filtering by generation-run status.
 * - Filtering by unlock method and unlock status.
 * - Filtering by the owner's user type.
 *
 * Data sources are identified by stable string keys rather than
 * database enums. This permits adding collector implementations
 * without requiring a Prisma migration.
 *
 * @author Malak
 */
export class GetAdminIdeasQueryDto extends ListQueryDto {
  /**
   * Filters ideas by software domain.
   */
  @IsOptional()
  @IsUUID('4')
  domainId?: string;

  /**
   * Filters ideas by a collection data-source key.
   *
   * Examples:
   * - youtube
   * - github
   * - dev-to
   * - stackoverflow
   */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'dataSourceKey must use lowercase kebab-case characters.',
  })
  dataSourceKey?: string;

  /**
   * Filters ideas by their selected geographical region.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  region?: string;

  /**
   * Filters ideas by the generation entitlement used.
   */
  @IsOptional()
  @IsEnum(IdeaGenerationType)
  generationType?: IdeaGenerationType;

  /**
   * Filters ideas by the status of their generation pipeline.
   */
  @IsOptional()
  @IsEnum(IdeaGenerationRunStatus)
  runStatus?: IdeaGenerationRunStatus;

  /**
   * Filters ideas by the mechanism that unlocked advanced features.
   */
  @IsOptional()
  @IsEnum(UnlockMethod)
  unlockMethod?: UnlockMethod;

  /**
   * Filters ideas by the registered owner's user type.
   *
   * Guest ideas are excluded when this filter is provided.
   */
  @IsOptional()
  @IsEnum(UserType)
  userType?: UserType;

  /**
   * Filters ideas by advanced-output access.
   *
   * Accepted query values:
   * - true
   * - false
   */
  @IsOptional()
  @IsBooleanString()
  isUnlocked?: string;
}
