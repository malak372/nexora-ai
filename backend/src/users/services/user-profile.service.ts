import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateProfileDto } from '../dto/update-profile.dto';
import { UserCommonService } from './user-common.service';

/**
 * Service responsible for user profile operations.
 *
 * This service handles the authenticated user's profile data,
 * profile updates, and free generation usage information.
 *
 * It uses UserCommonService for shared user validation logic.
 *
 * @author Eman
 */
@Injectable()
export class UserProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userCommonService: UserCommonService,
  ) { }

  /**
   * Calculates the remaining free generations.
   *
   * The returned value is never negative.
   *
   * @param limit - Total number of allowed free generations.
   * @param used - Number of already used free generations.
   * @returns Remaining free generations.
   */
  private calculateRemainingFreeGenerations(limit: number, used: number) {
    return Math.max(0, limit - used);
  }

  /**
   * Retrieves the authenticated user's profile.
   *
   * @param userId - Authenticated user ID.
   * @returns User profile information with free generation statistics.
   *
   * @throws NotFoundException if the user does not exist.
   */
  async getProfile(userId: string) {
    const user = await this.userCommonService.findUserOrThrow(userId);

    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
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
   * Currently, only the user's full name can be updated.
   * Fields that are not provided are ignored.
   *
   * @param userId - Authenticated user ID.
   * @param dto - Profile update request data.
   * @returns Updated user profile information.
   *
   * @throws NotFoundException if the user does not exist.
   */
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    await this.userCommonService.findUserOrThrow(userId);

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.fullName !== undefined && {
          fullName: dto.fullName,
        }),
      },
    });

    return {
      id: updatedUser.id,
      fullName: updatedUser.fullName,
      email: updatedUser.email,
      role: updatedUser.role,
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
   * Retrieves the authenticated user's free generation usage.
   *
   * @param userId - Authenticated user ID.
   * @returns Free generation limit, used count, and remaining count.
   *
   * @throws NotFoundException if the user does not exist.
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