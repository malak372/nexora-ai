import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

import { Prisma } from '@prisma/client';

import { createHash, randomUUID } from 'crypto';

import type { Request, Response } from 'express';

import { PrismaService } from '../../prisma/prisma.service';

import {
  GUEST_SESSION_COOKIE_NAME,
  GUEST_SESSION_LIFETIME_DAYS,
} from '../../utilities/constants/guest-session.constants';

/**
 * Manages one-generation guest sessions.
 *
 * Security:
 * - The public session token is stored in an HTTP-only cookie.
 * - A one-way fingerprint hash reduces repeated guest-session abuse.
 * - Guest entitlement is consumed atomically during idea persistence.
 *
 * The fingerprint is an abuse-reduction mechanism only. It is not
 * authenticated identity and must not be used for account ownership.
 *
 * @author Malak
 */
@Injectable()
export class GuestIdeaSessionService {
  private readonly fingerprintSecret: string;

  constructor(
    private readonly prisma: PrismaService,

    configService: ConfigService,
  ) {
    const configuredSecret = configService
      .get<string>('GUEST_SESSION_FINGERPRINT_SECRET')
      ?.trim();

    if (!configuredSecret) {
      throw new Error('GUEST_SESSION_FINGERPRINT_SECRET is required.');
    }

    this.fingerprintSecret = configuredSecret;
  }

  /**
   * Resolves the current usable guest session or creates one.
   */
  async resolveOrCreate(request: Request, response: Response) {
    const existingToken = this.readCookie(request, GUEST_SESSION_COOKIE_NAME);

    if (existingToken) {
      const existingSession = await this.prisma.guestSession.findUnique({
        where: {
          sessionToken: existingToken,
        },
      });

      if (existingSession) {
        this.assertUsable(existingSession);

        return existingSession;
      }
    }

    const fingerprintHash = this.buildFingerprintHash(request);

    const previousSession = await this.prisma.guestSession.findUnique({
      where: {
        fingerprintHash,
      },
    });

    if (previousSession) {
      this.writeCookie(
        response,
        previousSession.sessionToken,
        previousSession.expiresAt,
      );

      this.assertUsable(previousSession);

      return previousSession;
    }

    const expiresAt = new Date();

    expiresAt.setDate(expiresAt.getDate() + GUEST_SESSION_LIFETIME_DAYS);

    try {
      const session = await this.prisma.guestSession.create({
        data: {
          sessionToken: randomUUID(),

          fingerprintHash,

          expiresAt,
        },
      });

      this.writeCookie(response, session.sessionToken, session.expiresAt);

      return session;
    } catch (error: unknown) {
      /**
       * A concurrent request may have created the same unique
       * fingerprint before this request completed.
       */
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      ) {
        throw error;
      }

      const concurrentSession = await this.prisma.guestSession.findUnique({
        where: {
          fingerprintHash,
        },
      });

      if (!concurrentSession) {
        throw error;
      }

      this.writeCookie(
        response,
        concurrentSession.sessionToken,
        concurrentSession.expiresAt,
      );

      this.assertUsable(concurrentSession);

      return concurrentSession;
    }
  }

  /**
   * Atomically consumes the guest's single generation.
   *
   * This operation participates in the Idea persistence transaction.
   */
  async consume(
    guestSessionId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const result = await tx.guestSession.updateMany({
      where: {
        id: guestSessionId,

        hasGenerated: false,

        OR: [
          {
            expiresAt: null,
          },

          {
            expiresAt: {
              gt: new Date(),
            },
          },
        ],
      },

      data: {
        hasGenerated: true,
      },
    });

    if (result.count === 0) {
      throw new ConflictException({
        code: 'GUEST_GENERATION_ALREADY_USED',

        message:
          'Guest generation was already consumed or the session expired.',
      });
    }
  }

  /**
   * Ensures that an existing guest session may still generate.
   */
  private assertUsable(session: {
    hasGenerated: boolean;
    expiresAt: Date | null;
  }): void {
    if (session.expiresAt !== null && session.expiresAt <= new Date()) {
      throw new NotFoundException('Guest session has expired.');
    }

    if (session.hasGenerated) {
      throw new ConflictException({
        code: 'GUEST_GENERATION_ALREADY_USED',

        message:
          'The free guest idea has already been generated. Register or log in to continue.',
      });
    }
  }

  /**
   * Builds a privacy-preserving one-way client fingerprint.
   */
  private buildFingerprintHash(request: Request): string {
    const forwardedFor = request.headers['x-forwarded-for'];

    const forwardedIp = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor?.split(',')[0]?.trim();

    const ipAddress =
      forwardedIp || request.ip || request.socket.remoteAddress || 'unknown';

    const userAgent = request.get('user-agent') ?? 'unknown';

    return createHash('sha256')
      .update([this.fingerprintSecret, ipAddress, userAgent].join('|'))
      .digest('hex');
  }

  /**
   * Safely reads one cookie directly from the raw Cookie header.
   *
   * This avoids using the cookie-parser `request.cookies` property,
   * which is typed as `any` under strict ESLint configuration.
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

  /**
   * Writes the guest token into a secure browser cookie.
   */
  private writeCookie(
    response: Response,
    token: string,
    expiresAt: Date | null,
  ): void {
    response.cookie(GUEST_SESSION_COOKIE_NAME, token, {
      httpOnly: true,

      secure: process.env.NODE_ENV === 'production',

      sameSite: 'lax',

      path: '/',

      expires: expiresAt ?? undefined,
    });
  }
}
