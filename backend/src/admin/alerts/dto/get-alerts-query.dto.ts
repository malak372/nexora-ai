import { AlertType } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
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
  /**
   * Optional alert type filter.
   *
   * Must be one of the values defined in the
   * AlertType enum.
   *
   * Example:
   * SYSTEM
   */
  @IsOptional()
  @IsEnum(AlertType)
  type?: AlertType;

  /**
   * Optional read status filter.
   *
   * Filters alerts based on whether they have
   * been read by the recipient.
   *
   * Accepted values:
   * - "true"
   * - "false"
   */
  @IsOptional()
  @IsString()
  isRead?: string;
}