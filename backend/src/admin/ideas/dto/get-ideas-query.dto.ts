import { IsEnum, IsOptional, IsString } from 'class-validator';
import { IdeaGenerationType, UnlockMethod } from '@prisma/client';
import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * DTO for filtering, searching, and paginating generated project ideas.
 *
 * This DTO is used with the GET /admin/ideas endpoint.
 * It extends PaginationQueryDto to support pagination
 * while providing additional filtering and searching options.
 *
 * Supported features:
 * - Pagination.
 * - Search by project title.
 * - Filter by domain.
 * - Filter by platform.
 * - Filter by region.
 * - Filter by generation type.
 * - Filter by unlock method.
 * - Filter by unlock status.
 *
 * All filter properties are optional, allowing the administrator
 * to retrieve all ideas or apply one or more filters.
 *
 * Example:
 * GET /admin/ideas?page=1&limit=10&search=health&domainId=123&generationType=PREMIUM_CREDIT&isUnlocked=true
 *
 * @author Malak
 */
export class GetIdeasQueryDto extends ListQueryDto {
  /**
   * Optional search keyword.
   *
   * Used to search project ideas by title.
   *
   * Example:
   * health
   */
  @IsOptional()
  @IsString()
  search?: string;

  /**
   * Optional domain identifier.
   *
   * Filters ideas belonging to a specific domain.
   */
  @IsOptional()
  @IsString()
  domainId?: string;

  /**
   * Optional platform identifier.
   *
   * Filters ideas generated using comments
   * collected from a specific platform.
   */
  @IsOptional()
  @IsString()
  platformId?: string;

  /**
   * Optional region filter.
   *
   * Filters ideas based on the selected region.
   *
   * Example:
   * Palestine
   */
  @IsOptional()
  @IsString()
  region?: string;

  /**
   * Optional generation type.
   *
   * Must be one of the values defined in the
   * IdeaGenerationType enum.
   *
   * Example:
   * PREMIUM_CREDIT
   */
  @IsOptional()
  @IsEnum(IdeaGenerationType)
  generationType?: IdeaGenerationType;

  /**
   * Optional unlock method.
   *
   * Must be one of the values defined in the
   * UnlockMethod enum.
   *
   * Example:
   * CREDIT_GENERATION
   */
  @IsOptional()
  @IsEnum(UnlockMethod)
  unlockMethod?: UnlockMethod;

  /**
   * Optional unlock status.
   *
   * Filters ideas based on whether they are
   * unlocked or still locked.
   *
   * Accepted values:
   * - "true"
   * - "false"
   */
  @IsOptional()
  @IsString()
  isUnlocked?: string;
}