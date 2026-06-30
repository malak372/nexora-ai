import { Injectable, UnauthorizedException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { RefreshDto } from '../dto/refresh.dto';
import { AuthTokenService } from './auth-token.service';

/**
 * Service responsible for refresh token operations.
 *
 * Handles:
 * - Validating refresh tokens.
 * - Checking token expiration and revocation status.
 * - Ensuring the associated user account is active.
 * - Rotating refresh tokens.
 * - Generating new JWT access tokens.
 *
 * Token rotation improves security by revoking the current
 * refresh token and issuing a new one each time a refresh
 * request succeeds.
 *
 * @author Eman
 */
@Injectable()
export class AuthRefreshService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly authTokenService: AuthTokenService,
    ) { }

    /**
     * Refreshes authentication tokens using a valid refresh token.
     *
     * This method validates that:
     * - The refresh token exists.
     * - The refresh token has not been revoked.
     * - The refresh token has not expired.
     * - The associated user account is active.
     *
     * After successful validation, the current refresh token is
     * revoked and a new access token and refresh token are issued.
     *
     * @param dto - Refresh token request.
     * @returns Newly generated access token and refresh token.
     *
     * @throws UnauthorizedException if the refresh token is invalid,
     * revoked, expired, or the associated account is inactive.
     */
    async refresh(dto: RefreshDto) {
        const tokenHash = this.authTokenService.hashToken(dto.refreshToken);

        const storedToken = await this.prisma.refreshToken.findUnique({
            where: { tokenHash },
            include: { user: true },
        });

        if (!storedToken) {
            throw new UnauthorizedException('Invalid refresh token');
        }

        if (storedToken.revokedAt) {
            throw new UnauthorizedException('Refresh token revoked');
        }

        if (storedToken.expiresAt < new Date()) {
            throw new UnauthorizedException('Refresh token expired');
        }

        if (!storedToken.user.isActive) {
            throw new UnauthorizedException('Account is inactive');
        }

        await this.prisma.refreshToken.update({
            where: { id: storedToken.id },
            data: {
                revokedAt: new Date(),
            },
        });

        const accessToken =
            await this.authTokenService.generateAccessToken(storedToken.user);

        const refreshToken =
            await this.authTokenService.generateRefreshToken(storedToken.user.id);

        return {
            accessToken,
            refreshToken,
        };
    }
}