import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { AuditService } from './audit-logs.service';
import { GetAuditLogsQueryDto } from './dto/get-audit-logs-query.dto';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

/**
 * Controller responsible for audit log management.
 *
 * Although audit logs are general for the whole system,
 * viewing them is restricted to ADMIN users only.
 *
 * Base route:
 * /audit-logs
 *
 * @author Malak
 */
@Controller('audit-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  /**
   * Retrieves paginated audit logs.
   *
   * Endpoint:
   * GET /audit-logs
   */
  @Get()
  getAuditLogs(@Query() query: GetAuditLogsQueryDto) {
    return this.auditService.getAuditLogs(query);
  }

  /**
   * Retrieves audit log summary.
   *
   * Endpoint:
   * GET /audit-logs/summary
   */
  @Get('summary')
  getAuditLogsSummary(@Query() query: GetAuditLogsQueryDto) {
    return this.auditService.getAuditLogsSummary(query);
  }

  /**
   * Retrieves chart-ready audit analytics.
   *
   * Endpoint:
   * GET /audit-logs/charts
   */
  @Get('charts')
  getAuditLogsCharts(@Query() query: GetAuditLogsQueryDto) {
    return this.auditService.getAuditLogsCharts(query);
  }

  /**
   * Exports audit logs as CSV.
   *
   * Endpoint:
   * GET /audit-logs/export/csv
   */
  @Get('export/csv')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="audit-logs.csv"')
  exportAuditLogsCsv(@Query() query: GetAuditLogsQueryDto) {
    return this.auditService.exportAuditLogsCsv(query);
  }
}