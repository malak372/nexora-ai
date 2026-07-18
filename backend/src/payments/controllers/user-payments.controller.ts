import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

import { GetUserPaymentsQueryDto } from '../dto/get-user-payments-query.dto';

import { UserPaymentsService } from '../services/user-payments.service';

/**
 * Handles authenticated-user payment-history endpoints.
 *
 * Base route:
 * /users/payments
 *
 * Responsibilities:
 * - Retrieve the current user's payment history.
 * - Retrieve personal payment summary statistics.
 * - Retrieve chart-ready personal payment analytics.
 * - Export personal payment records as CSV.
 *
 * @author Eman
 */
@Controller('users/payments')
@UseGuards(JwtAuthGuard)
export class UserPaymentsController {
  constructor(private readonly userPaymentsService: UserPaymentsService) { }

  /**
   * Retrieves the authenticated user's payment history.
   *
   * GET /users/payments
   */
  @Get()
  getPaymentHistory(
    @CurrentUser()
    user: AuthenticatedUser,

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
    @CurrentUser()
    user: AuthenticatedUser,

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
    @CurrentUser()
    user: AuthenticatedUser,

    @Query()
    query: GetUserPaymentsQueryDto,
  ) {
    return this.userPaymentsService.getPaymentCharts(user.id, query);
  }

  /**
   * Exports the authenticated user's payment history as CSV.
   *
   * GET /users/payments/export/csv
   */
  @Get('export/csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header(
    'Content-Disposition',
    'attachment; filename="user-payments.csv"',
  )
  exportPaymentsCsv(
    @CurrentUser()
    user: AuthenticatedUser,

    @Query()
    query: GetUserPaymentsQueryDto,
  ) {
    return this.userPaymentsService.exportPaymentsCsv(user.id, query);
  }
}