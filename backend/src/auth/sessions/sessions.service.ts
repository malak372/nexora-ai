import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthAction } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { AuthAuditService } from '../audit/audit.service';

/**
 * Service responsible for authenticated session management.
 *
 * This service manages refresh-token-based user sessions in Nexora AI.
 * Each successful login or token refresh creates an active session
 * represented by a stored refresh-token record.
 *
 * It allows authenticated users to:
 * - View their active sessions across devices.
 * - Revoke a specific active session.
 * - Revoke all active sessions.
 *
 * Revoked or expired sessions are excluded from active-session results.
 * Revoking a session invalidates its refresh token and prevents it from
 * being used to generate new access tokens.
 *
 * Session-revocation actions are recorded in authentication audit logs
 * to support security monitoring and account-activity traceability.
 *
 * @author Eman
 */
@Injectable()
export class AuthSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authAuditService: AuthAuditService,
  ) { }

  /**
   * Retrieves all active authentication sessions for a user.
   *
   * @param userId - Authenticated user identifier.
   * @returns Active sessions with device and expiration metadata.
   */
  async getSessions(userId: string) {
    const now = new Date();

    return this.prisma.refreshToken.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: {
          gt: now,
        },
      },
      orderBy: [
        {
          lastUsedAt: 'desc',
        },
        {
          createdAt: 'desc',
        },
      ],
      select: {
        id: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
      },
    });
  }

  /**
   * Revokes a specific active session owned by the authenticated user.
   *
   * The update is conditional and atomic. If the session does not
   * belong to the user, is expired, was already revoked, or was
   * concurrently revoked, the operation returns a not-found error.
   *
   * @param userId - Authenticated user identifier.
   * @param sessionId - Session identifier to revoke.
   * @returns Session-revocation confirmation message.
   *
   * @throws NotFoundException when no active owned session is revoked.
   */
  async revokeSession(userId: string, sessionId: string) {
    const now = new Date();

    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        email: true,
      },
    });

    const revocationResult =
      await this.prisma.refreshToken.updateMany({
        where: {
          id: sessionId,
          userId,
          revokedAt: null,
          expiresAt: {
            gt: now,
          },
        },
        data: {
          revokedAt: now,
          lastUsedAt: now,
        },
      });

    if (revocationResult.count !== 1) {
      throw new NotFoundException('Session not found');
    }

    await this.authAuditService.createLog({
      userId,
      email: user?.email,
      action: AuthAction.LOGOUT,
      isSuccess: true,
      message: 'Authentication session revoked successfully',
    });

    return {
      message: 'Authentication session revoked successfully',
    };
  }

  /**
   * Revokes all active sessions owned by the authenticated user.
   *
   * Only non-revoked and non-expired refresh tokens are updated.
   *
   * @param userId - Authenticated user identifier.
   * @returns Confirmation message after revoking all active sessions.
   */
  async revokeAllSessions(userId: string) {
    const now = new Date();

    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        email: true,
      },
    });

    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: {
          gt: now,
        },
      },
      data: {
        revokedAt: now,
        lastUsedAt: now,
      },
    });

    await this.authAuditService.createLog({
      userId,
      email: user?.email,
      action: AuthAction.LOGOUT,
      isSuccess: true,
      message:
        'All active authentication sessions revoked successfully',
    });

    return {
      message: 'All active sessions have been revoked successfully',
    };
  }
}
