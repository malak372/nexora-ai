import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { GetUserPaymentsQueryDto } from './dto/get-user-payments-query.dto';
import { UserPaymentsService } from './payments.service';

/**
 * Controller responsible for authenticated user payment operations.
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
   */
  @Get()
  getPaymentHistory(
    @CurrentUser() user: { id: string },
    @Query() query: GetUserPaymentsQueryDto,
  ) {
    return this.userPaymentsService.getPaymentHistory(user.id, query);
  }

  /**
   * Retrieves payment summary for the authenticated user.
   */
  @Get('summary')
  getPaymentSummary(
    @CurrentUser() user: { id: string },
    @Query() query: GetUserPaymentsQueryDto,
  ) {
    return this.userPaymentsService.getPaymentSummary(user.id, query);
  }

  /**
   * Retrieves chart-ready payment analytics.
   */
  @Get('charts')
  getPaymentCharts(
    @CurrentUser() user: { id: string },
    @Query() query: GetUserPaymentsQueryDto,
  ) {
    return this.userPaymentsService.getPaymentCharts(user.id, query);
  }

  /**
   * Exports the authenticated user's payment history as CSV.
   */
  @Get('export/csv')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="user-payments.csv"')
  exportPaymentsCsv(
    @CurrentUser() user: { id: string },
    @Query() query: GetUserPaymentsQueryDto,
  ) {
    return this.userPaymentsService.exportPaymentsCsv(user.id, query);
  }
}
