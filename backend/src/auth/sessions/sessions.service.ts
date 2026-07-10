import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthAction } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { AuthAuditService } from '../audit/audit.service';

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
 * Session revocation actions are recorded in authentication audit logs
 * to support security monitoring and account activity traceability.
 *
 * @author Eman
 */
@Injectable()
export class AuthSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authAuditService: AuthAuditService,
  ) {}

  /**
   * Retrieves all active authentication sessions for a user.
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
   * After successful revocation, an authentication audit log is recorded.
   *
   * @param userId Authenticated user identifier.
   * @param sessionId Session identifier to revoke.
   * @returns Confirmation message after successful revocation.
   *
   * @throws NotFoundException when the session does not exist,
   * does not belong to the user, is expired, or was already revoked.
   */
  async revokeSession(userId: string, sessionId: string) {
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
        user: {
          select: {
            id: true,
            email: true,
          },
        },
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

    await this.authAuditService.createLog({
      userId: session.user.id,
      email: session.user.email,
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
   * This operation signs the user out from all active devices by
   * marking all non-revoked refresh tokens as revoked.
   *
   * After successful revocation, an authentication audit log is recorded.
   *
   * @param userId Authenticated user identifier.
   * @returns Confirmation message after revoking all active sessions.
   */
  async revokeAllSessions(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
      },
    });

    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    await this.authAuditService.createLog({
      userId,
      email: user?.email,
      action: AuthAction.LOGOUT,
      isSuccess: true,
      message: 'All active authentication sessions revoked successfully',
    });

    return {
      message: 'All active sessions have been revoked successfully',
    };
  }
}
