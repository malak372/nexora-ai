import { Transform } from 'class-transformer';

import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

import { ListQueryDto } from '../../utilities/dto/list-query.dto';

/**
 * Converts a query-string boolean value into a real boolean.
 *
 * Supported values:
 * - true
 * - false
 * - "true"
 * - "false"
 *
 * Unsupported values remain unchanged so class-validator
 * can reject them instead of silently converting them.
 *
 * @param value Raw query-string value.
 * @returns A boolean when the value is valid; otherwise,
 * the original value.
 */
function transformBooleanQueryValue(value: unknown): unknown {
  if (value === true || value === 'true') {
    return true;
  }

  if (value === false || value === 'false') {
    return false;
  }

  return value;
}

/**
 * Query DTO used by administrators to retrieve
 * and filter configured data sources.
 *
 * Inherited ListQueryDto fields:
 * - page
 * - limit
 * - search
 * - sortBy
 * - sortOrder
 * - fromDate
 * - toDate
 *
 * Supported data-source filters:
 * - key
 * - isActive
 * - isImplemented
 * - supportsPosts
 * - supportsComments
 * - supportsRegion
 * - supportsLanguage
 *
 * @author Malak
 */
export class GetDataSourcesQueryDto extends ListQueryDto {
  /**
   * Optional data-source key filter.
   *
   * The service may apply this value as an exact
   * or partial case-insensitive filter.
   *
   * Examples:
   * - youtube
   * - github
   * - google-play
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  key?: string;

  /**
   * Optional activation-state filter.
   *
   * Query examples:
   * - ?isActive=true
   * - ?isActive=false
   */
  @IsOptional()
  @Transform(({ value }) => transformBooleanQueryValue(value))
  @IsBoolean()
  isActive?: boolean;

  /**
   * Optional collector implementation-state filter.
   *
   * A source is implemented when a collector with
   * a matching sourceKey exists in CollectorsFactory.
   */
  @IsOptional()
  @Transform(({ value }) => transformBooleanQueryValue(value))
  @IsBoolean()
  isImplemented?: boolean;

  /**
   * Filters data sources according to whether
   * they return post-like records.
   */
  @IsOptional()
  @Transform(({ value }) => transformBooleanQueryValue(value))
  @IsBoolean()
  supportsPosts?: boolean;

  /**
   * Filters data sources according to whether
   * they return comments, reviews, or replies.
   */
  @IsOptional()
  @Transform(({ value }) => transformBooleanQueryValue(value))
  @IsBoolean()
  supportsComments?: boolean;

  /**
   * Filters data sources according to whether
   * their external platform supports real
   * geographical filtering.
   */
  @IsOptional()
  @Transform(({ value }) => transformBooleanQueryValue(value))
  @IsBoolean()
  supportsRegion?: boolean;

  /**
   * Filters data sources according to whether
   * their external platform supports language filtering.
   */
  @IsOptional()
  @Transform(({ value }) => transformBooleanQueryValue(value))
  @IsBoolean()
  supportsLanguage?: boolean;
}
