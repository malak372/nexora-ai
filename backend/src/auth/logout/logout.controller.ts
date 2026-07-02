import { Body, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

import { RefreshDto } from '../dto/refresh.dto';
import { AuthLogoutService } from './logout.service';

/**
 * Controller responsible for user logout.
 *
 * Handles user logout by revoking the provided
 * refresh token to prevent further authentication.
 *
 * Base route:
 * /auth/logout
 *
 * @author Eman
 */
@Controller('auth/logout')
export class LogoutController {
    constructor(
        private readonly authLogoutService: AuthLogoutService,
    ) { }

    /**
     * Logs out the user by revoking the provided refresh token.
     *
     * Endpoint:
     * POST /auth/logout
     *
     * @param dto Refresh token to revoke.
     * @param req HTTP request metadata.
     * @returns Logout confirmation message.
     */
    @Post()
    logout(
        @Body() dto: RefreshDto,
        @Req() req: Request,
    ) {
        return this.authLogoutService.logout(dto, {
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        });
    }
}