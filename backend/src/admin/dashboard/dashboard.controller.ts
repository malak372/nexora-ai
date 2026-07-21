import { Controller, Get, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { DashboardService } from './dashboard.service';

/** Administrative analytics dashboard endpoints. @author Malak */
@Controller('admin/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /** Returns the consolidated Nexora AI operational dashboard. */
  @Get()
  getDashboard() {
    return this.dashboardService.getDashboard();
  }
}
