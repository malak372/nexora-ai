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
const LOGIN_LOCK_MINUTES = 15;
const FAILED_LOGIN_WINDOW_MINUTES = 15;

/**
 * Service responsible for user login operations.
 *
 * Handles verified user authentication in Nexora AI, including:
 * - Credential validation.
 * - Account activity checks.
 * - Email verification enforcement.
 * - Failed login attempt tracking.
 * - Temporary account locking.
 * - JWT access token generation.
 * - Refresh token generation.
 * - Authentication audit logging.
 *
 * Failed login attempts are tracked within a limited time window.
 * The account is temporarily locked only when the user reaches
 * the maximum number of failed login attempts inside that window.
 * This prevents old failed attempts from accumulating forever while
 * still protecting the account from brute-force login attempts.
 *
 * On successful login, failed attempt counters and lock metadata
 * are cleared, and the user's last login timestamp is updated.
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
     * This method validates the user's credentials and account state.
     * If the account is locked, inactive, unverified, or the credentials
     * are invalid, the attempt is rejected and recorded in the
     * authentication audit log.
     *
     * Failed password attempts are counted only within the configured
     * failure window. If the number of failed attempts reaches the maximum
     * allowed limit within that window, the account is locked temporarily.
     *
     * @param dto User login credentials.
     * @param meta Optional request metadata such as IP address and user agent.
     * @returns Login response containing access token, refresh token,
     * and authenticated user data.
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
            await this.authAuditService.createLog({
                userId: user.id,
                email: user.email,
                action: AuthAction.LOGIN_FAILED,
                isSuccess: false,
                message: 'Account is temporarily locked',
                ...meta,
            });

            throw new UnauthorizedException(
                'Account is temporarily locked. Please try again later',
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
            const failedWindowStartedAt = user.failedLoginWindowStartedAt;

            const isInsideFailureWindow =
                failedWindowStartedAt &&
                now.getTime() - failedWindowStartedAt.getTime() <=
                FAILED_LOGIN_WINDOW_MINUTES * 60 * 1000;

            const nextFailedAttempts = isInsideFailureWindow
                ? user.failedLoginAttempts + 1
                : 1;

            const nextFailedWindowStartedAt = isInsideFailureWindow
                ? failedWindowStartedAt
                : now;

            if (nextFailedAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
                const lockedUntil = new Date(now);
                lockedUntil.setMinutes(
                    lockedUntil.getMinutes() + LOGIN_LOCK_MINUTES,
                );

                await this.prisma.user.update({
                    where: { id: user.id },
                    data: {
                        failedLoginAttempts: nextFailedAttempts,
                        failedLoginWindowStartedAt: nextFailedWindowStartedAt,
                        lockedUntil,
                    },
                });

                await this.authAuditService.createLog({
                    userId: user.id,
                    email: user.email,
                    action: AuthAction.ACCOUNT_LOCKED,
                    isSuccess: true,
                    message:
                        'Account locked after repeated failed login attempts within the allowed time window',
                    ...meta,
                });

                throw new UnauthorizedException(
                    'Too many failed login attempts. Account temporarily locked',
                );
            }

            await this.prisma.user.update({
                where: { id: user.id },
                data: {
                    failedLoginAttempts: nextFailedAttempts,
                    failedLoginWindowStartedAt: nextFailedWindowStartedAt,
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

        await this.prisma.user.update({
            where: { id: user.id },
            data: {
                failedLoginAttempts: 0,
                failedLoginWindowStartedAt: null,
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
}