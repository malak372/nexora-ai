import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { AlertType } from '@prisma/client';
import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * DTO for filtering, searching, and paginating system alerts.
 *
 * This DTO is used with the GET /admin/alerts endpoint.
 * It represents the optional query parameters that an administrator
 * can use to retrieve and filter alert notifications.
 *
 * Supported features:
 * - Pagination.
 * - Filter by alert type.
 * - Filter by read/unread status.
 * - Search by alert title or message.
 *
 * All properties are optional, allowing the administrator to
 * retrieve all alerts or apply one or more filters.
 *
 * Example:
 * GET /admin/alerts?page=1&limit=10&type=SYSTEM&isRead=false&search=maintenance
 *
 * @author Malak
 */

export class GetAlertsQueryDto extends ListQueryDto {
  @IsOptional()
  @IsEnum(AlertType)
  type?: AlertType;

  /**
   * Read status filter (clean boolean version)
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return undefined;
  })
  @IsBoolean()
  isRead?: boolean;
}