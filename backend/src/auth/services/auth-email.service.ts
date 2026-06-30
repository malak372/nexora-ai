import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../../mail/mail.service';
import { AuthTokenService } from './auth-token.service';

const EMAIL_VERIFICATION_TOKEN_BYTES = 32;
const EMAIL_VERIFICATION_TOKEN_EXPIRES_HOURS = 24;

/**
 * Service responsible for email verification operations.
 *
 * This service handles:
 * - Creating secure email verification tokens.
 * - Invalidating old unused verification tokens.
 * - Sending verification links to registered users.
 * - Verifying user email addresses.
 * - Marking verified accounts as verified.
 * - Sending a welcome email after successful verification.
 *
 * @author Eman
 */
@Injectable()
export class AuthEmailService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly mailService: MailService,
        private readonly authTokenService: AuthTokenService,
    ) { }

    /**
     * Generates and sends an email verification link.
     *
     * Before creating a new verification token, this method
     * marks any previous unused verification tokens for the same
     * user as used. This ensures that only the latest verification
     * link remains valid.
     *
     * The generated token is hashed before being stored in the
     * database for security reasons, while the plain token is sent
     * only through the verification link.
     *
     * @param userId - ID of the user who needs email verification.
     * @param email - Email address that will receive the verification link.
     * @returns A promise that resolves when the verification email is sent.
     */
    async sendEmailVerificationLink(
        userId: string,
        email: string,
    ): Promise<void> {
        await this.prisma.emailVerificationToken.updateMany({
            where: {
                userId,
                usedAt: null,
            },
            data: {
                usedAt: new Date(),
            },
        });

        const verificationToken = randomBytes(
            EMAIL_VERIFICATION_TOKEN_BYTES,
        ).toString('hex');

        const tokenHash = this.authTokenService.hashToken(verificationToken);

        const expiresAt = new Date();
        expiresAt.setHours(
            expiresAt.getHours() + EMAIL_VERIFICATION_TOKEN_EXPIRES_HOURS,
        );

        await this.prisma.emailVerificationToken.create({
            data: {
                userId,
                tokenHash,
                expiresAt,
            },
        });

        const frontendUrl =
            process.env.APP_FRONTEND_URL ?? 'http://localhost:3000';

        const verificationLink =
            `${frontendUrl}/verify-email?email=${encodeURIComponent(email)}` +
            `&token=${verificationToken}`;

        await this.mailService.sendVerificationEmail(email, verificationLink);
    }

    /**
     * Resends an email verification link for an unverified active user.
     *
     * @param email - User email address.
     * @returns Verification email resend confirmation message.
     *
     * @throws BadRequestException if the account does not exist,
     * is inactive, or is already verified.
     */
    async resendVerificationEmail(email: string) {
        const user = await this.prisma.user.findUnique({
            where: { email },
            select: {
                id: true,
                email: true,
                isActive: true,
                isVerified: true,
            },
        });

        if (!user || !user.isActive) {
            throw new BadRequestException('Invalid verification request');
        }

        if (user.isVerified) {
            return {
                message: 'Email is already verified',
            };
        }

        await this.sendEmailVerificationLink(user.id, user.email);

        return {
            message: 'Verification email has been resent successfully',
        };
    }

    /**
     * Verifies a user's email address using a verification token.
     *
     * This method validates that:
     * - The email and token are provided.
     * - The user exists and the account is active.
     * - The email is not already verified.
     * - The verification token exists.
     * - The token belongs to the same user.
     * - The token has not been used before.
     * - The token has not expired.
     *
     * After successful verification, the user's `isVerified`
     * status is updated to true, the token is marked as used,
     * and a welcome email is sent to the verified user.
     *
     * @param email - User email address.
     * @param token - Plain verification token received from the verification link.
     * @returns Email verification confirmation message.
     *
     * @throws BadRequestException if the verification request is invalid,
     * the account is inactive, or the token is invalid, expired, or already used.
     */
    async verifyEmail(email: string, token: string) {
        if (!email || !token) {
            throw new BadRequestException('Email and token are required');
        }

        const user = await this.prisma.user.findUnique({
            where: { email },
            select: {
                id: true,
                isVerified: true,
                isActive: true,
            },
        });

        if (!user || !user.isActive) {
            throw new BadRequestException('Invalid verification request');
        }

        if (user.isVerified) {
            return {
                message: 'Email is already verified',
            };
        }

        const tokenHash = this.authTokenService.hashToken(token);

        const storedToken =
            await this.prisma.emailVerificationToken.findUnique({
                where: { tokenHash },
            });

        if (
            !storedToken ||
            storedToken.userId !== user.id ||
            storedToken.usedAt ||
            storedToken.expiresAt < new Date()
        ) {
            throw new BadRequestException(
                'Invalid or expired verification token',
            );
        }

        await this.prisma.$transaction([
            this.prisma.user.update({
                where: { id: user.id },
                data: {
                    isVerified: true,
                },
            }),

            this.prisma.emailVerificationToken.update({
                where: { id: storedToken.id },
                data: {
                    usedAt: new Date(),
                },
            }),
        ]);

        const verifiedUser = await this.prisma.user.findUnique({
            where: { id: user.id },
            select: {
                email: true,
                fullName: true,
            },
        });

        if (verifiedUser) {
            await this.mailService.sendWelcomeEmail(
                verifiedUser.email,
                verifiedUser.fullName,
            );
        }

        return {
            message: 'Email verified successfully',
        };
    }
}