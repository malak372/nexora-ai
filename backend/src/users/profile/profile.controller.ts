import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import { avatarUploadOptions } from '../config/avatar-upload.config';
import { RequestEmailChangeDto } from './dto/request-email-change.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { VerifyEmailChangeDto } from './dto/verify-email-change.dto';
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


  /** Starts an email change and sends an approval code to the current address. */
  @Post('profile/email-change/request')
  requestEmailChange(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RequestEmailChangeDto,
  ) {
    return this.userProfileService.requestEmailChange(user.id, dto);
  }

  /** Confirms that the current email owner approves the change. */
  @Post('profile/email-change/verify-current')
  verifyCurrentEmailChange(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: VerifyEmailChangeDto,
  ) {
    return this.userProfileService.verifyCurrentEmailChange(user.id, dto);
  }

  /** Confirms ownership of the requested new email address. */
  @Post('profile/email-change/verify-new')
  verifyNewEmailChange(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: VerifyEmailChangeDto,
  ) {
    return this.userProfileService.verifyNewEmailChange(user.id, dto);
  }

  /** Cancels the active email-change request. */
  @Post('profile/email-change/cancel')
  cancelEmailChange(@CurrentUser() user: AuthenticatedUser) {
    return this.userProfileService.cancelEmailChange(user.id);
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