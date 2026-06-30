import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AiMonitoringService } from './ai-monitoring.service';
import { GetAiLogsQueryDto } from './dto/get-ai-logs-query.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

/**
 * Controller responsible for AI and external API monitoring.
 *
 * Base route:
 * /admin/ai-monitoring
 *
 * Access:
 * Admin only.
 *
 * @author Malak
 */
@Controller('admin/ai-monitoring')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AiMonitoringController {
  constructor(
    private readonly aiMonitoringService: AiMonitoringService,
  ) { }

  /**
   * Retrieves paginated external API logs.
   *
   * Endpoint:
   * GET /admin/ai-monitoring/logs
   */
  @Get('logs')
  getAiLogs(@Query() query: GetAiLogsQueryDto) {
    return this.aiMonitoringService.getAiLogs(query);
  }

  /**
   * Exports filtered external API logs as CSV.
   *
   * Endpoint:
   * GET /admin/ai-monitoring/logs/export/csv
   */
  @Get('logs/export/csv')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="ai-logs.csv"')
  exportAiLogsCsv(@Query() query: GetAiLogsQueryDto) {
    return this.aiMonitoringService.exportAiLogsCsv(query);
  }

  /**
   * Retrieves external API usage summary.
   *
   * Endpoint:
   * GET /admin/ai-monitoring/summary
   */
  @Get('summary')
  getAiSummary(@Query() query: GetAiLogsQueryDto) {
    return this.aiMonitoringService.getAiSummary(query);
  }

  /**
   * Retrieves chart-ready external API analytics.
   *
   * Endpoint:
   * GET /admin/ai-monitoring/charts
   */
  @Get('charts')
  getAiCharts(@Query() query: GetAiLogsQueryDto) {
    return this.aiMonitoringService.getAiCharts(query);
  }
}