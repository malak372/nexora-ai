import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import { avatarUploadOptions } from '../config/avatar-upload.config';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserProfileService } from './profile.service';

/**
 * Controller responsible for authenticated user profile operations.
 *
 * Base route: /users
 *
 * @author Eman
 */
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UserProfileController {
  constructor(private readonly userProfileService: UserProfileService) {}

  /** Retrieves the authenticated user's profile. */
  @Get('profile')
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.userProfileService.getProfile(user.id);
  }

  /** Updates editable text profile fields. */
  @Patch('profile')
  updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.userProfileService.updateProfile(user.id, dto);
  }

  /**
   * Uploads or replaces the authenticated user's avatar.
   * The multipart field name must be "avatar".
   */
  @Patch('profile/avatar')
  @UseInterceptors(FileInterceptor('avatar', avatarUploadOptions))
  uploadAvatar(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('An avatar image is required.');
    }

    return this.userProfileService.updateAvatar(user.id, file);
  }

  /** Removes the current avatar and restores the initials fallback. */
  @Delete('profile/avatar')
  removeAvatar(@CurrentUser() user: AuthenticatedUser) {
    return this.userProfileService.removeAvatar(user.id);
  }

  /** Retrieves the authenticated user's free generation usage. */
  @Get('free-generations')
  getFreeGenerations(@CurrentUser() user: AuthenticatedUser) {
    return this.userProfileService.getFreeGenerations(user.id);
  }
}