import { Body, Controller, Delete, Get, Put, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import { UpdateUserPreferencesDto } from './dto/update-user-preferences.dto';
import { UserPreferencesService } from './user-preferences.service';

/**
 * Exposes authenticated personalization and onboarding endpoints.
 *
 * Base routes:
 * - /preferences/options
 * - /users/preferences
 *
 * @author Malak
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class UserPreferencesController {
  constructor(
    private readonly userPreferencesService: UserPreferencesService,
  ) {}

  /** Returns active preference cards grouped by category. */
  @Get('preferences/options')
  getPreferenceCatalog(@CurrentUser() user: AuthenticatedUser) {
    return this.userPreferencesService.getCatalog(user.id);
  }

  /** Returns the authenticated user's saved preferences. */
  @Get('users/preferences')
  getMyPreferences(@CurrentUser() user: AuthenticatedUser) {
    return this.userPreferencesService.getMyPreferences(user.id);
  }

  /** Completes the first-time personalization onboarding flow. */
  @Put('users/preferences/onboarding')
  completeOnboarding(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateUserPreferencesDto,
  ) {
    return this.userPreferencesService.completeOnboarding(user.id, dto);
  }

  /** Replaces existing selections with refreshed interests. */
  @Put('users/preferences')
  updatePreferences(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateUserPreferencesDto,
  ) {
    return this.userPreferencesService.updatePreferences(user.id, dto);
  }

  /** Clears selections and reopens onboarding for the user. */
  @Delete('users/preferences/selections')
  resetPreferences(@CurrentUser() user: AuthenticatedUser) {
    return this.userPreferencesService.resetPreferences(user.id);
  }
}
