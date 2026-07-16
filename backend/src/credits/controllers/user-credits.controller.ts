import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

import { GetUserCreditHistoryQueryDto } from '../dto/get-user-credit-history-query.dto';

import { UserCreditsService } from '../services/user-credits.service';

/**
 * Provides authenticated users with access to their own
 * credit balance and credit transaction history.
 *
 * Responsibilities:
 * - Retrieve the authenticated user's current credit summary.
 * - Retrieve the authenticated user's paginated and filtered
 *   credit transaction history.
 *
 * The authenticated user identifier is always obtained from
 * the verified JWT payload. A user cannot request another
 * user's credit information through these endpoints.
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
   * Returns the authenticated user's current credit summary.
   *
   * The response may include:
   * - Current credit balance.
   * - Account status.
   * - Free-generation usage and remaining quota.
   *
   * GET /users/credits
   */
  @Get()
  getCredits(@CurrentUser() user: AuthenticatedUser) {
    return this.userCreditsService.getCredits(user.id);
  }

  /**
   * Returns the authenticated user's own paginated
   * and filtered credit transaction history.
   *
   * The history may contain transaction types such as:
   * - PURCHASE
   * - BONUS
   * - DEDUCTION_GENERATION
   * - REFUND
   * - ADMIN_ADJUSTMENT
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
