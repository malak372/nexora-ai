import { Body, Controller, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { CurrentUser } from '../decorators/current-user.decorator';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import { AuthPasswordService } from './password.service';
import type { AuthenticatedUser } from '../types/authenticated-user.type';

/**
 * Controller responsible for password management.
 *
 * Handles password changes, forgot password requests,
 * and password reset operations.
 *
 * Base route:
 * /auth/password
 *
 * @author Eman
 */
@Controller('auth/password')
export class PasswordController {
    constructor(
        private readonly authPasswordService: AuthPasswordService,
    ) { }

    /**
     * Changes the authenticated user's password.
     *
     * Requires JWT authentication.
     *
     * Endpoint:
     * PATCH /auth/password/change
     */
    @UseGuards(JwtAuthGuard)
    @Patch('change')
    changePassword(
        @CurrentUser() user: AuthenticatedUser,
        @Body() dto: ChangePasswordDto,
        @Req() req: Request,
    ) {
        return this.authPasswordService.changePassword(user.id, dto, {
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
    }

    /**
     * Sends a password reset link to the user's email.
     *
     * Endpoint:
     * POST /auth/password/forgot
     */
    @Throttle({ default: { limit: 3, ttl: 60000 } })
    @Post('forgot')
    forgotPassword(
        @Body() dto: ForgotPasswordDto,
        @Req() req: Request,
    ) {
        return this.authPasswordService.forgotPassword(dto, {
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
    }

    /**
     * Resets the user's password using a valid reset token.
     *
     * Endpoint:
     * POST /auth/password/reset
     */
    @Post('reset')
    resetPassword(
        @Body() dto: ResetPasswordDto,
        @Req() req: Request,
    ) {
        return this.authPasswordService.resetPassword(dto, {
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
    }
}