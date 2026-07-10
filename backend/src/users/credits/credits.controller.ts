import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { GetUserCreditHistoryQueryDto } from './dto/get-user-credit-history-query.dto';
import { UserCreditsService } from './credits.service';

/**
 * Controller responsible for authenticated user credit operations.
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
   * Retrieves the authenticated user's credit balance and premium status.
   */
  @Get()
  getCredits(@CurrentUser() user: { id: string }) {
    return this.userCreditsService.getCredits(user.id);
  }

  /**
   * Retrieves the authenticated user's credit transaction history.
   */
  @Get('history')
  getCreditHistory(
    @CurrentUser() user: { id: string },
    @Query() query: GetUserCreditHistoryQueryDto,
  ) {
    return this.userCreditsService.getCreditHistory(user.id, query);
  }
}
