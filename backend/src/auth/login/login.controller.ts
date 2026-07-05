import {
    Body,
    Controller,
    HttpCode,
    HttpStatus,
    Post,
    Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { LoginDto } from '../dto/login.dto';
import { AuthLoginService } from './login.service';

/**
 * Controller responsible for user login.
 *
 * Handles user authentication by validating credentials
 * and issuing access and refresh tokens.
 *
 * Base route:
 * /auth/login
 *
 * @author Eman
 */
@Controller('auth/login')
export class LoginController {
    constructor(
        private readonly authLoginService: AuthLoginService,
    ) { }

    /**
     * Authenticates an active and verified user.
     *
     * Rate limit:
     * - 5 requests per minute.
     *
     * Endpoint:
     * POST /auth/login
     *
     * @param dto User login credentials.
     * @param req HTTP request metadata.
     * @returns Access token, refresh token, and authenticated user data.
     */
    @Throttle({ default: { limit: 5, ttl: 60000 } })
    @HttpCode(HttpStatus.OK)
    @Post()
    login(
        @Body() dto: LoginDto,
        @Req() req: Request,
    ) {
        return this.authLoginService.login(dto, {
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
    }
}