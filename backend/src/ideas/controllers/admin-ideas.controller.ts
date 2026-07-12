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

import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';

import { GetIdeasQueryDto } from '../dto/get-ideas-query.dto';
import { AdminIdeasService } from '../services/admin-ideas.service';

/**
 * Controller responsible for administrative idea management.
 *
 * Provides admin-only endpoints for:
 * - Listing generated project ideas.
 * - Filtering, searching, sorting, and paginating ideas.
 * - Viewing idea summary reports.
 * - Viewing chart-ready idea analytics.
 * - Exporting ideas as CSV.
 * - Viewing detailed information about a specific idea.
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
  constructor(
    private readonly adminIdeasService: AdminIdeasService,
  ) {}

  /**
   * Retrieves generated project ideas.
   *
   * GET /admin/ideas
   */
  @Get()
  getIdeas(@Query() query: GetIdeasQueryDto) {
    return this.adminIdeasService.getIdeas(query);
  }

  /**
   * Retrieves idea summary statistics.
   *
   * GET /admin/ideas/summary
   */
  @Get('summary')
  getIdeasSummary(@Query() query: GetIdeasQueryDto) {
    return this.adminIdeasService.getIdeasSummary(query);
  }

  /**
   * Retrieves chart-ready idea analytics.
   *
   * GET /admin/ideas/charts
   */
  @Get('charts')
  getIdeasCharts(@Query() query: GetIdeasQueryDto) {
    return this.adminIdeasService.getIdeasCharts(query);
  }

  /**
   * Exports filtered ideas as CSV.
   *
   * GET /admin/ideas/export/csv
   */
  @Get('export/csv')
  @Header('Content-Type', 'text/csv')
  @Header(
    'Content-Disposition',
    'attachment; filename="ideas.csv"',
  )
  exportIdeasCsv(@Query() query: GetIdeasQueryDto) {
    return this.adminIdeasService.exportIdeasCsv(query);
  }

  /**
   * Retrieves detailed information about one idea.
   *
   * GET /admin/ideas/:id
   */
  @Get(':id')
  getIdeaById(
    @Param(
      'id',
      new ParseUUIDPipe({
        version: '4',
      }),
    )
    ideaId: string,
  ) {
    return this.adminIdeasService.getIdeaById(ideaId);
  }
}