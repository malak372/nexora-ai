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
 * Handles administrator credit-management endpoints.
 *
 * Base route:
 * /admin/credits
 *
 * @author Malak
 */
@Controller('admin/credits')
@UseGuards(
  JwtAuthGuard,
  RolesGuard,
)
@Roles(UserRole.ADMIN)
export class AdminCreditsController {
  constructor(
    private readonly adminCreditsService:
      AdminCreditsService,
  ) {}

  @Get('summary')
  getCreditsSummary(
    @Query() query: GetAdminCreditHistoryQueryDto,
  ) {
    return this.adminCreditsService
      .getCreditsSummary(query);
  }

  @Get('charts')
  getCreditsCharts(
    @Query() query: GetAdminCreditHistoryQueryDto,
  ) {
    return this.adminCreditsService
      .getCreditsCharts(query);
  }

  @Get('history')
  getCreditHistory(
    @Query() query: GetAdminCreditHistoryQueryDto,
  ) {
    return this.adminCreditsService
      .getCreditHistory(query);
  }

  @Post('adjust')
  adjustUserCredits(
    @Body() body: AdjustUserCreditsDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.adminCreditsService
      .adjustUserCredits(
        body,
        admin.id,
      );
  }

  @Get('export/csv')
  @Header(
    'Content-Type',
    'text/csv',
  )
  @Header(
    'Content-Disposition',
    'attachment; filename="credits.csv"',
  )
  exportCreditsCsv(
    @Query() query: GetAdminCreditHistoryQueryDto,
  ) {
    return this.adminCreditsService
      .exportCreditsCsv(query);
  }
}