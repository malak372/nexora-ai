import {
  Body,
  Controller,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

import { Throttle } from '@nestjs/throttler';

import type { Request } from 'express';

import { GUEST_SESSION_COOKIE_NAME } from '../../../utilities/constants/guest-session.constants';

import { GenerateGuestIdeaDto } from '../dto/generate-guest-idea.dto';

import { IdeaGenerationOrchestratorService } from '../services/idea-generation-orchestrator.service';

/**
 * Maximum number of guest-generation requests allowed during one
 * throttling window.
 *
 * @author Malak
 */
const GUEST_GENERATION_RATE_LIMIT = 3;

/**
 * Guest-generation throttling window in milliseconds.
 *
 * @author Malak
 */
const GUEST_GENERATION_RATE_LIMIT_TTL_MS =
  60_000;

/**
 * Controller responsible for starting guest idea generation.
 *
 * Base route:
 * /guest/ideas/generate
 *
 * The guest-session token is read exclusively from the secure
 * HTTP-only guest-session cookie. It must never be accepted from
 * the request body or query string.
 *
 * Responsibilities:
 * - Validate the guest-generation request DTO.
 * - Read the guest-session token from the Cookie header.
 * - Reject requests without a valid cookie token.
 * - Delegate generation orchestration.
 *
 * The controller does not:
 * - Evaluate guest entitlement.
 * - Consume the guest generation.
 * - Select data sources.
 * - Execute AI generation directly.
 *
 * @author Malak
 */
@Controller('guest/ideas/generate')
export class GuestIdeaGenerationController {
  constructor(
    private readonly orchestrator:
      IdeaGenerationOrchestratorService,
  ) {}

  /**
   * Starts the single guest-free idea-generation workflow.
   *
   * Endpoint:
   * POST /guest/ideas/generate
   *
   * @param dto Validated guest-generation request.
   * @param request Current Express request.
   * @returns Completed idea-generation pipeline result.
   */
  @Post()
  @Throttle({
    default: {
      limit:
        GUEST_GENERATION_RATE_LIMIT,

      ttl:
        GUEST_GENERATION_RATE_LIMIT_TTL_MS,
    },
  })
  generateGuestIdea(
    @Body() dto: GenerateGuestIdeaDto,
    @Req() request: Request,
  ) {
    const guestSessionToken =
      this.readCookie(
        request,
        GUEST_SESSION_COOKIE_NAME,
      );

    if (!guestSessionToken) {
      throw new UnauthorizedException({
        code:
          'GUEST_SESSION_REQUIRED',

        message:
          'A valid guest session is required to generate a guest idea.',
      });
    }

    return this.orchestrator.generateForGuest({
      guestSessionToken,
      dto,
    });
  }

  /**
   * Reads one cookie safely from the raw Cookie header.
   *
   * Using the raw header avoids relying on an untyped
   * request.cookies property and prevents unsafe-assignment lint
   * warnings when cookie-parser types are not installed.
   *
   * @param request Current Express request.
   * @param cookieName Requested cookie name.
   * @returns Decoded cookie value or undefined.
   */
  private readCookie(
    request: Request,
    cookieName: string,
  ): string | undefined {
    const rawCookieHeader =
      request.headers.cookie;

    if (!rawCookieHeader) {
      return undefined;
    }

    for (
      const cookiePart of
      rawCookieHeader.split(';')
    ) {
      const separatorIndex =
        cookiePart.indexOf('=');

      if (separatorIndex < 0) {
        continue;
      }

      const name = cookiePart
        .slice(0, separatorIndex)
        .trim();

      if (name !== cookieName) {
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
          decodeURIComponent(
            encodedValue,
          ).trim();

        return (
          decodedValue || undefined
        );
      } catch {
        return undefined;
      }
    }

    return undefined;
  }
}