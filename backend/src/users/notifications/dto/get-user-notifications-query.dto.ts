import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { AlertType } from '@prisma/client';

import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * DTO for retrieving the authenticated user's notifications.
 *
 * Extends the shared list query DTO to support:
 * - Pagination
 * - Date range filtering
 * - Search
 * - Sorting
 *
 * Additional filters:
 * - Read status
 * - Notification type
 *
 * @author Eman
 */
export class GetUserNotificationsQueryDto extends ListQueryDto {
  /**
   * Optional read status filter.
   */
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  isRead?: boolean;

  /**
   * Optional notification type filter.
   */
  @IsOptional()
  @IsEnum(AlertType)
  type?: AlertType;
}
