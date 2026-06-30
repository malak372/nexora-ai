import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AccountStatus, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes, createHash } from 'crypto';
import type { StringValue } from 'ms';

import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { MailService } from '../mail/mail.service';

/**
 * Service responsible for authentication and session management.
 *
 * Handles user registration, login, password changes,
 * JWT access token generation, refresh token creation
 * and rotation, logout, and retrieving the authenticated
 * user's profile.
 *
 * It also supports transferring guest-generated ideas to a newly
 * registered user account when a valid guest session token is provided.
 *
 * @author Eman
 */
const SALT_ROUNDS = 10;
const PASSWORD_RESET_TOKEN_BYTES = 32;
const PASSWORD_RESET_TOKEN_EXPIRES_MINUTES = 15;
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
  ) { }

  /**
   * Hashes a plain refresh token using SHA-256 before storing
   * or comparing it in the database.
   *
   * @param token - Plain refresh token.
   * @returns Hashed refresh token.
   */
  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Generates a signed JWT access token for the authenticated user.
   *
   * @param user - Authenticated user data required in the JWT payload.
   * @returns Signed access token.
   */
  private async generateAccessToken(user: {
    id: string;
    email: string;
    role: UserRole;
    accountStatus: AccountStatus;
  }) {
    return this.jwtService.signAsync(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        accountStatus: user.accountStatus,
      },
      {
        secret: process.env.JWT_ACCESS_SECRET,
        expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN || '15m') as StringValue,
      },
    );
  }

  /**
   * Generates a secure refresh token, stores its hash in the database,
   * and returns the plain token to the client.
   *
   * @param userId - ID of the user who owns the refresh token.
   * @returns Plain refresh token.
   */
  private async generateRefreshToken(userId: string) {
    const refreshToken = randomBytes(64).toString('hex');
    const tokenHash = this.hashToken(refreshToken);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
      },
    });

    return refreshToken;
  }

  /**
   * Transfers ideas generated as a Guest to a newly registered user.
   *
   * If a guest generated an idea before creating an account, this method:
   * - Finds the guest session by its session token.
   * - Attaches the guest-generated ideas to the new user account.
   * - Removes the guest session relation from the transferred ideas.
   * - Increments the user's used free generations count.
   * - Marks the guest session as having generated an idea.
   *
   * @param guestSessionToken - Optional guest session token sent during registration.
   * @param userId - Newly registered user ID.
   * @returns Number of guest ideas transferred to the user account.
   */
  private async attachGuestIdeasToUser(
    guestSessionToken: string | undefined,
    userId: string,
  ) {
    if (!guestSessionToken) {
      return 0;
    }

    const guestSession = await this.prisma.guestSession.findUnique({
      where: {
        sessionToken: guestSessionToken,
      },
      include: {
        ideas: true,
      },
    });

    if (!guestSession || guestSession.ideas.length === 0) {
      return 0;
    }

    const guestIdeasCount = guestSession.ideas.length;

    await this.prisma.$transaction([
      this.prisma.idea.updateMany({
        where: {
          guestSessionId: guestSession.id,
          userId: null,
        },
        data: {
          userId,
          guestSessionId: null,
        },
      }),

      this.prisma.user.update({
        where: { id: userId },
        data: {
          freeGenerationsUsed: {
            increment: guestIdeasCount,
          },
        },
      }),

      this.prisma.guestSession.update({
        where: {
          id: guestSession.id,
        },
        data: {
          hasGenerated: true,
        },
      }),
    ]);

    return guestIdeasCount;
  }

  /**
   * Registers a new user account.
   *
   * The method checks if the email is already used, hashes the password,
   * creates a USER account with NORMAL status, attaches any guest-generated
   * ideas if a guest session token is provided, then returns authentication
   * tokens and the registered user data.
   *
   * @param dto - Registration request data.
   * @returns Registration message, access token, refresh token, transferred guest ideas count, and user data.
   *
   * @throws BadRequestException if the email already exists.
   * @throws UnauthorizedException if the newly created user cannot be found.
   */
  async register(dto: RegisterDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new BadRequestException('Email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        fullName: dto.fullName,
        email: dto.email,
        passwordHash,
        role: UserRole.USER,
        accountStatus: AccountStatus.NORMAL,
        freeGenerationLimit: 3,
        freeGenerationsUsed: 0,
        creditBalance: 0,
      },
    });

    const attachedGuestIdeasCount = await this.attachGuestIdeasToUser(
      dto.guestSessionToken,
      user.id,
    );

    const updatedUser = await this.prisma.user.findUnique({
      where: { id: user.id },
    });

    if (!updatedUser) {
      throw new UnauthorizedException('User not found');
    }

    const accessToken = await this.generateAccessToken(updatedUser);
    const refreshToken = await this.generateRefreshToken(updatedUser.id);

    return {
      message: 'Registered successfully',
      accessToken,
      refreshToken,
      attachedGuestIdeasCount,
      user: {
        id: updatedUser.id,
        fullName: updatedUser.fullName,
        email: updatedUser.email,
        role: updatedUser.role,
        accountStatus: updatedUser.accountStatus,
        freeGenerationLimit: updatedUser.freeGenerationLimit,
        freeGenerationsUsed: updatedUser.freeGenerationsUsed,
        creditBalance: updatedUser.creditBalance,
      },
    };
  }

  /**
   * Authenticates a registered user.
   *
   * The method validates the email, account status, and password,
   * then returns a new access token and refresh token.
   *
   * @param dto - Login request data.
   * @returns Login message, access token, refresh token, and user data.
   *
   * @throws UnauthorizedException if the credentials are invalid or the account is inactive.
   */
  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account is inactive');
    }

    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const accessToken = await this.generateAccessToken(user);
    const refreshToken = await this.generateRefreshToken(user.id);

    return {
      message: 'Logged in successfully',
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        accountStatus: user.accountStatus,
        freeGenerationLimit: user.freeGenerationLimit,
        freeGenerationsUsed: user.freeGenerationsUsed,
        creditBalance: user.creditBalance,
      },
    };
  }

  /**
   * Refreshes authentication tokens.
   *
   * This method validates the provided refresh token, checks that it is not
   * revoked or expired, revokes the old token, and issues a new access token
   * and refresh token.
   *
   * @param dto - Refresh token request data.
   * @returns New access token and refresh token.
   *
   * @throws UnauthorizedException if the refresh token is invalid, revoked, expired, or belongs to an inactive account.
   */
  async refresh(dto: RefreshDto) {
    const tokenHash = this.hashToken(dto.refreshToken);

    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!storedToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (storedToken.revokedAt) {
      throw new UnauthorizedException('Refresh token revoked');
    }

    if (storedToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    if (!storedToken.user.isActive) {
      throw new UnauthorizedException('Account is inactive');
    }

    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: {
        revokedAt: new Date(),
      },
    });

    const accessToken = await this.generateAccessToken(storedToken.user);
    const refreshToken = await this.generateRefreshToken(storedToken.user.id);

    return {
      accessToken,
      refreshToken,
    };
  }

  /**
   * Logs out the authenticated user.
   *
   * Revokes the provided refresh token to prevent
   * any future token refresh operations.
   *
   * @param dto - Logout request containing the refresh token.
   * @returns Logout confirmation message.
   */
  async logout(dto: RefreshDto) {
    const tokenHash = this.hashToken(dto.refreshToken);

    await this.prisma.refreshToken.updateMany({
      where: {
        tokenHash,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    return {
      message: 'Logged out successfully',
    };
  }

  /**
   * Retrieves the authenticated user's profile.
   *
   * @param userId - Authenticated user ID.
   * @returns Authenticated user's profile data.
   *
   * @throws UnauthorizedException if the user cannot be found.
   */
  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        accountStatus: true,
        freeGenerationLimit: true,
        freeGenerationsUsed: true,
        creditBalance: true,
        isActive: true,
        isVerified: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;
  }
/**
 * Changes the authenticated user's password.
 *
 * The current password must be valid, and the new password
 * must be different from the existing one.
 *
 * @param userId - Authenticated user ID.
 * @param dto - Current and new password data.
 * @returns Password change confirmation message.
 *
 * @throws UnauthorizedException if the user does not exist
 * or the account is inactive.
 *
 * @throws BadRequestException if the current password is
 * incorrect or the new password matches the current password.
 */
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        passwordHash: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User is not active or does not exist');
    }

    const isCurrentPasswordValid = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );

    if (!isCurrentPasswordValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    const isSamePassword = await bcrypt.compare(
      dto.newPassword,
      user.passwordHash,
    );

    if (isSamePassword) {
      throw new BadRequestException(
        'New password must be different from current password',
      );
    }

    const newPasswordHash = await bcrypt.hash(dto.newPassword, SALT_ROUNDS);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: newPasswordHash,
      },
    });

    return {
      message: 'Password changed successfully',
    };
  }
/**
 * Sends a password reset email if the provided email belongs
 * to an active account.
 *
 * For security reasons, this method always returns the same
 * response message whether the email exists or not.
 *
 * @param dto - Forgot password request data.
 * @returns Password reset email confirmation message.
 */
  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: {
        id: true,
        email: true,
        isActive: true,
      },
    });

    const response = {
      message:
        'If this email exists, a password reset link has been sent',
    };

    if (!user || !user.isActive) {
      return response;
    }

    await this.prisma.passwordResetToken.updateMany({
      where: {
        userId: user.id,
        usedAt: null,
      },
      data: {
        usedAt: new Date(),
      },
    });

    const resetToken = randomBytes(PASSWORD_RESET_TOKEN_BYTES).toString('hex');
    const tokenHash = this.hashToken(resetToken);

    const expiresAt = new Date();
    expiresAt.setMinutes(
      expiresAt.getMinutes() + PASSWORD_RESET_TOKEN_EXPIRES_MINUTES,
    );

    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    const frontendUrl =
      process.env.APP_FRONTEND_URL ?? 'http://localhost:3000';

    const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;

    await this.mailService.sendPasswordResetEmail(user.email, resetLink);

    return response;
  }

/**
 * Resets a user's password using a valid password reset token.
 *
 * The reset token must be valid, unused, and not expired.
 * After a successful password reset, all active refresh tokens
 * are revoked.
 *
 * @param dto - Reset password request data.
 * @returns Password reset confirmation message.
 *
 * @throws BadRequestException if the reset token is invalid,
 * expired, already used, or the new password matches the
 * current password.
 */
  async resetPassword(dto: ResetPasswordDto) {
    const tokenHash = this.hashToken(dto.token);

    const storedToken = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: {
        user: true,
      },
    });

    if (
      !storedToken ||
      storedToken.usedAt ||
      storedToken.expiresAt < new Date() ||
      !storedToken.user.isActive
    ) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const isSamePassword = await bcrypt.compare(
      dto.newPassword,
      storedToken.user.passwordHash,
    );

    if (isSamePassword) {
      throw new BadRequestException(
        'New password must be different from current password',
      );
    }

    const newPasswordHash = await bcrypt.hash(
      dto.newPassword,
      SALT_ROUNDS,
    );

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: storedToken.userId },
        data: {
          passwordHash: newPasswordHash,
        },
      }),

      this.prisma.passwordResetToken.update({
        where: { id: storedToken.id },
        data: {
          usedAt: new Date(),
        },
      }),

      this.prisma.refreshToken.updateMany({
        where: {
          userId: storedToken.userId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      }),
    ]);

    return {
      message: 'Password reset successfully',
    };
  }
}