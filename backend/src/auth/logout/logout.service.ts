import { Injectable } from '@nestjs/common';
import { AuthAction } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import { AuthAuditService } from '../audit/audit.service';
import type { AuthRequestMeta } from '../audit/audit.service';
import { RefreshDto } from '../dto/refresh.dto';
import { AuthTokenService } from '../token/token.service';

/**
 * Service responsible for logout operations.
 *
 * Revokes refresh tokens and records a logout audit entry
 * when an active session is successfully revoked.
 *
 * Logout is idempotent: an invalid, unknown, or previously revoked
 * refresh token still returns a successful response.
 *
 * @author Eman
 */
@Injectable()
export class AuthLogoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authTokenService: AuthTokenService,
    private readonly authAuditService: AuthAuditService,
  ) { }

  /**
   * Logs out the user by revoking the provided refresh token.
   *
   * The operation always returns a successful response to avoid
   * exposing whether a refresh token exists in the database.
   *
   * @param dto - Logout request containing the refresh token.
   * @param meta - Optional request metadata.
   * @returns Logout confirmation message.
   */
  async logout(dto: RefreshDto, meta?: AuthRequestMeta) {
    const tokenHash = this.authTokenService.hashToken(dto.refreshToken);

    const storedToken = await this.prisma.refreshToken.findUnique({
      where: {
        tokenHash,
      },
      select: {
        userId: true,
        revokedAt: true,
        user: {
          select: {
            email: true,
          },
        },
      },
    });

    const revocationResult = await this.prisma.refreshToken.updateMany({
      where: {
        tokenHash,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    /**
     * Record a logout only when this request actually revoked
     * an active refresh token.
     */
    if (storedToken && revocationResult.count === 1) {
      await this.authAuditService.createLog({
        userId: storedToken.userId,
        email: storedToken.user.email,
        action: AuthAction.LOGOUT,
        isSuccess: true,
        message: 'User logged out successfully',
        ...meta,
      });
    }

    return {
      message: 'Logged out successfully',
    };
  }
}
