import { Header, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { GetPaymentsQueryDto } from './dto/get-payments-query.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

/**
 * Controller responsible for administrative payment management.
 *
 * This controller provides endpoints that allow administrators to:
 * - Retrieve all payment records.
 * - Search and filter payments by status, purpose,
 *   payment method, or user information.
 *
 * All endpoints are protected by JWT authentication and
 * can only be accessed by users with the ADMIN role.
 *
 * Base route:
 * /admin/payments
 *
 * @author Malak
 */
@Controller('admin/payments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class PaymentsController {
  /**
   * Creates an instance of PaymentsController.
   *
   * @param paymentsService - Service responsible for payment management operations.
   */
  constructor(private readonly paymentsService: PaymentsService) { }

  /**
   * Retrieves payment records with optional filtering.
   *
   * Endpoint:
   * GET /admin/payments
   *
   * Supported query parameters:
   * - status: Filter by payment status.
   * - purpose: Filter by payment purpose.
   * - method: Filter by payment method.
   * - search: Search by user's full name or email.
   *
   * Example:
   * GET /admin/payments?status=SUCCESS&method=PAYPAL
   *
   * @param query - Query parameters used for searching and filtering payments.
   * @returns A list of payment records with related user and idea information.
   */
  @Get()
  getPayments(@Query() query: GetPaymentsQueryDto) {
    return this.paymentsService.getPayments(query);
  }
  /**
   * Exports filtered payment records as a CSV file.
   *
   * This endpoint allows administrators to export payment
   * transactions in CSV format.
   *
   * The exported data supports the same filtering options
   * available in the payment list endpoint, including:
   * - Date range.
   * - Payment status.
   * - Payment purpose.
   * - Payment method.
   * - User name or email search.
   *
   * @param query - Query parameters used to filter the exported payment records.
   * @returns CSV file containing the matching payment records.
   */
  @Get('export/csv')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="payments.csv"')
  exportPaymentsCsv(@Query() query: GetPaymentsQueryDto) {
    return this.paymentsService.exportPaymentsCsv(query);
  }
}