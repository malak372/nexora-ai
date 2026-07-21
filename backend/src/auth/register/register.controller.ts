import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';

import { GUEST_SESSION_COOKIE_NAME } from '../../utilities/constants/guest-session.constants';

import { RegisterDto } from '../dto/register.dto';

import { AuthRegisterService } from './register.service';

const REGISTER_RATE_LIMIT_TTL_MS = 60_000;

const GUEST_SESSION_CLEAR_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
};

/**
 * Controller responsible for user registration.
 *
 * Registers new users and transfers eligible guest-owned
 * activity when a guest-session cookie is available.
 *
 * Base route:
 * /auth/register
 *
 * @author Eman
 */
@Controller('auth/register')
export class RegisterController {
  constructor(private readonly authRegisterService: AuthRegisterService) {}

  /**
   * Registers a new user and transfers guest-owned activity
   * when a valid guest-session cookie exists.
   *
   * Rate limit:
   * - 3 requests per minute.
   *
   * Endpoint:
   * POST /auth/register
   *
   * @param dto - User registration data.
   * @param request - Current HTTP request.
   * @param response - HTTP response used to clear the guest cookie.
   * @returns Registration result and transferred-activity summary.
   */
  @Post()
  @Throttle({
    default: {
      limit: 3,
      ttl: REGISTER_RATE_LIMIT_TTL_MS,
    },
  })
  async register(
    @Body() dto: RegisterDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const guestSessionToken = this.readCookie(
      request,
      GUEST_SESSION_COOKIE_NAME,
    );

    const result = await this.authRegisterService.register(
      dto,
      {
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      },
      guestSessionToken,
    );

    if (result.attachedGuestIdeasCount > 0) {
      response.clearCookie(
        GUEST_SESSION_COOKIE_NAME,
        GUEST_SESSION_CLEAR_COOKIE_OPTIONS,
      );
    }

    return result;
  }

  /**
   * Safely reads one cookie from the raw Cookie header.
   *
   * Reading the raw header avoids relying on Express's loosely
   * typed `cookies` property and prevents strict ESLint
   * unsafe-assignment warnings.
   *
   * @param request - Current HTTP request.
   * @param cookieName - Name of the requested cookie.
   * @returns Decoded cookie value, or undefined when unavailable.
   */
  private readCookie(request: Request, cookieName: string): string | undefined {
    const rawCookieHeader = request.headers.cookie;

    if (!rawCookieHeader) {
      return undefined;
    }

    for (const cookiePart of rawCookieHeader.split(';')) {
      const separatorIndex = cookiePart.indexOf('=');

      if (separatorIndex < 0) {
        continue;
      }

      const name = cookiePart.slice(0, separatorIndex).trim();

      if (name !== cookieName) {
        continue;
      }

      const encodedValue = cookiePart.slice(separatorIndex + 1).trim();

      if (!encodedValue) {
        return undefined;
      }

      try {
        const decodedValue = decodeURIComponent(encodedValue).trim();

        return decodedValue || undefined;
      } catch {
        return undefined;
      }
    }

    return undefined;
  }
}
