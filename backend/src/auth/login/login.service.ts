import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthAction } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

import { PrismaService } from '../../prisma/prisma.service';

import { AuthAuditService } from '../audit/audit.service';
import type { AuthRequestMeta } from '../audit/audit.service';
import { LoginDto } from '../dto/login.dto';
import { AuthTokenService } from '../token/token.service';

const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const FAILED_LOGIN_WINDOW_MINUTES = 15;

const MILLISECONDS_PER_MINUTE = 60_000;

/**
 * Progressive account-lock durations:
 * - First lock: 30 minutes.
 * - Second lock: 2 hours.
 * - Third and later locks: 24 hours.
 */
const LOGIN_LOCK_DURATIONS_MINUTES = [30, 120, 1_440] as const;

const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';

/**
 * Minimal user information required for failed-login processing.
 */
type FailedLoginUser = {
  readonly id: string;
  readonly email: string;
  readonly failedLoginAttempts: number;
  readonly failedLoginWindowStartedAt: Date | null;
  readonly loginLockLevel: number;
};

/**
 * Service responsible for user login operations.
 *
 * Handles:
 * - Credential validation.
 * - Account availability checks.
 * - Email-verification enforcement.
 * - Failed-login tracking.
 * - Progressive temporary account locking.
 * - Access-token generation.
 * - Refresh-token generation.
 * - Authentication audit logging.
 *
 * @author Eman
 */
@Injectable()
export class AuthLoginService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authTokenService: AuthTokenService,
    private readonly authAuditService: AuthAuditService,
  ) {}

  /**
   * Authenticates an active and verified user.
   *
   * @param dto - User login credentials.
   * @param meta - Optional request metadata.
   * @returns Access token, refresh token, and authenticated user data.
   *
   * @throws UnauthorizedException when authentication fails.
   */
  async login(dto: LoginDto, meta?: AuthRequestMeta) {
    const user = await this.prisma.user.findUnique({
      where: {
        email: dto.email,
      },
    });

    if (!user) {
      await this.logFailedLogin({
        email: dto.email,
        message: INVALID_CREDENTIALS_MESSAGE,
        meta,
      });

      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    const now = new Date();

    /**
     * Validate the password before exposing account-state information.
     * This prevents an attacker with only an email address from learning
     * whether the account is inactive, deleted, or unverified.
     */
    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      if (this.isAccountLocked(user.lockedUntil, now)) {
        await this.rejectLockedAccount(
          {
            id: user.id,
            email: user.email,
          },
          user.lockedUntil,
          now,
          meta,
        );
      }

      await this.handleFailedLogin(
        {
          id: user.id,
          email: user.email,
          failedLoginAttempts: user.failedLoginAttempts,
          failedLoginWindowStartedAt: user.failedLoginWindowStartedAt,
          loginLockLevel: user.loginLockLevel,
        },
        now,
        meta,
      );
    }

    if (this.isAccountLocked(user.lockedUntil, now)) {
      await this.rejectLockedAccount(
        {
          id: user.id,
          email: user.email,
        },
        user.lockedUntil,
        now,
        meta,
      );
    }

    if (!user.isActive || user.deletedAt) {
      await this.logFailedLogin({
        userId: user.id,
        email: user.email,
        message: 'Account is unavailable',
        meta,
      });

      throw new UnauthorizedException('This account is currently unavailable.');
    }

    if (!user.isVerified) {
      await this.logFailedLogin({
        userId: user.id,
        email: user.email,
        message: 'Email is not verified',
        meta,
      });

      throw new UnauthorizedException(
        'Please verify your email before logging in.',
      );
    }

    await this.prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        failedLoginAttempts: 0,
        failedLoginWindowStartedAt: null,
        loginLockLevel: 0,
        lockedUntil: null,
        lastLoginAt: now,
      },
    });

    const accessToken = await this.authTokenService.generateAccessToken(user);

    const refreshToken = await this.authTokenService.generateRefreshToken(
      user.id,
      meta,
    );

    await this.authAuditService.createLog({
      userId: user.id,
      email: user.email,
      action: AuthAction.LOGIN_SUCCESS,
      isSuccess: true,
      message: 'User logged in successfully',
      ...meta,
    });

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
        userType: user.userType,
        freeGenerationLimit: user.freeGenerationLimit,
        freeGenerationsUsed: user.freeGenerationsUsed,
        creditBalance: user.creditBalance,
      },
    };
  }

  /**
   * Handles a failed login attempt inside the configured failure window.
   *
   * If the maximum number of attempts is reached, the account is
   * temporarily locked using the next progressive lock duration.
   */
  private async handleFailedLogin(
    user: FailedLoginUser,
    now: Date,
    meta?: AuthRequestMeta,
  ): Promise<never> {
    const isInsideFailureWindow = this.isInsideFailureWindow(
      user.failedLoginWindowStartedAt,
      now,
    );

    const nextFailedAttempts = isInsideFailureWindow
      ? user.failedLoginAttempts + 1
      : 1;

    const nextWindowStartedAt = isInsideFailureWindow
      ? user.failedLoginWindowStartedAt
      : now;

    if (nextFailedAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
      await this.lockUser(user, now, meta);
    }

    await this.prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        failedLoginAttempts: nextFailedAttempts,
        failedLoginWindowStartedAt: nextWindowStartedAt,
        lockedUntil: null,
      },
    });

    await this.logFailedLogin({
      userId: user.id,
      email: user.email,
      message: INVALID_CREDENTIALS_MESSAGE,
      meta,
    });

    throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
  }

  /**
   * Temporarily locks an account using the current progressive lock level.
   */
  private async lockUser(
    user: FailedLoginUser,
    now: Date,
    meta?: AuthRequestMeta,
  ): Promise<never> {
    const lockDurationMinutes = this.getLockDurationMinutes(
      user.loginLockLevel,
    );

    const lockedUntil = new Date(
      now.getTime() + lockDurationMinutes * MILLISECONDS_PER_MINUTE,
    );

    await this.prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        failedLoginAttempts: 0,
        failedLoginWindowStartedAt: null,
        loginLockLevel: user.loginLockLevel + 1,
        lockedUntil,
      },
    });

    const formattedDuration = this.formatLockDuration(lockDurationMinutes);

    await this.authAuditService.createLog({
      userId: user.id,
      email: user.email,
      action: AuthAction.ACCOUNT_LOCKED,
      isSuccess: true,
      message:
        `Account locked for ${formattedDuration} after ` +
        `${MAX_FAILED_LOGIN_ATTEMPTS} failed login attempts within ` +
        `${FAILED_LOGIN_WINDOW_MINUTES} minutes`,
      ...meta,
    });

    throw new UnauthorizedException(
      `Account locked for ${formattedDuration} due to multiple failed login attempts.`,
    );
  }

  /**
   * Rejects a login attempt made while an account is locked.
   */
  private async rejectLockedAccount(
    user: Pick<FailedLoginUser, 'id' | 'email'>,
    lockedUntil: Date,
    now: Date,
    meta?: AuthRequestMeta,
  ): Promise<never> {
    const remainingMinutes = Math.max(
      1,
      Math.ceil(
        (lockedUntil.getTime() - now.getTime()) / MILLISECONDS_PER_MINUTE,
      ),
    );

    const formattedDuration = this.formatLockDuration(remainingMinutes);

    await this.logFailedLogin({
      userId: user.id,
      email: user.email,
      message:
        `Login attempted while account was locked. ` +
        `Remaining lock time: ${formattedDuration}`,
      meta,
    });

    throw new UnauthorizedException(
      `Account is temporarily locked. Try again in ${formattedDuration}.`,
    );
  }

  /**
   * Creates a standardized failed-login audit record.
   */
  private async logFailedLogin(input: {
    readonly userId?: string;
    readonly email: string;
    readonly message: string;
    readonly meta?: AuthRequestMeta;
  }): Promise<void> {
    await this.authAuditService.createLog({
      userId: input.userId,
      email: input.email,
      action: AuthAction.LOGIN_FAILED,
      isSuccess: false,
      message: input.message,
      ...input.meta,
    });
  }

  /**
   * Determines whether an account is currently locked.
   */
  private isAccountLocked(
    lockedUntil: Date | null,
    now: Date,
  ): lockedUntil is Date {
    return lockedUntil !== null && lockedUntil > now;
  }

  /**
   * Determines whether a failed attempt occurred within the active window.
   */
  private isInsideFailureWindow(
    windowStartedAt: Date | null,
    now: Date,
  ): windowStartedAt is Date {
    if (!windowStartedAt) {
      return false;
    }

    const elapsedMilliseconds = now.getTime() - windowStartedAt.getTime();

    return (
      elapsedMilliseconds <=
      FAILED_LOGIN_WINDOW_MINUTES * MILLISECONDS_PER_MINUTE
    );
  }

  /**
   * Returns the lock duration associated with a lock level.
   */
  private getLockDurationMinutes(lockLevel: number): number {
    const durationIndex = Math.min(
      Math.max(lockLevel, 0),
      LOGIN_LOCK_DURATIONS_MINUTES.length - 1,
    );

    return LOGIN_LOCK_DURATIONS_MINUTES[durationIndex];
  }

  /**
   * Formats a duration into a human-readable value.
   */
  private formatLockDuration(totalMinutes: number): string {
    const minutes = Math.max(1, Math.ceil(totalMinutes));

    if (minutes < 60) {
      return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    const formattedHours = `${hours} ${hours === 1 ? 'hour' : 'hours'}`;

    if (remainingMinutes === 0) {
      return formattedHours;
    }

    return (
      `${formattedHours} and ${remainingMinutes} ` +
      `${remainingMinutes === 1 ? 'minute' : 'minutes'}`
    );
  }
}
