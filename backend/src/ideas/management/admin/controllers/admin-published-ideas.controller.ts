import {
  Controller,
  Get,
  Header,
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
 * Dedicated administration route for published ideas.
 *
 * This controller deliberately uses /admin/published-ideas instead of a
 * nested /admin/ideas/published route. Keeping it outside /admin/ideas/:ideaId
 * prevents static route names such as "published" from ever reaching the
 * UUID parser used by the idea-detail endpoint.
 *
 * @author Malak
 */
@Controller('admin/published-ideas')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminPublishedIdeasController {
  constructor(private readonly adminIdeasService: AdminIdeasService) {}

  /** GET /admin/published-ideas */
  @Get()
  getPublishedIdeas(@Query() query: GetAdminIdeasQueryDto) {
    return this.adminIdeasService.getPublishedIdeas(query);
  }

  /** GET /admin/published-ideas/export/csv */
  @Get('export/csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="voxidence-published-ideas.csv"')
  exportPublishedIdeasCsv(@Query() query: GetAdminIdeasQueryDto) {
    return this.adminIdeasService.exportPublishedIdeasCsv(query);
  }
}