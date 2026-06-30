import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { RefreshDto } from '../dto/refresh.dto';
import { AuthTokenService } from './auth-token.service';

/**
 * Service responsible for logout operations.
 *
 * Handles revoking refresh tokens so they can no longer
 * be used to generate new access tokens.
 *
 * @author Eman
 */
@Injectable()
export class AuthLogoutService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly authTokenService: AuthTokenService,
    ) { }

    /**
     * Logs out the user by revoking the provided refresh token.
     *
     * @param dto - Logout request containing the refresh token.
     * @returns Logout confirmation message.
     */
    async logout(dto: RefreshDto) {
        const tokenHash = this.authTokenService.hashToken(dto.refreshToken);

        await this.prisma.refreshToken.updateMany({
            where: {
                tokenHash,
                revokedAt: null,
            },
            data: {
                revokedAt: new Date(),
            },
        });

        return {
            message: 'Logged out successfully',
        };
    }
}