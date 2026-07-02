import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthAction } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { RefreshDto } from '../dto/refresh.dto';
import { AuthTokenService } from '../token/token.service';
import {
    AuthAuditService,
    AuthRequestMeta,
} from '../audit/audit.service';

/**
 * Service responsible for refresh token operations.
 *
 * Handles refresh token validation, revocation checks,
 * expiration checks, account activity checks, refresh token
 * rotation, access token generation, and authentication
 * audit logging.
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
     * Refreshes authentication tokens using a valid refresh token.
     *
     * Records successful refresh token rotations and failed refresh
     * attempts in the authentication audit logs.
     *
     * @param dto Refresh token request data.
     * @param meta Optional request metadata such as IP address and user agent.
     * @returns Newly generated access token and refresh token.
     *
     * @throws UnauthorizedException if the refresh token is invalid,
     * revoked, expired, or the associated account is inactive or not verified.
     */
    async refresh(dto: RefreshDto, meta?: AuthRequestMeta) {
        const tokenHash = this.authTokenService.hashToken(dto.refreshToken);

        const storedToken = await this.prisma.refreshToken.findUnique({
            where: { tokenHash },
            include: { user: true },
        });

        if (!storedToken) {
            await this.authAuditService.createLog({
                action: AuthAction.REFRESH_TOKEN_FAILED,
                isSuccess: false,
                message: 'Invalid refresh token',
                ...meta,
            });

            throw new UnauthorizedException('Invalid refresh token');
        }

        if (storedToken.revokedAt) {
            await this.authAuditService.createLog({
                userId: storedToken.user.id,
                email: storedToken.user.email,
                action: AuthAction.REFRESH_TOKEN_FAILED,
                isSuccess: false,
                message: 'Refresh token revoked',
                ...meta,
            });

            throw new UnauthorizedException('Refresh token revoked');
        }

        if (storedToken.expiresAt < new Date()) {
            await this.authAuditService.createLog({
                userId: storedToken.user.id,
                email: storedToken.user.email,
                action: AuthAction.REFRESH_TOKEN_FAILED,
                isSuccess: false,
                message: 'Refresh token expired',
                ...meta,
            });

            throw new UnauthorizedException('Refresh token expired');
        }

        if (!storedToken.user.isActive || !storedToken.user.isVerified) {
            await this.authAuditService.createLog({
                userId: storedToken.user.id,
                email: storedToken.user.email,
                action: AuthAction.REFRESH_TOKEN_FAILED,
                isSuccess: false,
                message: 'Account is inactive or not verified',
                ...meta,
            });

            throw new UnauthorizedException('Account is inactive or not verified');
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

        await this.authAuditService.createLog({
            userId: storedToken.user.id,
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
}