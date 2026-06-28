import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AlertsService } from './alerts.service';
import { CreateAlertDto } from './dto/create-alert.dto';
import { GetAlertsQueryDto } from './dto/get-alerts-query.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

/**
 * Controller responsible for sending and managing system alerts.
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
   * Endpoint:
   * GET /admin/alerts
   *
   * @param query - Query parameters used for pagination and filtering alerts.
   * @returns Paginated alerts list with metadata.
   */
  @Get()
  getAlerts(@Query() query: GetAlertsQueryDto) {
    return this.alertsService.getAlerts(query);
  }

  /**
   * Creates and sends a new alert.
   *
   * Endpoint:
   * POST /admin/alerts
   *
   * @param body - DTO containing the alert information.
   * @returns A success message and the created alert, or the number of users who received the alert.
   */
  @Post()
  createAlert(
    @Body() body: CreateAlertDto,
    @CurrentUser() currentUser: any,
  ) {
    return this.alertsService.createAlert(
      body,
      currentUser.id,
    );
  }

}