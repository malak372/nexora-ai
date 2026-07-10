import { BadRequestException, Injectable } from '@nestjs/common';
import { AuthAction } from '@prisma/client';
import { randomBytes } from 'crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../../mail/mail.service';
import { AuthTokenService } from '../token/token.service';
import { AuthAuditService, AuthRequestMeta } from '../audit/audit.service';

const EMAIL_VERIFICATION_TOKEN_BYTES = 32;
const EMAIL_VERIFICATION_TOKEN_EXPIRES_HOURS = 24;

/**
 * Service responsible for email verification operations.
 *
 * Handles:
 * - Creating secure email verification tokens.
 * - Invalidating old unused verification tokens.
 * - Sending verification emails.
 * - Resending verification links for unverified users.
 * - Verifying user email addresses.
 * - Marking accounts as verified.
 * - Sending welcome emails after successful verification.
 * - Recording authentication audit logs for email events.
 *
 * @author Eman
 */
@Injectable()
export class AuthEmailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly authTokenService: AuthTokenService,
    private readonly authAuditService: AuthAuditService,
  ) {}

  /**
   * Generates and sends an email verification link.
   *
   * Any previous unused verification tokens for the same user
   * are invalidated before creating a new token. The plain token
   * is sent only through email, while its hashed value is stored
   * in the database for security.
   *
   * After the verification email is sent, an authentication audit
   * log is recorded.
   *
   * @param userId User ID that requires email verification.
   * @param email Email address that will receive the verification link.
   * @returns A promise that resolves after the email is sent.
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

    const frontendUrl = process.env.APP_FRONTEND_URL ?? 'http://localhost:3000';

    const verificationLink =
      `${frontendUrl}/verify-email?email=${encodeURIComponent(email)}` +
      `&token=${verificationToken}`;

    await this.mailService.sendVerificationEmail(email, verificationLink);

    await this.authAuditService.createLog({
      userId,
      email,
      action: AuthAction.VERIFICATION_EMAIL_SENT,
      isSuccess: true,
      message: 'Verification email sent successfully',
    });
  }

  /**
   * Resends an email verification link for an unverified active user.
   *
   * The request is rejected if the account does not exist,
   * is inactive, or is already verified. After a new verification
   * link is sent, an authentication audit log is recorded.
   *
   * @param email User email address.
   * @param meta Optional request metadata such as IP address and user agent.
   * @returns Verification email resend confirmation message.
   *
   * @throws BadRequestException if the verification request is invalid.
   */
  async resendVerificationEmail(email: string, meta?: AuthRequestMeta) {
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

    await this.authAuditService.createLog({
      userId: user.id,
      email: user.email,
      action: AuthAction.RESEND_VERIFICATION_EMAIL,
      isSuccess: true,
      message: 'Verification email resent successfully',
      ...meta,
    });

    return {
      message: 'Verification email has been resent successfully',
    };
  }

  /**
   * Verifies a user's email address using a verification token.
   *
   * The email and token must be provided. The user must exist,
   * be active, and not already verified. The verification token
   * must exist, belong to the requested user, be unused, and
   * not be expired.
   *
   * Failed verification attempts are recorded in authentication
   * audit logs before rejecting the request. After successful
   * verification, the user's account is marked as verified,
   * the token is marked as used, a welcome email is sent, and
   * a successful verification audit log is recorded.
   *
   * @param email User email address.
   * @param token Plain verification token received from the verification link.
   * @param meta Optional request metadata such as IP address and user agent.
   * @returns Email verification confirmation message.
   *
   * @throws BadRequestException if the email or token is missing,
   * the request is invalid, or the token is invalid, expired,
   * or already used.
   */
  async verifyEmail(email: string, token: string, meta?: AuthRequestMeta) {
    if (!email || !token) {
      await this.authAuditService.createLog({
        email,
        action: AuthAction.VERIFY_EMAIL_FAILED,
        isSuccess: false,
        message: 'Email or verification token is missing',
        ...meta,
      });

      throw new BadRequestException('Email and token are required');
    }

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        isVerified: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      await this.authAuditService.createLog({
        userId: user?.id,
        email,
        action: AuthAction.VERIFY_EMAIL_FAILED,
        isSuccess: false,
        message: 'Invalid verification request',
        ...meta,
      });

      throw new BadRequestException('Invalid verification request');
    }

    if (user.isVerified) {
      return {
        message: 'Email is already verified',
      };
    }

    const tokenHash = this.authTokenService.hashToken(token);

    const storedToken = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
    });

    if (
      !storedToken ||
      storedToken.userId !== user.id ||
      storedToken.usedAt ||
      storedToken.expiresAt < new Date()
    ) {
      await this.authAuditService.createLog({
        userId: user.id,
        email: user.email,
        action: AuthAction.VERIFY_EMAIL_FAILED,
        isSuccess: false,
        message: 'Invalid or expired verification token',
        ...meta,
      });

      throw new BadRequestException('Invalid or expired verification token');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          isVerified: true,
          emailVerifiedAt: new Date(),
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

    await this.authAuditService.createLog({
      userId: user.id,
      email: user.email,
      action: AuthAction.EMAIL_VERIFIED,
      isSuccess: true,
      message: 'Email verified successfully',
      ...meta,
    });

    return {
      message: 'Email verified successfully',
    };
  }
}
