import {
  Controller,
  Get,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { DashboardResponseDto } from './dto/dashboard-response.dto';
import { CacheInterceptor } from '@nestjs/cache-manager';
import { ApiOkResponse } from '@nestjs/swagger';

/**
 * Administrative Dashboard Controller
 *
 * Provides aggregated analytics for system monitoring:
 * users, ideas, payments, comments, AI usage, revenue.
 *
 * Access restricted to ADMIN role only.
 *
 * Base route: /admin/dashboard
 *
 * @author Malak
 */
@Controller('admin/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /**
   * Returns dashboard analytics summary.
   *
   * Cached for performance optimization.
   *
   * @route GET /admin/dashboard
   */
  @Get()
  @UseInterceptors(CacheInterceptor)
  @ApiOkResponse({ type: DashboardResponseDto })
  getDashboard(): Promise<DashboardResponseDto> {
    return this.dashboardService.getDashboard();
  }
}