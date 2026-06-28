import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * DTO for pagination query parameters.
 *
 * This DTO is used by endpoints that return paginated results.
 * It defines the optional pagination parameters that allow
 * administrators to control which page of data is returned
 * and how many records are included per page.
 *
 * Default values:
 * - page = 1
 * - limit = 10
 *
 * Validation rules:
 * - Page number must be greater than or equal to 1.
 * - Limit must be between 1 and 100.
 *
 * Example:
 * GET /admin/users?page=2&limit=20
 *
 * @author Malak
 */
export class PaginationQueryDto {
  /**
   * Optional page number.
   *
   * Determines which page of results will be returned.
   *
   * Default:
   * 1
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  /**
   * Optional page size.
   *
   * Specifies the maximum number of records
   * returned per page.
   *
   * Allowed range:
   * 1 - 100
   *
   * Default:
   * 10
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;
}