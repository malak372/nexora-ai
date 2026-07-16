import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { UserRole } from '@prisma/client';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';

import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

import { AdjustUserCreditsDto } from '../dto/adjust-user-credits.dto';
import { GetAdminCreditHistoryQueryDto } from '../dto/get-admin-credit-history-query.dto';

import { AdminCreditsService } from '../services/admin-credits.service';

/**
 * Provides administrator-only endpoints for monitoring
 * and managing user credit balances and transactions.
 *
 * Responsibilities:
 * - Retrieve credit transaction history.
 * - Retrieve credit analytics and chart data.
 * - Adjust user credit balances manually.
 * - Export filtered credit transactions as CSV.
 *
 * All endpoints require:
 * - A valid authenticated session.
 * - The ADMIN user role.
 *
 * Base route:
 * /admin/credits
 *
 * @author Malak
 */
@Controller('admin/credits')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminCreditsController {
  constructor(private readonly adminCreditsService: AdminCreditsService) {}

  /**
   * Returns aggregated credit statistics based on
   * the supplied filters.
   *
   * GET /admin/credits/summary
   */
  @Get('summary')
  getCreditsSummary(@Query() query: GetAdminCreditHistoryQueryDto) {
    return this.adminCreditsService.getCreditsSummary(query);
  }

  /**
   * Returns credit analytics formatted for administrative charts.
   *
   * GET /admin/credits/charts
   */
  @Get('charts')
  getCreditsCharts(@Query() query: GetAdminCreditHistoryQueryDto) {
    return this.adminCreditsService.getCreditsCharts(query);
  }

  /**
   * Returns paginated and filtered credit transaction history.
   *
   * GET /admin/credits/history
   */
  @Get('history')
  getCreditHistory(@Query() query: GetAdminCreditHistoryQueryDto) {
    return this.adminCreditsService.getCreditHistory(query);
  }

  /**
   * Applies an administrator-authorized credit adjustment
   * to a target user's balance.
   *
   * The service is responsible for:
   * - Validating the target user.
   * - Preventing invalid negative balances.
   * - Updating the balance atomically.
   * - Creating an ADMIN_ADJUSTMENT transaction.
   * - Recording the administrator audit log.
   *
   * POST /admin/credits/adjust
   */
  @Post('adjust')
  adjustUserCredits(
    @Body() dto: AdjustUserCreditsDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.adminCreditsService.adjustUserCredits(dto, admin.id);
  }

  /**
   * Exports filtered credit transaction history as a CSV file.
   *
   * GET /admin/credits/export/csv
   */
  @Get('export/csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header(
    'Content-Disposition',
    'attachment; filename="credit-transactions.csv"',
  )
  exportCreditsCsv(@Query() query: GetAdminCreditHistoryQueryDto) {
    return this.adminCreditsService.exportCreditsCsv(query);
  }
}
