/**
 * Guest idea-generation runs controller.
 *
 * Provides a secure read-only endpoint that allows a guest to monitor
 * the generation run created by the current guest session.
 *
 * The guest-session token is read exclusively from the secure HTTP-only
 * cookie. The token is never accepted through route parameters, query
 * parameters, or the request body.
 *
 * Responsibilities:
 * - Read the current guest-session token from the cookie.
 * - Reject requests that do not contain a valid guest-session cookie.
 * - Return only a generation run owned by the current guest session.
 * - Support frontend polling while the generation pipeline is active.
 *
 * This controller does not:
 * - Start idea generation.
 * - Cancel generation.
 * - Modify generation stages.
 * - Expose AI benchmark candidates to guests.
 * - Expose another guest's generation run.
 *
 * Base route:
 * /guest/idea-generation-runs
 *
 * @author Eman
 */

import {
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    Req,
    UnauthorizedException,
} from '@nestjs/common';

import { Throttle } from '@nestjs/throttler';

import type { Request } from 'express';

import { GUEST_SESSION_COOKIE_NAME } from '../../../utilities/constants/guest-session.constants';

import { IdeaGenerationQueryService } from '../services/idea-generation-query.service';

/**
 * Maximum number of guest run-status requests allowed
 * during one throttling window.
 *
 * Polling occurs frequently while the generation pipeline is running,
 * so this limit is intentionally higher than the generation-start limit.
 */
const GUEST_RUN_STATUS_RATE_LIMIT = 60;

/**
 * Guest run-status throttling window in milliseconds.
 */
const GUEST_RUN_STATUS_RATE_LIMIT_TTL_MS = 60_000;

/**
 * Controller used by guests to monitor their idea-generation runs.
 */
@Controller('guest/idea-generation-runs')
export class GuestIdeaGenerationRunsController {
    constructor(
        private readonly ideaGenerationQueryService: IdeaGenerationQueryService,
    ) { }

    /**
     * Returns one generation run owned by the current guest session.
     *
     * Endpoint:
     * GET /guest/idea-generation-runs/:runId
     *
     * The frontend calls this endpoint repeatedly while the run is:
     * - QUEUED
     * - RUNNING
     * - RETRYING
     * - PAUSED
     *
     * Polling should stop when the run becomes:
     * - COMPLETED
     * - FAILED
     * - CANCELLED
     *
     * @param runId Idea-generation run identifier.
     * @param request Current Express request.
     * @returns Safe guest generation-run details.
     *
     * @throws UnauthorizedException When the guest cookie is missing.
     */
    @Get(':runId')
    @Throttle({
        default: {
            limit: GUEST_RUN_STATUS_RATE_LIMIT,
            ttl: GUEST_RUN_STATUS_RATE_LIMIT_TTL_MS,
        },
    })
    getGuestGenerationRun(
        @Param('runId', new ParseUUIDPipe()) runId: string,
        @Req() request: Request,
    ) {
        const guestSessionToken = this.readCookie(
            request,
            GUEST_SESSION_COOKIE_NAME,
        );

        if (!guestSessionToken) {
            throw new UnauthorizedException({
                code: 'GUEST_SESSION_REQUIRED',
                message:
                    'A valid guest session is required to access this generation run.',
            });
        }

        return this.ideaGenerationQueryService.findOwnedGuestRun(
            guestSessionToken,
            runId,
        );
    }

    /**
     * Reads and decodes one cookie from the raw Cookie request header.
     *
     * Reading the raw header avoids depending on an untyped
     * request.cookies property when cookie-parser types are unavailable.
     *
     * @param request Current Express request.
     * @param cookieName Name of the required cookie.
     * @returns Decoded cookie value, or undefined when unavailable.
     */
    private readCookie(
        request: Request,
        cookieName: string,
    ): string | undefined {
        const rawCookieHeader = request.headers.cookie;

        if (!rawCookieHeader) {
            return undefined;
        }

        for (const cookiePart of rawCookieHeader.split(';')) {
            const separatorIndex = cookiePart.indexOf('=');

            if (separatorIndex < 0) {
                continue;
            }

            const currentCookieName = cookiePart
                .slice(0, separatorIndex)
                .trim();

            if (currentCookieName !== cookieName) {
                continue;
            }

            const encodedValue = cookiePart
                .slice(separatorIndex + 1)
                .trim();

            if (!encodedValue) {
                return undefined;
            }

            try {
                const decodedValue =
                    decodeURIComponent(encodedValue).trim();

                return decodedValue || undefined;
            } catch {
                return undefined;
            }
        }

        return undefined;
    }
}