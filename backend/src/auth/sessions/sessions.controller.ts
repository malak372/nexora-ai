import {
    Controller,
    Delete,
    Get,
    Param,
    ParseUUIDPipe,
    UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { CurrentUser } from '../decorators/current-user.decorator';
import type { AuthenticatedUser } from '../types/authenticated-user.type';
import { AuthSessionsService } from './sessions.service';

/**
 * Controller responsible for authentication session management.
 *
 * Provides endpoints for viewing and managing the authenticated
 * user's active authentication sessions across devices.
 *
 * Base route:
 * /auth/sessions
 *
 * @author Eman
 */
@Controller('auth/sessions')
@UseGuards(JwtAuthGuard)
export class AuthSessionsController {
    constructor(
        private readonly authSessionsService: AuthSessionsService,
    ) { }

    /**
     * Returns all active authentication sessions
     * belonging to the authenticated user.
     *
     * Endpoint:
     * GET /auth/sessions
     *
     * @param user Authenticated user.
     * @returns Active authentication sessions.
     */
    @Get()
    getSessions(
        @CurrentUser() user: AuthenticatedUser,
    ) {
        return this.authSessionsService.getSessions(user.id);
    }

    /**
     * Revokes a specific active authentication session.
     *
     * The requested session must belong to the authenticated
     * user. Once revoked, the associated refresh token can
     * no longer be used to obtain new access tokens.
     *
     * Endpoint:
     * DELETE /auth/sessions/:id
     *
     * @param user Authenticated user.
     * @param sessionId Authentication session identifier.
     * @returns Session revocation confirmation message.
     */
    @Delete(':id')
    revokeSession(
        @CurrentUser() user: AuthenticatedUser,
        @Param('id', ParseUUIDPipe) sessionId: string,
    ) {
        return this.authSessionsService.revokeSession(
            user.id,
            sessionId,
        );
    }

    /**
     * Revokes all active authentication sessions
     * belonging to the authenticated user.
     *
     * After this operation, the user will be signed
     * out from every authenticated device. A new login
     * is required to create fresh authentication sessions.
     *
     * Endpoint:
     * DELETE /auth/sessions
     *
     * @param user Authenticated user.
     * @returns Confirmation message after revoking all sessions.
     */
    @Delete()
    revokeAllSessions(
        @CurrentUser() user: AuthenticatedUser,
    ) {
        return this.authSessionsService.revokeAllSessions(
            user.id,
        );
    }
}