import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Cache } from 'cache-manager';

import { PrismaService } from '../../prisma/prisma.service';
import { userCacheKeys } from '../cache/user-cache.keys';
import { UserValidationService } from '../validation/validation.service';

/**
 * Manages private favorites for authenticated users' generated ideas.
 *
 * Business rules:
 * - A user can favorite only an idea owned by the same user.
 * - The idea does not need to be published.
 * - Guest ideas cannot be favorited until they are transferred to a user.
 * - Favorites are private and are never exposed through public publications.
 * - Repeated add operations are idempotent.
 *
 * @author Eman
 */
@Injectable()
export class UserFavoritesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userValidationService: UserValidationService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  /** Adds one user-owned generated idea to private favorites. */
  async addFavorite(userId: string, ideaId: string) {
    await this.userValidationService.findUserOrThrow(userId);
    await this.findOwnedIdeaOrThrow(userId, ideaId);

    const favorite = await this.prisma.favoriteIdea.upsert({
      where: {
        userId_ideaId: {
          userId,
          ideaId,
        },
      },
      update: {},
      create: {
        userId,
        ideaId,
      },
      select: {
        id: true,
        userId: true,
        ideaId: true,
        createdAt: true,
      },
    });

    await this.invalidateUserCaches(userId);

    return {
      message: 'Idea added to favorites.',
      favorite,
    };
  }

  /** Removes one user-owned generated idea from private favorites. */
  async removeFavorite(userId: string, ideaId: string) {
    await this.userValidationService.findUserOrThrow(userId);

    const result = await this.prisma.favoriteIdea.deleteMany({
      where: {
        userId,
        ideaId,
      },
    });

    if (result.count === 0) {
      throw new NotFoundException('Favorite idea not found.');
    }

    await this.invalidateUserCaches(userId);

    return {
      message: 'Idea removed from favorites.',
    };
  }

  /** Returns all non-deleted favorite ideas owned by the current user. */
  async getFavorites(userId: string) {
    await this.userValidationService.findUserOrThrow(userId);

    const favorites = await this.prisma.favoriteIdea.findMany({
      where: {
        userId,
        idea: {
          userId,
          deletedAt: null,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        createdAt: true,
        idea: {
          select: {
            id: true,
            title: true,
            generationType: true,
            selectedRegion: true,
            limitedAbstract: true,
            partialAbstract: true,
            fullAbstract: true,
            problemStatement: true,
            objectives: true,
            targetUsers: true,
            isUnlocked: true,
            unlockMethod: true,
            unlockedAt: true,
            commentsCount: true,
            createdAt: true,
            updatedAt: true,
            domain: {
              select: {
                id: true,
                name: true,
              },
            },
            publication: {
              select: {
                id: true,
                status: true,
                visibility: true,
                publishedAt: true,
              },
            },
            generationRun: {
              select: {
                id: true,
                status: true,
                currentStageKey: true,
                progressPercent: true,
              },
            },
            _count: {
              select: {
                generatedOutputs: true,
                chatSessions: true,
              },
            },
          },
        },
      },
    });

    return favorites.map((favorite) => ({
      id: favorite.id,
      favoritedAt: favorite.createdAt,
      idea: {
        ...favorite.idea,
        fullAbstract: favorite.idea.isUnlocked
          ? favorite.idea.fullAbstract
          : null,
        commentsCount: favorite.idea.isUnlocked
          ? favorite.idea.commentsCount
          : undefined,
        isFavorite: true,
        access: {
          canViewAdvancedOutputs: favorite.idea.isUnlocked,
          canViewFullAbstract: favorite.idea.isUnlocked,
          canViewCommunityData: favorite.idea.isUnlocked,
          canUseAiChat: favorite.idea.isUnlocked,
          requiresDirectUnlock: !favorite.idea.isUnlocked,
        },
      },
    }));
  }

  /** Ensures that the requested idea exists and belongs to the current user. */
  private async findOwnedIdeaOrThrow(
    userId: string,
    ideaId: string,
  ): Promise<void> {
    const idea = await this.prisma.idea.findFirst({
      where: {
        id: ideaId,
        userId,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!idea) {
      throw new NotFoundException('User-owned idea not found.');
    }
  }

  /** Invalidates user summaries affected by favorite changes. */
  private async invalidateUserCaches(userId: string): Promise<void> {
    await this.cacheManager.del(userCacheKeys.summary(userId));
  }
}
