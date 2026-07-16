import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthAction } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import { AuthAuditService } from '../audit/audit.service';
import type { AuthRequestMeta } from '../audit/audit.service';
import { RefreshDto } from '../dto/refresh.dto';
import { AuthTokenService } from '../token/token.service';

const INVALID_REFRESH_TOKEN_MESSAGE = 'Invalid refresh token';

/**
 * Service responsible for refresh-token operations.
 *
 * Handles:
 * - Refresh-token validation.
 * - Revocation and expiration checks.
 * - Account availability checks.
 * - One-time refresh-token consumption.
 * - Refresh-token rotation.
 * - Access-token generation.
 * - Authentication audit logging.
 *
 * @author Eman
 */
@Injectable()
export class AuthRefreshService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authTokenService: AuthTokenService,
    private readonly authAuditService: AuthAuditService,
  ) { }

  /**
   * Rotates a valid refresh token and returns a new token pair.
   *
   * The provided refresh token can be consumed only once.
   * Reusing an expired, revoked, unknown, or concurrently consumed
   * refresh token results in an unauthorized response.
   *
   * @param dto - Refresh-token request data.
   * @param meta - Optional request metadata.
   * @returns Newly generated access and refresh tokens.
   *
   * @throws UnauthorizedException when token rotation fails.
   */
  async refresh(dto: RefreshDto, meta?: AuthRequestMeta) {
    const tokenHash =
      this.authTokenService.hashToken(dto.refreshToken);

    const storedToken =
      await this.prisma.refreshToken.findUnique({
        where: {
          tokenHash,
        },
        select: {
          id: true,
          userId: true,
          expiresAt: true,
          revokedAt: true,
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              role: true,
              accountStatus: true,
              userType: true,
              freeGenerationLimit: true,
              freeGenerationsUsed: true,
              creditBalance: true,
              isActive: true,
              isVerified: true,
              deletedAt: true,
            },
          },
        },
      });

    if (!storedToken) {
      await this.logFailedRefresh(
        'Refresh token was not found',
        meta,
      );

      throw new UnauthorizedException(
        INVALID_REFRESH_TOKEN_MESSAGE,
      );
    }

    const now = new Date();

    if (storedToken.revokedAt) {
      await this.logFailedRefresh(
        'Refresh token was already revoked',
        meta,
        storedToken.userId,
        storedToken.user.email,
      );

      throw new UnauthorizedException(
        INVALID_REFRESH_TOKEN_MESSAGE,
      );
    }

    if (storedToken.expiresAt <= now) {
      await this.logFailedRefresh(
        'Refresh token has expired',
        meta,
        storedToken.userId,
        storedToken.user.email,
      );

      throw new UnauthorizedException(
        INVALID_REFRESH_TOKEN_MESSAGE,
      );
    }

    if (
      !storedToken.user.isActive ||
      !storedToken.user.isVerified ||
      storedToken.user.deletedAt
    ) {
      await this.logFailedRefresh(
        'Associated account is inactive, unverified, or deleted',
        meta,
        storedToken.userId,
        storedToken.user.email,
      );

      throw new UnauthorizedException(
        INVALID_REFRESH_TOKEN_MESSAGE,
      );
    }

    /**
     * Atomically consumes the current refresh token.
     *
     * The revokedAt condition ensures that if concurrent requests
     * attempt to use the same token, only one request succeeds.
     */
    const revocationResult =
      await this.prisma.refreshToken.updateMany({
        where: {
          id: storedToken.id,
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
      await this.logFailedRefresh(
        'Refresh token was concurrently consumed or became invalid',
        meta,
        storedToken.userId,
        storedToken.user.email,
      );

      throw new UnauthorizedException(
        INVALID_REFRESH_TOKEN_MESSAGE,
      );
    }

    const accessToken =
      await this.authTokenService.generateAccessToken(
        storedToken.user,
      );

    const refreshToken =
      await this.authTokenService.generateRefreshToken(
        storedToken.userId,
        meta,
      );

    await this.authAuditService.createLog({
      userId: storedToken.userId,
      email: storedToken.user.email,
      action: AuthAction.REFRESH_TOKEN,
      isSuccess: true,
      message: 'Refresh token rotated successfully',
      ...meta,
    });

    return {
      accessToken,
      refreshToken,
    };
  }

  /**
   * Records a failed refresh-token operation.
   */
  private async logFailedRefresh(
    message: string,
    meta?: AuthRequestMeta,
    userId?: string,
    email?: string,
  ): Promise<void> {
    await this.authAuditService.createLog({
      userId,
      email,
      action: AuthAction.REFRESH_TOKEN_FAILED,
      isSuccess: false,
      message,
      ...meta,
    });
  }
}
