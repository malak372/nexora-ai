import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { IdeasService } from './ideas.service';
import { GetIdeasQueryDto } from './dto/get-ideas-query.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

/**
 * Controller responsible for administrative idea management.
 *
 * This controller provides endpoints that allow administrators to:
 * - Retrieve generated software project ideas.
 * - Search and filter ideas.
 * - View detailed information about a specific idea.
 *
 * Ideas can be filtered by domain, platform, region,
 * generation type, unlock method, and unlock status.
 *
 * All endpoints are protected by JWT authentication and
 * can only be accessed by users with the ADMIN role.
 *
 * Base route:
 * /admin/ideas
 *
 * @author Malak
 */
@Controller('admin/ideas')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class IdeasController {
  /**
   * Creates an instance of IdeasController.
   *
   * @param ideasService - Service responsible for idea management.
   */
  constructor(private readonly ideasService: IdeasService) { }

  /**
   * Retrieves generated project ideas with optional filtering.
   *
   * Endpoint:
   * GET /admin/ideas
   *
   * Supported query parameters:
   * - search: Search by project title.
   * - domainId: Filter by domain.
   * - platformId: Filter by platform.
   * - region: Filter by region.
   * - generationType: Filter by idea generation type.
   * - unlockMethod: Filter by unlock method.
   * - isUnlocked: Filter by unlock status.
   *
   * Example:
   * GET /admin/ideas?search=health&generationType=PREMIUM&isUnlocked=true
   *
   * @param query - Query parameters used for searching and filtering ideas.
   * @returns A list of generated software project ideas.
   */
  @Get()
  getIdeas(@Query() query: GetIdeasQueryDto) {
    return this.ideasService.getIdeas(query);
  }

  /**
   * Retrieves detailed information about a specific project idea.
   *
   * Endpoint:
   * GET /admin/ideas/:id
   *
   * The returned information may include:
   * - Basic idea information.
   * - Project title.
   * - Abstract.
   * - Domain.
   * - Platform.
   * - Generation type.
   * - Unlock information.
   * - Related comments and metadata.
   *
   * @param id - The unique identifier of the project idea.
   * @returns The complete details of the selected project idea.
   */
  @Get(':id')
  getIdeaById(@Param('id') id: string) {
    return this.ideasService.getIdeaById(id);
  }
}