import { AlertType } from '@prisma/client';

import { Transform } from 'class-transformer';

import { IsBoolean, IsEnum, IsOptional } from 'class-validator';

import { ListQueryDto } from '../../utilities/dto/list-query.dto';

/**
 * DTO used to filter administrator alert results.
 *
 * Supports:
 * - Pagination.
 * - Search.
 * - Date-range filtering.
 * - Sorting.
 * - Alert-type filtering.
 * - Read-status filtering.
 *
 * @author Malak
 */
export class GetAlertsQueryDto extends ListQueryDto {
  /**
   * Optional alert-type filter.
   */
  @IsOptional()
  @IsEnum(AlertType)
  type?: AlertType;

  /**
   * Optional read-status filter.
   *
   * Converts the query-string values "true" and "false"
   * into their corresponding boolean values.
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown => {
    if (typeof value !== 'string') {
      return value;
    }

    const normalizedValue = value.trim().toLowerCase();

    if (normalizedValue === 'true') {
      return true;
    }

    if (normalizedValue === 'false') {
      return false;
    }

    return value;
  })
  @IsBoolean()
  isRead?: boolean;
}
