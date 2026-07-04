import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UpdateUserPreferencesDto } from './dto/update-user-preferences.dto';
import { UserPreferencesService } from './preferences.service';

/**
 * Controller responsible for authenticated user preferences.
 *
 * Base route:
 * /users/preferences
 *
 * @author Eman
 */
@Controller('users/preferences')
@UseGuards(JwtAuthGuard)
export class UserPreferencesController {
    constructor(
        private readonly userPreferencesService: UserPreferencesService,
    ) { }

    /**
     * Retrieves the authenticated user's preferences.
     */
    @Get()
    getPreferences(@CurrentUser() user: { id: string }) {
        return this.userPreferencesService.getPreferences(user.id);
    }

    /**
     * Creates or updates the authenticated user's preferences.
     */
    @Patch()
    updatePreferences(
        @CurrentUser() user: { id: string },
        @Body() dto: UpdateUserPreferencesDto,
    ) {
        return this.userPreferencesService.updatePreferences(user.id, dto);
    }
}