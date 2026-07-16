import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthAction } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthAuditService, AuthRequestMeta } from '../audit/audit.service';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import { AuthTokenService } from '../token/token.service';

const SALT_ROUNDS = 10;
const PASSWORD_RESET_TOKEN_BYTES = 32;
const PASSWORD_RESET_TOKEN_EXPIRES_MINUTES = 15;

const PASSWORD_CHANGED_SUCCESSFULLY_MESSAGE =
  'Password changed successfully';

const PASSWORD_RESET_SUCCESSFULLY_MESSAGE =
  'Password reset successfully';

const PASSWORD_RESET_REQUEST_RESPONSE_MESSAGE =
  'If this email exists, a password reset link has been sent';

const INVALID_OR_EXPIRED_RESET_TOKEN_MESSAGE =
  'Invalid or expired reset token';

const NEW_PASSWORD_MUST_BE_DIFFERENT_MESSAGE =
  'New password must be different from current password';

/**
 * Service responsible for password-related authentication operations.
 *
 * Handles:
 * - Password changes for authenticated users.
 * - Current password validation before updates.
 * - Secure password reset token generation.
 * - Invalidating old unused password reset tokens.
 * - Sending password reset emails.
 * - Resetting forgotten passwords.
 * - Revoking active refresh tokens after password updates.
 * - Recording successful and failed password-related audit logs.
 *
 * This service supports Nexora AI security requirements by ensuring
 * sensitive password operations are traceable, token-based flows are
 * time-limited, and users are forced to re-authenticate after password
 * changes or resets.
 *
 * @author Eman
 */
@Injectable()
export class AuthPasswordService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly authTokenService: AuthTokenService,
    private readonly authAuditService: AuthAuditService,
  ) { }

  /**
   * Changes the password of an authenticated and active user.
   *
   * The current password must be valid, and the new password must be
   * different from the existing password. Failed attempts are recorded
   * in authentication audit logs for security monitoring.
   *
   * After a successful password change:
   * - The password hash is updated.
   * - The passwordChangedAt timestamp is updated.
   * - All active refresh tokens are revoked.
   * - A successful password change audit log is recorded.
   *
   * @param userId Authenticated user ID.
   * @param dto Current and new password data.
   * @param meta Optional request metadata such as IP address and user agent.
   * @returns Password change confirmation message.
   *
   * @throws UnauthorizedException if the user does not exist or is inactive.
   * @throws BadRequestException if the current password is incorrect
   * or the new password matches the current password.
   */
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    meta?: AuthRequestMeta,
  ) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      await this.authAuditService.createLog({
        userId,
        action: AuthAction.CHANGE_PASSWORD,
        isSuccess: false,
        message:
          'Password change failed because account is inactive or missing',
        ...meta,
      });

      throw new UnauthorizedException(
        'User is not active or does not exist',
      );
    }

    const isCurrentPasswordValid = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );

    if (!isCurrentPasswordValid) {
      await this.authAuditService.createLog({
        userId: user.id,
        email: user.email,
        action: AuthAction.CHANGE_PASSWORD,
        isSuccess: false,
        message:
          'Password change failed because current password is incorrect',
        ...meta,
      });

      throw new BadRequestException('Current password is incorrect');
    }

    const isSamePassword = await bcrypt.compare(
      dto.newPassword,
      user.passwordHash,
    );

    if (isSamePassword) {
      await this.authAuditService.createLog({
        userId: user.id,
        email: user.email,
        action: AuthAction.CHANGE_PASSWORD,
        isSuccess: false,
        message:
          'Password change failed because new password matches current password',
        ...meta,
      });

      throw new BadRequestException(
        NEW_PASSWORD_MUST_BE_DIFFERENT_MESSAGE,
      );
    }

    const newPasswordHash = await bcrypt.hash(
      dto.newPassword,
      SALT_ROUNDS,
    );

    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: {
          id: userId,
        },
        data: {
          passwordHash: newPasswordHash,
          passwordChangedAt: now,
        },
      }),

      this.prisma.refreshToken.updateMany({
        where: {
          userId,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
        },
      }),
    ]);

    await this.authAuditService.createLog({
      userId: user.id,
      email: user.email,
      action: AuthAction.CHANGE_PASSWORD,
      isSuccess: true,
      message: PASSWORD_CHANGED_SUCCESSFULLY_MESSAGE,
      ...meta,
    });

    return {
      message: PASSWORD_CHANGED_SUCCESSFULLY_MESSAGE,
    };
  }

  /**
   * Sends a password reset email for active accounts.
   *
   * For security reasons, this method always returns the same response
   * whether the email exists or not. This prevents user enumeration.
   *
   * If the account exists and is active:
   * - Previous unused reset tokens are invalidated.
   * - A new secure reset token is created.
   * - A password reset email is sent.
   * - A forgot password audit log is recorded.
   *
   * @param dto Forgot password request data.
   * @param meta Optional request metadata such as IP address and user agent.
   * @returns Password reset request confirmation message.
   */
  async forgotPassword(
    dto: ForgotPasswordDto,
    meta?: AuthRequestMeta,
  ) {
    const user = await this.prisma.user.findUnique({
      where: {
        email: dto.email,
      },
      select: {
        id: true,
        email: true,
        isActive: true,
      },
    });

    const response = {
      message: PASSWORD_RESET_REQUEST_RESPONSE_MESSAGE,
    };

    if (!user || !user.isActive) {
      return response;
    }

    const now = new Date();

    await this.prisma.passwordResetToken.updateMany({
      where: {
        userId: user.id,
        usedAt: null,
      },
      data: {
        usedAt: now,
      },
    });

    const resetToken = randomBytes(
      PASSWORD_RESET_TOKEN_BYTES,
    ).toString('hex');

    const tokenHash =
      this.authTokenService.hashToken(resetToken);

    const expiresAt = new Date(
      now.getTime() +
      PASSWORD_RESET_TOKEN_EXPIRES_MINUTES * 60_000,
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

    const resetLink =
      `${frontendUrl}/reset-password?token=${resetToken}`;

    await this.mailService.sendPasswordResetEmail(
      user.email,
      resetLink,
    );

    await this.authAuditService.createLog({
      userId: user.id,
      email: user.email,
      action: AuthAction.FORGOT_PASSWORD,
      isSuccess: true,
      message: 'Password reset link requested',
      ...meta,
    });

    return response;
  }

  /**
   * Resets a user's password using a valid password reset token.
   *
   * The reset token must:
   * - Exist in the database.
   * - Belong to an active user.
   * - Be unused.
   * - Not be expired.
   *
   * Failed reset attempts are recorded before rejecting the request.
   *
   * After successful validation:
   * - The user's password is updated.
   * - The reset token is marked as used.
   * - All active refresh tokens are revoked.
   * - A successful password reset audit log is recorded.
   *
   * @param dto Reset token and new password data.
   * @param meta Optional request metadata such as IP address and user agent.
   * @returns Password reset confirmation message.
   *
   * @throws BadRequestException if the reset token is invalid,
   * expired, already used, or the new password matches the current password.
   */
  async resetPassword(
    dto: ResetPasswordDto,
    meta?: AuthRequestMeta,
  ) {
    const tokenHash =
      this.authTokenService.hashToken(dto.token);

    const storedToken =
      await this.prisma.passwordResetToken.findUnique({
        where: {
          tokenHash,
        },
        select: {
          id: true,
          userId: true,
          expiresAt: true,
          usedAt: true,
          user: {
            select: {
              email: true,
              passwordHash: true,
              isActive: true,
            },
          },
        },
      });

    const now = new Date();

    if (
      !storedToken ||
      storedToken.usedAt ||
      storedToken.expiresAt < now ||
      !storedToken.user.isActive
    ) {
      await this.authAuditService.createLog({
        userId: storedToken?.userId,
        email: storedToken?.user.email,
        action: AuthAction.RESET_PASSWORD_FAILED,
        isSuccess: false,
        message: INVALID_OR_EXPIRED_RESET_TOKEN_MESSAGE,
        ...meta,
      });

      throw new BadRequestException(
        INVALID_OR_EXPIRED_RESET_TOKEN_MESSAGE,
      );
    }

    const isSamePassword = await bcrypt.compare(
      dto.newPassword,
      storedToken.user.passwordHash,
    );

    if (isSamePassword) {
      await this.authAuditService.createLog({
        userId: storedToken.userId,
        email: storedToken.user.email,
        action: AuthAction.RESET_PASSWORD_FAILED,
        isSuccess: false,
        message: 'New password matches the current password',
        ...meta,
      });

      throw new BadRequestException(
        NEW_PASSWORD_MUST_BE_DIFFERENT_MESSAGE,
      );
    }

    const newPasswordHash = await bcrypt.hash(
      dto.newPassword,
      SALT_ROUNDS,
    );

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: {
          id: storedToken.userId,
        },
        data: {
          passwordHash: newPasswordHash,
          passwordChangedAt: now,
        },
      }),

      this.prisma.passwordResetToken.update({
        where: {
          id: storedToken.id,
        },
        data: {
          usedAt: now,
        },
      }),

      this.prisma.refreshToken.updateMany({
        where: {
          userId: storedToken.userId,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
        },
      }),
    ]);

    await this.authAuditService.createLog({
      userId: storedToken.userId,
      email: storedToken.user.email,
      action: AuthAction.RESET_PASSWORD,
      isSuccess: true,
      message: PASSWORD_RESET_SUCCESSFULLY_MESSAGE,
      ...meta,
    });

    return {
      message: PASSWORD_RESET_SUCCESSFULLY_MESSAGE,
    };
  }
}
