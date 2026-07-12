import { AlertType } from '@prisma/client';

import { Transform } from 'class-transformer';

import { IsBoolean, IsEnum, IsOptional } from 'class-validator';

import { ListQueryDto } from '../../utilities/dto/list-query.dto';

/**
 * DTO for filtering administrator alert results.
 *
 * Supports:
 * - Pagination.
 * - Search.
 * - Date range filtering.
 * - Sorting.
 * - Alert type filtering.
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
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown => {
    if (typeof value !== 'string') {
      return value;
    }

    const normalized = value.trim().toLowerCase();

    if (normalized === 'true') {
      return true;
    }

    if (normalized === 'false') {
      return false;
    }

    return value;
  })
  @IsBoolean()
  isRead?: boolean;
}
