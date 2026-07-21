import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { AuthAction } from '@prisma/client';

import { randomBytes } from 'crypto';

import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';

import { AuthAuditService, AuthRequestMeta } from '../audit/audit.service';

import { AuthTokenService } from '../token/token.service';

/**
 * Number of random bytes used to generate
 * an email-verification token.
 */
const EMAIL_VERIFICATION_TOKEN_BYTES = 32;

/**
 * Email-verification token lifetime in hours.
 */
const EMAIL_VERIFICATION_TOKEN_EXPIRES_HOURS = 24;

/**
 * Minimum duration between verification-email deliveries.
 */
const EMAIL_VERIFICATION_COOLDOWN_MS = 60_000;

/**
 * Generic response used to prevent account enumeration.
 */
const VERIFICATION_EMAIL_REQUEST_MESSAGE =
  'If the account is eligible, a verification email has been sent.';

/**
 * Result returned by email-verification operations.
 */
type AuthEmailMessage = {
  readonly message: string;
};

/**
 * Service responsible for email-verification operations.
 *
 * Handles:
 * - Secure verification-token creation.
 * - Verification-email delivery.
 * - Verification-email resend cooldowns.
 * - Email-address verification.
 * - Token invalidation.
 * - Welcome-email delivery.
 * - Authentication audit logging.
 *
 * @author Eman
 */
@Injectable()
export class AuthEmailService {
  private readonly logger = new Logger(AuthEmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly authTokenService: AuthTokenService,
    private readonly authAuditService: AuthAuditService,
  ) {}

  /**
   * Generates and sends an email-verification link.
   *
   * Only the token hash is persisted. The plain token
   * is included exclusively in the verification email.
   *
   * Previous unused verification tokens are invalidated
   * after the new verification email is delivered.
   *
   * @param userId User requiring email verification.
   * @param email Recipient email address.
   * @param meta Optional request metadata.
   * @param claimedAt Cooldown timestamp already reserved
   * by the resend operation.
   */
  async sendEmailVerificationLink(
    userId: string,
    email: string,
    meta?: AuthRequestMeta,
    claimedAt: Date = new Date(),
  ): Promise<void> {
    const verificationToken = randomBytes(
      EMAIL_VERIFICATION_TOKEN_BYTES,
    ).toString('hex');

    const tokenHash = this.authTokenService.hashToken(verificationToken);

    const expiresAt = new Date(
      Date.now() + EMAIL_VERIFICATION_TOKEN_EXPIRES_HOURS * 60 * 60 * 1000,
    );

    const storedToken = await this.prisma.emailVerificationToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
      },
      select: {
        id: true,
      },
    });

    try {
      const frontendUrl =
        process.env.APP_FRONTEND_URL ?? 'http://localhost:3000';

      const verificationLink =
        `${frontendUrl}/verify-email` +
        `?email=${encodeURIComponent(email)}` +
        `&token=${encodeURIComponent(verificationToken)}`;

      await this.mailService.sendVerificationEmail(email, verificationLink);

      const now = new Date();

      await this.prisma.$transaction([
        this.prisma.emailVerificationToken.updateMany({
          where: {
            userId,
            id: {
              not: storedToken.id,
            },
            usedAt: null,
          },
          data: {
            usedAt: now,
          },
        }),

        this.prisma.user.update({
          where: {
            id: userId,
          },
          data: {
            verificationEmailSentAt: claimedAt,
          },
        }),
      ]);

      await this.authAuditService.createLog({
        userId,
        email,
        action: AuthAction.VERIFICATION_EMAIL_SENT,
        isSuccess: true,
        message: 'Verification email sent successfully',
        ...meta,
      });
    } catch (error: unknown) {
      /*
       * The new token must not remain active when
       * its email could not be delivered.
       */
      await this.prisma.emailVerificationToken
        .delete({
          where: {
            id: storedToken.id,
          },
        })
        .catch(() => undefined);

      /*
       * Release the cooldown only when this request
       * still owns the stored timestamp.
       */
      await this.prisma.user
        .updateMany({
          where: {
            id: userId,
            verificationEmailSentAt: claimedAt,
          },
          data: {
            verificationEmailSentAt: null,
          },
        })
        .catch(() => undefined);

      await this.authAuditService
        .createLog({
          userId,
          email,
          action: AuthAction.VERIFICATION_EMAIL_SENT,
          isSuccess: false,
          message: 'Verification email delivery failed',
          ...meta,
        })
        .catch(() => undefined);

      throw error;
    }
  }

  /**
   * Requests a new verification email for an
   * active and unverified account.
   *
   * A database-backed cooldown ensures that only
   * one email can be delivered during the configured
   * cooldown period, including when multiple requests
   * arrive concurrently.
   *
   * A generic response is always returned to prevent
   * disclosure of registered email addresses.
   *
   * @param email User email address.
   * @param meta Optional request metadata.
   * @returns Generic request confirmation.
   */
  async resendVerificationEmail(
    email: string,
    meta?: AuthRequestMeta,
  ): Promise<AuthEmailMessage> {
    const genericResponse: AuthEmailMessage = {
      message: VERIFICATION_EMAIL_REQUEST_MESSAGE,
    };

    const user = await this.prisma.user.findUnique({
      where: {
        email,
      },
      select: {
        id: true,
        email: true,
        isActive: true,
        isVerified: true,
        emailVerifiedAt: true,
      },
    });

    /*
     * Do not reveal whether:
     * - The account does not exist.
     * - The account is inactive.
     * - The account is already verified.
     */
    if (!user || !user.isActive || user.isVerified || user.emailVerifiedAt) {
      return genericResponse;
    }

    const claimedAt = new Date();

    const cooldownThreshold = new Date(
      claimedAt.getTime() - EMAIL_VERIFICATION_COOLDOWN_MS,
    );

    /*
     * Atomically reserve the email-delivery attempt.
     *
     * If two requests arrive together, only one of
     * them can update the timestamp and send an email.
     */
    const cooldownClaim = await this.prisma.user.updateMany({
      where: {
        id: user.id,
        isActive: true,
        isVerified: false,
        emailVerifiedAt: null,
        OR: [
          {
            verificationEmailSentAt: null,
          },
          {
            verificationEmailSentAt: {
              lte: cooldownThreshold,
            },
          },
        ],
      },
      data: {
        verificationEmailSentAt: claimedAt,
      },
    });

    if (cooldownClaim.count === 0) {
      return genericResponse;
    }

    await this.sendEmailVerificationLink(user.id, user.email, meta, claimedAt);

    await this.authAuditService.createLog({
      userId: user.id,
      email: user.email,
      action: AuthAction.RESEND_VERIFICATION_EMAIL,
      isSuccess: true,
      message: 'Verification email resend request processed successfully',
      ...meta,
    });

    return genericResponse;
  }

  /**
   * Verifies a user's email address using a valid
   * email-verification token.
   *
   * @param email User email address.
   * @param token Plain verification token.
   * @param meta Optional request metadata.
   * @returns Email-verification result.
   *
   * @throws BadRequestException When the request or
   * token is invalid.
   */
  async verifyEmail(
    email: string,
    token: string,
    meta?: AuthRequestMeta,
  ): Promise<AuthEmailMessage> {
    const user = await this.prisma.user.findUnique({
      where: {
        email,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
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
      where: {
        tokenHash,
      },
      select: {
        id: true,
        userId: true,
        usedAt: true,
        expiresAt: true,
      },
    });

    const now = new Date();

    if (
      !storedToken ||
      storedToken.userId !== user.id ||
      storedToken.usedAt ||
      storedToken.expiresAt <= now
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

    /*
     * Mark the token as used atomically.
     *
     * This prevents two simultaneous requests from
     * successfully using the same verification token.
     */
    const consumedToken = await this.prisma.emailVerificationToken.updateMany({
      where: {
        id: storedToken.id,
        userId: user.id,
        usedAt: null,
        expiresAt: {
          gt: now,
        },
      },
      data: {
        usedAt: now,
      },
    });

    if (consumedToken.count === 0) {
      await this.authAuditService.createLog({
        userId: user.id,
        email: user.email,
        action: AuthAction.VERIFY_EMAIL_FAILED,
        isSuccess: false,
        message: 'Verification token was already consumed',
        ...meta,
      });

      throw new BadRequestException('Invalid or expired verification token');
    }

    await this.prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        isVerified: true,
        emailVerifiedAt: now,
        verificationEmailSentAt: null,
      },
    });

    /*
     * Email verification must remain successful even
     * if the optional welcome email cannot be delivered.
     */
    try {
      await this.mailService.sendWelcomeEmail(user.email, user.fullName);
    } catch {
      this.logger.warn(`Welcome email could not be sent for user ${user.id}.`);
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
