import { Body, Header, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CreditsService } from './credits.service';
import { GetCreditHistoryQueryDto } from './dto/get-credit-history-query.dto';
import { AdjustUserCreditsDto } from './dto/adjust-user-credits.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

/**
 * Controller responsible for administrative credit management.
 *
 * This controller provides endpoints that allow administrators to:
 * - View users' credit transaction history.
 * - Search and filter credit transactions.
 * - Manually add or deduct credits from a user's account.
 *
 * All endpoints are protected by JWT authentication and
 * can only be accessed by users with the ADMIN role.
 *
 * Base route:
 * /admin/credits
 *
 * @author Malak
 */
@Controller('admin/credits')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class CreditsController {
  /**
   * Creates an instance of CreditsController.
   *
   * @param creditsService - Service responsible for credit transaction management.
   */
  constructor(private readonly creditsService: CreditsService) { }

  /**
   * Retrieves the credit transaction history.
   *
   * Endpoint:
   * GET /admin/credits/history
   *
   * Supported query parameters:
   * - page: Page number for pagination.
   * - limit: Number of records per page.
   * - type: Filter by credit transaction type.
   * - search: Search by user's full name or email.
   *
   * Example:
   * GET /admin/credits/history?page=1&limit=10&type=PURCHASE&search=malak
   *
   * @param query - Query parameters used for pagination, searching,
   * and filtering credit transactions.
   * @returns A paginated list of credit transactions with related user,
   * payment, and idea information.
   */
  @Get('history')
  getCreditHistory(@Query() query: GetCreditHistoryQueryDto) {
    return this.creditsService.getCreditHistory(query);
  }

  /**
   * Manually adjusts a user's credit balance.
   *
   * Endpoint:
   * POST /admin/credits/adjust
   *
   * This endpoint allows an administrator to add or deduct credits
   * from a specific user's account.
   *
   * Positive amount values add credits.
   * Negative amount values deduct credits.
   *
   * Example:
   * POST /admin/credits/adjust
   *
   * Body:
   * {
   *   "userId": "c9d7b1a6-8d4e-4d15-b6a2-91f6d5f3a8b2",
   *   "amount": 5,
   *   "description": "Compensation for system issue"
   * }
   *
   * @param body - Data required to adjust the user's credits.
   * @param currentUser - The authenticated admin performing the adjustment.
   * @returns The updated credit balance and created credit transaction record.
   */
  @Post('adjust')
  adjustUserCredits(
    @Body() body: AdjustUserCreditsDto,
    @CurrentUser() currentUser: any,
  ) {
    return this.creditsService.adjustUserCredits(body, currentUser.id);
  }
  /**
   * Exports filtered credit transactions as a CSV file.
   *
   * Endpoint:
   * GET /admin/credits/export/csv
   *
   * @param query - Query parameters used to filter the exported credit records.
   * @returns CSV file containing the matching credit transaction records.
   */
  @Get('export/csv')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="credits.csv"')
  exportCreditsCsv(@Query() query: GetCreditHistoryQueryDto) {
    return this.creditsService.exportCreditsCsv(query);
  }
}