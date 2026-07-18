import { Type } from 'class-transformer';

import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Query parameters used to retrieve community posts
 * and comments associated with a user-owned idea.
 *
 * Community data is available only when:
 * - The user owns the idea.
 * - The idea is unlocked.
 * - The idea has an associated CollectionJob.
 *
 * @author Malak
 */
export class GetIdeaCommentsQueryDto {
  /**
   * Requested result page.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  /**
   * Maximum number of comments returned per page.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  /**
   * Optional DataSource registry key.
   *
   * Examples:
   * - youtube
   * - github
   * - dev-to
   */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  dataSourceKey?: string;

  /**
   * Optional comment sentiment filter.
   */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  sentiment?: string;

  /**
   * Optional comment-language filter.
   *
   * This filter is only used when the user explicitly
   * filters already collected comments. Language does not
   * restrict the original collection unless supported and selected.
   */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  languageCode?: string;
}