import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

/**
 * Handles authentication operations such as registration,
 * login, token refresh, logout, password changes,
 * and retrieving the current user.
 *
 * @author Eman
 */
@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  /**
   * Registers a new user account.
   *
   * @param dto - User registration data.
   * @returns Newly registered user with authentication tokens.
   */
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  /**
   * Authenticates a user.
   *
   * @param dto - User login credentials.
   * @returns Access and refresh tokens.
   */
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /**
   * Generates a new access token using a valid refresh token.
   *
   * @param dto - Refresh token request.
   * @returns New access token and refresh token.
   */
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto);
  }

  /**
   * Logs out the authenticated user.
   *
   * Invalidates the provided refresh token.
   *
   * @param dto - Refresh token to revoke.
   * @returns Logout confirmation.
   */
  @Post('logout')
  logout(@Body() dto: RefreshDto) {
    return this.authService.logout(dto);
  }

  /**
   * Changes the authenticated user's password.
   *
   * @param user - Authenticated user extracted from the JWT token.
   * @param dto - Current and new password data.
   * @returns Password change confirmation.
   */
  @UseGuards(JwtAuthGuard)
  @Patch('change-password')
  changePassword(
    @CurrentUser() user: { id: string },
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(user.id, dto);
  }

  /**
   * Returns the authenticated user's information.
   *
   * @param user - Authenticated user extracted from the JWT token.
   * @returns Authenticated user profile.
   */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: { id: string }) {
    return this.authService.me(user.id);
  }
  /**
   * Sends a password reset link to the user's email.
   *
   * @param dto - User email.
   * @returns Password reset request confirmation.
   */
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  /**
   * Resets the user's password using a valid reset token.
   *
   * @param dto - Reset token and new password.
   * @returns Password reset confirmation.
   */
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  /**
   * Verifies a user's email using a verification token.
   *
   * @param email - User email address.
   * @param token - Email verification token.
   * @returns Email verification confirmation.
   */
  @Get('verify-email')
  verifyEmail(
    @Query('email') email: string,
    @Query('token') token: string,
  ) {
    return this.authService.verifyEmail(email, token);
  }
}