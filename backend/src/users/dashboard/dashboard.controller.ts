import { Controller, Get, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserDashboardService } from './dashboard.service';

/**
 * Controller responsible for authenticated user dashboard summary.
 *
 * Base route:
 * /users
 *
 * @author Eman
 */
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UserDashboardController {
  constructor(private readonly userSummaryService: UserDashboardService) {}

  /**
   * Retrieves a dashboard-style summary for the authenticated user.
   */
  @Get('summary')
  getSummary(@CurrentUser() user: { id: string }) {
    return this.userSummaryService.getSummary(user.id);
  }
}
