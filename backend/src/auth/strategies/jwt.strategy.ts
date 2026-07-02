import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { AccountStatus, UserRole, UserType } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';

type JwtPayload = {
  sub: string;
  email: string;
  role: UserRole;
  accountStatus: AccountStatus;
  userType?: UserType | null;
};

/**
 * JWT authentication strategy.
 *
 * Validates JWT access tokens extracted from the Authorization
 * header and attaches the authenticated user's identity,
 * authorization information, and account details to the
 * current request.
 *
 * @author Eman
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    const secret = process.env.JWT_ACCESS_SECRET;

    if (!secret) {
      throw new Error('JWT_ACCESS_SECRET is not configured');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  /**
   * Validates the decoded JWT payload.
   *
   * Retrieves the authenticated user from the database and
   * ensures the account exists and is active before attaching
   * the authenticated user information to the request object.
   *
   * The attached user object contains identity information,
   * authorization data, account status, and user type for use
   * throughout protected endpoints.
   *
   * @param payload Decoded JWT payload.
   * @returns Authenticated user information attached to the request.
   *
   * @throws UnauthorizedException if the user does not exist
   * or the account is inactive.
   */
  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        accountStatus: true,
        userType: true,
        isActive: true,
        isVerified: true,
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User is not active or does not exist');
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
}