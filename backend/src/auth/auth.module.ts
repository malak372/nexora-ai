import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import type { StringValue } from 'ms';

import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';

import { AuthService } from './auth.service';

import { LoginController } from './login/login.controller';
import { RegisterController } from './register/register.controller';
import { RefreshController } from './refresh/refresh.controller';
import { LogoutController } from './logout/logout.controller';
import { PasswordController } from './password/password.controller';
import { EmailController } from './email/email.controller';
import { AuthSessionsController } from './sessions/sessions.controller';
import { AuthAuditController } from './audit/audit.controller';

import { JwtStrategy } from './strategies/jwt.strategy';
import { RolesGuard } from './guards/roles.guard';

import { AuthTokenService } from './token/token.service';
import { AuthGuestService } from './guest/guest.service';
import { AuthEmailService } from './email/email.service';
import { AuthPasswordService } from './password/password.service';
import { AuthRegisterService } from './register/register.service';
import { AuthLoginService } from './login/login.service';
import { AuthRefreshService } from './refresh/refresh.service';
import { AuthLogoutService } from './logout/logout.service';
import { AuthAuditService } from './audit/audit.service';
import { AuthSessionsService } from './sessions/sessions.service';

/**
 * Authentication module.
 *
 * Centralizes all authentication-related controllers, services,
 * guards, and strategies used by Nexora AI.
 *
 * This module supports:
 * - User registration with email verification.
 * - Verified login using JWT access tokens.
 * - Refresh token generation, rotation, and revocation.
 * - Logout and session invalidation.
 * - Password change, forgot password, and reset password flows.
 * - Guest idea transfer after registration.
 * - Authentication audit logging.
 * - Active session management across devices.
 * - Role-based authorization using RolesGuard.
 *
 * Imported modules:
 * - PrismaModule: provides database access.
 * - PassportModule: enables Passport authentication strategies.
 * - JwtModule: signs and validates JWT access tokens.
 * - MailModule: sends authentication-related emails.
 *
 * Exported providers:
 * - AuthService: main authentication facade service.
 * - RolesGuard: reusable role-based authorization guard.
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
    RegisterController,
    LoginController,
    RefreshController,
    LogoutController,
    PasswordController,
    EmailController,
    AuthSessionsController,
    AuthAuditController,
  ],
  providers: [
    AuthService,

    AuthRegisterService,
    AuthLoginService,
    AuthRefreshService,
    AuthLogoutService,
    AuthPasswordService,
    AuthEmailService,
    AuthGuestService,
    AuthTokenService,
    AuthAuditService,
    AuthSessionsService,

    JwtStrategy,
    RolesGuard,
  ],
  exports: [
    AuthService,
    RolesGuard,
  ],
})
export class AuthModule { }