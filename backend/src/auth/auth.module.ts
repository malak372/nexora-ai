import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import type { StringValue } from 'ms';

import { LoginController } from './login/login.controller';
import { RegisterController } from './register/register.controller';
import { RefreshController } from './refresh/refresh.controller';
import { LogoutController } from './logout/logout.controller';
import { PasswordController } from './password/password.controller';
import { EmailController } from './email/email.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RolesGuard } from './guards/roles.guard';

import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';

import { AuthTokenService } from './token/token.service';
import { AuthGuestService } from './guest/guest.service';
import { AuthEmailService } from './email/email.service';
import { AuthPasswordService } from './password/password.service';
import { AuthRegisterService } from './register/register.service';
import { AuthLoginService } from './login/login.service';
import { AuthRefreshService } from './refresh/refresh.service';
import { AuthLogoutService } from './logout/logout.service';
import { AuthAuditService } from './audit/audit.service';

/**
 * Authentication module.
 *
 * Configures all authentication-related components, including:
 * - User registration and verified login.
 * - Failed login attempt tracking and temporary account lock.
 * - JWT access and refresh token management.
 * - Password change and password reset flows.
 * - Email verification and welcome email flow.
 * - Guest idea transfer after registration.
 * - Authentication audit logging.
 * - Passport JWT strategy and role-based guards.
 * - User type support for personalization and analytics.
 *
 * This module imports PrismaModule for database access
 * and MailModule for authentication-related email delivery.
 *
 * @author Eman
 */
@Module({
  imports: [
    PrismaModule,
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_ACCESS_SECRET,
      signOptions: {
        expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN || '15m') as StringValue,
      },
    }),
    MailModule,
  ],
  controllers: [
    LoginController,
    RegisterController,
    RefreshController,
    LogoutController,
    PasswordController,
    EmailController,
  ],
  providers: [
    AuthService,
    AuthTokenService,
    AuthGuestService,
    AuthEmailService,
    AuthPasswordService,
    AuthRegisterService,
    AuthLoginService,
    AuthRefreshService,
    AuthLogoutService,
    AuthAuditService,
    JwtStrategy,
    RolesGuard,
  ],
  exports: [AuthService, RolesGuard],
})
export class AuthModule { }