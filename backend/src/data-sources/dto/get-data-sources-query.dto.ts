import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { ListQueryDto } from '../../utilities/dto/list-query.dto';

/**
 * Converts query-string boolean values into booleans.
 *
 * Other values remain unchanged so class-validator can
 * reject invalid input instead of silently converting it.
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
 * Query DTO for filtering, searching, sorting,
 * date filtering, and paginating data sources.
 *
 * Inherited fields:
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
export class GetDataSourcesQueryDto extends ListQueryDto {
  /**
   * Exact or partial source-key filter.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  key?: string;

  /**
   * Activation-state filter.
   */
  @IsOptional()
  @Transform(({ value }) => transformBooleanQueryValue(value))
  @IsBoolean()
  isActive?: boolean;

  /**
   * Backend implementation-state filter.
   */
  @IsOptional()
  @Transform(({ value }) => transformBooleanQueryValue(value))
  @IsBoolean()
  isImplemented?: boolean;

  /**
   * Filters sources that support posts.
   */
  @IsOptional()
  @Transform(({ value }) => transformBooleanQueryValue(value))
  @IsBoolean()
  supportsPosts?: boolean;

  /**
   * Filters sources that support comments.
   */
  @IsOptional()
  @Transform(({ value }) => transformBooleanQueryValue(value))
  @IsBoolean()
  supportsComments?: boolean;

  /**
   * Filters sources that support region filtering.
   */
  @IsOptional()
  @Transform(({ value }) => transformBooleanQueryValue(value))
  @IsBoolean()
  supportsRegion?: boolean;

  /**
   * Filters sources that support language filtering.
   */
  @IsOptional()
  @Transform(({ value }) => transformBooleanQueryValue(value))
  @IsBoolean()
  supportsLanguage?: boolean;
}