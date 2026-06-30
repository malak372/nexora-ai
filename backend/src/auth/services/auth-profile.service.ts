import { Injectable, UnauthorizedException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Service responsible for authenticated user profile operations.
 *
 * Provides functionality for retrieving the current
 * authenticated user's profile information.
 *
 * The returned data includes basic account information,
 * account status, usage limits, credit balance,
 * verification status, and account creation date.
 *
 * @author Eman
 */
@Injectable()
export class AuthProfileService {
    constructor(private readonly prisma: PrismaService) { }

    /**
     * Retrieves the authenticated user's profile.
     *
     * Only non-sensitive account information is returned.
     * Password hashes, authentication tokens, and other
     * confidential data are intentionally excluded.
     *
     * @param userId - Authenticated user's ID.
     * @returns User profile information.
     *
     * @throws UnauthorizedException if the user does not exist.
     */
    async me(userId: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                fullName: true,
                email: true,
                role: true,
                accountStatus: true,
                freeGenerationLimit: true,
                freeGenerationsUsed: true,
                creditBalance: true,
                isActive: true,
                isVerified: true,
                createdAt: true,
            },
        });

        if (!user) {
            throw new UnauthorizedException('User not found');
        }

        return user;
    }
}