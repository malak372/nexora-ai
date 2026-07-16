import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';

import { UserRole } from '@prisma/client';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';

import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

import { CreateAlertDto } from '../dto/create-alert.dto';
import { CreateEmailAlertDto } from '../dto/create-email-alert.dto';
import { GetAlertsQueryDto } from '../dto/get-alerts-query.dto';

import { AdminAlertsService } from '../services/admin-alerts.service';

/**
 * Handles administrator-only alert operations.
 *
 * Base route:
 * /admin/alerts
 *
 * Supported operations:
 * - Retrieve in-app alerts.
 * - Create an individual or broadcast in-app alert.
 * - Send an individual or broadcast email alert.
 *
 * @author Malak
 */
@Controller('admin/alerts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminAlertsController {
  constructor(private readonly adminAlertsService: AdminAlertsService) {}

  /**
   * Retrieves a paginated and filtered list of in-app alerts.
   *
   * GET /admin/alerts
   */
  @Get()
  getAlerts(@Query() query: GetAlertsQueryDto) {
    return this.adminAlertsService.getAlerts(query);
  }

  /**
   * Creates an in-app alert for one user or broadcasts
   * the alert to multiple eligible users.
   *
   * POST /admin/alerts
   */
  @Post()
  createAlert(
    @Body() dto: CreateAlertDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.adminAlertsService.createAlert(dto, currentUser.id);
  }

  /**
   * Sends an email alert to one user or broadcasts
   * the email to multiple eligible users.
   *
   * POST /admin/alerts/email
   */
  @Post('email')
  sendEmailAlert(
    @Body() dto: CreateEmailAlertDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.adminAlertsService.sendEmailAlert(dto, currentUser.id);
  }
}
