import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { AlertType } from '@prisma/client';
import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * DTO for filtering, searching, sorting, and paginating system alerts.
 *
 * Used with:
 * GET /admin/alerts
 *
 * Supports:
 * - Pagination through page and limit.
 * - Sorting through sortBy and sortOrder.
 * - Date filtering through fromDate and toDate.
 * - Search by alert title or message.
 * - Filter by alert type.
 * - Filter by read or unread status.
 *
 * @author Malak
 */
export class GetAlertsQueryDto extends ListQueryDto {
  /**
   * Alert type filter.
   *
   * Must be one of the values defined in AlertType enum.
   *
   * Example:
   * SYSTEM
   * PAYMENT
   * ADMIN
   */
  @IsOptional()
  @IsEnum(AlertType)
  type?: AlertType;

  /**
   * Read status filter.
   *
   * Accepts:
   * ?isRead=true
   * ?isRead=false
   *
   * Automatically transforms the query value
   * into a boolean before validation.
   *
   * Query examples:
   * ?isRead=true → true
   * ?isRead=false → false
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      const normalized = value.toLowerCase();

      if (normalized === 'true') {
        return true;
      }

      if (normalized === 'false') {
        return false;
      }
    }

    return value;
  })
  @IsBoolean()
  isRead?: boolean;
}