import { Controller, Get, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';

import { DomainsService } from '../domains.service';

/**
 * Provides user-facing domain-discovery endpoints.
 *
 * These endpoints expose only active domains that may be selected
 * during data collection and idea generation.
 *
 * Administrative fields, inactive domains, reports, and modification
 * operations are intentionally not exposed here.
 *
 * Base route:
 * /domains
 *
 * @author Eman
 */
@Controller('domains')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.USER, UserRole.ADMIN)
export class DomainsController {
  constructor(private readonly domainsService: DomainsService) {}

  /**
   * Returns active domains available for idea generation.
   *
   * Endpoint:
   * GET /domains/available
   */
  @Get('available')
  getAvailableDomains() {
    return this.domainsService.getAvailableDomains();
  }
}
