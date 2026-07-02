import { Body, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

import { RegisterDto } from '../dto/register.dto';
import { AuthRegisterService } from './register.service';

/**
 * Controller responsible for user registration.
 *
 * Handles creating new user accounts and initiating
 * the email verification process.
 *
 * Base route:
 * /auth/register
 *
 * @author Eman
 */
@Controller('auth/register')
export class RegisterController {
    constructor(
        private readonly authRegisterService: AuthRegisterService,
    ) { }

    /**
     * Registers a new user account and sends an email verification link.
     *
     * Endpoint:
     * POST /auth/register
     *
     * @param dto User registration data.
     * @param req HTTP request metadata.
     * * @returns Registered user data and transferred guest ideas count.
     */
    @Post()
    register(
        @Body() dto: RegisterDto,
        @Req() req: Request,
    ) {
        return this.authRegisterService.register(dto, {
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
    }
}