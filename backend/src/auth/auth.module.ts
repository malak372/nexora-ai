/**
 * Authentication module.
 *
 * Centralizes all authentication-related controllers, services,
 * guards, strategies, and guest-session management used by Nexora AI.
 *
 * This module supports:
 * - User registration with email verification.
 * - Verified login using JWT access tokens.
 * - Refresh-token generation, rotation, and revocation.
 * - Logout and session invalidation.
 * - Password change, forgot-password, and reset-password flows.
 * - Guest-session creation and restoration.
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
 * @module AuthModule
 * @author Eman
 */

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import type { StringValue } from 'ms';

import { MailModule } from '../mail/mail.module';
import { PrismaModule } from '../prisma/prisma.module';

import { AuthService } from './auth.service';

import { AuthAuditController } from './audit/audit.controller';
import { EmailController } from './email/email.controller';
import { GuestSessionController } from './guest/guest-session.controller';
import { LoginController } from './login/login.controller';
import { LogoutController } from './logout/logout.controller';
import { PasswordController } from './password/password.controller';
import { RefreshController } from './refresh/refresh.controller';
import { RegisterController } from './register/register.controller';
import { AuthSessionsController } from './sessions/sessions.controller';

import { AuthAuditService } from './audit/audit.service';
import { AuthEmailService } from './email/email.service';
import { AuthGuestService } from './guest/guest.service';
import { GuestSessionService } from './guest/guest-session.service';
import { AuthLoginService } from './login/login.service';
import { AuthLogoutService } from './logout/logout.service';
import { AuthPasswordService } from './password/password.service';
import { AuthRefreshService } from './refresh/refresh.service';
import { AuthRegisterService } from './register/register.service';
import { AuthSessionsService } from './sessions/sessions.service';
import { AuthTokenService } from './token/token.service';

import { RolesGuard } from './guards/roles.guard';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    /**
     * Provides PrismaService for authentication and guest-session
     * database operations.
     */
    PrismaModule,

    /**
     * Registers Passport authentication support.
     */
    PassportModule,

    /**
     * Configures JWT access-token signing and verification.
     */
    JwtModule.register({
      secret: process.env.JWT_ACCESS_SECRET,

      signOptions: {
        expiresIn: (
          process.env.JWT_ACCESS_EXPIRES_IN || '15m'
        ) as StringValue,
      },
    }),

    /**
     * Provides authentication-related email delivery.
     */
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

    /**
     * Exposes:
     * POST /auth/guest-session
     *
     * Creates or restores the HTTP-only guest session required
     * before starting guest idea generation.
     */
    GuestSessionController,
  ],

  providers: [
    /**
     * Main authentication facade.
     */
    AuthService,

    /**
     * Authentication flow services.
     */
    AuthRegisterService,
    AuthLoginService,
    AuthRefreshService,
    AuthLogoutService,
    AuthPasswordService,
    AuthEmailService,
    AuthTokenService,
    AuthAuditService,
    AuthSessionsService,

    /**
     * Handles transferring an existing guest idea into a newly
     * registered or authenticated user account.
     */
    AuthGuestService,

    /**
     * Creates and restores guest sessions used by the public
     * guest idea-generation flow.
     */
    GuestSessionService,

    /**
     * Authentication strategy and authorization guard.
     */
    JwtStrategy,
    RolesGuard,
  ],

  exports: [
    AuthService,
    RolesGuard,
  ],
})
export class AuthModule { }