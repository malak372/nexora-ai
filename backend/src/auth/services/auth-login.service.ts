import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

import { PrismaService } from '../../prisma/prisma.service';
import { LoginDto } from '../dto/login.dto';
import { AuthTokenService } from './auth-token.service';

const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCK_MINUTES = 15;

/**
 * Service responsible for user login operations.
 *
 * Handles:
 * - Validating user credentials.
 * - Enforcing email verification before login.
 * - Tracking failed login attempts.
 * - Temporarily locking accounts after repeated failed attempts.
 * - Resetting failed login counters after successful login.
 * - Generating access and refresh tokens.
 *
 * @author Eman
 */
@Injectable()
export class AuthLoginService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly authTokenService: AuthTokenService,
    ) { }

    /**
     * Authenticates an active and verified user.
     *
     * If the password is incorrect, the failed login counter is increased.
     * After 5 failed attempts, the account is temporarily locked for
     * 15 minutes. On successful login, failed login counters are reset.
     *
     * @param dto - User login credentials.
     * @returns Login response containing access token, refresh token,
     * and basic user data.
     *
     * @throws UnauthorizedException if the email or password is invalid,
     * the account is inactive, the email is not verified, or the account
     * is temporarily locked.
     */
    async login(dto: LoginDto) {
        const user = await this.prisma.user.findUnique({
            where: { email: dto.email },
        });

        if (!user) {
            throw new UnauthorizedException('Invalid email or password');
        }

        if (user.lockedUntil && user.lockedUntil > new Date()) {
            throw new UnauthorizedException(
                'Account is temporarily locked. Please try again later',
            );
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

            throw new UnauthorizedException('Invalid email or password');
        }

        if (user.failedLoginAttempts > 0 || user.lockedUntil) {
            await this.prisma.user.update({
                where: { id: user.id },
                data: {
                    failedLoginAttempts: 0,
                    lockedUntil: null,
                },
            });
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
}