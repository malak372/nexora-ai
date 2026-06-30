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

import { IdeasService } from './ideas.service';
import { GetIdeasQueryDto } from './dto/get-ideas-query.dto';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

/**
 * Controller responsible for administrative idea management.
 *
 * Provides admin-only endpoints for:
 * - Listing generated project ideas.
 * - Filtering, searching, sorting, and paginating ideas.
 * - Viewing idea summary reports.
 * - Viewing chart-ready idea analytics.
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
export class IdeasController {
  constructor(private readonly ideasService: IdeasService) { }

  /**
   * Retrieves generated project ideas.
   *
   * Endpoint:
   * GET /admin/ideas
   */
  @Get()
  getIdeas(@Query() query: GetIdeasQueryDto) {
    return this.ideasService.getIdeas(query);
  }

  /**
   * Retrieves idea summary statistics.
   *
   * Endpoint:
   * GET /admin/ideas/summary
   */
  @Get('summary')
  getIdeasSummary(@Query() query: GetIdeasQueryDto) {
    return this.ideasService.getIdeasSummary(query);
  }

  /**
   * Retrieves chart-ready idea analytics.
   *
   * Endpoint:
   * GET /admin/ideas/charts
   */
  @Get('charts')
  getIdeasCharts(@Query() query: GetIdeasQueryDto) {
    return this.ideasService.getIdeasCharts(query);
  }
  /**
   * Exports filtered ideas as CSV.
   *
   * Endpoint:
   * GET /admin/ideas/export/csv
   */
  @Get('export/csv')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="ideas.csv"')
  exportIdeasCsv(@Query() query: GetIdeasQueryDto) {
    return this.ideasService.exportIdeasCsv(query);
  }
  /**
   * Retrieves detailed information about a specific project idea.
   *
   * Endpoint:
   * GET /admin/ideas/:id
   */
  @Get(':id')
  getIdeaById(@Param('id', ParseUUIDPipe) id: string) {
    return this.ideasService.getIdeaById(id);
  }
}