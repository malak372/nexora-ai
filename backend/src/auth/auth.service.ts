import { Injectable } from '@nestjs/common';

import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

import { AuthRegisterService } from './register/register.service';
import { AuthLoginService } from './login/login.service';
import { AuthRefreshService } from './refresh/refresh.service';
import { AuthLogoutService } from './logout/logout.service';
import { AuthPasswordService } from './password/password.service';
import { AuthEmailService } from './email/email.service';
import { AuthRequestMeta } from './audit/audit.service';

/**
 * Main authentication facade service.
 *
 * Provides a single entry point for authentication operations in Nexora AI.
 * This service delegates authentication requests to specialized services,
 * keeping the authentication module modular, maintainable, and aligned
 * with the Single Responsibility Principle.
 *
 * Supported operations include:
 * - User registration.
 * - Verified user login.
 * - Access token refresh.
 * - Logout and refresh token revocation.
 * - Password change.
 * - Forgot password flow.
 * - Password reset flow.
 * - Email verification.
 * - Resending email verification links.
 *
 * Request metadata such as IP address and user agent can be passed to
 * the delegated services to support authentication audit logging and
 * security monitoring.
 *
 * @author Eman
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly authRegisterService: AuthRegisterService,
    private readonly authLoginService: AuthLoginService,
    private readonly authRefreshService: AuthRefreshService,
    private readonly authLogoutService: AuthLogoutService,
    private readonly authPasswordService: AuthPasswordService,
    private readonly authEmailService: AuthEmailService,
  ) {}

  /**
   * Registers a new user account.
   */
  register(dto: RegisterDto, meta?: AuthRequestMeta) {
    return this.authRegisterService.register(dto, meta);
  }

  /**
   * Authenticates a verified user and issues tokens.
   */
  login(dto: LoginDto, meta?: AuthRequestMeta) {
    return this.authLoginService.login(dto, meta);
  }

  /**
   * Rotates a refresh token and issues a new access token.
   */
  refresh(dto: RefreshDto, meta?: AuthRequestMeta) {
    return this.authRefreshService.refresh(dto, meta);
  }

  /**
   * Logs out the user by revoking the provided refresh token.
   */
  logout(dto: RefreshDto, meta?: AuthRequestMeta) {
    return this.authLogoutService.logout(dto, meta);
  }

  /**
   * Changes the authenticated user's password.
   */
  changePassword(
    userId: string,
    dto: ChangePasswordDto,
    meta?: AuthRequestMeta,
  ) {
    return this.authPasswordService.changePassword(userId, dto, meta);
  }

  /**
   * Starts the forgot password flow.
   */
  forgotPassword(dto: ForgotPasswordDto, meta?: AuthRequestMeta) {
    return this.authPasswordService.forgotPassword(dto, meta);
  }

  /**
   * Resets the user's password using a valid reset token.
   */
  resetPassword(dto: ResetPasswordDto, meta?: AuthRequestMeta) {
    return this.authPasswordService.resetPassword(dto, meta);
  }

  /**
   * Verifies a user's email address.
   */
  verifyEmail(email: string, token: string, meta?: AuthRequestMeta) {
    return this.authEmailService.verifyEmail(email, token, meta);
  }

  /**
   * Resends the email verification link.
   */
  resendVerificationEmail(email: string, meta?: AuthRequestMeta) {
    return this.authEmailService.resendVerificationEmail(email, meta);
  }
}
