import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';

import { UserRole } from '@prisma/client';

import { Roles } from '../../auth/decorators/roles.decorator';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';

import { GetFeedbackQueryDto } from '../dto/get-feedback-query.dto';

import { AdminFeedbackService } from '../services/admin-feedback.service';

/**
 * Handles administrator feedback analytics and monitoring.
 *
 * Base route:
 * /admin/feedback
 *
 * @author Malak
 */
@Controller('admin/feedback')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminFeedbackController {
  constructor(private readonly adminFeedbackService: AdminFeedbackService) {}

  /**
   * Returns paginated idea feedback.
   *
   * GET /admin/feedback
   */
  @Get()
  getFeedback(@Query() query: GetFeedbackQueryDto) {
    return this.adminFeedbackService.getFeedback(query);
  }

  /**
   * Returns feedback summary statistics.
   *
   * GET /admin/feedback/summary
   */
  @Get('summary')
  getFeedbackSummary(@Query() query: GetFeedbackQueryDto) {
    return this.adminFeedbackService.getFeedbackSummary(query);
  }

  /**
   * Returns chart-ready feedback analytics.
   *
   * GET /admin/feedback/charts
   */
  @Get('charts')
  getFeedbackCharts(@Query() query: GetFeedbackQueryDto) {
    return this.adminFeedbackService.getFeedbackCharts(query);
  }

  /**
   * Exports filtered feedback as CSV.
   *
   * GET /admin/feedback/export/csv
   */
  @Get('export/csv')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="feedback.csv"')
  exportFeedbackCsv(@Query() query: GetFeedbackQueryDto) {
    return this.adminFeedbackService.exportFeedbackCsv(query);
  }
}
