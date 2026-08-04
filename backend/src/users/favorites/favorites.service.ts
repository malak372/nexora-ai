import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Cache } from 'cache-manager';

import { AccountStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { userCacheKeys } from '../cache/user-cache.keys';
import { UserValidationService } from '../validation/validation.service';

/**
 * Manages the authenticated user's private favorite-idea collection.
 *
 * A favorite can represent:
 * - An idea generated and owned by the authenticated user.
 * - An idea accepted by the authenticated user through its publication.
 *
 * Accepted favorites expose only the safe publication snapshot. They never
 * expose the source owner's private generation data or protected AI outputs.
 *
 * Repeated add operations are idempotent and the existing FavoriteIdea table
 * is reused, so no database migration is required.
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

  /**
   * Adds an owned or accepted idea to the user's private favorites.
   */
  async addFavorite(userId: string, ideaId: string) {
    await this.userValidationService.findUserOrThrow(userId);
    await this.ensureFavoriteAccess(userId, ideaId);

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

  /**
   * Removes one favorite owned by the authenticated user.
   */
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

  /**
   * Returns owned and accepted favorites in one safe, unified collection.
   */
  async getFavorites(userId: string) {
    await this.userValidationService.findUserOrThrow(userId);

    const [user, favorites] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { accountStatus: true },
      }),
      this.prisma.favoriteIdea.findMany({
        where: {
          userId,
          idea: {
            deletedAt: null,
            OR: [
              { userId },
              {
                publication: {
                  acceptances: {
                    some: { userId },
                  },
                },
              },
            ],
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
              userId: true,
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
                  ideaId: true,
                  status: true,
                  visibility: true,
                  publicTitle: true,
                  publicAbstract: true,
                  publicProblem: true,
                  publicObjectives: true,
                  publicTargetUsers: true,
                  publishedAt: true,
                  archivedAt: true,
                  acceptances: {
                    where: { userId },
                    take: 1,
                    select: {
                      id: true,
                      acceptedAt: true,
                      advancedUnlockedAt: true,
                    },
                  },
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
      }),
    ]);

    const canUseAiChat = user.accountStatus === AccountStatus.PREMIUM;

    return favorites.map((favorite) => {
      const idea = favorite.idea;
      const isOwned = idea.userId === userId;
      const acceptance = idea.publication?.acceptances?.[0] ?? null;

      if (isOwned) {
        const {
          userId: _ownerId,
          publication,
          ...safeOwnedIdea
        } = idea;

        return {
          id: favorite.id,
          favoritedAt: favorite.createdAt,
          favoriteKind: 'OWNED',
          idea: {
            ...safeOwnedIdea,
            publication: publication
              ? {
                  ...publication,
                  acceptances: undefined,
                }
              : null,
            fullAbstract: idea.isUnlocked ? idea.fullAbstract : null,
            commentsCount: idea.isUnlocked ? idea.commentsCount : undefined,
            isFavorite: true,
            access: {
              canViewAdvancedOutputs: idea.isUnlocked,
              canViewFullAbstract: idea.isUnlocked,
              canViewCommunityData: idea.isUnlocked,
              canUseAiChat: idea.isUnlocked && canUseAiChat,
              requiresDirectUnlock: !idea.isUnlocked,
            },
          },
        };
      }

      if (!idea.publication || !acceptance) {
        throw new ForbiddenException(
          'Accepted favorite access is no longer available.',
        );
      }

      const publication = idea.publication;
      const hasAdvancedAccess = acceptance.advancedUnlockedAt !== null;

      return {
        id: favorite.id,
        favoritedAt: favorite.createdAt,
        favoriteKind: 'ACCEPTED',
        idea: {
          id: idea.id,
          title: publication.publicTitle,
          limitedAbstract: publication.publicAbstract,
          problemStatement: publication.publicProblem,
          objectives: publication.publicObjectives,
          targetUsers: publication.publicTargetUsers,
          selectedRegion: idea.selectedRegion,
          domain: idea.domain,
          createdAt: acceptance.acceptedAt,
          updatedAt: idea.updatedAt,
          isUnlocked: hasAdvancedAccess,
          isFavorite: true,
          publication: {
            id: publication.id,
            ideaId: publication.ideaId,
            status: publication.status,
            visibility: publication.visibility,
            publishedAt: publication.publishedAt,
            archivedAt: publication.archivedAt,
          },
          acceptance: {
            id: acceptance.id,
            acceptedAt: acceptance.acceptedAt,
            advancedUnlockedAt: acceptance.advancedUnlockedAt,
          },
          acceptedAt: acceptance.acceptedAt,
          hasAdvancedAccess,
          __libraryKind: 'accepted',
          access: {
            canViewAdvancedOutputs: hasAdvancedAccess,
            canViewFullAbstract: hasAdvancedAccess,
            canViewCommunityData: true,
            canUseAiChat: false,
            requiresDirectUnlock: !hasAdvancedAccess,
          },
        },
      };
    });
  }

  /**
   * Ensures the idea is either owned by the user or belongs to a publication
   * the user previously accepted.
   */
  private async ensureFavoriteAccess(
    userId: string,
    ideaId: string,
  ): Promise<void> {
    const idea = await this.prisma.idea.findFirst({
      where: {
        id: ideaId,
        deletedAt: null,
        OR: [
          { userId },
          {
            publication: {
              acceptances: {
                some: { userId },
              },
            },
          },
        ],
      },
      select: {
        id: true,
      },
    });

    if (!idea) {
      throw new NotFoundException(
        'Only an owned or accepted idea can be added to favorites.',
      );
    }
  }

  /** Invalidates dashboard data affected by favorite changes. */
  private async invalidateUserCaches(userId: string): Promise<void> {
    await this.cacheManager.del(userCacheKeys.summary(userId));
  }
}