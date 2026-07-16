import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import { Throttle } from '@nestjs/throttler';

import type { Request } from 'express';

import { ResendVerificationEmailDto } from '../dto/resend-verification-email.dto';
import { VerifyEmailDto } from '../dto/verify-email.dto';

import { AuthEmailService } from './email.service';

/**
 * Controller responsible for authentication email operations.
 *
 * Handles:
 * - Email-address verification.
 * - Verification-email resend requests.
 *
 * Base route:
 * /auth/email
 *
 * @author Eman
 */
@Controller('auth/email')
export class EmailController {
  constructor(private readonly authEmailService: AuthEmailService) {}

  /**
   * Verifies a user's email address using a valid
   * email-verification token.
   *
   * Rate limit:
   * - Maximum 10 requests per minute per client.
   *
   * Endpoint:
   * GET /auth/email/verify
   *
   * @param query Validated email and verification token.
   * @param request Current HTTP request.
   * @returns Email-verification result.
   */
  @Throttle({
    default: {
      limit: 10,
      ttl: 60_000,
    },
  })
  @Get('verify')
  @HttpCode(HttpStatus.OK)
  verifyEmail(@Query() query: VerifyEmailDto, @Req() request: Request) {
    return this.authEmailService.verifyEmail(query.email, query.token, {
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
    });
  }

  /**
   * Requests a new email-verification email.
   *
   * Rate limit:
   * - Maximum 3 requests per minute per client.
   *
   * This rate limit protects the endpoint from excessive
   * requests. The service must separately enforce an
   * email-delivery cooldown to prevent duplicate emails.
   *
   * The endpoint should return a generic successful response
   * regardless of whether:
   * - The account does not exist.
   * - The account is already verified.
   * - An email was sent recently.
   * - A new email was sent.
   *
   * Endpoint:
   * POST /auth/email/resend-verification
   *
   * @param dto Validated user email address.
   * @param request Current HTTP request.
   * @returns Generic verification-email request result.
   */
  @Throttle({
    default: {
      limit: 3,
      ttl: 60_000,
    },
  })
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  resendVerificationEmail(
    @Body() dto: ResendVerificationEmailDto,
    @Req() request: Request,
  ) {
    return this.authEmailService.resendVerificationEmail(dto.email, {
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
    });
  }
}
