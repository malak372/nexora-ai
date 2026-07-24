import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { AiMonitoringService } from './ai-monitoring.service';
import { GetAiLogsQueryDto } from './dto/get-ai-logs-query.dto';

/**
 * Administrator controller for AI-provider monitoring and diagnostics.
 *
 * Base route: /admin/ai-monitoring
 * Access: ADMIN only.
 *
 * @author Malak
 */
@Controller('admin/ai-monitoring')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AiMonitoringController {
  constructor(private readonly aiMonitoringService: AiMonitoringService) {}

  /**
   * Retrieves paginated individual provider-request attempts.
   *
   * Endpoint: GET /admin/ai-monitoring/logs
   */
  @Get('logs')
  getAiLogs(@Query() query: GetAiLogsQueryDto) {
    return this.aiMonitoringService.getAiLogs(query);
  }

  /**
   * Exports filtered provider-request diagnostics as CSV.
   *
   * Endpoint: GET /admin/ai-monitoring/logs/export/csv
   */
  @Get('logs/export/csv')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="ai-logs.csv"')
  exportAiLogsCsv(@Query() query: GetAiLogsQueryDto) {
    return this.aiMonitoringService.exportAiLogsCsv(query);
  }

  /**
   * Retrieves one detailed provider-request attempt.
   *
   * Endpoint: GET /admin/ai-monitoring/logs/:id
   */
  @Get('logs/:id')
  getAiLogById(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.aiMonitoringService.getAiLogById(id);
  }

  /**
   * Retrieves retries and fallback attempts for one logical AI operation.
   *
   * Endpoint: GET /admin/ai-monitoring/operations/:operationId
   */
  @Get('operations/:operationId')
  getAiOperationTimeline(
    @Param('operationId', new ParseUUIDPipe()) operationId: string,
  ) {
    return this.aiMonitoringService.getAiOperationTimeline(operationId);
  }

  /**
   * Retrieves external AI usage and failure summary metrics.
   *
   * Endpoint: GET /admin/ai-monitoring/summary
   */
  @Get('summary')
  getAiSummary(@Query() query: GetAiLogsQueryDto) {
    return this.aiMonitoringService.getAiSummary(query);
  }

  /**
   * Retrieves chart-ready provider and failure analytics.
   *
   * Endpoint: GET /admin/ai-monitoring/charts
   */
  @Get('charts')
  getAiCharts(@Query() query: GetAiLogsQueryDto) {
    return this.aiMonitoringService.getAiCharts(query);
  }
}