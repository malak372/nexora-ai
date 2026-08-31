import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Prisma } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Minimal payload required from an access token.
 *
 * `iat` is automatically added by JWT and represents
 * the token-issuance time in Unix seconds.
 */
type JwtPayload = {
  readonly sub: string;
  readonly iat?: number;
};

/**
 * JWT authentication strategy.
 *
 * Validates JWT access tokens extracted from the Authorization
 * header and loads the latest authenticated-user information
 * directly from the database.
 *
 * @author Eman
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(private readonly prisma: PrismaService) {
    const accessTokenSecret = process.env.JWT_ACCESS_SECRET?.trim();

    if (!accessTokenSecret) {
      throw new Error('JWT_ACCESS_SECRET is not configured');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: accessTokenSecret,
    });
  }

  /**
   * Validates the decoded JWT payload.
   *
   * Authentication succeeds only when:
   * - The referenced user exists.
   * - The account is active.
   * - The email is verified.
   * - The account has not been soft-deleted.
   * - The token was issued after the latest password change.
   *
   * The returned object is attached to `request.user`.
   *
   * @param payload - Decoded JWT access-token payload.
   * @returns Current authenticated-user information.
   *
   * @throws UnauthorizedException when authentication fails.
   */
  async validate(payload: JwtPayload) {
    if (!payload.sub) {
      throw new UnauthorizedException('Unauthorized');
    }

    const loadUser = () =>
      this.prisma.user.findUnique({
        where: {
          id: payload.sub,
        },
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          accountStatus: true,
          userType: true,
          isActive: true,
          isVerified: true,
          deletedAt: true,
          passwordChangedAt: true,
        },
      });

    let user: Awaited<ReturnType<typeof loadUser>>;

    try {
      user = await loadUser();
    } catch (error) {
      if (!this.isTransientDatabaseFailure(error)) {
        throw error;
      }

      this.logger.warn(
        'Transient database connectivity failure during JWT validation; attempting one bounded Prisma reconnect before failing the request.',
      );

      try {
        await this.prisma.recoverConnection(error);
        user = await loadUser();
      } catch (retryError) {
        if (!this.isTransientDatabaseFailure(retryError)) {
          throw retryError;
        }

        throw new ServiceUnavailableException(
          'Authentication service is temporarily unavailable. Please retry shortly.',
        );
      }
    }

    if (!user || !user.isActive || !user.isVerified || user.deletedAt) {
      throw new UnauthorizedException('Unauthorized');
    }

    if (
      user.passwordChangedAt &&
      this.wasIssuedBeforePasswordChange(payload.iat, user.passwordChangedAt)
    ) {
      throw new UnauthorizedException('Unauthorized');
    }

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      accountStatus: user.accountStatus,
      userType: user.userType,
      isActive: user.isActive,
      isVerified: user.isVerified,
    };
  }

  private isTransientDatabaseFailure(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return ['P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(
        error.code,
      );
    }

    if (error instanceof Prisma.PrismaClientInitializationError) {
      return ['P1001', 'P1002', 'P1017'].includes(error.errorCode ?? '');
    }

    const message =
      error instanceof Error
        ? error.message.toLocaleLowerCase()
        : String(error).toLocaleLowerCase();

    return /can't reach database server|connection (?:closed|reset|refused)|connection pool|timed out fetching a new connection|socket hang up|econnreset|econnrefused|engine is not yet connected/iu.test(
      message,
    );
  }

  /**
   * Determines whether an access token was created before
   * the user's most recent password change.
   */
  private wasIssuedBeforePasswordChange(
    issuedAtSeconds: number | undefined,
    passwordChangedAt: Date,
  ): boolean {
    if (issuedAtSeconds === undefined) {
      return true;
    }

    const issuedAtMilliseconds = issuedAtSeconds * 1_000;

    return issuedAtMilliseconds < passwordChangedAt.getTime();
  }
}
