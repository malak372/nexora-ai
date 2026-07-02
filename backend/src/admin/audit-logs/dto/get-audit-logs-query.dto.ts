import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { AdminAction, AdminTargetType } from '@prisma/client';
import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * DTO for filtering, searching, sorting, and paginating admin audit logs.
 *
 * Used with:
 * - GET /admin/audit-logs
 * - GET /admin/audit-logs/export/csv
 * - GET /admin/audit-logs/summary
 * - GET /admin/audit-logs/charts
 *
 * Supports:
 * - Pagination through page and limit.
 * - Sorting through sortBy and sortOrder.
 * - Date filtering through fromDate and toDate.
 * - Search.
 * - Filter by admin ID.
 * - Filter by admin action.
 * - Filter by target type.
 * - Filter by target ID.
 *
 * Example:
 * GET /admin/audit-logs?page=1&limit=10&action=ADMIN_CREATE_ALERT&targetType=ALERT
 *
 * @author Malak
 */
export class GetAuditLogsQueryDto extends ListQueryDto {
  /**
   * Optional admin identifier.
   *
   * Filters audit logs by the admin who performed the action.
   *
   * Must be a valid UUID.
   */
  @IsOptional()
  @IsUUID()
  adminId?: string;

  /**
   * Optional admin action filter.
   *
   * Must be one of the values defined in the AdminAction enum.
   *
   * Example:
   * ADMIN_CREATE_ALERT
   */
  @IsOptional()
  @IsEnum(AdminAction)
  action?: AdminAction;

  /**
   * Optional target type filter.
   *
   * Must be one of the values defined in the AdminTargetType enum.
   *
   * Example:
   * ALERT
   */
  @IsOptional()
  @IsEnum(AdminTargetType)
  targetType?: AdminTargetType;

  /**
   * Optional target entity identifier.
   *
   * Filters audit logs by the identifier of the affected entity,
   * such as a user, payment, alert, idea, system setting, or BROADCAST.
   */
  @IsOptional()
  @IsString()
  targetId?: string;
}