import {
  IsBooleanString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { IdeaGenerationType, UnlockMethod, UserType } from '@prisma/client';
import { ListQueryDto } from '../../utilities/dto/list-query.dto';

/**
 * DTO for filtering, searching, sorting, and paginating generated ideas.
 *
 * Used with:
 * GET /admin/ideas
 * GET /admin/ideas/summary
 * GET /admin/ideas/charts
 * GET /admin/ideas/export/csv
 *
 * Supports:
 * - Pagination.
 * - Sorting.
 * - Date filtering.
 * - Search by idea title and problem statement.
 * - Filter by domain.
 * - Filter by selected platform.
 * - Filter by selected region.
 * - Filter by idea generation type.
 * - Filter by unlock method.
 * - Filter by unlock status.
 * - Filter by owner user type.
 *
 * @author Malak
 */
export class GetIdeasQueryDto extends ListQueryDto {
  @IsOptional()
  @IsUUID()
  domainId?: string;

  @IsOptional()
  @IsUUID()
  platformId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  region?: string;

  @IsOptional()
  @IsEnum(IdeaGenerationType)
  generationType?: IdeaGenerationType;

  @IsOptional()
  @IsEnum(UnlockMethod)
  unlockMethod?: UnlockMethod;

  /**
   * Optional user type filter.
   *
   * Filters ideas by the type of the registered user
   * who generated the idea.
   *
   * Examples:
   * ?userType=STUDENT
   * ?userType=DEVELOPER
   */
  @IsOptional()
  @IsEnum(UserType)
  userType?: UserType;

  @IsOptional()
  @IsBooleanString()
  isUnlocked?: string;
}
