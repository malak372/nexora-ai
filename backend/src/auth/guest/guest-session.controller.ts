/**
 * Guest session controller.
 *
 * Creates or restores the secure session required before a guest
 * starts the free idea-generation flow.
 *
 * The generated guest-session token is stored exclusively inside
 * an HTTP-only cookie and is never returned to the frontend body.
 *
 * Responsibilities:
 * - Read limited request information for fingerprint generation.
 * - Create or restore the current guest session.
 * - Store the session token inside a secure HTTP-only cookie.
 * - Return only safe session information to the frontend.
 *
 * The controller does not:
 * - Generate ideas.
 * - Consume the guest generation entitlement.
 * - Transfer guest ideas to registered users.
 * - Expose the raw guest-session token in the response body.
 *
 * Base route:
 * /auth/guest-session
 *
 * @author Eman
 */

import {
    Controller,
    HttpCode,
    HttpStatus,
    Post,
    Req,
    Res,
} from '@nestjs/common';

import { Throttle } from '@nestjs/throttler';

import type {
    CookieOptions,
    Request,
    Response,
} from 'express';

import {
    GUEST_SESSION_COOKIE_NAME,
    GUEST_SESSION_LIFETIME_DAYS,
} from '../../utilities/constants/guest-session.constants';

import { GuestSessionService } from './guest-session.service';

/**
 * Maximum number of guest-session requests allowed
 * during one throttling window.
 */
const GUEST_SESSION_RATE_LIMIT = 10;

/**
 * Guest-session throttling window in milliseconds.
 */
const GUEST_SESSION_RATE_LIMIT_TTL_MS = 60_000;

/**
 * Number of milliseconds in one day.
 */
const MILLISECONDS_PER_DAY =
    24 * 60 * 60 * 1000;

/**
 * Secure options used by the guest-session cookie.
 *
 * The cookie:
 * - Cannot be read by frontend JavaScript.
 * - Is sent only over HTTPS in production.
 * - Supports normal same-site frontend/backend navigation.
 * - Is available across the complete application.
 */
const GUEST_SESSION_COOKIE_OPTIONS: CookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite:
      process.env.NODE_ENV === 'production'
        ? 'none'
        : 'lax',
    path: '/',
    maxAge:
        GUEST_SESSION_LIFETIME_DAYS *
        MILLISECONDS_PER_DAY,
};

/**
 * Safe guest-session response returned to the frontend.
 *
 * The raw session token is intentionally excluded.
 */
type GuestSessionResponse = {
    /**
     * Indicates whether the current guest has already generated
     * the single available guest idea.
     */
    hasGenerated: boolean;

    /**
     * Guest-session expiration time.
     */
    expiresAt: Date | null;
};

/**
 * Controller responsible for guest-session initialization.
 *
 * The frontend should call this endpoint before requesting
 * guest idea generation.
 */
@Controller('auth/guest-session')
export class GuestSessionController {
    constructor(
        private readonly guestSessionService: GuestSessionService,
    ) { }

    /**
     * Creates or restores the current guest session.
     *
     * Endpoint:
     * POST /auth/guest-session
     *
     * Rate limit:
     * - 10 requests per minute.
     *
     * The session token is stored in an HTTP-only cookie.
     * Only hasGenerated and expiresAt are returned to the frontend.
     *
     * @param request Current Express request.
     * @param response Express response used to set the cookie.
     * @returns Safe guest-session information.
     */
    @Post()
    @HttpCode(HttpStatus.OK)
    @Throttle({
        default: {
            limit: GUEST_SESSION_RATE_LIMIT,
            ttl: GUEST_SESSION_RATE_LIMIT_TTL_MS,
        },
    })
    async createOrRestoreSession(
        @Req() request: Request,
        @Res({ passthrough: true }) response: Response,
    ): Promise<GuestSessionResponse> {
        const session =
            await this.guestSessionService.createOrReuse({
                ipAddress: request.ip,
                userAgent: request.headers['user-agent'],
            });

        response.cookie(
            GUEST_SESSION_COOKIE_NAME,
            session.sessionToken,
            {
                ...GUEST_SESSION_COOKIE_OPTIONS,

                /**
                 * Uses the database expiration date when available.
                 *
                 * This keeps the browser cookie expiration synchronized
                 * with the stored guest-session expiration.
                 */
                expires:
                    session.expiresAt ??
                    this.createFallbackExpirationDate(),
            },
        );

        return {
            hasGenerated: session.hasGenerated,
            expiresAt: session.expiresAt,
        };
    }

    /**
     * Creates a fallback cookie expiration date.
     *
     * This is used only if an older database record does not have
     * an expiresAt value.
     *
     * @returns Guest cookie expiration date.
     */
    private createFallbackExpirationDate(): Date {
        return new Date(
            Date.now() +
            GUEST_SESSION_LIFETIME_DAYS *
            MILLISECONDS_PER_DAY,
        );
    }
}