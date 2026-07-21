import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import type { StringValue } from 'ms';

import { PrismaService } from '../../prisma/prisma.service';

const REFRESH_TOKEN_BYTES = 64;
const REFRESH_TOKEN_EXPIRES_DAYS = 30;

const DEFAULT_ACCESS_TOKEN_EXPIRES_IN: StringValue = '15m';

/**
 * Metadata stored with a refresh-token session.
 */
type RefreshTokenMeta = {
  readonly ipAddress?: string;
  readonly userAgent?: string;
};

/**
 * Service responsible for authentication-token operations.
 *
 * Handles:
 * - Hashing sensitive plain tokens.
 * - Generating signed JWT access tokens.
 * - Generating secure refresh tokens.
 * - Persisting refresh-token session records.
 *
 * @author Eman
 */
@Injectable()
export class AuthTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Hashes a plain token using SHA-256.
   *
   * Used before storing or comparing refresh tokens,
   * password-reset tokens, and email-verification tokens.
   *
   * @param token - Plain token value.
   * @returns SHA-256 hexadecimal token hash.
   */
  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Generates a signed JWT access token.
   *
   * Only the user identifier is stored in the custom payload.
   * Current account and authorization data are loaded from the
   * database by JwtStrategy for every protected request.
   *
   * The JWT library automatically adds claims such as:
   * - iat: token issuance time.
   * - exp: token expiration time.
   *
   * @param user - User identity required for the JWT payload.
   * @returns Signed JWT access token.
   */
  async generateAccessToken(user: { readonly id: string }): Promise<string> {
    const accessTokenSecret = process.env.JWT_ACCESS_SECRET?.trim();

    if (!accessTokenSecret) {
      throw new Error('JWT_ACCESS_SECRET is not configured');
    }

    const expiresIn = (process.env.JWT_ACCESS_EXPIRES_IN?.trim() ||
      DEFAULT_ACCESS_TOKEN_EXPIRES_IN) as StringValue;

    return this.jwtService.signAsync(
      {
        sub: user.id,
      },
      {
        secret: accessTokenSecret,
        expiresIn,
      },
    );
  }

  /**
   * Generates and stores a secure refresh token.
   *
   * The plain token is returned to the client, while only its
   * SHA-256 hash is stored in the database.
   *
   * An optional Prisma transaction client may be supplied so
   * refresh-token rotation can revoke the old token and create
   * the replacement token atomically.
   *
   * @param userId - User who owns the refresh-token session.
   * @param meta - Optional client IP address and user agent.
   * @param tx - Optional existing Prisma transaction client.
   * @returns Plain refresh token sent to the client.
   */
  async generateRefreshToken(
    userId: string,
    meta?: RefreshTokenMeta,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const refreshToken = randomBytes(REFRESH_TOKEN_BYTES).toString('hex');

    const tokenHash = this.hashToken(refreshToken);

    const now = new Date();

    const expiresAt = new Date(now);
    expiresAt.setUTCDate(expiresAt.getUTCDate() + REFRESH_TOKEN_EXPIRES_DAYS);

    const client = tx ?? this.prisma;

    await client.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
        lastUsedAt: now,
      },
    });

    return refreshToken;
  }
}
