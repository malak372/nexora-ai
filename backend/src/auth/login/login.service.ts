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

/**
 * Service responsible for user login operations.
 *
 * Handles credential validation, account activity checks,
 * email verification enforcement, failed login tracking,
 * temporary account locking, token generation, and
 * authentication audit logging.
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
     * Records authentication audit logs for failed attempts,
     * locked accounts, and successful logins. Failed password
     * attempts are tracked, and the account is temporarily locked
     * after repeated failures.
     *
     * @param dto User login credentials.
     * @param meta Optional request metadata such as IP address and user agent.
     * @returns Login response containing tokens and user data.
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

        if (user.lockedUntil && user.lockedUntil > new Date()) {
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
            const nextFailedAttempts = user.failedLoginAttempts + 1;

            if (nextFailedAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
                const lockedUntil = new Date();
                lockedUntil.setMinutes(
                    lockedUntil.getMinutes() + LOGIN_LOCK_MINUTES,
                );

                await this.prisma.user.update({
                    where: { id: user.id },
                    data: {
                        failedLoginAttempts: nextFailedAttempts,
                        lockedUntil,
                    },
                });

                await this.authAuditService.createLog({
                    userId: user.id,
                    email: user.email,
                    action: AuthAction.ACCOUNT_LOCKED,
                    isSuccess: true,
                    message: 'Account locked after repeated failed login attempts',
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

        if (user.failedLoginAttempts > 0 || user.lockedUntil) {
            await this.prisma.user.update({
                where: { id: user.id },
                data: {
                    failedLoginAttempts: 0,
                    lockedUntil: null,
                    lastLoginAt: new Date(),
                },
            });
        } else {
            await this.prisma.user.update({
                where: { id: user.id },
                data: {
                    lastLoginAt: new Date(),
                },
            });
        }

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