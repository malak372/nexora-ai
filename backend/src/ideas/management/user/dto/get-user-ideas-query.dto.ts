import {
  IdeaGenerationType,
  UnlockMethod,
} from '@prisma/client';

import { Transform } from 'class-transformer';

import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsUUID,
} from 'class-validator';

import { ListQueryDto } from '../../../../utilities/dto/list-query.dto';

/**
 * Query parameters used to retrieve ideas owned by
 * the authenticated user.
 *
 * Supports:
 * - Pagination.
 * - Searching.
 * - Sorting.
 * - Date-range filtering.
 * - Domain filtering.
 * - Generation-type filtering.
 * - Unlock-status filtering.
 * - Unlock-method filtering.
 *
 * @author Malak
 */
export class GetUserIdeasQueryDto extends ListQueryDto {
  /**
   * Filters ideas by software domain.
   */
  @IsOptional()
  @IsUUID('4')
  domainId?: string;

  /**
   * Filters ideas by their generation entitlement.
   */
  @IsOptional()
  @IsEnum(IdeaGenerationType)
  generationType?: IdeaGenerationType;

  /**
   * Filters ideas according to whether advanced
   * project features are unlocked.
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === true || value === 'true') {
      return true;
    }

    if (value === false || value === 'false') {
      return false;
    }

    return value;
  })
  @IsBoolean()
  isUnlocked?: boolean;

  /**
   * Filters ideas by the mechanism used to unlock
   * their advanced project features.
   */
  @IsOptional()
  @IsEnum(UnlockMethod)
  unlockMethod?: UnlockMethod;
}