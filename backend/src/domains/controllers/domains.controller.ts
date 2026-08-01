import { Controller, Get } from '@nestjs/common';

import { DomainsService } from '../domains.service';

/**
 * Provides public domain-discovery endpoints.
 *
 * These endpoints expose only active domains that may be displayed
 * or selected during public idea discovery.
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
export class DomainsController {
  constructor(private readonly domainsService: DomainsService) { }

  /**
   * Returns active domains available for idea generation.
   *
   * This endpoint is intentionally public so guests can view
   * the available domains from the landing page.
   *
   * Endpoint:
   * GET /domains/available
   */
  @Get('available')
  getAvailableDomains() {
    return this.domainsService.getAvailableDomains();
  }
}