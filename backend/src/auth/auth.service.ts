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

/**
 * Main authentication facade service.
 *
 * Acts as the central facade for authentication operations by
 * delegating requests to specialized authentication services.
 *
 * This design keeps authentication logic modular, maintainable,
 * and aligned with the Single Responsibility Principle (SRP).
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
  ) { }

  /**
   * Delegates user registration to AuthRegisterService.
   */
  register(dto: RegisterDto) {
    return this.authRegisterService.register(dto);
  }

  /**
   * Delegates user login and failed login protection to AuthLoginService.
   */
  login(dto: LoginDto) {
    return this.authLoginService.login(dto);
  }

  /**
   * Delegates refresh token rotation to AuthRefreshService.
   */
  refresh(dto: RefreshDto) {
    return this.authRefreshService.refresh(dto);
  }

  /**
   * Delegates logout and refresh token revocation to AuthLogoutService.
   */
  logout(dto: RefreshDto) {
    return this.authLogoutService.logout(dto);
  }

  /**
   * Delegates password change to AuthPasswordService.
   */
  changePassword(userId: string, dto: ChangePasswordDto) {
    return this.authPasswordService.changePassword(userId, dto);
  }

  /**
   * Delegates forgot password flow to AuthPasswordService.
   */
  forgotPassword(dto: ForgotPasswordDto) {
    return this.authPasswordService.forgotPassword(dto);
  }

  /**
   * Delegates password reset flow to AuthPasswordService.
   */
  resetPassword(dto: ResetPasswordDto) {
    return this.authPasswordService.resetPassword(dto);
  }

  /**
   * Delegates email verification flow to AuthEmailService.
   */
  verifyEmail(email: string, token: string) {
    return this.authEmailService.verifyEmail(email, token);
  }

  /**
   * Delegates resend verification email flow to AuthEmailService.
   */
  resendVerificationEmail(email: string) {
    return this.authEmailService.resendVerificationEmail(email);
  }
}