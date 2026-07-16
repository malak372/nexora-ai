import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { UserRole } from '@prisma/client';

import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';

import { AiUsageAnalyticsService } from './ai-usage-analytics.service';

import { GetAiAnalyticsQueryDto } from './dto/get-ai-analytics-query.dto';

import type { AiUsageAnalyticsSummary } from './types/ai-usage-analytics.type';

/**
 * Administrator-only AI usage analytics controller.
 *
 * Base route:
 * /ai/analytics
 *
 * All routes require:
 * - A valid authenticated user.
 * - The ADMIN role.
 *
 * @author Malak
 */
@Controller('ai/analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AiUsageAnalyticsController {
  constructor(private readonly analyticsService: AiUsageAnalyticsService) {}

  /**
   * Returns aggregated AI request, token, latency, fallback, and cost
   * analytics.
   *
   * Route:
   * GET /ai/analytics/summary
   */
  @Get('summary')
  getSummary(
    @Query()
    query: GetAiAnalyticsQueryDto,
  ): Promise<AiUsageAnalyticsSummary> {
    return this.analyticsService.getSummary(query);
  }
}
