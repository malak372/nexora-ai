import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { DataCollectionService } from './data-collection.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

/**
 * Controller responsible for managing the data collection process.
 *
 * This controller provides endpoints that allow administrators to:
 * - Start the data collection process.
 * - Stop an active data collection process.
 * - Monitor the current data collection status.
 *
 * All endpoints are protected by JWT authentication and
 * can only be accessed by users with the ADMIN role.
 *
 * Base route:
 * /admin/data-collection
 *
 * @author Malak
 */
@Controller('admin/data-collection')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class DataCollectionController {
  constructor(
    private readonly dataCollectionService: DataCollectionService,
  ) { }

  /**
   * Starts the data collection process.
   *
   * Endpoint:
   * POST /admin/data-collection/run
   *
   * @param currentUser - The authenticated administrator.
   * @returns A success message and the current collection status.
   */
  @Post('run')
  runDataCollection(@CurrentUser() currentUser: any) {
    return this.dataCollectionService.runDataCollection(currentUser.id);
  }

  /**
   * Stops the currently running data collection process.
   *
   * Endpoint:
   * POST /admin/data-collection/stop
   *
   * @param currentUser - The authenticated administrator.
   * @returns A success message and the updated collection status.
   */
  @Post('stop')
  stopDataCollection(@CurrentUser() currentUser: any) {
    return this.dataCollectionService.stopDataCollection(currentUser.id);
  }

  /**
   * Retrieves the current status of the data collection process.
   *
   * Endpoint:
   * GET /admin/data-collection/status
   *
   * @returns The current data collection status.
   */
  @Get('status')
  getDataCollectionStatus() {
    return this.dataCollectionService.getDataCollectionStatus();
  }
}