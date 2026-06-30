import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ResendVerificationEmailDto } from './dto/resend-verification-email.dto';

/**
 * Controller responsible for authentication endpoints.
 *
 * Provides APIs for:
 * - User registration and login.
 * - JWT refresh and logout.
 * - Authenticated user profile retrieval.
 * - Password change and password reset flows.
 * - Email verification and verification email resend.
 *
 * Sensitive endpoints such as login, forgot password,
 * and resend verification are rate-limited to reduce abuse.
 *
 * Base route:
 * /auth
 *
 * @author Eman
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  /**
   * Registers a new user account and sends an email verification link.
   *
   * @param dto - User registration data.
   * @returns Registered user data, authentication tokens,
   * and transferred guest ideas count.
   */
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  /**
   * Authenticates an active and verified user.
   *
   * Rate limit:
   * - 5 requests per minute.
   *
   * @param dto - User login credentials.
   * @returns Access token, refresh token, and user data.
   */
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /**
   * Refreshes authentication tokens using a valid refresh token.
   *
   * @param dto - Refresh token request data.
   * @returns New access token and refresh token.
   */
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto);
  }

  /**
   * Logs out the user by revoking the provided refresh token.
   *
   * @param dto - Refresh token to revoke.
   * @returns Logout confirmation message.
   */
  @Post('logout')
  logout(@Body() dto: RefreshDto) {
    return this.authService.logout(dto);
  }

  /**
   * Changes the authenticated user's password.
   *
   * Requires JWT authentication.
   *
   * @param user - Authenticated user extracted from JWT.
   * @param dto - Current and new password data.
   * @returns Password change confirmation message.
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
   * Returns the authenticated user's profile.
   *
   * Requires JWT authentication.
   *
   * @param user - Authenticated user extracted from JWT.
   * @returns Authenticated user profile data.
   */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: { id: string }) {
    return this.authService.me(user.id);
  }

  /**
   * Sends a password reset link to the user's email.
   *
   * Rate limit:
   * - 3 requests per minute.
   *
   * @param dto - User email address.
   * @returns Password reset request confirmation message.
   */
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  /**
   * Resets the user's password using a valid reset token.
   *
   * @param dto - Reset token and new password data.
   * @returns Password reset confirmation message.
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
   * @returns Email verification confirmation message.
   */
  @Get('verify-email')
  verifyEmail(
    @Query('email') email: string,
    @Query('token') token: string,
  ) {
    return this.authService.verifyEmail(email, token);
  }

  /**
   * Resends an email verification link to an unverified user.
   *
   * Rate limit:
   * - 3 requests per minute.
   *
   * @param dto - User email address.
   * @returns Verification email resend confirmation message.
   */
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('resend-verification')
  resendVerificationEmail(
    @Body() dto: ResendVerificationEmailDto,
  ) {
    return this.authService.resendVerificationEmail(dto.email);
  }
}