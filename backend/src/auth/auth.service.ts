import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AccountStatus, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { AuthTokenService } from './services/auth-token.service';
import { AuthGuestService } from './services/auth-guest.service';
import { AuthEmailService } from './services/auth-email.service';
import { AuthPasswordService } from './services/auth-password.service';

const SALT_ROUNDS = 10;

/**
 * Main authentication service.
 *
 * Coordinates the authentication flow by using specialized
 * authentication services for tokens, guest idea transfer,
 * email verification, and password operations.
 *
 * Handles:
 * - User registration.
 * - User login.
 * - Refresh token rotation.
 * - Logout.
 * - Authenticated user profile retrieval.
 * - Password operation delegation.
 * - Email verification delegation.
 *
 * @author Eman
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authTokenService: AuthTokenService,
    private readonly authGuestService: AuthGuestService,
    private readonly authEmailService: AuthEmailService,
    private readonly authPasswordService: AuthPasswordService,
  ) { }

  /**
   * Registers a new user account.
   *
   * Creates a normal USER account, hashes the password,
   * transfers any guest-generated ideas if a guest session
   * token is provided, sends an email verification link,
   * and returns authentication tokens.
   *
   * @param dto - Registration request data.
   * @returns Registration response with tokens, user data,
   * and the number of transferred guest ideas.
   *
   * @throws BadRequestException if the email is already registered.
   * @throws UnauthorizedException if the created user cannot be retrieved.
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

    const attachedGuestIdeasCount =
      await this.authGuestService.attachGuestIdeasToUser(
        dto.guestSessionToken,
        user.id,
      );

    const updatedUser = await this.prisma.user.findUnique({
      where: { id: user.id },
    });

    if (!updatedUser) {
      throw new UnauthorizedException('User not found');
    }

    await this.authEmailService.sendEmailVerificationLink(
      updatedUser.id,
      updatedUser.email,
    );

    const accessToken =
      await this.authTokenService.generateAccessToken(updatedUser);

    const refreshToken =
      await this.authTokenService.generateRefreshToken(updatedUser.id);

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
   * Authenticates an active and verified user.
   *
   * Validates the user's email, account status, email verification
   * status, and password. If valid, generates new access and refresh
   * tokens.
   *
   * @param dto - Login request data.
   * @returns Login response with tokens and user data.
   *
   * @throws UnauthorizedException if credentials are invalid,
   * the account is inactive, or the email is not verified.
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

    if (!user.isVerified) {
      throw new UnauthorizedException(
        'Please verify your email before logging in',
      );
    }

    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const accessToken =
      await this.authTokenService.generateAccessToken(user);

    const refreshToken =
      await this.authTokenService.generateRefreshToken(user.id);

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
   * Validates the provided refresh token, revokes it,
   * and issues a new access token and refresh token.
   *
   * @param dto - Refresh token request data.
   * @returns New access and refresh tokens.
   *
   * @throws UnauthorizedException if the refresh token is invalid,
   * revoked, expired, or belongs to an inactive account.
   */
  async refresh(dto: RefreshDto) {
    const tokenHash = this.authTokenService.hashToken(dto.refreshToken);

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

    const accessToken =
      await this.authTokenService.generateAccessToken(storedToken.user);

    const refreshToken =
      await this.authTokenService.generateRefreshToken(storedToken.user.id);

    return {
      accessToken,
      refreshToken,
    };
  }

  /**
   * Logs out a user.
   *
   * Revokes the provided refresh token so it can no longer
   * be used to generate new access tokens.
   *
   * @param dto - Logout request containing the refresh token.
   * @returns Logout confirmation message.
   */
  async logout(dto: RefreshDto) {
    const tokenHash = this.authTokenService.hashToken(dto.refreshToken);

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
   * @returns Authenticated user profile data.
   *
   * @throws UnauthorizedException if the user does not exist.
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
   * Delegates password change logic to AuthPasswordService.
   *
   * @param userId - Authenticated user ID.
   * @param dto - Current and new password data.
   * @returns Password change confirmation.
   */
  changePassword(userId: string, dto: ChangePasswordDto) {
    return this.authPasswordService.changePassword(userId, dto);
  }

  /**
   * Delegates forgot password flow to AuthPasswordService.
   *
   * @param dto - Forgot password request data.
   * @returns Password reset email request confirmation.
   */
  forgotPassword(dto: ForgotPasswordDto) {
    return this.authPasswordService.forgotPassword(dto);
  }

  /**
   * Delegates password reset flow to AuthPasswordService.
   *
   * @param dto - Password reset request data.
   * @returns Password reset confirmation.
   */
  resetPassword(dto: ResetPasswordDto) {
    return this.authPasswordService.resetPassword(dto);
  }

  /**
   * Delegates email verification flow to AuthEmailService.
   *
   * @param email - User email address.
   * @param token - Email verification token.
   * @returns Email verification confirmation.
   */
  verifyEmail(email: string, token: string) {
    return this.authEmailService.verifyEmail(email, token);
  }

  /**
   * Delegates resend verification email flow to AuthEmailService.
   *
   * @param email - User email address.
   * @returns Verification email resend confirmation.
   */
  resendVerificationEmail(email: string) {
    return this.authEmailService.resendVerificationEmail(email);
  }
}