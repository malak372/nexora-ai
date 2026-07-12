import { AlertType } from '@prisma/client';

import { Transform } from 'class-transformer';

import { IsBoolean, IsEnum, IsOptional } from 'class-validator';

import { ListQueryDto } from '../../utilities/dto/list-query.dto';

/**
 * DTO for retrieving authenticated-user notifications.
 *
 * Supports:
 * - Pagination.
 * - Date filtering.
 * - Search.
 * - Sorting.
 * - Read-status filtering.
 * - Notification-type filtering.
 *
 * @author Eman
 */
export class GetUserNotificationsQueryDto extends ListQueryDto {
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

  /**
   * Optional notification-type filter.
   */
  @IsOptional()
  @IsEnum(AlertType)
  type?: AlertType;
}
