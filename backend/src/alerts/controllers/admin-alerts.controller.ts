import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';

import { UserRole } from '@prisma/client';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';

import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

import { CreateAlertDto } from '../dto/create-alert.dto';
import { CreateEmailAlertDto } from '../dto/create-email-alert.dto';
import { GetSentCommunicationsQueryDto } from '../dto/get-sent-communications-query.dto';
import { SendAdminCommunicationDto } from '../dto/send-admin-communication.dto';
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
   * Returns summary counters for administrator alert activity.
   *
   * The summary respects search, category and date-range filters while
   * intentionally ignoring read-status filtering so the UI can show
   * All / Unread / Read counters at the same time.
   *
   * GET /admin/alerts/summary
   */
  @Get('summary')
  getAlertsSummary(@Query() query: GetAlertsQueryDto) {
    return this.adminAlertsService.getAlertsSummary(query);
  }

  /**
   * Retrieves administrator-sent communication history.
   *
   * This history includes in-app only, email only and combined sends.
   *
   * GET /admin/alerts/sent
   */
  @Get('sent')
  getSentCommunications(@Query() query: GetSentCommunicationsQueryDto) {
    return this.adminAlertsService.getSentCommunications(query);
  }

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
   * Sends one administrator communication to selected users or to all
   * active users through in-app notification, email, or both channels.
   *
   * POST /admin/alerts/send
   */
  @Post('send')
  sendCommunication(
    @Body() dto: SendAdminCommunicationDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.adminAlertsService.sendCommunication(dto, currentUser.id);
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