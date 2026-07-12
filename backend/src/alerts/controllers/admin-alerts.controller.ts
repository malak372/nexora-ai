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
 * Administrator-only alert controller.
 *
 * Base route:
 * /admin/alerts
 *
 * @author Malak
 */
@Controller('admin/alerts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminAlertsController {
  constructor(private readonly adminAlertsService: AdminAlertsService) {}

  /**
   * Retrieves alerts.
   *
   * GET /admin/alerts
   */
  @Get()
  getAlerts(@Query() query: GetAlertsQueryDto) {
    return this.adminAlertsService.getAlerts(query);
  }

  /**
   * Creates one in-app alert or broadcast.
   *
   * POST /admin/alerts
   */
  @Post()
  createAlert(
    @Body() body: CreateAlertDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.adminAlertsService.createAlert(body, currentUser.id);
  }

  /**
   * Sends one email alert or broadcast.
   *
   * POST /admin/alerts/email
   */
  @Post('email')
  sendEmailAlert(
    @Body() body: CreateEmailAlertDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.adminAlertsService.sendEmailAlert(body, currentUser.id);
  }
}
