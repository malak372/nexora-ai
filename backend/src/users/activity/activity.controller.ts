import { Controller, Get, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserActivityService } from './activity.service';

/**
 * Controller responsible for authenticated user recent activity.
 *
 * Base route:
 * /users
 *
 * @author Eman
 */
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UserActivityController {
    constructor(private readonly userActivityService: UserActivityService) { }

    /**
     * Retrieves the authenticated user's recent activity.
     */
    @Get('activity')
    getActivity(@CurrentUser() user: { id: string }) {
        return this.userActivityService.getActivity(user.id);
    }
}