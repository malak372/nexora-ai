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
 * /admin/ai/analytics
 *
 * Security:
 * - Requires a valid JWT access token.
 * - Requires the authenticated user to have the ADMIN role.
 *
 * Responsibilities:
 * - Receive administrator AI-analytics filters.
 * - Delegate analytics aggregation to AiUsageAnalyticsService.
 * - Return normalized AI request, token, cost, latency, fallback,
 *   success, failure, and model-usage statistics.
 *
 * This controller does not:
 * - Query Prisma directly.
 * - Execute AI providers.
 * - Calculate analytics.
 * - Modify AI model configuration.
 *
 * @author Malak
 */
@Controller('admin/ai/analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AiUsageAnalyticsController {
  constructor(private readonly analyticsService: AiUsageAnalyticsService) {}

  /**
   * Returns aggregated AI usage analytics.
   *
   * Supported optional filters:
   * - fromDate
   * - toDate
   * - providerKey
   * - requestType
   * - aiModelId
   *
   * Route:
   * GET /admin/ai/analytics/summary
   *
   * Example:
   * GET /admin/ai/analytics/summary
   *   ?providerKey=google
   *   &fromDate=2026-07-01
   *   &toDate=2026-07-31
   *
   * @param query Validated analytics filters.
   * @returns Aggregated administrator-facing AI usage analytics.
   */
  @Get('summary')
  getSummary(
    @Query()
    query: GetAiAnalyticsQueryDto,
  ): Promise<AiUsageAnalyticsSummary> {
    return this.analyticsService.getSummary(query);
  }
}
