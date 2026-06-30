import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { DataCollectionService } from './data-collection.service';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

type AuthenticatedAdmin = {
  id: string;
  role: UserRole;
};

/**
 * Controller responsible for managing the data collection process.
 *
 * Base route:
 * /admin/data-collection
 *
 * Access:
 * Admin only.
 *
 * @author Malak
 */
@Controller('admin/data-collection')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class DataCollectionController {
  constructor(
    private readonly dataCollectionService: DataCollectionService,
  ) {}

  /**
   * Starts the data collection process.
   *
   * Endpoint:
   * POST /admin/data-collection/run
   */
  @Post('run')
  runDataCollection(@CurrentUser() currentUser: AuthenticatedAdmin) {
    return this.dataCollectionService.runDataCollection(currentUser.id);
  }

  /**
   * Stops the current data collection process.
   *
   * Endpoint:
   * POST /admin/data-collection/stop
   */
  @Post('stop')
  stopDataCollection(@CurrentUser() currentUser: AuthenticatedAdmin) {
    return this.dataCollectionService.stopDataCollection(currentUser.id);
  }

  /**
   * Returns the current data collection status.
   *
   * Endpoint:
   * GET /admin/data-collection/status
   */
  @Get('status')
  getDataCollectionStatus() {
    return this.dataCollectionService.getDataCollectionStatus();
  }
}