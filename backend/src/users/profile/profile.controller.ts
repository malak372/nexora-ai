import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserProfileService } from './profile.service';

/**
 * Controller responsible for authenticated user profile operations.
 *
 * Base route:
 * /users
 *
 * @author Eman
 */
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UserProfileController {
  constructor(private readonly userProfileService: UserProfileService) {}

  /**
   * Retrieves the authenticated user's profile.
   */
  @Get('profile')
  getProfile(@CurrentUser() user: { id: string }) {
    return this.userProfileService.getProfile(user.id);
  }

  /**
   * Updates the authenticated user's editable profile fields.
   */
  @Patch('profile')
  updateProfile(
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateProfileDto,
  ) {
    return this.userProfileService.updateProfile(user.id, dto);
  }

  /**
   * Retrieves the authenticated user's free generation usage.
   */
  @Get('free-generations')
  getFreeGenerations(@CurrentUser() user: { id: string }) {
    return this.userProfileService.getFreeGenerations(user.id);
  }
}
