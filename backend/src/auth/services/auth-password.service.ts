import {
    BadRequestException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../../mail/mail.service';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import { AuthTokenService } from './auth-token.service';

const SALT_ROUNDS = 10;
const PASSWORD_RESET_TOKEN_BYTES = 32;
const PASSWORD_RESET_TOKEN_EXPIRES_MINUTES = 15;

/**
 * Service responsible for password-related authentication operations.
 *
 * Handles:
 * - Changing the authenticated user's password.
 * - Creating secure password reset tokens.
 * - Sending password reset emails.
 * - Resetting forgotten passwords.
 * - Revoking active refresh tokens after password reset.
 *
 * @author Eman
 */
@Injectable()
export class AuthPasswordService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly mailService: MailService,
        private readonly authTokenService: AuthTokenService,
    ) { }

    /**
     * Changes the password of an authenticated user.
     *
     * The method verifies that the user exists, the account is active,
     * the current password is correct, and the new password is different
     * from the current password.
     *
     * @param userId - Authenticated user ID.
     * @param dto - Current and new password data.
     * @returns Password change confirmation message.
     *
     * @throws UnauthorizedException if the user does not exist or is inactive.
     * @throws BadRequestException if the current password is incorrect
     * or the new password matches the current password.
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
     * Sends a password reset email for active accounts.
     *
     * For security reasons, this method always returns the same response
     * whether the email exists or not. If the account exists and is active,
     * any previous unused reset tokens are invalidated, a new secure token
     * is created, and a password reset link is emailed to the user.
     *
     * @param dto - Forgot password request data.
     * @returns Password reset request confirmation message.
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
        const tokenHash = this.authTokenService.hashToken(resetToken);

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
     * Resets a user's password using a valid reset token.
     *
     * The reset token must exist, belong to an active user,
     * be unused, and not be expired. After a successful reset,
     * the user's password is updated, the reset token is marked
     * as used, and all active refresh tokens are revoked to force
     * re-authentication.
     *
     * @param dto - Reset password request data.
     * @returns Password reset confirmation message.
     *
     * @throws BadRequestException if the token is invalid, expired,
     * already used, or the new password matches the current password.
     */
    async resetPassword(dto: ResetPasswordDto) {
        const tokenHash = this.authTokenService.hashToken(dto.token);

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