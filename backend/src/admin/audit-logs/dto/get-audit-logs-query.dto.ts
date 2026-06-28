import { IsEnum, IsOptional, IsString } from 'class-validator';
import { AdminAction, AdminTargetType } from '@prisma/client';
import { ListQueryDto } from '../../../utilities/dto/list-query.dto';

/**
 * DTO for filtering and paginating admin audit logs.
 *
 * This DTO is used with the GET /admin/audit-logs endpoint.
 * It defines the optional query parameters that allow administrators
 * to review and filter recorded admin actions.
 *
 * Supported filters:
 * - Admin ID.
 * - Admin action.
 * - Target type.
 * - Target ID.
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
   */
  @IsOptional()
  @IsString()
  adminId?: string;

  /**
   * Optional admin action filter.
   *
   * Must be one of the values defined in the AdminAction enum.
   */
  @IsOptional()
  @IsEnum(AdminAction)
  action?: AdminAction;

  /**
   * Optional target type filter.
   *
   * Must be one of the values defined in the AdminTargetType enum.
   */
  @IsOptional()
  @IsEnum(AdminTargetType)
  targetType?: AdminTargetType;

  /**
   * Optional target identifier.
   *
   * Filters audit logs by the ID of the affected entity.
   */
  @IsOptional()
  @IsString()
  targetId?: string;
}