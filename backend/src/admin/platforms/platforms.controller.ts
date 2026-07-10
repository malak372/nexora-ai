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

import { PlatformsService } from './platforms.service';
import { CreatePlatformDto } from './dto/create-platform.dto';
import { UpdatePlatformDto } from './dto/update-platform.dto';
import { GetPlatformsQueryDto } from './dto/get-platforms-query.dto';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

type AuthenticatedAdmin = {
  id: string;
  role: UserRole;
};

/**
 * Controller responsible for managing supported platforms.
 *
 * Provides admin-only endpoints for:
 * - Listing platforms.
 * - Viewing platform summary reports.
 * - Viewing chart-ready platform analytics.
 * - Creating platforms.
 * - Updating platforms.
 * - Deactivating platforms.
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
  constructor(private readonly platformsService: PlatformsService) {}

  /**
   * Retrieves platforms with filtering, searching,
   * sorting, and pagination.
   *
   * Endpoint:
   * GET /admin/platforms
   */
  @Get()
  getPlatforms(@Query() query: GetPlatformsQueryDto) {
    return this.platformsService.getPlatforms(query);
  }

  /**
   * Retrieves platform summary statistics.
   *
   * Endpoint:
   * GET /admin/platforms/summary
   */
  @Get('summary')
  getPlatformsSummary(@Query() query: GetPlatformsQueryDto) {
    return this.platformsService.getPlatformsSummary(query);
  }

  /**
   * Retrieves chart-ready platform analytics.
   *
   * Endpoint:
   * GET /admin/platforms/charts
   */
  @Get('charts')
  getPlatformsCharts(@Query() query: GetPlatformsQueryDto) {
    return this.platformsService.getPlatformsCharts(query);
  }

  /**
   * Creates a new platform.
   *
   * Endpoint:
   * POST /admin/platforms
   */
  @Post()
  createPlatform(
    @Body() body: CreatePlatformDto,
    @CurrentUser() currentUser: AuthenticatedAdmin,
  ) {
    return this.platformsService.createPlatform(body, currentUser.id);
  }

  /**
   * Updates an existing platform.
   *
   * Endpoint:
   * PATCH /admin/platforms/:id
   */
  @Patch(':id')
  updatePlatform(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdatePlatformDto,
    @CurrentUser() currentUser: AuthenticatedAdmin,
  ) {
    return this.platformsService.updatePlatform(id, body, currentUser.id);
  }

  /**
   * Deactivates an existing platform.
   *
   * Endpoint:
   * DELETE /admin/platforms/:id
   */
  @Delete(':id')
  deactivatePlatform(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: AuthenticatedAdmin,
  ) {
    return this.platformsService.deactivatePlatform(id, currentUser.id);
  }
}
