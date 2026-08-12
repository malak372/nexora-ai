import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { CurrentUser } from '../decorators/current-user.decorator';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../types/authenticated-user.type';

import { AuthPasswordService } from './password.service';

const PASSWORD_ACTION_TTL_MS = 60_000;

/**
 * Controller responsible for password management.
 *
 * Handles:
 * - Authenticated password changes.
 * - Password-reset requests.
 * - Password resets using valid reset tokens.
 *
 * Base route:
 * /auth/password
 *
 * @author Eman
 */
@Controller('auth/password')
export class PasswordController {
  constructor(
    private readonly authPasswordService:
      AuthPasswordService,
  ) { }

  /**
   * Changes the authenticated user's password.
   *
   * Endpoint:
   * PATCH /auth/password/change
   */
  @Patch('change')
  @UseGuards(JwtAuthGuard)
  @Throttle({
    default: {
      limit: 5,
      ttl: PASSWORD_ACTION_TTL_MS,
    },
  })
  changePassword(
    @CurrentUser()
    user: AuthenticatedUser,

    @Body()
    dto: ChangePasswordDto,

    @Req()
    request: Request,
  ) {
    return this.authPasswordService.changePassword(
      user.id,
      dto,
      {
        ipAddress:
          request.ip,

        userAgent:
          request.headers[
          'user-agent'
          ],
      },
    );
  }

  /**
   * Requests a password-reset email.
   *
   * Web requests receive the normal web URL.
   * Mobile requests receive the voxidence:// deep link.
   *
   * Endpoint:
   * POST /auth/password/forgot
   */
  @Post('forgot')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    default: {
      limit: 3,
      ttl: PASSWORD_ACTION_TTL_MS,
    },
  })
  forgotPassword(
    @Body()
    dto: ForgotPasswordDto,

    @Req()
    request: Request,
  ) {
    const requestedClient =
      request.headers[
      'x-voxidence-client'
      ];

    const resetClient =
      typeof requestedClient ===
        'string' &&
        requestedClient
          .trim()
          .toLowerCase() ===
        'mobile'
        ? 'mobile'
        : 'web';

    return this.authPasswordService.forgotPassword(
      dto,
      {
        ipAddress:
          request.ip,

        userAgent:
          request.headers[
          'user-agent'
          ],
      },
      resetClient,
    );
  }

  /**
   * Resets a user's password.
   *
   * Endpoint:
   * POST /auth/password/reset
   */
  @Post('reset')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    default: {
      limit: 5,
      ttl: PASSWORD_ACTION_TTL_MS,
    },
  })
  resetPassword(
    @Body()
    dto: ResetPasswordDto,

    @Req()
    request: Request,
  ) {
    return this.authPasswordService.resetPassword(
      dto,
      {
        ipAddress:
          request.ip,

        userAgent:
          request.headers[
          'user-agent'
          ],
      },
    );
  }
}