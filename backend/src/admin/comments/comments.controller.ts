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
 * All endpoints are protected by JWT authentication and can only be
 * accessed by users with the ADMIN role.
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
  /**
   * Creates an instance of CommentsController.
   *
   * @param commentsService - Service responsible for comment management operations.
   */
  constructor(
    private readonly commentsService: CommentsService,
  ) {}

  /**
   * Retrieves collected comments.
   *
   * Endpoint:
   * GET /admin/comments
   *
   * Supports:
   * - Pagination.
   * - Sorting.
   * - Searching by comment content.
   * - Date range filtering.
   * - Filtering by platform.
   * - Filtering by language.
   * - Filtering by region.
   *
   * Example:
   * GET /admin/comments?page=1&limit=10&platformId=PLATFORM_ID&language=en&region=Palestine
   *
   * @param query - DTO containing pagination, sorting, searching, and filtering parameters.
   * @returns A paginated list of collected comments with related platform information.
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
   * This report can be used to display dashboard cards such as:
   * - Total comments.
   * - Comments collected today.
   * - Comments collected this month.
   * - Number of supported platforms.
   * - Number of detected languages.
   * - Number of detected regions.
   *
   * @returns Comment summary statistics.
   */
  @Get('summary')
  getCommentsSummary() {
    return this.commentsService.getCommentsSummary();
  }

  /**
   * Retrieves chart-ready analytics for collected comments.
   *
   * Endpoint:
   * GET /admin/comments/charts
   *
   * This endpoint provides data for charts such as:
   * - Comments grouped by platform.
   * - Comments grouped by language.
   * - Comments grouped by region.
   *
   * @returns Chart-ready analytics data.
   */
  @Get('charts')
  getCommentsCharts() {
    return this.commentsService.getCommentsCharts();
  }
}