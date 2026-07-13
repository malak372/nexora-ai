import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

import { GetUserCreditHistoryQueryDto } from '../dto/get-user-credit-history-query.dto';

import { UserCreditsService } from '../services/user-credits.service';

/**
 * Handles authenticated-user credit endpoints.
 *
 * Base route:
 * /users/credits
 *
 * @author Eman
 */
@Controller('users/credits')
@UseGuards(JwtAuthGuard)
export class UserCreditsController {
  constructor(private readonly userCreditsService: UserCreditsService) {}

  /**
   * Returns the current credit summary.
   *
   * GET /users/credits
   */
  @Get()
  getCredits(@CurrentUser() user: AuthenticatedUser) {
    return this.userCreditsService.getCredits(user.id);
  }

  /**
   * Returns the user's own credit history.
   *
   * GET /users/credits/history
   */
  @Get('history')
  getCreditHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GetUserCreditHistoryQueryDto,
  ) {
    return this.userCreditsService.getCreditHistory(user.id, query);
  }
}
