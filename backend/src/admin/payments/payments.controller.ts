import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { PaymentsService } from './payments.service';
import { GetPaymentsQueryDto } from './dto/get-payments-query.dto';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

/**
 * Controller responsible for Admin payment management.
 *
 * Base route:
 * /admin/payments
 *
 * Access:
 * Admin only.
 *
 * Provides:
 * - Paginated payments list.
 * - Payment summary statistics.
 * - Chart-ready payment analytics.
 * - CSV export for payments.
 *
 * @author Malak
 */
@Controller('admin/payments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * Retrieves paginated payment records.
   *
   * Supports:
   * - Pagination.
   * - Sorting.
   * - Date range filtering.
   * - Search by user full name or email.
   * - Filter by status, purpose, and method.
   *
   * Endpoint:
   * GET /admin/payments
   */
  @Get()
  getPayments(@Query() query: GetPaymentsQueryDto) {
    return this.paymentsService.getPayments(query);
  }

  /**
   * Retrieves payment summary statistics.
   *
   * Endpoint:
   * GET /admin/payments/summary
   */
  @Get('summary')
  getPaymentsSummary(@Query() query: GetPaymentsQueryDto) {
    return this.paymentsService.getPaymentsSummary(query);
  }

  /**
   * Retrieves chart-ready payment analytics.
   *
   * Endpoint:
   * GET /admin/payments/charts
   */
  @Get('charts')
  getPaymentsCharts(@Query() query: GetPaymentsQueryDto) {
    return this.paymentsService.getPaymentsCharts(query);
  }

  /**
   * Exports filtered payment records as CSV.
   *
   * Endpoint:
   * GET /admin/payments/export/csv
   */
  @Get('export/csv')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="payments-report.csv"')
  exportPaymentsCsv(@Query() query: GetPaymentsQueryDto) {
    return this.paymentsService.exportPaymentsCsv(query);
  }
}
