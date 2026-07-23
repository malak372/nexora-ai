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
 * Metadata associated with a refresh-token session.
 *
 * This information is stored for security auditing and
 * session-management purposes.
 */
type RefreshTokenMeta = {
  /**
   * IP address from which the token session was created.
   */
  readonly ipAddress?: string;

  /**
   * User-agent string of the client that created the session.
   */
  readonly userAgent?: string;
};

/**
 * Service responsible for authentication-token operations.
 *
 * Responsibilities:
 * - Hash sensitive plain tokens before persistence.
 * - Generate signed JWT access tokens.
 * - Generate cryptographically secure refresh tokens.
 * - Persist refresh-token session records.
 * - Support atomic refresh-token rotation through Prisma transactions.
 *
 * Security considerations:
 * - Plain refresh tokens are never stored in the database.
 * - Refresh tokens are generated using cryptographically secure random bytes.
 * - Only SHA-256 hashes of refresh tokens are persisted.
 * - JWT access-token secrets are loaded from environment variables.
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
   * This method is used before storing or comparing:
   * - Refresh tokens.
   * - Password-reset tokens.
   * - Email-verification tokens.
   *
   * @param token - Plain token value.
   * @returns SHA-256 hexadecimal representation of the token.
   */
  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Generates a signed JWT access token.
   *
   * Only the user identifier is included in the custom JWT payload.
   * Current account information and authorization permissions are loaded
   * from the database by the JWT strategy for each protected request.
   *
   * The JWT implementation automatically adds standard claims such as:
   * - `iat`: Token issuance timestamp.
   * - `exp`: Token expiration timestamp.
   *
   * @param user - User identity required for the JWT payload.
   * @returns Signed JWT access token.
   * @throws Error when JWT_ACCESS_SECRET is not configured.
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
   * Generates and persists a secure refresh token.
   *
   * The generated plain token is returned to the client, while only
   * its SHA-256 hash is stored in the database.
   *
   * `lastUsedAt` is intentionally left null when the token is created.
   * A newly created refresh token has not been used yet, and setting
   * this field during creation may violate database date constraints
   * because PostgreSQL generates `createdAt` independently.
   *
   * The `lastUsedAt` value should only be updated when the refresh token
   * is actually used during a token-refresh operation.
   *
   * An optional Prisma transaction client can be supplied so refresh-token
   * rotation can revoke the previous token and create its replacement
   * atomically.
   *
   * @param userId - Identifier of the user who owns the session.
   * @param meta - Optional client IP address and user-agent metadata.
   * @param tx - Optional Prisma transaction client.
   * @returns Plain refresh token that should be returned to the client.
   */
  async generateRefreshToken(
    userId: string,
    meta?: RefreshTokenMeta,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const refreshToken = randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
    const tokenHash = this.hashToken(refreshToken);

    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt);

    expiresAt.setUTCDate(expiresAt.getUTCDate() + REFRESH_TOKEN_EXPIRES_DAYS);

    const client = tx ?? this.prisma;

    await client.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      },
    });

    return refreshToken;
  }
}
