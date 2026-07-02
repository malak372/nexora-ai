import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import type { StringValue } from 'ms';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RolesGuard } from './guards/roles.guard';

import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';

import { AuthTokenService } from './services/auth-token.service';
import { AuthGuestService } from './services/auth-guest.service';
import { AuthEmailService } from './services/auth-email.service';
import { AuthPasswordService } from './services/auth-password.service';
import { AuthRegisterService } from './services/auth-register.service';
import { AuthLoginService } from './services/auth-login.service';
import { AuthRefreshService } from './services/auth-refresh.service';
import { AuthLogoutService } from './services/auth-logout.service';
import { AuthProfileService } from './services/auth-profile.service';

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
 * - Passport JWT strategy and role-based guards.
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
  controllers: [AuthController],
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
    AuthProfileService,
    JwtStrategy,
    RolesGuard,
  ],
  exports: [
    AuthService,
    RolesGuard,
  ],
})
export class AuthModule { }