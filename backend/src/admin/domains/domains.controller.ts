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

import { DomainsService } from './domains.service';
import { CreateDomainDto } from './dto/create-domain.dto';
import { UpdateDomainDto } from './dto/update-domain.dto';
import { GetDomainsQueryDto } from './dto/get-domains-query.dto';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

type AuthenticatedAdmin = {
  id: string;
  role: UserRole;
};

/**
 * Controller responsible for managing software project domains.
 *
 * Provides admin-only endpoints for:
 * - Listing domains.
 * - Creating domains.
 * - Updating domains.
 * - Deactivating domains.
 * - Viewing domain summary reports.
 * - Viewing chart-ready domain analytics.
 *
 * Base route:
 * /admin/domains
 *
 * @author Malak
 */
@Controller('admin/domains')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class DomainsController {
  constructor(private readonly domainsService: DomainsService) {}

  /**
   * Retrieves configured domains.
   *
   * Endpoint:
   * GET /admin/domains
   */
  @Get()
  getDomains(@Query() query: GetDomainsQueryDto) {
    return this.domainsService.getDomains(query);
  }

  /**
   * Retrieves domain summary statistics.
   *
   * Endpoint:
   * GET /admin/domains/summary
   */
  @Get('summary')
  getDomainsSummary(@Query() query: GetDomainsQueryDto) {
    return this.domainsService.getDomainsSummary(query);
  }

  /**
   * Retrieves chart-ready domain analytics.
   *
   * Endpoint:
   * GET /admin/domains/charts
   */
  @Get('charts')
  getDomainsCharts(@Query() query: GetDomainsQueryDto) {
    return this.domainsService.getDomainsCharts(query);
  }

  /**
   * Creates a new domain.
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
   * Updates an existing domain.
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
   * Deactivates an existing domain.
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
