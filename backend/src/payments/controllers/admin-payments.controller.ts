import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';

import { UserRole } from '@prisma/client';

import { Roles } from '../../auth/decorators/roles.decorator';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';

import { GetAdminPaymentsQueryDto } from '../dto/get-admin-payments-query.dto';

import { AdminPaymentsService } from '../services/admin-payments.service';

/**
 * Handles administrator payment-monitoring endpoints.
 *
 * Base route:
 * /admin/payments
 *
 * @author Malak
 */
@Controller('admin/payments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminPaymentsController {
  constructor(private readonly adminPaymentsService: AdminPaymentsService) {}

  /**
   * Retrieves paginated payment records.
   *
   * GET /admin/payments
   */
  @Get()
  getPayments(
    @Query()
    query: GetAdminPaymentsQueryDto,
  ) {
    return this.adminPaymentsService.getPayments(query);
  }

  /**
   * Retrieves payment summary statistics.
   *
   * GET /admin/payments/summary
   */
  @Get('summary')
  getPaymentsSummary(
    @Query()
    query: GetAdminPaymentsQueryDto,
  ) {
    return this.adminPaymentsService.getPaymentsSummary(query);
  }

  /**
   * Retrieves chart-ready payment analytics.
   *
   * GET /admin/payments/charts
   */
  @Get('charts')
  getPaymentsCharts(
    @Query()
    query: GetAdminPaymentsQueryDto,
  ) {
    return this.adminPaymentsService.getPaymentsCharts(query);
  }

  /**
   * Exports filtered payments as CSV.
   *
   * GET /admin/payments/export/csv
   */
  @Get('export/csv')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="payments-report.csv"')
  exportPaymentsCsv(
    @Query()
    query: GetAdminPaymentsQueryDto,
  ) {
    return this.adminPaymentsService.exportPaymentsCsv(query);
  }
}
