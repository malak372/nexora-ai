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

import { CreditsService } from './credits.service';
import { GetCreditHistoryQueryDto } from './dto/get-credit-history-query.dto';
import { AdjustUserCreditsDto } from './dto/adjust-user-credits.dto';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

type AuthenticatedAdmin = {
  id: string;
  role: UserRole;
};

/**
 * Controller responsible for administrative credit management.
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
  constructor(private readonly creditsService: CreditsService) {}

  /**
   * Retrieves credit summary statistics.
   *
   * Endpoint:
   * GET /admin/credits/summary
   */
  @Get('summary')
  getCreditsSummary(@Query() query: GetCreditHistoryQueryDto) {
    return this.creditsService.getCreditsSummary(query);
  }

  /**
   * Retrieves chart-ready credit analytics.
   *
   * Endpoint:
   * GET /admin/credits/charts
   */
  @Get('charts')
  getCreditsCharts(@Query() query: GetCreditHistoryQueryDto) {
    return this.creditsService.getCreditsCharts(query);
  }

  /**
   * Retrieves credit transaction history.
   *
   * Endpoint:
   * GET /admin/credits/history
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
   */
  @Post('adjust')
  adjustUserCredits(
    @Body() body: AdjustUserCreditsDto,
    @CurrentUser() currentUser: AuthenticatedAdmin,
  ) {
    return this.creditsService.adjustUserCredits(body, currentUser.id);
  }

  /**
   * Exports filtered credit transactions as CSV.
   *
   * Endpoint:
   * GET /admin/credits/export/csv
   */
  @Get('export/csv')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="credits.csv"')
  exportCreditsCsv(@Query() query: GetCreditHistoryQueryDto) {
    return this.creditsService.exportCreditsCsv(query);
  }
}
