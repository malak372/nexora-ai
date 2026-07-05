import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { AuditAction, AuditTargetType } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserValidationService } from '../validation/validation.service';
import { AuditService } from '../../audit-logs/audit-logs.service';
import { userCacheKeys } from '../cache/user-cache.keys';

/**
 * Service responsible for managing the authenticated user's profile.
 *
 * Handles profile retrieval, editable profile updates,
 * free generation usage tracking, and cache invalidation
 * for profile-related user data.
 *
 * Business rules:
 * - Users can only modify allowed profile fields: fullName and userType.
 * - System-managed fields such as role, accountStatus, creditBalance,
 *   and free generation counters cannot be modified here.
 * - Premium access is represented by the user's account status.
 * - Profile updates are audited for traceability.
 *
 * @author Eman
 */
@Injectable()
export class UserProfileService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly userCommonService: UserValidationService,
        private readonly auditService: AuditService,

        @Inject(CACHE_MANAGER)
        private readonly cacheManager: Cache,
    ) { }

    private calculateRemainingFreeGenerations(limit: number, used: number) {
        return Math.max(0, limit - used);
    }

    /**
     * Retrieves the authenticated user's profile information.
     *
     * Uses cache to reduce repeated database reads for frequently
     * requested profile data.
     */
    async getProfile(userId: string) {
        const cacheKey = userCacheKeys.profile(userId);
        const cachedProfile = await this.cacheManager.get(cacheKey);

        if (cachedProfile) {
            return cachedProfile;
        }

        const user = await this.userCommonService.findUserOrThrow(userId);

        const profile = {
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
            createdAt: user.createdAt,
        };

        await this.cacheManager.set(cacheKey, profile);

        return profile;
    }

    /**
     * Updates the authenticated user's editable profile fields.
     *
     * Invalidates cached profile and dashboard summary data
     * because these responses may contain profile fields.
     */
    async updateProfile(userId: string, dto: UpdateProfileDto) {
        const oldUser = await this.userCommonService.findUserOrThrow(userId);

        const updatedUser = await this.prisma.user.update({
            where: { id: userId },
            data: {
                ...(dto.fullName !== undefined && {
                    fullName: dto.fullName,
                }),
                ...(dto.userType !== undefined && {
                    userType: dto.userType,
                }),
            },
        });

        await this.cacheManager.del(userCacheKeys.profile(userId));
        await this.cacheManager.del(userCacheKeys.summary(userId));

        await this.auditService.createLog({
            actorId: userId,
            action: AuditAction.USER_UPDATE_PROFILE,
            targetType: AuditTargetType.USER,
            targetId: userId,
            oldValue: {
                fullName: oldUser.fullName,
                userType: oldUser.userType,
            },
            newValue: {
                fullName: updatedUser.fullName,
                userType: updatedUser.userType,
            },
        });

        return {
            id: updatedUser.id,
            fullName: updatedUser.fullName,
            email: updatedUser.email,
            role: updatedUser.role,
            userType: updatedUser.userType,
            accountStatus: updatedUser.accountStatus,
            creditBalance: updatedUser.creditBalance,
            freeGenerationLimit: updatedUser.freeGenerationLimit,
            freeGenerationsUsed: updatedUser.freeGenerationsUsed,
            remainingFreeGenerations: this.calculateRemainingFreeGenerations(
                updatedUser.freeGenerationLimit,
                updatedUser.freeGenerationsUsed,
            ),
            updatedAt: updatedUser.updatedAt,
        };
    }

    /**
     * Retrieves free generation usage statistics.
     */
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