import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { CommentsService } from './comments.service';
import { GetCommentsQueryDto } from './dto/get-comments-query.dto';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

/**
 * Controller responsible for administrative comment management.
 *
 * This controller provides admin-only endpoints that allow administrators to:
 * - Retrieve collected comments.
 * - Search comments by content.
 * - Filter comments by platform, language, region, and date range.
 * - Sort and paginate comment records.
 * - Retrieve comment summary reports.
 * - Retrieve chart-ready analytics for collected comments.
 *
 * Base route:
 * /admin/comments
 *
 * @author Malak
 */
@Controller('admin/comments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  /**
   * Retrieves collected comments.
   *
   * Endpoint:
   * GET /admin/comments
   */
  @Get()
  getComments(@Query() query: GetCommentsQueryDto) {
    return this.commentsService.getComments(query);
  }

  /**
   * Retrieves summary statistics for collected comments.
   *
   * Endpoint:
   * GET /admin/comments/summary
   *
   * The same filters used by the comments list can also be used here.
   */
  @Get('summary')
  getCommentsSummary(@Query() query: GetCommentsQueryDto) {
    return this.commentsService.getCommentsSummary(query);
  }

  /**
   * Retrieves chart-ready analytics for collected comments.
   *
   * Endpoint:
   * GET /admin/comments/charts
   *
   * The same filters used by the comments list can also be used here.
   */
  @Get('charts')
  getCommentsCharts(@Query() query: GetCommentsQueryDto) {
    return this.commentsService.getCommentsCharts(query);
  }
}
