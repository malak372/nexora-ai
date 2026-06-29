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
 * This controller provides admin-only endpoints that allow administrators to:
 * - View all recorded administrative actions.
 * - Filter audit logs by administrator.
 * - Filter logs by action type.
 * - Filter logs by target entity type.
 * - Filter logs by target entity ID.
 * - Retrieve paginated audit log records.
 * - Retrieve audit log summary reports.
 * - Retrieve chart-ready audit log analytics.
 *
 * Audit logs improve traceability, accountability,
 * and security monitoring for sensitive admin actions.
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
  constructor(private readonly auditLogsService: AuditLogsService) {}

  /**
   * Retrieves administrative audit logs.
   *
   * Endpoint:
   * GET /admin/audit-logs
   */
  @Get()
  getAuditLogs(@Query() query: GetAuditLogsQueryDto) {
    return this.auditLogsService.getAuditLogs(query);
  }

  /**
   * Retrieves audit log summary reports.
   *
   * Endpoint:
   * GET /admin/audit-logs/summary
   */
  @Get('summary')
  getAuditLogsSummary(@Query() query: GetAuditLogsQueryDto) {
    return this.auditLogsService.getAuditLogsSummary(query);
  }

  /**
   * Retrieves chart-ready audit log analytics.
   *
   * Endpoint:
   * GET /admin/audit-logs/charts
   */
  @Get('charts')
  getAuditLogsCharts(@Query() query: GetAuditLogsQueryDto) {
    return this.auditLogsService.getAuditLogsCharts(query);
  }
}