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
import { AuthEmailService } from './email.service';

/**
 * Controller responsible for authentication email operations.
 *
 * Handles email verification and resending verification links
 * for registered users.
 *
 * Base route:
 * /auth/email
 *
 * @author Eman
 */
@Controller('auth/email')
export class EmailController {
    constructor(private readonly authEmailService: AuthEmailService) { }

    /**
     * Verifies a user's email address using a verification token.
     *
     * Endpoint:
     * GET /auth/email/verify
     *
     * @param email User email address.
     * @param token Email verification token.
     * @param req HTTP request metadata.
     * @returns Email verification confirmation message.
     */
    @Get('verify')
    verifyEmail(
        @Query('email') email: string,
        @Query('token') token: string,
        @Req() req: Request,
    ) {
        return this.authEmailService.verifyEmail(email, token, {
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
    }

    /**
     * Resends an email verification link to an unverified user.
     *
     * Rate limit:
     * - 3 requests per minute.
     *
     * Endpoint:
     * POST /auth/email/resend-verification
     *
     * Returns:
     * - 200 OK when the request is processed successfully,
     *   regardless of whether a new verification email is sent
     *   or the email is already verified.
     *
     * @param dto User email address.
     * @param req HTTP request metadata.
     * @returns Verification email resend confirmation message.
     */
    @Throttle({ default: { limit: 3, ttl: 60000 } })
    @Post('resend-verification')
    @HttpCode(HttpStatus.OK)
    resendVerificationEmail(
        @Body() dto: ResendVerificationEmailDto,
        @Req() req: Request,
    ) {
        return this.authEmailService.resendVerificationEmail(dto.email, {
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
    }
}