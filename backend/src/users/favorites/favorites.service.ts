import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

import { PrismaService } from '../../prisma/prisma.service';
import { UserValidationService } from '../validation/validation.service';
import { userCacheKeys } from '../cache/user-cache.keys';

/**
 * Service responsible for authenticated user favorite ideas.
 *
 * Users can only favorite, remove, and view ideas that belong to them.
 *
 * Cache behavior:
 * - Adding or removing a favorite idea invalidates the cached dashboard
 *   summary because favoriteIdeasCount is displayed there.
 *
 * @author Eman
 */
@Injectable()
export class UserFavoritesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userCommonService: UserValidationService,

    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  /**
   * Adds an owned idea to the authenticated user's favorites.
   */
  async addFavorite(userId: string, ideaId: string) {
    await this.userCommonService.findUserOrThrow(userId);

    const idea = await this.prisma.idea.findFirst({
      where: {
        id: ideaId,
        userId,
      },
      select: { id: true },
    });

    if (!idea) {
      throw new NotFoundException('Idea not found');
    }

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

    await this.cacheManager.del(userCacheKeys.summary(userId));

    return favorite;
  }

  /**
   * Removes an owned idea from the authenticated user's favorites.
   */
  async removeFavorite(userId: string, ideaId: string) {
    await this.userCommonService.findUserOrThrow(userId);

    const favorite = await this.prisma.favoriteIdea.findUnique({
      where: {
        userId_ideaId: {
          userId,
          ideaId,
        },
      },
    });

    if (!favorite) {
      throw new NotFoundException('Favorite idea not found');
    }

    await this.prisma.favoriteIdea.delete({
      where: {
        userId_ideaId: {
          userId,
          ideaId,
        },
      },
    });

    await this.cacheManager.del(userCacheKeys.summary(userId));

    return {
      message: 'Idea removed from favorites',
    };
  }

  /**
   * Retrieves all favorite ideas for the authenticated user.
   */
  async getFavorites(userId: string) {
    await this.userCommonService.findUserOrThrow(userId);

    return this.prisma.favoriteIdea.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        idea: {
          select: {
            id: true,
            title: true,
            problemStatement: true,
            objectives: true,
            targetUsers: true,
            partialAbstract: true,
            generationType: true,
            isUnlocked: true,
            unlockMethod: true,
            commentsCount: true,
            selectedRegion: true,
            createdAt: true,
            domain: true,
            selectedPlatform: true,
          },
        },
      },
    });
  }
}
