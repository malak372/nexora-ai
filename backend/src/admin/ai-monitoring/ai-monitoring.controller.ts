import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AiMonitoringService } from './ai-monitoring.service';
import { GetAiLogsQueryDto } from './dto/get-ai-logs-query.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

/**
 * Controller responsible for monitoring AI service activity.
 *
 * This controller provides endpoints that allow administrators to:
 * - Retrieve AI API request logs.
 * - Monitor AI providers and request types.
 * - Review API response status and performance.
 *
 * The monitoring information helps administrators track
 * AI service usage, detect failed requests, measure response
 * times, and estimate API costs.
 *
 * All endpoints are protected by JWT authentication and
 * can only be accessed by users with the ADMIN role.
 *
 * Base route:
 * /admin/ai
 *
 * @author Malak
 */
@Controller('admin/ai')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AiMonitoringController {
  /**
   * Creates an instance of AiMonitoringController.
   *
   * @param aiMonitoringService - Service responsible for AI monitoring operations.
   */
  constructor(
    private readonly aiMonitoringService: AiMonitoringService,
  ) { }

  /**
   * Retrieves AI API request logs with optional filtering.
   *
   * Endpoint:
   * GET /admin/ai/logs
   *
   * Supported query parameters:
   * - provider: Filter by AI provider.
   * - requestType: Filter by request type.
   * - isSuccess: Filter successful or failed requests.
   *
   * Example:
   * GET /admin/ai/logs?provider=OPENAI&requestType=IDEA_GENERATION&isSuccess=true
   *
   * @param query - Query parameters used for filtering AI request logs.
   * @returns A list of AI API logs with request details, response information,
   * associated user, and related idea.
   */
  @Get('logs')
  getAiLogs(@Query() query: GetAiLogsQueryDto) {
    return this.aiMonitoringService.getAiLogs(query);
  }
}