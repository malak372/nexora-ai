import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Service responsible for authentication session management.
 *
 * Provides operations for retrieving and revoking the
 * authenticated user's active sessions across devices.
 *
 * @author Eman
 */
@Injectable()
export class AuthSessionsService {
    constructor(
        private readonly prisma: PrismaService,
    ) { }

    /**
     * Returns all active sessions for the authenticated user.
     *
     * Revoked and expired sessions are excluded from the response.
     *
     * @param userId Authenticated user identifier.
     * @returns List of active authentication sessions.
     */
    async getSessions(userId: string) {
        const sessions = await this.prisma.refreshToken.findMany({
            where: {
                userId,
                revokedAt: null,
                expiresAt: {
                    gt: new Date(),
                },
            },
            orderBy: {
                lastUsedAt: 'desc',
            },
            select: {
                id: true,
                ipAddress: true,
                userAgent: true,
                createdAt: true,
                lastUsedAt: true,
                expiresAt: true,
            },
        });

        return sessions.map((session) => ({
            id: session.id,
            ipAddress: session.ipAddress,
            userAgent: session.userAgent,
            createdAt: session.createdAt,
            lastUsedAt: session.lastUsedAt,
            expiresAt: session.expiresAt,
        }));
    }

    /**
     * Revokes a specific active authentication session
     * belonging to the authenticated user.
     *
     * The session is invalidated by marking its refresh
     * token as revoked. If the session does not exist,
     * belongs to another user, or has already been revoked,
     * no changes are applied.
     *
     * @param userId Authenticated user identifier.
     * @param sessionId Authentication session identifier.
     * @returns Confirmation message after revoking the session.
     */
    async revokeSession(
        userId: string,
        sessionId: string,
    ) {
        await this.prisma.refreshToken.updateMany({
            where: {
                id: sessionId,
                userId,
                revokedAt: null,
            },
            data: {
                revokedAt: new Date(),
            },
        });

        return {
            message: 'Authentication session revoked successfully',
        };
    }

    /**
     * Revokes all active authentication sessions
     * belonging to the authenticated user.
     *
     * All active refresh tokens are invalidated,
     * forcing the user to authenticate again on
     * every device.
     *
     * @param userId Authenticated user identifier.
     * @returns Confirmation message after revoking all sessions.
     */
    async revokeAllSessions(userId: string) {
        await this.prisma.refreshToken.updateMany({
            where: {
                userId,
                revokedAt: null,
            },
            data: {
                revokedAt: new Date(),
            },
        });

        return {
            message: 'All active sessions have been revoked successfully',
        };
    }
}