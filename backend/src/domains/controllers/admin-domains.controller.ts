import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';

import { DomainsService } from '../domains.service';
import { CreateDomainDto } from '../dto/create-domain.dto';
import { GetDomainsQueryDto } from '../dto/get-domains-query.dto';
import { UpdateDomainDto } from '../dto/update-domain.dto';

type AuthenticatedAdmin = {
  readonly id: string;
  readonly role: UserRole;
};

/**
 * Provides administrative domain-management endpoints.
 *
 * Responsibilities:
 * - List all active and inactive domains.
 * - Create domains.
 * - Update domains and discovery keywords.
 * - Deactivate domains.
 * - Return administrative summaries and charts.
 *
 * Base route:
 * /admin/domains
 *
 * @author Malak
 */
@Controller('admin/domains')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminDomainsController {
  constructor(private readonly domainsService: DomainsService) {}

  /**
   * Returns the administrative paginated domain list.
   *
   * Endpoint:
   * GET /admin/domains
   */
  @Get()
  getDomains(@Query() query: GetDomainsQueryDto) {
    return this.domainsService.getDomains(query);
  }

  /**
   * Returns administrative domain summary statistics.
   *
   * Endpoint:
   * GET /admin/domains/summary
   */
  @Get('summary')
  getDomainsSummary(@Query() query: GetDomainsQueryDto) {
    return this.domainsService.getDomainsSummary(query);
  }

  /**
   * Returns chart-ready administrative domain analytics.
   *
   * Endpoint:
   * GET /admin/domains/charts
   */
  @Get('charts')
  getDomainsCharts(@Query() query: GetDomainsQueryDto) {
    return this.domainsService.getDomainsCharts(query);
  }

  /**
   * Creates a new software domain.
   *
   * Endpoint:
   * POST /admin/domains
   */
  @Post()
  createDomain(
    @Body() body: CreateDomainDto,
    @CurrentUser() currentUser: AuthenticatedAdmin,
  ) {
    return this.domainsService.createDomain(body, currentUser.id);
  }

  /**
   * Updates an existing software domain.
   *
   * Endpoint:
   * PATCH /admin/domains/:id
   */
  @Patch(':id')
  updateDomain(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateDomainDto,
    @CurrentUser() currentUser: AuthenticatedAdmin,
  ) {
    return this.domainsService.updateDomain(id, body, currentUser.id);
  }

  /**
   * Deactivates an existing software domain.
   *
   * Endpoint:
   * DELETE /admin/domains/:id
   */
  @Delete(':id')
  deactivateDomain(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedAdmin,
  ) {
    return this.domainsService.deactivateDomain(id, currentUser.id);
  }
}
