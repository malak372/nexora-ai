import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { AlertsService } from './alerts.service';
import { CreateAlertDto } from './dto/create-alert.dto';
import { CreateEmailAlertDto } from './dto/create-email-alert.dto';
import { GetAlertsQueryDto } from './dto/get-alerts-query.dto';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

type AuthenticatedAdmin = {
  id: string;
  role: UserRole;
};

/**
 * Controller responsible for sending and managing system alerts.
 *
 * Supports:
 * - In-app alerts.
 * - Email alerts.
 *
 * @author Malak
 */
@Controller('admin/alerts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) { }

  /**
   * Retrieves alerts with optional filtering and pagination.
   *
   * GET /admin/alerts
   *
   * @param query Query parameters used for pagination and filtering alerts.
   * @returns Paginated alerts list with metadata.
   */
  @Get()
  getAlerts(@Query() query: GetAlertsQueryDto) {
    return this.alertsService.getAlerts(query);
  }

  /**
   * Creates and sends an in-app alert.
   *
   * POST /admin/alerts
   *
   * If userId is provided, the alert is sent to one user.
   * If userId is omitted, the alert is broadcast to all active users.
   *
   * @param body Alert creation data.
   * @param currentUser Authenticated admin user.
   * @returns Created alert or broadcast result.
   */
  @Post()
  createAlert(
    @Body() body: CreateAlertDto,
    @CurrentUser() currentUser: AuthenticatedAdmin,
  ) {
    return this.alertsService.createAlert(body, currentUser.id);
  }

  /**
   * Sends an email alert.
   *
   * POST /admin/alerts/email
   *
   * This endpoint is separate from in-app alerts.
   * It does not create app notification records.
   *
   * If userId is provided, the email is sent to one user.
   * If userId is omitted, the email is sent to all active users.
   *
   * @param body Email alert data.
   * @param currentUser Authenticated admin user.
   * @returns Email sending result.
   */
  @Post('email')
  sendEmailAlert(
    @Body() body: CreateEmailAlertDto,
    @CurrentUser() currentUser: AuthenticatedAdmin,
  ) {
    return this.alertsService.sendEmailAlert(body, currentUser.id);
  }
}