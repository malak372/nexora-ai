import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserValidationService } from '../validation/Validation.service';

/**
 * Service responsible for managing the authenticated user's profile.
 *
 * This service handles all profile-related operations including:
 *
 * - Retrieving full user profile information
 * - Updating editable profile fields
 * - Tracking free generation usage limits
 *
 * Business rules:
 * - Users can only modify allowed profile fields (fullName, userType)
 * - System-managed fields such as role, accountStatus, and creditBalance
 *   cannot be modified through this service
 * - Premium status is derived automatically from creditBalance
 *
 * The service ensures consistency between user identity,
 * generation limits, and system-defined account state.
 *
 * @author Eman
 */
@Injectable()
export class UserProfileService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly userCommonService: UserValidationService,
    ) { }

    /**
     * Calculates remaining free generations for the user.
     *
     * Ensures the value never becomes negative even if
     * inconsistent data exists in the database.
     *
     * @param limit - Maximum allowed free generations
     * @param used - Number of already consumed free generations
     * @returns Remaining available free generations
     */
    private calculateRemainingFreeGenerations(limit: number, used: number) {
        return Math.max(0, limit - used);
    }

    /**
     * Retrieves the authenticated user's profile information.
     *
     * This includes:
     * - Basic identity (id, fullName, email)
     * - Role and user classification (userType)
     * - Account state (accountStatus, isActive, isVerified)
     * - Credit and generation limits
     *
     * @param userId - Authenticated user ID
     * @returns Complete user profile snapshot
     *
     * @throws NotFoundException if user does not exist
     */
    async getProfile(userId: string) {
        const user = await this.userCommonService.findUserOrThrow(userId);

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
            createdAt: user.createdAt,
        };
    }

    /**
     * Updates the authenticated user's profile.
     *
     * Only explicitly allowed fields can be updated:
     * - fullName
     * - userType
     *
     * All other fields are strictly controlled by the system.
     *
     * @param userId - Authenticated user ID
     * @param dto - Profile update payload
     * @returns Updated user profile snapshot
     *
     * @throws NotFoundException if user does not exist
     */
    async updateProfile(userId: string, dto: UpdateProfileDto) {
        await this.userCommonService.findUserOrThrow(userId);

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
     *
     * Useful for:
     * - UI usage tracking
     * - enforcing free tier limits
     * - guiding upgrade to credit system
     *
     * @param userId - Authenticated user ID
     * @returns Free generation quota information
     *
     * @throws NotFoundException if user does not exist
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