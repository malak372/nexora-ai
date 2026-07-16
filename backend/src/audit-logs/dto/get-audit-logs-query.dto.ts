import { AuditAction, AuditTargetType } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { ListQueryDto } from '../../utilities/dto/list-query.dto';

/**
 * Query DTO used to filter, search, sort, and paginate audit logs.
 *
 * Inherits common query options from ListQueryDto, including:
 * - Pagination.
 * - Sorting.
 * - Date-range filtering.
 * - Free-text search.
 *
 * Additional audit-specific filters:
 * - Actor identifier.
 * - Audit action.
 * - Target entity type.
 * - Target entity identifier.
 *
 * Used by:
 * - GET /audit-logs
 * - GET /audit-logs/summary
 * - GET /audit-logs/charts
 * - GET /audit-logs/export/csv
 *
 * @author Malak
 */
export class GetAuditLogsQueryDto extends ListQueryDto {
  /**
   * Optional identifier of the user or administrator
   * who performed the audited action.
   *
   * Audit records created by internal system operations
   * may have a null actor ID.
   */
  @IsOptional()
  @IsUUID('4')
  actorId?: string;

  /**
   * Optional audit-action filter.
   *
   * Must match one of the AuditAction enum values
   * defined in the Prisma schema.
   */
  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  /**
   * Optional target-entity type filter.
   *
   * Examples:
   * - USER
   * - IDEA
   * - PAYMENT
   * - DATA_SOURCE
   * - SYSTEM_SETTING
   */
  @IsOptional()
  @IsEnum(AuditTargetType)
  targetType?: AuditTargetType;

  /**
   * Optional identifier of the affected entity.
   *
   * This remains a string rather than a UUID-only field because
   * some system targets may use stable non-UUID identifiers.
   */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  targetId?: string;
}