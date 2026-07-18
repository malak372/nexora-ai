import {
  Controller,
  Get,
  Header,
  Query,
  UseGuards,
} from '@nestjs/common';

import { UserRole } from '@prisma/client';

import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';

import { GetFeedbackQueryDto } from '../dto/get-feedback-query.dto';

import { AdminFeedbackService } from '../services/admin-feedback.service';

/**
 * Handles administrator publication-feedback analytics.
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
  constructor(
    private readonly adminFeedbackService: AdminFeedbackService,
  ) { }

  /**
   * Returns paginated textual feedback.
   *
   * GET /admin/feedback/comments
   */
  @Get('comments')
  getFeedbackComments(@Query() query: GetFeedbackQueryDto) {
    return this.adminFeedbackService.getFeedbackComments(query);
  }

  /**
   * Returns paginated publication ratings.
   *
   * GET /admin/feedback/ratings
   */
  @Get('ratings')
  getRatings(@Query() query: GetFeedbackQueryDto) {
    return this.adminFeedbackService.getRatings(query);
  }

  /**
   * Returns combined feedback and rating statistics.
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
   * Exports textual publication feedback as CSV.
   *
   * GET /admin/feedback/comments/export/csv
   */
  @Get('comments/export/csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header(
    'Content-Disposition',
    'attachment; filename="publication-feedback.csv"',
  )
  exportFeedbackCsv(@Query() query: GetFeedbackQueryDto) {
    return this.adminFeedbackService.exportFeedbackCsv(query);
  }

  /**
   * Exports publication ratings as CSV.
   *
   * GET /admin/feedback/ratings/export/csv
   */
  @Get('ratings/export/csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header(
    'Content-Disposition',
    'attachment; filename="publication-ratings.csv"',
  )
  exportRatingsCsv(@Query() query: GetFeedbackQueryDto) {
    return this.adminFeedbackService.exportRatingsCsv(query);
  }
}