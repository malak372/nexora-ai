import {
  Controller,
  Get,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { CacheInterceptor } from '@nestjs/cache-manager';
import { ApiOkResponse } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { DashboardService } from './dashboard.service';
import { DashboardResponseDto } from './dto/dashboard-response.dto';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

/**
 * Administrative Dashboard Controller.
 *
 * Provides aggregated analytics for system monitoring,
 * including users, ideas, payments, comments, AI usage,
 * revenue, domains, platforms, charts, and recent activity.
 *
 * Security:
 * - Requires JWT authentication.
 * - Restricted to ADMIN role only.
 *
 * Base route:
 * /admin/dashboard
 *
 * @author Malak
 */
@Controller('admin/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /**
   * Returns the Admin dashboard analytics summary.
   *
   * Endpoint:
   * GET /admin/dashboard
   *
   * Notes:
   * - Uses cache interceptor for performance optimization.
   * - Make sure CacheModule is registered in the module.
   *
   * @returns Dashboard analytics response.
   */
  @Get()
  @UseInterceptors(CacheInterceptor)
  @ApiOkResponse({ type: DashboardResponseDto })
  getDashboard(): Promise<DashboardResponseDto> {
    return this.dashboardService.getDashboard();
  }
}