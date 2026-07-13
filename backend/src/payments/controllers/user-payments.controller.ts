import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

import { GetUserPaymentsQueryDto } from '../dto/get-user-payments-query.dto';

import { UserPaymentsService } from '../services/user-payments.service';

/**
 * Handles authenticated-user payment endpoints.
 *
 * Base route:
 * /users/payments
 *
 * @author Eman
 */
@Controller('users/payments')
@UseGuards(JwtAuthGuard)
export class UserPaymentsController {
  constructor(private readonly userPaymentsService: UserPaymentsService) {}

  /**
   * Retrieves the authenticated user's payment history.
   *
   * GET /users/payments
   */
  @Get()
  getPaymentHistory(
    @CurrentUser() user: { id: string },

    @Query()
    query: GetUserPaymentsQueryDto,
  ) {
    return this.userPaymentsService.getPaymentHistory(user.id, query);
  }

  /**
   * Retrieves the authenticated user's payment summary.
   *
   * GET /users/payments/summary
   */
  @Get('summary')
  getPaymentSummary(
    @CurrentUser() user: { id: string },

    @Query()
    query: GetUserPaymentsQueryDto,
  ) {
    return this.userPaymentsService.getPaymentSummary(user.id, query);
  }

  /**
   * Retrieves chart-ready payment analytics.
   *
   * GET /users/payments/charts
   */
  @Get('charts')
  getPaymentCharts(
    @CurrentUser() user: { id: string },

    @Query()
    query: GetUserPaymentsQueryDto,
  ) {
    return this.userPaymentsService.getPaymentCharts(user.id, query);
  }

  /**
   * Exports the user's payment history as CSV.
   *
   * GET /users/payments/export/csv
   */
  @Get('export/csv')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="user-payments.csv"')
  exportPaymentsCsv(
    @CurrentUser() user: { id: string },

    @Query()
    query: GetUserPaymentsQueryDto,
  ) {
    return this.userPaymentsService.exportPaymentsCsv(user.id, query);
  }
}
