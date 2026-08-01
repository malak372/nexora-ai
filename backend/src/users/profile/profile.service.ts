import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { AuditAction, AuditTargetType } from '@prisma/client';
import type { Cache } from 'cache-manager';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { AuditService } from '../../audit-logs/audit-logs.service';
import { PrismaService } from '../../prisma/prisma.service';
import { userCacheKeys } from '../cache/user-cache.keys';
import {
  detectSupportedAvatar,
  getLocalAvatarFilename,
} from '../utils/avatar-file-filter.util';
import { UserValidationService } from '../validation/validation.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

const AVATAR_PUBLIC_PREFIX = '/uploads/avatars/';
const AVATAR_DIRECTORY = join(process.cwd(), 'uploads', 'avatars');

@Injectable()
export class UserProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userCommonService: UserValidationService,
    private readonly auditService: AuditService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

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

  private async safelyDeleteLocalAvatar(avatarUrl: string | null): Promise<void> {
    const filename = getLocalAvatarFilename(avatarUrl);
    if (!filename) return;

    try {
      await unlink(join(AVATAR_DIRECTORY, filename));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw error;
    }
  }

  async getProfile(userId: string) {
    const cacheKey = userCacheKeys.profile(userId);
    const cachedProfile = await this.cacheManager.get(cacheKey);
    if (cachedProfile) return cachedProfile;

    const user = await this.userCommonService.findUserOrThrow(userId);
    const profile = this.buildProfile(user);
    await this.cacheManager.set(cacheKey, profile);
    return profile;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const oldUser = await this.userCommonService.findUserOrThrow(userId);
    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.fullName !== undefined && { fullName: dto.fullName }),
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

  /** Validates, stores, and links a new avatar to the authenticated user. */
  async updateAvatar(userId: string, file: Express.Multer.File) {
    const oldUser = await this.userCommonService.findUserOrThrow(userId);
    const detectedType = detectSupportedAvatar(file.buffer);
    const filename = `${randomUUID()}.${detectedType.extension}`;
    const avatarUrl = `${AVATAR_PUBLIC_PREFIX}${filename}`;

    await mkdir(AVATAR_DIRECTORY, { recursive: true });
    await writeFile(join(AVATAR_DIRECTORY, filename), file.buffer, {
      flag: 'wx',
    });

    let updatedUser;
    try {
      updatedUser = await this.prisma.user.update({
        where: { id: userId },
        data: { avatarUrl },
      });
    } catch (error) {
      await this.safelyDeleteLocalAvatar(avatarUrl);
      throw error;
    }

    await this.safelyDeleteLocalAvatar(oldUser.avatarUrl);
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

  /** Removes the avatar from both the database and local storage. */
  async removeAvatar(userId: string) {
    const oldUser = await this.userCommonService.findUserOrThrow(userId);

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: null },
    });

    await this.safelyDeleteLocalAvatar(oldUser.avatarUrl);
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