import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { BadRequestException, ConflictException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuditAction, AuditTargetType } from '@prisma/client';
import type { Cache } from 'cache-manager';
import { createHash, randomInt, randomUUID } from 'node:crypto';

import { AuditService } from '../../audit-logs/audit-logs.service';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { userCacheKeys } from '../cache/user-cache.keys';
import { AvatarStorageService } from '../storage/avatar-storage.service';
import { detectSupportedAvatar } from '../utils/avatar-file-filter.util';
import { UserValidationService } from '../validation/validation.service';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { RequestEmailChangeDto } from './dto/request-email-change.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { VerifyEmailChangeDto } from './dto/verify-email-change.dto';

const EMAIL_CHANGE_CODE_TTL_MS = 10 * 60 * 1000;
const EMAIL_CHANGE_MAX_ATTEMPTS = 5;
const PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class UserProfileService {
  private readonly logger = new Logger(UserProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly userCommonService: UserValidationService,
    private readonly auditService: AuditService,
    private readonly mailService: MailService,
    private readonly avatarStorageService: AvatarStorageService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) { }

  private calculateRemainingFreeGenerations(limit: number, used: number) {
    return Math.max(0, limit - used);
  }

  private buildProfile(user: {
    id: string;
    fullName: string;
    email: string;
    role: unknown;
    userType: unknown;
    accountStatus: unknown;
    creditBalance: number;
    freeGenerationLimit: number;
    freeGenerationsUsed: number;
    isActive: boolean;
    isVerified: boolean;
    createdAt: Date;
    avatarUrl: string | null;
    updatedAt?: Date;
  }) {
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      userType: user.userType,
      accountStatus: user.accountStatus,
      creditBalance: user.creditBalance,
      freeGenerationLimit: user.freeGenerationLimit,
      freeGenerationsUsed: user.freeGenerationsUsed,
      remainingFreeGenerations: this.calculateRemainingFreeGenerations(
        user.freeGenerationLimit,
        user.freeGenerationsUsed,
      ),
      isActive: user.isActive,
      isVerified: user.isVerified,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
      ...(user.updatedAt ? { updatedAt: user.updatedAt } : {}),
    };
  }

  private async clearProfileCaches(userId: string): Promise<void> {
    await Promise.all([
      this.cacheManager.del(userCacheKeys.profile(userId)),
      this.cacheManager.del(userCacheKeys.summary(userId)),
    ]);
  }

  private async safelyDeleteStoredAvatar(avatarUrl: string | null): Promise<void> {
    await this.avatarStorageService.deleteAvatarByUrl(avatarUrl);
  }

  async getProfile(userId: string) {
    const cacheKey = userCacheKeys.profile(userId);
    const cachedProfile = await this.cacheManager.get(cacheKey);

    if (cachedProfile) {
      return cachedProfile;
    }

    // The profile screen only needs account fields. Avoid loading the complete
    // User row (password hashes and unrelated internal columns) on every cache
    // miss.
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        deletedAt: null,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        userType: true,
        accountStatus: true,
        creditBalance: true,
        freeGenerationLimit: true,
        freeGenerationsUsed: true,
        isActive: true,
        isVerified: true,
        createdAt: true,
        updatedAt: true,
        avatarUrl: true,
      },
    });

    if (!user) {
      throw new BadRequestException('User was not found.');
    }

    const profile = this.buildProfile(user);

    await this.cacheManager.set(
      cacheKey,
      profile,
      PROFILE_CACHE_TTL_MS,
    );

    return profile;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const oldUser = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
    });

    if (!oldUser) {
      throw new BadRequestException('User was not found.');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.fullName !== undefined && { fullName: dto.fullName.trim() }),
        ...(dto.userType !== undefined && { userType: dto.userType }),
      },
    });

    await this.clearProfileCaches(userId);
    await this.auditService.createLog({
      actorId: userId,
      action: AuditAction.USER_UPDATE_PROFILE,
      targetType: AuditTargetType.USER,
      targetId: userId,
      oldValue: { fullName: oldUser.fullName, userType: oldUser.userType },
      newValue: { fullName: updatedUser.fullName, userType: updatedUser.userType },
    });

    return this.buildProfile(updatedUser);
  }

  private hashEmailChangeCode(
    requestId: string,
    purpose: 'CURRENT' | 'NEW',
    code: string,
  ): string {
    return createHash('sha256')
      .update(
        `${requestId}:${purpose}:${code}:${process.env.EMAIL_CHANGE_CODE_PEPPER ?? ''}`,
      )
      .digest('hex');
  }

  private generateEmailChangeCode(): string {
    return randomInt(100000, 1000000).toString();
  }

  private getEmailChangeExpiry(): Date {
    return new Date(Date.now() + EMAIL_CHANGE_CODE_TTL_MS);
  }

  /**
   * Starts a two-step email-change request.
   *
   * Step 1 sends a confirmation code to the current email address.
   * The new address is not contacted until the current address is verified.
   */
  async requestEmailChange(userId: string, dto: RequestEmailChangeDto) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, isActive: true },
      select: {
        id: true,
        fullName: true,
        email: true,
        passwordHash: true,
      },
    });

    if (!user) {
      throw new BadRequestException('User was not found.');
    }

    const newEmail = dto.newEmail.trim().toLowerCase();
    const currentEmail = user.email.trim().toLowerCase();

    if (newEmail === currentEmail) {
      throw new BadRequestException(
        'The new email must be different from the current email.',
      );
    }

    const passwordMatches = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException('Current password is incorrect.');
    }

    const duplicate = await this.prisma.user.findFirst({
      where: {
        email: newEmail,
        id: { not: userId },
        deletedAt: null,
      },
      select: { id: true },
    });

    if (duplicate) {
      throw new ConflictException(
        'This email address is already used by another account.',
      );
    }

    const requestId = randomUUID();
    const currentCode = this.generateEmailChangeCode();
    const currentCodeHash = this.hashEmailChangeCode(
      requestId,
      'CURRENT',
      currentCode,
    );
    const currentCodeExpiresAt = this.getEmailChangeExpiry();

    await this.prisma.$transaction(async (tx) => {
      await tx.emailChangeRequest.updateMany({
        where: {
          userId,
          completedAt: null,
          cancelledAt: null,
        },
        data: {
          cancelledAt: new Date(),
        },
      });

      await tx.emailChangeRequest.create({
        data: {
          id: requestId,
          userId,
          oldEmail: currentEmail,
          newEmail,
          currentCodeHash,
          currentCodeExpiresAt,
        },
      });
    });

    try {
      await this.mailService.sendCurrentEmailChangeApprovalCode(
        currentEmail,
        user.fullName,
        newEmail,
        currentCode,
        10,
      );
    } catch (error) {
      await this.prisma.emailChangeRequest.updateMany({
        where: {
          id: requestId,
          userId,
          completedAt: null,
          cancelledAt: null,
        },
        data: {
          cancelledAt: new Date(),
        },
      });

      throw error;
    }

    return {
      message:
        'A confirmation code was sent to your current email address.',
      stage: 'VERIFY_CURRENT_EMAIL',
      oldEmail: currentEmail,
      newEmail,
      expiresInSeconds: Math.floor(EMAIL_CHANGE_CODE_TTL_MS / 1000),
    };
  }

  /**
   * Confirms that the owner of the current email approves the change.
   * After approval, a second code is sent to the requested new email.
   */
  async verifyCurrentEmailChange(
    userId: string,
    dto: VerifyEmailChangeDto,
  ) {
    const now = new Date();

    const pending = await this.prisma.emailChangeRequest.findFirst({
      where: {
        userId,
        completedAt: null,
        cancelledAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (
      !pending ||
      pending.currentEmailVerifiedAt ||
      pending.currentCodeExpiresAt <= now
    ) {
      throw new BadRequestException(
        'The current-email confirmation code is invalid or expired.',
      );
    }

    if (pending.currentAttempts >= EMAIL_CHANGE_MAX_ATTEMPTS) {
      throw new BadRequestException(
        'Too many invalid attempts. Start a new email-change request.',
      );
    }

    const submittedHash = this.hashEmailChangeCode(
      pending.id,
      'CURRENT',
      dto.code,
    );

    if (submittedHash !== pending.currentCodeHash) {
      await this.prisma.emailChangeRequest.update({
        where: { id: pending.id },
        data: {
          currentAttempts: { increment: 1 },
        },
      });

      throw new BadRequestException(
        'The current-email confirmation code is invalid or expired.',
      );
    }

    const newCode = this.generateEmailChangeCode();
    const newCodeHash = this.hashEmailChangeCode(
      pending.id,
      'NEW',
      newCode,
    );
    const newCodeExpiresAt = this.getEmailChangeExpiry();

    await this.prisma.emailChangeRequest.update({
      where: { id: pending.id },
      data: {
        currentEmailVerifiedAt: now,
        newCodeHash,
        newCodeExpiresAt,
        newAttempts: 0,
      },
    });

    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { fullName: true },
      });

      await this.mailService.sendNewEmailChangeVerificationCode(
        pending.newEmail,
        user?.fullName ?? 'Nexora user',
        newCode,
        10,
      );
    } catch (error) {
      await this.prisma.emailChangeRequest.update({
        where: { id: pending.id },
        data: {
          cancelledAt: new Date(),
        },
      });

      throw error;
    }

    return {
      message:
        'The current email was confirmed. A verification code was sent to the new email address.',
      stage: 'VERIFY_NEW_EMAIL',
      newEmail: pending.newEmail,
      expiresInSeconds: Math.floor(EMAIL_CHANGE_CODE_TTL_MS / 1000),
    };
  }

  /**
   * Verifies the new address and changes the account email atomically.
   */
  async verifyNewEmailChange(
    userId: string,
    dto: VerifyEmailChangeDto,
  ) {
    const now = new Date();

    const pending = await this.prisma.emailChangeRequest.findFirst({
      where: {
        userId,
        completedAt: null,
        cancelledAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (
      !pending ||
      !pending.currentEmailVerifiedAt ||
      !pending.newCodeHash ||
      !pending.newCodeExpiresAt ||
      pending.newCodeExpiresAt <= now
    ) {
      throw new BadRequestException(
        'The new-email verification code is invalid or expired.',
      );
    }

    if (pending.newAttempts >= EMAIL_CHANGE_MAX_ATTEMPTS) {
      throw new BadRequestException(
        'Too many invalid attempts. Start a new email-change request.',
      );
    }

    const submittedHash = this.hashEmailChangeCode(
      pending.id,
      'NEW',
      dto.code,
    );

    if (submittedHash !== pending.newCodeHash) {
      await this.prisma.emailChangeRequest.update({
        where: { id: pending.id },
        data: {
          newAttempts: { increment: 1 },
        },
      });

      throw new BadRequestException(
        'The new-email verification code is invalid or expired.',
      );
    }

    const duplicate = await this.prisma.user.findFirst({
      where: {
        email: pending.newEmail,
        id: { not: userId },
        deletedAt: null,
      },
      select: { id: true },
    });

    if (duplicate) {
      throw new ConflictException(
        'This email address is already used by another account.',
      );
    }

    const updatedUser = await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.emailChangeRequest.updateMany({
        where: {
          id: pending.id,
          userId,
          completedAt: null,
          cancelledAt: null,
          currentEmailVerifiedAt: { not: null },
          newCodeExpiresAt: { gt: now },
        },
        data: {
          completedAt: now,
          newEmailVerifiedAt: now,
        },
      });

      if (consumed.count !== 1) {
        throw new BadRequestException(
          'The new-email verification code is invalid or expired.',
        );
      }

      return tx.user.update({
        where: { id: userId },
        data: {
          email: pending.newEmail,
          isVerified: true,
          emailVerifiedAt: now,
          verificationEmailSentAt: null,
        },
      });
    });

    await this.clearProfileCaches(userId);

    await this.auditService.createLog({
      actorId: userId,
      action: AuditAction.USER_UPDATE_PROFILE,
      targetType: AuditTargetType.USER,
      targetId: userId,
      oldValue: { email: pending.oldEmail },
      newValue: { email: pending.newEmail },
    });

    try {
      await this.mailService.sendEmailChangedNotice(
        pending.oldEmail,
        updatedUser.fullName,
        pending.newEmail,
      );
    } catch {
      this.logger.warn(
        `Email-change completion notice could not be sent for user ${userId}.`,
      );
    }

    return {
      message: 'Email changed successfully.',
      stage: 'COMPLETED',
      profile: this.buildProfile(updatedUser),
    };
  }

  /** Cancels the newest active email-change request. */
  async cancelEmailChange(userId: string) {
    await this.prisma.emailChangeRequest.updateMany({
      where: {
        userId,
        completedAt: null,
        cancelledAt: null,
      },
      data: {
        cancelledAt: new Date(),
      },
    });

    return {
      message: 'The pending email-change request was cancelled.',
    };
  }

  /** Validates, stores, and links a new avatar to the authenticated user. */
  async updateAvatar(userId: string, file: Express.Multer.File) {
    const oldUser = await this.userCommonService.findUserOrThrow(userId);
    const detectedType = detectSupportedAvatar(file.buffer);
    const filename = `${randomUUID()}.${detectedType.extension}`;

    const uploadedAvatar = await this.avatarStorageService.uploadAvatar({
      userId,
      filename,
      buffer: file.buffer,
      contentType: detectedType.mimeType,
    });

    let updatedUser;
    try {
      updatedUser = await this.prisma.user.update({
        where: { id: userId },
        data: { avatarUrl: uploadedAvatar.publicUrl },
      });
    } catch (error) {
      await this.avatarStorageService.deleteAvatarByUrl(
        uploadedAvatar.publicUrl,
      );
      throw error;
    }

    await this.safelyDeleteStoredAvatar(oldUser.avatarUrl);
    await this.clearProfileCaches(userId);

    await this.auditService.createLog({
      actorId: userId,
      action: AuditAction.USER_UPDATE_PROFILE,
      targetType: AuditTargetType.USER,
      targetId: userId,
      oldValue: { avatarUrl: oldUser.avatarUrl },
      newValue: { avatarUrl: updatedUser.avatarUrl },
    });

    return this.buildProfile(updatedUser);
  }

  /** Removes the avatar from both the database and Supabase Storage. */
  async removeAvatar(userId: string) {
    const oldUser = await this.userCommonService.findUserOrThrow(userId);

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: null },
    });

    await this.safelyDeleteStoredAvatar(oldUser.avatarUrl);
    await this.clearProfileCaches(userId);

    await this.auditService.createLog({
      actorId: userId,
      action: AuditAction.USER_UPDATE_PROFILE,
      targetType: AuditTargetType.USER,
      targetId: userId,
      oldValue: { avatarUrl: oldUser.avatarUrl },
      newValue: { avatarUrl: null },
    });

    return this.buildProfile(updatedUser);
  }

  /**
   * Soft-deletes a user account without breaking idea, publication, or payment
   * relations that must remain available for data integrity and auditing.
   */
  async deleteAccount(userId: string, dto: DeleteAccountDto) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, isActive: true },
      select: {
        id: true,
        email: true,
        fullName: true,
        passwordHash: true,
        avatarUrl: true,
      },
    });

    if (!user) {
      throw new BadRequestException('User was not found or is already deleted.');
    }

    const passwordMatches = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException('Current password is incorrect.');
    }

    const deletedAt = new Date();
    const anonymizedEmail = `deleted+${user.id}@deleted.nexora.local`;
    const unusablePasswordHash = await bcrypt.hash(randomUUID(), 12);

    await this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: deletedAt },
      });

      await tx.userDevice.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: deletedAt },
      });

      await tx.emailVerificationToken.deleteMany({ where: { userId } });
      await tx.passwordResetToken.deleteMany({ where: { userId } });
      await tx.emailChangeRequest.deleteMany({ where: { userId } });

      await tx.user.update({
        where: { id: userId },
        data: {
          fullName: 'Deleted user',
          email: anonymizedEmail,
          passwordHash: unusablePasswordHash,
          avatarUrl: null,
          isActive: false,
          isVerified: false,
          deletedAt,
          lockedAt: null,
          lockedUntil: null,
          lockDurationMinutes: null,
        },
      });
    });

    await this.clearProfileCaches(userId);
    await this.safelyDeleteStoredAvatar(user.avatarUrl);

    await this.auditService.createLog({
      actorId: userId,
      action: AuditAction.USER_UPDATE_PROFILE,
      targetType: AuditTargetType.USER,
      targetId: userId,
      oldValue: { isActive: true },
      newValue: { accountDeleted: true, deletedAt: deletedAt.toISOString() },
    });

    this.logger.log(`User account soft-deleted: ${userId}`);

    return {
      success: true,
      message: 'Your account has been deleted successfully.',
    };
  }

  async getFreeGenerations(userId: string) {
    const user = await this.userCommonService.findUserOrThrow(userId);
    return {
      limit: user.freeGenerationLimit,
      used: user.freeGenerationsUsed,
      remaining: this.calculateRemainingFreeGenerations(
        user.freeGenerationLimit,
        user.freeGenerationsUsed,
      ),
    };
  }
}