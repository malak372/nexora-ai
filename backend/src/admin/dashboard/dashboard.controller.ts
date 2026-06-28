import { Controller, Get, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

/**
 * Controller responsible for the administrative dashboard.
 *
 * This controller provides endpoints that allow administrators
 * to retrieve the overall dashboard statistics and system overview.
 *
 * The dashboard summarizes key information such as:
 * - Total users.
 * - Total generated ideas.
 * - Total payments.
 * - Total collected comments.
 * - Credits sold.
 * - AI requests.
 * - OpenAI usage cost.
 * - Average AI response time.
 *
 * All endpoints are protected by JWT authentication and
 * can only be accessed by users with the ADMIN role.
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
  /**
   * Creates an instance of DashboardController.
   *
   * @param dashboardService - Service responsible for retrieving
   * dashboard statistics and analytics.
   */
  constructor(private readonly dashboardService: DashboardService) { }

  /**
   * Retrieves the administrative dashboard summary.
   *
   * Endpoint:
   * GET /admin/dashboard
   *
   * Returns an overview of the platform including
   * users, ideas, payments, comments, AI usage,
   * credits sold, and other system statistics.
   *
   * @returns A dashboard summary containing key platform metrics.
   */
  @Get()
  getDashboard() {
    return this.dashboardService.getDashboard();
  }
}