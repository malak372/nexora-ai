import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PlatformsService } from './platforms.service';
import { CreatePlatformDto } from './dto/create-platform.dto';
import { UpdatePlatformDto } from './dto/update-platform.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

/**
 * Controller responsible for platform management.
 *
 * This controller provides endpoints that allow administrators to:
 * - Retrieve all available platforms.
 * - Create new platforms.
 * - Update existing platforms.
 * - Deactivate platforms.
 *
 * All endpoints are protected by JWT authentication and
 * can only be accessed by users with the ADMIN role.
 *
 * Base route:
 * /admin/platforms
 *
 * @author Malak
 */
@Controller('admin/platforms')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class PlatformsController {
  constructor(private readonly platformsService: PlatformsService) { }

  /**
   * Retrieves all configured platforms.
   *
   * Endpoint:
   * GET /admin/platforms
   *
   * @returns A list of available platforms.
   */
  @Get()
  getPlatforms() {
    return this.platformsService.getPlatforms();
  }

  /**
   * Creates a new platform.
   *
   * Endpoint:
   * POST /admin/platforms
   *
   * @param body - DTO containing the platform information.
   * @param currentUser - The authenticated admin creating the platform.
   * @returns A success message and the newly created platform.
   */
  @Post()
  createPlatform(
    @Body() body: CreatePlatformDto,
    @CurrentUser() currentUser: any,
  ) {
    return this.platformsService.createPlatform(body, currentUser.id);
  }

  /**
   * Updates an existing platform.
   *
   * Endpoint:
   * PATCH /admin/platforms/:id
   *
   * @param id - The unique identifier of the platform.
   * @param body - DTO containing the updated platform information.
   * @param currentUser - The authenticated admin updating the platform.
   * @returns A success message and the updated platform.
   */
  @Patch(':id')
  updatePlatform(
    @Param('id') id: string,
    @Body() body: UpdatePlatformDto,
    @CurrentUser() currentUser: any,
  ) {
    return this.platformsService.updatePlatform(id, body, currentUser.id);
  }

  /**
   * Deactivates a platform.
   *
   * Endpoint:
   * DELETE /admin/platforms/:id
   *
   * This operation performs a soft deactivation by marking
   * the platform as inactive instead of permanently removing it.
   *
   * @param id - The unique identifier of the platform.
   * @param currentUser - The authenticated admin deactivating the platform.
   * @returns A success message and the updated platform information.
   */
  @Delete(':id')
  deletePlatform(
    @Param('id') id: string,
    @CurrentUser() currentUser: any,
  ) {
    return this.platformsService.deactivatePlatform(id, currentUser.id);
  }
}