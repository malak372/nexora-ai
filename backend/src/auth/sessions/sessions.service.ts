import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

const SESSION_NOT_FOUND_MESSAGE = 'Authentication session was not found.';

/**
 * Service responsible for authenticated session management.
 *
 * Active sessions are represented by non-revoked, non-expired refresh-token
 * records. Every read and revoke operation is scoped to the authenticated user
 * so one user cannot inspect or revoke another user's sessions.
 *
 * @author Eman
 */
@Injectable()
export class AuthSessionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns all active authentication sessions owned by a user.
   *
   * @param userId Authenticated user identifier.
   * @returns Active sessions ordered from most recently used to oldest.
   */
  async getSessions(userId: string) {
    const now = new Date();

    const sessions = await this.prisma.refreshToken.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: {
          gt: now,
        },
      },
      select: {
        id: true,
        createdAt: true,
        expiresAt: true,
        lastUsedAt: true,
        ipAddress: true,
        userAgent: true,
      },
      orderBy: [
        {
          lastUsedAt: 'desc',
        },
        {
          createdAt: 'desc',
        },
      ],
    });

    return {
      sessions: sessions.map((session) => ({
        id: session.id,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        lastUsedAt: session.lastUsedAt,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        deviceLabel: this.buildDeviceLabel(session.userAgent),
      })),
      total: sessions.length,
    };
  }

  /**
   * Revokes one active authentication session owned by the user.
   *
   * The ownership and active-state conditions are included in the update query
   * to prevent cross-user revocation and concurrent double revocation.
   *
   * @param userId Authenticated user identifier.
   * @param sessionId Refresh-token session identifier.
   * @returns Session revocation confirmation.
   * @throws NotFoundException when the session is missing, expired, revoked,
   * or belongs to another user.
   */
  async revokeSession(userId: string, sessionId: string) {
    const now = new Date();

    const result = await this.prisma.refreshToken.updateMany({
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
      },
    });

    if (result.count !== 1) {
      throw new NotFoundException(SESSION_NOT_FOUND_MESSAGE);
    }

    return {
      message: 'Authentication session revoked successfully.',
      sessionId,
    };
  }

  /**
   * Revokes every currently active authentication session owned by the user.
   *
   * @param userId Authenticated user identifier.
   * @returns Number of sessions revoked by the operation.
   */
  async revokeAllSessions(userId: string) {
    const now = new Date();

    const result = await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: {
          gt: now,
        },
      },
      data: {
        revokedAt: now,
      },
    });

    return {
      message: 'All authentication sessions revoked successfully.',
      revokedSessionsCount: result.count,
    };
  }

  /**
   * Produces a short display label without persisting additional device data.
   *
   * @param userAgent Raw request user-agent value stored with the refresh token.
   * @returns Human-readable device label.
   */
  private buildDeviceLabel(userAgent: string | null): string {
    if (!userAgent) {
      return 'Unknown device';
    }

    const platform = /Android/i.test(userAgent)
      ? 'Android'
      : /iPhone|iPad|iPod/i.test(userAgent)
        ? 'iOS'
        : /Windows/i.test(userAgent)
          ? 'Windows'
          : /Macintosh|Mac OS X/i.test(userAgent)
            ? 'macOS'
            : /Linux/i.test(userAgent)
              ? 'Linux'
              : 'Unknown OS';

    const browser = /Edg\//i.test(userAgent)
      ? 'Edge'
      : /OPR\//i.test(userAgent)
        ? 'Opera'
        : /Chrome\//i.test(userAgent)
          ? 'Chrome'
          : /Firefox\//i.test(userAgent)
            ? 'Firefox'
            : /Safari\//i.test(userAgent)
              ? 'Safari'
              : 'Unknown browser';

    return `${browser} on ${platform}`;
  }
}