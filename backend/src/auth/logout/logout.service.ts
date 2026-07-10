import { Injectable } from '@nestjs/common';
import { AuthAction } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { RefreshDto } from '../dto/refresh.dto';
import { AuthTokenService } from '../token/token.service';
import { AuthAuditService, AuthRequestMeta } from '../audit/audit.service';

/**
 * Service responsible for logout operations.
 *
 * Handles revoking refresh tokens and recording logout
 * audit logs when a valid active refresh token is found.
 *
 * @author Eman
 */
@Injectable()
export class AuthLogoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authTokenService: AuthTokenService,
    private readonly authAuditService: AuthAuditService,
  ) {}

  /**
   * Logs out the user by revoking the provided refresh token.
   *
   * If the refresh token belongs to an active session, the token
   * is revoked and a logout audit log is recorded for the user.
   *
   * @param dto Logout request containing the refresh token.
   * @param meta Optional request metadata such as IP address and user agent.
   * @returns Logout confirmation message.
   */
  async logout(dto: RefreshDto, meta?: AuthRequestMeta) {
    const tokenHash = this.authTokenService.hashToken(dto.refreshToken);

    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    await this.prisma.refreshToken.updateMany({
      where: {
        tokenHash,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    if (storedToken && !storedToken.revokedAt) {
      await this.authAuditService.createLog({
        userId: storedToken.user.id,
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
