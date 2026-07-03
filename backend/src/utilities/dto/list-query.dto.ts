import { IntersectionType } from '@nestjs/mapped-types';
import { PaginationQueryDto } from './pagination-query.dto';
import { DateRangeQueryDto } from './date-range-query.dto';
import { SearchQueryDto } from './search-query.dto';
import { SortingQueryDto } from './sorting-query.dto';

/**
 * Base DTO for list endpoints.
 *
 * This DTO combines the common query parameters shared across
 * list endpoints, including:
 * - Pagination.
 * - Date range filtering.
 * - Search.
 * - Sorting.
 *
 * It is intended to be extended by other query DTOs
 * that require these common features.
 *
 * @author Malak
 */
export class ListQueryDto extends IntersectionType(
  PaginationQueryDto,
  DateRangeQueryDto,
  SearchQueryDto,
  SortingQueryDto,
) { }