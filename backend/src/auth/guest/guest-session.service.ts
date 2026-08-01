/**
 * Guest session management service.
 *
 * Responsible for creating or restoring a guest session before
 * the guest starts the free idea-generation flow.
 *
 * The session is identified through a secure random token stored
 * inside an HTTP-only cookie.
 *
 * A fingerprint hash is generated from limited request information
 * to reduce repeated guest-session creation attempts from the same
 * client after consuming the free guest generation.
 *
 * This service does not:
 * - Read or write cookies directly.
 * - Start idea generation.
 * - Consume the guest generation entitlement.
 * - Attach guest ideas to registered users.
 *
 * @author Eman
 */

import { Injectable } from '@nestjs/common';

import { createHash, randomBytes } from 'node:crypto';

import { PrismaService } from '../../prisma/prisma.service';

import { GUEST_SESSION_LIFETIME_DAYS } from '../../utilities/constants/guest-session.constants';

/**
 * Input required to create or restore a guest session.
 */
type CreateOrReuseGuestSessionInput = {
    /**
     * Client IP address resolved by Express.
     */
    ipAddress?: string;

    /**
     * Browser user-agent header.
     */
    userAgent?: string;
};

/**
 * Public guest-session result returned to the controller.
 *
 * Sensitive internal values such as fingerprintHash are not exposed.
 */
type GuestSessionResult = {
    /**
     * Random public token stored in the guest-session cookie.
     */
    sessionToken: string;

    /**
     * Indicates whether the guest already used the free generation.
     */
    hasGenerated: boolean;

    /**
     * Guest-session expiration date.
     */
    expiresAt: Date | null;
};

/**
 * Creates and restores guest sessions.
 *
 * The service reuses an existing non-expired session associated
 * with the same fingerprint. An expired session receives a new
 * token and a new expiration date.
 */
@Injectable()
export class GuestSessionService {
    constructor(
        private readonly prisma: PrismaService,
    ) { }

    /**
     * Creates a new guest session or restores the existing valid session.
     *
     * Reusing the existing session preserves hasGenerated. This prevents
     * a guest who already generated an idea from refreshing the page and
     * receiving another free generation.
     *
     * When the existing session is expired, its token and expiration date
     * are renewed. The hasGenerated value is intentionally preserved.
     *
     * @param input Limited client request information.
     * @returns Guest-session cookie information.
     */
    async createOrReuse(
        input: CreateOrReuseGuestSessionInput,
    ): Promise<GuestSessionResult> {
        const fingerprintHash = this.createFingerprintHash(input);

        const existingSession =
            await this.prisma.guestSession.findUnique({
                where: {
                    fingerprintHash,
                },
                select: {
                    sessionToken: true,
                    hasGenerated: true,
                    expiresAt: true,
                },
            });

        const now = new Date();

        if (
            existingSession &&
            !this.isExpired(existingSession.expiresAt, now)
        ) {
            return existingSession;
        }

        const expiresAt = this.createExpirationDate(now);
        const sessionToken = this.createSessionToken();

        if (existingSession) {
            return this.prisma.guestSession.update({
                where: {
                    fingerprintHash,
                },
                data: {
                    sessionToken,
                    expiresAt,
                },
                select: {
                    sessionToken: true,
                    hasGenerated: true,
                    expiresAt: true,
                },
            });
        }

        return this.prisma.guestSession.create({
            data: {
                fingerprintHash,
                sessionToken,
                expiresAt,
            },
            select: {
                sessionToken: true,
                hasGenerated: true,
                expiresAt: true,
            },
        });
    }

    /**
     * Creates a one-way fingerprint hash from limited request data.
     *
     * This is not treated as an authentication credential. It is used
     * only to reduce repeated creation of guest sessions from the same
     * browser and network combination.
     *
     * @param input Client request information.
     * @returns SHA-256 fingerprint hash.
     */
    private createFingerprintHash(
        input: CreateOrReuseGuestSessionInput,
    ): string {
        const normalizedIpAddress =
            input.ipAddress?.trim() || 'unknown-ip';

        const normalizedUserAgent =
            input.userAgent?.trim() || 'unknown-user-agent';

        return createHash('sha256')
            .update(
                `${normalizedIpAddress}|${normalizedUserAgent}`,
                'utf8',
            )
            .digest('hex');
    }

    /**
     * Creates a cryptographically secure public guest-session token.
     *
     * @returns Random hexadecimal session token.
     */
    private createSessionToken(): string {
        return randomBytes(32).toString('hex');
    }

    /**
     * Calculates the guest-session expiration date.
     *
     * @param baseDate Date from which the lifetime is calculated.
     * @returns Calculated expiration date.
     */
    private createExpirationDate(
        baseDate: Date,
    ): Date {
        const expiresAt = new Date(baseDate);

        expiresAt.setDate(
            expiresAt.getDate() +
            GUEST_SESSION_LIFETIME_DAYS,
        );

        return expiresAt;
    }

    /**
     * Determines whether a guest session has expired.
     *
     * A null expiration value is treated as non-expired to remain
     * compatible with existing guest-session records.
     *
     * @param expiresAt Stored guest-session expiration date.
     * @param now Current date.
     * @returns True when the session is expired.
     */
    private isExpired(
        expiresAt: Date | null,
        now: Date,
    ): boolean {
        return Boolean(
            expiresAt &&
            expiresAt.getTime() <= now.getTime(),
        );
    }
}