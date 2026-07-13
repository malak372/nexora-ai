import { Body, Controller, Post, Req, Res } from '@nestjs/common';

import type { Request, Response } from 'express';

import { GUEST_SESSION_COOKIE_NAME } from '../../utilities/constants/guest-session.constants';

import { RegisterDto } from '../dto/register.dto';

import { AuthRegisterService } from './register.service';

/**
 * Controller responsible for user registration.
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
   * POST /auth/register
   */
  @Post()
  async register(
    @Body()
    dto: RegisterDto,

    @Req()
    request: Request,

    @Res({
      passthrough: true,
    })
    response: Response,
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
      response.clearCookie(GUEST_SESSION_COOKIE_NAME, {
        httpOnly: true,

        secure: process.env.NODE_ENV === 'production',

        sameSite: 'lax',

        path: '/',
      });
    }

    return result;
  }

  /**
   * Safely reads one cookie directly from the Cookie header.
   *
   * Reading the raw header avoids relying on Express's `cookies`
   * property, which is typed as `any` by cookie-parser and can trigger
   * strict ESLint unsafe-assignment rules.
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
