import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthAction } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

import { PrismaService } from '../../prisma/prisma.service';
import { LoginDto } from '../dto/login.dto';
import { AuthTokenService } from '../token/token.service';
import {
    AuthAuditService,
    AuthRequestMeta,
} from '../audit/audit.service';

const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const FAILED_LOGIN_WINDOW_MINUTES = 15;

/**
 * Progressive lock durations in minutes:
 * - First lock: 30 minutes.
 * - Second lock: 2 hours.
 * - Third and later locks: 24 hours.
 */
const LOGIN_LOCK_DURATIONS_MINUTES = [30, 120, 1440];

/**
 * Service responsible for user login operations.
 *
 * Handles verified user authentication in Nexora AI, including:
 * - Credential validation.
 * - Account activity checks.
 * - Email verification enforcement.
 * - Failed login attempt tracking within a limited time window.
 * - Progressive temporary account locking.
 * - JWT access token generation.
 * - Refresh token generation.
 * - Authentication audit logging.
 *
 * Failed login attempts are counted only within the configured
 * failure window. If failed attempts are separated by more than
 * the allowed time window, the counter is restarted.
 *
 * Lock policy:
 * - 5 failed attempts within 15 minutes => 30 minutes lock.
 * - Another 5 failed attempts within 15 minutes after the first lock expires => 2 hours lock.
 * - Another 5 failed attempts within 15 minutes after the second lock expires => 24 hours lock.
 *
 * A successful login resets failed attempts, lock window, lock level,
 * and lock expiration.
 *
 * @author Eman
 */
@Injectable()
export class AuthLoginService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly authTokenService: AuthTokenService,
        private readonly authAuditService: AuthAuditService,
    ) { }

    /**
     * Authenticates an active and verified user.
     *
     * @param dto User login credentials.
     * @param meta Optional request metadata such as IP address and user agent.
     * @returns Login response containing access token, refresh token, and user data.
     *
     * @throws UnauthorizedException if login validation fails.
     */
    async login(dto: LoginDto, meta?: AuthRequestMeta) {
        const user = await this.prisma.user.findUnique({
            where: { email: dto.email },
        });

        if (!user) {
            await this.authAuditService.createLog({
                email: dto.email,
                action: AuthAction.LOGIN_FAILED,
                isSuccess: false,
                message: 'Invalid email or password',
                ...meta,
            });

            throw new UnauthorizedException('Invalid email or password');
        }

        const now = new Date();

        if (user.lockedUntil && user.lockedUntil > now) {
            const remainingMinutes = Math.ceil(
                (user.lockedUntil.getTime() - now.getTime()) / 60000,
            );

            await this.authAuditService.createLog({
                userId: user.id,
                email: user.email,
                action: AuthAction.LOGIN_FAILED,
                isSuccess: false,
                message: `Login attempted while account was locked. Remaining lock time: ${this.formatLockDuration(remainingMinutes)}`,
                ...meta,
            });

            throw new UnauthorizedException(
                `Account is temporarily locked. Try again in ${this.formatLockDuration(remainingMinutes)}.`,
            );
        }

        if (!user.isActive) {
            await this.authAuditService.createLog({
                userId: user.id,
                email: user.email,
                action: AuthAction.LOGIN_FAILED,
                isSuccess: false,
                message: 'Account is inactive',
                ...meta,
            });

            throw new UnauthorizedException('Account is inactive');
        }

        if (!user.isVerified) {
            await this.authAuditService.createLog({
                userId: user.id,
                email: user.email,
                action: AuthAction.LOGIN_FAILED,
                isSuccess: false,
                message: 'Email is not verified',
                ...meta,
            });

            throw new UnauthorizedException(
                'Please verify your email before logging in',
            );
        }

        const isPasswordValid = await bcrypt.compare(
            dto.password,
            user.passwordHash,
        );

        if (!isPasswordValid) {
            await this.handleFailedLogin(
                {
                    id: user.id,
                    email: user.email,
                    failedLoginAttempts: user.failedLoginAttempts,
                    failedLoginWindowStartedAt:
                        user.failedLoginWindowStartedAt,
                    loginLockLevel: user.loginLockLevel,
                },
                now,
                meta,
            );
        }

        await this.prisma.user.update({
            where: { id: user.id },
            data: {
                failedLoginAttempts: 0,
                failedLoginWindowStartedAt: null,
                loginLockLevel: 0,
                lockedUntil: null,
                lastLoginAt: now,
            },
        });

        const accessToken =
            await this.authTokenService.generateAccessToken(user);

        const refreshToken =
            await this.authTokenService.generateRefreshToken(
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
     * Handles failed login attempts inside a limited time window.
     *
     * If the user reaches the maximum number of failed attempts within
     * the configured window, the account is locked using the current
     * progressive lock level.
     *
     * If the window has expired, the failed attempt counter restarts
     * from one instead of accumulating old failures.
     */
    private async handleFailedLogin(
        user: {
            id: string;
            email: string;
            failedLoginAttempts: number;
            failedLoginWindowStartedAt: Date | null;
            loginLockLevel: number;
        },
        now: Date,
        meta?: AuthRequestMeta,
    ): Promise<never> {
        const windowStartedAt = user.failedLoginWindowStartedAt;

        const isInsideFailureWindow =
            windowStartedAt !== null &&
            now.getTime() - windowStartedAt.getTime() <=
            FAILED_LOGIN_WINDOW_MINUTES * 60 * 1000;

        const nextFailedAttempts = isInsideFailureWindow
            ? user.failedLoginAttempts + 1
            : 1;

        const nextWindowStartedAt = isInsideFailureWindow
            ? windowStartedAt
            : now;

        if (nextFailedAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
            await this.lockUser(
                {
                    ...user,
                    failedLoginAttempts: nextFailedAttempts,
                    failedLoginWindowStartedAt: nextWindowStartedAt,
                },
                now,
                meta,
            );
        }

        await this.prisma.user.update({
            where: { id: user.id },
            data: {
                failedLoginAttempts: nextFailedAttempts,
                failedLoginWindowStartedAt: nextWindowStartedAt,
                lockedUntil: null,
            },
        });

        await this.authAuditService.createLog({
            userId: user.id,
            email: user.email,
            action: AuthAction.LOGIN_FAILED,
            isSuccess: false,
            message: 'Invalid email or password',
            ...meta,
        });

        throw new UnauthorizedException('Invalid email or password');
    }

    /**
     * Locks the account using progressive lock durations.
     *
     * The lock level is increased only when a lock is actually applied.
     * A successful login resets the lock level to zero.
     */
    private async lockUser(
        user: {
            id: string;
            email: string;
            failedLoginAttempts: number;
            failedLoginWindowStartedAt: Date | null;
            loginLockLevel: number;
        },
        now: Date,
        meta?: AuthRequestMeta,
    ): Promise<never> {
        const durationIndex = Math.min(
            user.loginLockLevel,
            LOGIN_LOCK_DURATIONS_MINUTES.length - 1,
        );

        const lockDurationMinutes =
            LOGIN_LOCK_DURATIONS_MINUTES[durationIndex];

        const lockedUntil = new Date(now);
        lockedUntil.setMinutes(
            lockedUntil.getMinutes() + lockDurationMinutes,
        );

        await this.prisma.user.update({
            where: { id: user.id },
            data: {
                failedLoginAttempts: 0,
                failedLoginWindowStartedAt: null,
                loginLockLevel: user.loginLockLevel + 1,
                lockedUntil,
            },
        });

        await this.authAuditService.createLog({
            userId: user.id,
            email: user.email,
            action: AuthAction.ACCOUNT_LOCKED,
            isSuccess: true,
            message: `Account locked for ${this.formatLockDuration(lockDurationMinutes)} after ${MAX_FAILED_LOGIN_ATTEMPTS} failed login attempts within ${FAILED_LOGIN_WINDOW_MINUTES} minutes`,
            ...meta,
        });

        throw new UnauthorizedException(
            `Account locked for ${this.formatLockDuration(lockDurationMinutes)} due to multiple failed login attempts.`,
        );
    }
    /**
     * Formats a lock duration into a human-readable value for audit logs.
     *
     * This keeps authentication security logs clear for admins when reviewing
     * progressive account lock events, such as:
     * - 30 minutes
     * - 2 hours
     * - 24 hours
     *
     * @param minutes Lock duration in minutes.
     * @returns Human-readable lock duration.
     */

    private formatLockDuration(minutes: number): string {
        if (minutes >= 1440) {
            return '24 hours';
        }

        if (minutes >= 60) {
            return `${minutes / 60} hours`;
        }

        return `${minutes} minutes`;
    }
}