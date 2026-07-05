import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Service responsible for authenticated session management.
 *
 * This service manages refresh-token based user sessions in Nexora AI.
 * Each successful login or token refresh creates an active session
 * represented by a stored refresh token record.
 *
 * It allows authenticated users to:
 * - View their active sessions across devices.
 * - Revoke a specific active session.
 * - Revoke all active sessions.
 *
 * Revoked or expired sessions are excluded from active session results.
 * Revoking a session invalidates its refresh token and prevents it from
 * being used to generate new access tokens.
 *
 * @author Eman
 */
@Injectable()
export class AuthSessionsService {
    constructor(
        private readonly prisma: PrismaService,
    ) { }

    /**
     * Retrieves all active authentication sessions for a user.
     *
     * A session is considered active only if:
     * - It belongs to the authenticated user.
     * - It has not been revoked.
     * - Its refresh token has not expired.
     *
     * @param userId Authenticated user identifier.
     * @returns List of active sessions with device and expiration metadata.
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
     * Revokes a specific active session owned by the authenticated user.
     *
     * The session must:
     * - Exist.
     * - Belong to the authenticated user.
     * - Not already be revoked.
     * - Not be expired.
     *
     * If no matching active session is found, a NotFoundException is thrown.
     * This prevents the API from returning a misleading success response
     * when the requested session does not exist or is no longer active.
     *
     * @param userId Authenticated user identifier.
     * @param sessionId Session identifier to revoke.
     * @returns Confirmation message after successful revocation.
     *
     * @throws NotFoundException when the session does not exist,
     * does not belong to the user, is expired, or was already revoked.
     */
    async revokeSession(
        userId: string,
        sessionId: string,
    ) {
        const session = await this.prisma.refreshToken.findFirst({
            where: {
                id: sessionId,
                userId,
                revokedAt: null,
                expiresAt: {
                    gt: new Date(),
                },
            },
            select: {
                id: true,
            },
        });

        if (!session) {
            throw new NotFoundException('Session not found');
        }

        await this.prisma.refreshToken.update({
            where: {
                id: session.id,
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
     * Revokes all active sessions owned by the authenticated user.
     *
     * This operation signs the user out from all active devices by
     * marking all non-revoked refresh tokens as revoked.
     *
     * After this operation, existing refresh tokens can no longer be used
     * to obtain new access tokens. The user must log in again to create
     * a new session.
     *
     * @param userId Authenticated user identifier.
     * @returns Confirmation message after revoking all active sessions.
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