import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';

import { UserRole } from '@prisma/client';

import { Roles } from '../../../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../../auth/guards/roles.guard';

import { GetAdminIdeasQueryDto } from '../dto/get-admin-ideas-query.dto';
import { AdminIdeasService } from '../services/admin-ideas.service';

/**
 * Administrative controller for generated project ideas.
 *
 * Provides administrator-only endpoints for:
 * - Listing ideas.
 * - Filtering and searching ideas.
 * - Viewing aggregate summaries.
 * - Viewing chart-ready analytics.
 * - Exporting ideas as CSV.
 * - Inspecting the complete details of one idea.
 *
 * Base route:
 * /admin/ideas
 *
 * @author Malak
 */
@Controller('admin/ideas')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminIdeasController {
  constructor(private readonly adminIdeasService: AdminIdeasService) {}

  /**
   * Retrieves generated ideas with pagination, filtering,
   * searching and sorting.
   *
   * GET /admin/ideas
   */
  @Get()
  getIdeas(@Query() query: GetAdminIdeasQueryDto) {
    return this.adminIdeasService.getIdeas(query);
  }

  /**
   * Retrieves summary statistics for generated ideas.
   *
   * GET /admin/ideas/summary
   */
  @Get('summary')
  getIdeasSummary(@Query() query: GetAdminIdeasQueryDto) {
    return this.adminIdeasService.getIdeasSummary(query);
  }

  /**
   * Retrieves chart-ready idea analytics.
   *
   * GET /admin/ideas/charts
   */
  @Get('charts')
  getIdeasCharts(@Query() query: GetAdminIdeasQueryDto) {
    return this.adminIdeasService.getIdeasCharts(query);
  }

  /**
   * Exports the currently filtered ideas as a CSV document.
   *
   * GET /admin/ideas/export/csv
   */
  @Get('export/csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="nexora-ideas.csv"')
  exportIdeasCsv(@Query() query: GetAdminIdeasQueryDto) {
    return this.adminIdeasService.exportIdeasCsv(query);
  }

  /**
   * Retrieves the complete administrative view of one idea.
   *
   * GET /admin/ideas/:ideaId
   */
  @Get(':ideaId')
  getIdeaById(
    @Param(
      'ideaId',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    ideaId: string,
  ) {
    return this.adminIdeasService.getIdeaById(ideaId);
  }
}
