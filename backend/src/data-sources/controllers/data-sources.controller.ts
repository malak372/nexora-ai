import {
  Controller,
  Get,
  UseGuards,
} from '@nestjs/common';

import { UserRole } from '@prisma/client';

import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';

import { DataSourcesService } from '../data-sources.service';

/**
 * User-facing data-source endpoints.
 *
 * Registered users use this controller to discover
 * which sources can be selected before starting the
 * Data Collection pipeline stage.
 *
 * Base route:
 * /data-sources
 *
 * @author Malak
 */
@Controller('data-sources')
@UseGuards(
  JwtAuthGuard,
  RolesGuard,
)
@Roles(
  UserRole.USER,
  UserRole.ADMIN,
)
export class DataSourcesController {
  constructor(
    private readonly dataSourcesService:
      DataSourcesService,
  ) {}

  /**
   * Returns active, implemented, and operational data sources.
   */
  @Get('available')
  findAvailable() {
    return this.dataSourcesService
      .findAvailable();
  }
}