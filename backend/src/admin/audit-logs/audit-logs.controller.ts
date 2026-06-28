import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuditLogsService } from './audit-logs.service';
import { GetAuditLogsQueryDto } from './dto/get-audit-logs-query.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

/**
 * Controller responsible for administrative audit log management.
 *
 * This controller provides endpoints that allow administrators to:
 * - View all recorded administrative actions.
 * - Filter audit logs by administrator.
 * - Filter logs by action type.
 * - Filter logs by target entity type.
 * - Filter logs by target entity ID.
 * - Retrieve paginated audit log records.
 *
 * Audit logs provide a complete history of sensitive administrative
 * operations performed within the system, improving traceability,
 * accountability, and security monitoring.
 *
 * All endpoints are protected by JWT authentication and
 * can only be accessed by users with the ADMIN role.
 *
 * Base route:
 * /admin/audit-logs
 *
 * @author Malak
 */
@Controller('admin/audit-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AuditLogsController {
  /**
   * Creates an instance of AuditLogsController.
   *
   * @param auditLogsService - Service responsible for audit log management.
   */
  constructor(private readonly auditLogsService: AuditLogsService) { }

  /**
   * Retrieves administrative audit logs.
   *
   * Endpoint:
   * GET /admin/audit-logs
   *
   * Supports optional filtering by:
   * - Admin ID.
   * - Admin action.
   * - Target entity type.
   * - Target entity ID.
   *
   * Supports pagination using:
   * - page
   * - limit
   *
   * Example:
   * GET /admin/audit-logs?page=1&limit=10&action=ADMIN_UPDATE_USER_STATUS
   *
   * @param query - DTO containing pagination and filtering parameters.
   * @returns A paginated list of audit logs with metadata.
   */
  @Get()
  getAuditLogs(@Query() query: GetAuditLogsQueryDto) {
    return this.auditLogsService.getAuditLogs(query);
  }
}