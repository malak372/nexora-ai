import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { FeedbackService } from './feedbacks.service';
import { GetFeedbacksQueryDto } from './dto/get-feedbacks-query.dto';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

/**
 * Controller responsible for admin feedback analytics and monitoring.
 *
 * Base route:
 * /admin/feedback
 *
 * @author Malak
 */
@Controller('admin/feedback')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Get()
  getFeedback(@Query() query: GetFeedbacksQueryDto) {
    return this.feedbackService.getFeedback(query);
  }

  @Get('summary')
  getFeedbackSummary(@Query() query: GetFeedbacksQueryDto) {
    return this.feedbackService.getFeedbackSummary(query);
  }

  @Get('charts')
  getFeedbackCharts(@Query() query: GetFeedbacksQueryDto) {
    return this.feedbackService.getFeedbackCharts(query);
  }

  @Get('export/csv')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="feedback.csv"')
  exportFeedbackCsv(@Query() query: GetFeedbacksQueryDto) {
    return this.feedbackService.exportFeedbackCsv(query);
  }
}
