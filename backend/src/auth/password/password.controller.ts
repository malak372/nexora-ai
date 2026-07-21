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
  constructor(private readonly authPasswordService: AuthPasswordService) {}

  /**
   * Changes the authenticated user's password.
   *
   * Requires JWT authentication.
   *
   * Rate limit:
   * - 5 requests per minute.
   *
   * Endpoint:
   * PATCH /auth/password/change
   *
   * @param user - Authenticated user.
   * @param dto - Current and new password data.
   * @param request - Current HTTP request containing client metadata.
   * @returns Password-change confirmation message.
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
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
    @Req() request: Request,
  ) {
    return this.authPasswordService.changePassword(user.id, dto, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  /**
   * Requests a password-reset email.
   *
   * The endpoint should always return the same public response,
   * regardless of whether the email belongs to an account, to
   * reduce user-enumeration risks.
   *
   * Rate limit:
   * - 3 requests per minute.
   *
   * Endpoint:
   * POST /auth/password/forgot
   *
   * @param dto - Email address requesting a password reset.
   * @param request - Current HTTP request containing client metadata.
   * @returns Generic password-reset request confirmation.
   */
  @Post('forgot')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    default: {
      limit: 3,
      ttl: PASSWORD_ACTION_TTL_MS,
    },
  })
  forgotPassword(@Body() dto: ForgotPasswordDto, @Req() request: Request) {
    return this.authPasswordService.forgotPassword(dto, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  /**
   * Resets a user's password using a valid reset token.
   *
   * Rate limit:
   * - 5 requests per minute.
   *
   * Endpoint:
   * POST /auth/password/reset
   *
   * @param dto - Reset token and new password data.
   * @param request - Current HTTP request containing client metadata.
   * @returns Password-reset confirmation message.
   */
  @Post('reset')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    default: {
      limit: 5,
      ttl: PASSWORD_ACTION_TTL_MS,
    },
  })
  resetPassword(@Body() dto: ResetPasswordDto, @Req() request: Request) {
    return this.authPasswordService.resetPassword(dto, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }
}
