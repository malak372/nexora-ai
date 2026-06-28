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
 * This controller provides endpoints that allow administrators to:
 * - Retrieve collected comments.
 * - Search and filter comments by platform, language,
 *   region, or content.
 *
 * All endpoints are protected by JWT authentication and
 * can only be accessed by users with the ADMIN role.
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
  constructor(private readonly commentsService: CommentsService) { }

  /**
   * Retrieves collected comments with optional filtering.
   *
   * Endpoint:
   * GET /admin/comments
   *
   * Supported query parameters:
   * - platformId: Filter by platform.
   * - language: Filter by comment language.
   * - region: Filter by geographical region.
   * - search: Search within comment content.
   *
   * Example:
   * GET /admin/comments?platformId=PLATFORM_ID&language=en&region=Palestine
   *
   * @param query - Query parameters used for searching and filtering comments.
   * @returns A list of collected comments with related platform information and usage statistics.
   */
  @Get()
  getComments(@Query() query: GetCommentsQueryDto) {
    return this.commentsService.getComments(query);
  }
}