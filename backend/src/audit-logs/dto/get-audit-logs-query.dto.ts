import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { AuditAction, AuditTargetType } from '@prisma/client';

import { ListQueryDto } from '../../utilities/dto/list-query.dto';

/**
 * DTO for filtering, searching, sorting, and paginating audit logs.
 *
 * Used with:
 * - GET /audit-logs
 * - GET /audit-logs/summary
 * - GET /audit-logs/charts
 * - GET /audit-logs/export/csv
 *
 * Supports:
 * - Pagination.
 * - Sorting.
 * - Date range filtering.
 * - Search.
 * - Filter by actor ID.
 * - Filter by action.
 * - Filter by target type.
 * - Filter by target ID.
 *
 * @author Malak
 */
export class GetAuditLogsQueryDto extends ListQueryDto {
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @IsOptional()
  @IsEnum(AuditTargetType)
  targetType?: AuditTargetType;

  @IsOptional()
  @IsString()
  targetId?: string;
}
