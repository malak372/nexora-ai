import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AccountStatus, UserRole } from '@prisma/client';
import { randomBytes, createHash } from 'crypto';
import type { StringValue } from 'ms';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Service responsible for authentication token operations.
 *
 * Handles:
 * - Hashing refresh, password reset, and email verification tokens.
 * - Generating JWT access tokens.
 * - Generating and storing secure refresh tokens.
 *
 * @author Eman
 */
@Injectable()
export class AuthTokenService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly jwtService: JwtService,
    ) { }

    /**
     * Hashes a plain token using SHA-256.
     *
     * Used before storing or comparing sensitive tokens
     * such as refresh tokens, password reset tokens,
     * and email verification tokens.
     *
     * @param token - Plain token value.
     * @returns Hashed token value.
     */
    hashToken(token: string) {
        return createHash('sha256').update(token).digest('hex');
    }

    /**
     * Generates a signed JWT access token.
     *
     * The token includes the user's ID, email, role,
     * and account status to support authenticated
     * and role-based access control.
     *
     * @param user - User data required for JWT payload.
     * @returns Signed JWT access token.
     */
    async generateAccessToken(user: {
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
     * Generates and stores a secure refresh token.
     *
     * A random refresh token is generated and returned
     * to the client, while only its hashed value is stored
     * in the database for security.
     *
     * @param userId - ID of the user who owns the refresh token.
     * @returns Plain refresh token.
     */
    async generateRefreshToken(userId: string) {
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
}