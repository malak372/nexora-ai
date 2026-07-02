import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Service responsible for guest session operations.
 *
 * This service handles transferring guest-generated ideas
 * to a newly registered user account when the user registers
 * using a valid guest session token.
 *
 * @author Eman
 */
@Injectable()
export class AuthGuestService {
    constructor(private readonly prisma: PrismaService) { }

    /**
     * Transfers guest-generated ideas to a registered user account.
     *
     * If a guest user generated ideas before registration, this method:
     * - Finds the guest session using the provided session token.
     * - Transfers all ideas linked to the guest session to the new user.
     * - Removes the guest session reference from transferred ideas.
     * - Increments the user's used free generation count.
     * - Marks the guest session as already used for generation.
     *
     * If the guest session token is missing, invalid, or has no ideas,
     * no transfer is performed and the method returns 0.
     *
     * @param guestSessionToken Optional guest session token.
     * @param userId Newly registered user ID.
     * @returns Number of guest-generated ideas transferred to the user.
     */
    async attachGuestIdeasToUser(
        guestSessionToken: string | undefined,
        userId: string,
    ) {
        if (!guestSessionToken) {
            return 0;
        }

        const guestSession = await this.prisma.guestSession.findUnique({
            where: {
                sessionToken: guestSessionToken,
            },
            include: {
                ideas: true,
            },
        });

        if (!guestSession || guestSession.ideas.length === 0) {
            return 0;
        }

        const guestIdeasCount = guestSession.ideas.length;

        await this.prisma.$transaction([
            this.prisma.idea.updateMany({
                where: {
                    guestSessionId: guestSession.id,
                    userId: null,
                },
                data: {
                    userId,
                    guestSessionId: null,
                },
            }),

            this.prisma.user.update({
                where: { id: userId },
                data: {
                    freeGenerationsUsed: {
                        increment: guestIdeasCount,
                    },
                },
            }),

            this.prisma.guestSession.update({
                where: {
                    id: guestSession.id,
                },
                data: {
                    hasGenerated: true,
                },
            }),
        ]);

        return guestIdeasCount;
    }
}