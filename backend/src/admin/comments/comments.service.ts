import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { GetCommentsQueryDto } from './dto/get-comments-query.dto';

import {
  buildDateFilter,
  buildOrderBy,
  buildPagination,
  buildSearchFilter,
  buildStringFilter,
} from '../../utilities/base-query/builder';

import { calculateTotalPages } from '../../utilities/analytics/analytics.helper';

/**
 * Service responsible for Admin collected social comments management.
 *
 * Uses SocialComment instead of the removed Comment model.
 *
 * Comments are now connected through:
 * SocialComment -> SocialPost -> Platform / CollectionJob
 *
 * @author Malak
 */
@Injectable()
export class CommentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Builds the shared Prisma where filter for collected social comments.
   */
  private buildCommentsWhere(
    query: GetCommentsQueryDto,
  ): Prisma.SocialCommentWhereInput {
    return {
      ...buildDateFilter(query),
      ...buildStringFilter('language', query.language),
      ...buildSearchFilter(['content'], query.search),

      ...(query.region && {
        post: {
          region: {
            contains: query.region,
            mode: 'insensitive',
          },
        },
      }),

      ...(query.platformId && {
        post: {
          platformId: query.platformId,
        },
      }),
    };
  }

  /**
   * Adds a minimum createdAt date while preserving existing date filters.
   */
  private mergeCreatedAtGte(
    where: Prisma.SocialCommentWhereInput,
    gte: Date,
  ): Prisma.SocialCommentWhereInput {
    const existingCreatedAt =
      typeof where.createdAt === 'object' && where.createdAt !== null
        ? where.createdAt
        : {};

    return {
      ...where,
      createdAt: {
        ...existingCreatedAt,
        gte,
      },
    };
  }

  /**
   * Retrieves collected social comments with filtering,
   * searching, sorting, and pagination.
   */
  async getComments(query: GetCommentsQueryDto) {
    const { page, limit, skip } = buildPagination(query);
    const where = this.buildCommentsWhere(query);

    const orderBy = buildOrderBy(
      query,
      ['collectedAt', 'language', 'sentiment', 'createdAt'] as const,
      'createdAt',
    );

    const [comments, total] = await Promise.all([
      this.prisma.socialComment.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        select: {
          id: true,
          externalId: true,
          content: true,
          author: true,
          sentiment: true,
          language: true,
          likesCount: true,
          publishedAt: true,
          collectedAt: true,
          createdAt: true,

          post: {
            select: {
              id: true,
              title: true,
              content: true,
              url: true,
              sourceType: true,
              country: true,
              city: true,
              region: true,
              language: true,

              platform: {
                select: {
                  id: true,
                  name: true,
                },
              },

              collectionJob: {
                select: {
                  id: true,
                  status: true,
                  totalPosts: true,
                  totalComments: true,
                },
              },
            },
          },
        },
      }),

      this.prisma.socialComment.count({ where }),
    ]);

    return {
      data: comments,
      meta: {
        page,
        limit,
        total,
        totalPages: calculateTotalPages(total, limit),
      },
    };
  }

  /**
   * Retrieves summary statistics for collected social comments.
   */
  async getCommentsSummary(query: GetCommentsQueryDto) {
    const where = this.buildCommentsWhere(query);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const todayWhere = this.mergeCreatedAtGte(where, todayStart);
    const monthWhere = this.mergeCreatedAtGte(where, monthStart);

    const [
      totalComments,
      todayComments,
      thisMonthComments,
      platformsGroup,
      languagesGroup,
      regionsGroup,
    ] = await Promise.all([
      this.prisma.socialComment.count({ where }),
      this.prisma.socialComment.count({ where: todayWhere }),
      this.prisma.socialComment.count({ where: monthWhere }),

      this.prisma.socialPost.groupBy({
        by: ['platformId'],
        where: {
          platformId: { not: null },
          comments: { some: where },
        },
        _count: { platformId: true },
      }),

      this.prisma.socialComment.groupBy({
        by: ['language'],
        where: {
          ...where,
          language: { not: null },
        },
        _count: { language: true },
      }),

      this.prisma.socialPost.groupBy({
        by: ['region'],
        where: {
          region: { not: null },
          comments: { some: where },
        },
        _count: { region: true },
      }),
    ]);

    return {
      totalComments,
      todayComments,
      thisMonthComments,
      platformsCount: platformsGroup.length,
      languagesCount: languagesGroup.length,
      regionsCount: regionsGroup.length,
    };
  }

  /**
   * Retrieves chart-ready analytics for collected social comments.
   */
  async getCommentsCharts(query: GetCommentsQueryDto) {
    const where = this.buildCommentsWhere(query);

    const [
      commentsByPlatformGroup,
      commentsByLanguageGroup,
      commentsByRegionGroup,
    ] = await Promise.all([
      this.prisma.socialPost.groupBy({
        by: ['platformId'],
        where: {
          platformId: { not: null },
          comments: { some: where },
        },
        _count: { platformId: true },
        orderBy: {
          _count: {
            platformId: 'desc',
          },
        },
      }),

      this.prisma.socialComment.groupBy({
        by: ['language'],
        where: {
          ...where,
          language: { not: null },
        },
        _count: { language: true },
        orderBy: {
          _count: {
            language: 'desc',
          },
        },
      }),

      this.prisma.socialPost.groupBy({
        by: ['region'],
        where: {
          region: { not: null },
          comments: { some: where },
        },
        _count: { region: true },
        orderBy: {
          _count: {
            region: 'desc',
          },
        },
      }),
    ]);

    const platformIds = commentsByPlatformGroup
      .map((item) => item.platformId)
      .filter((id): id is string => Boolean(id));

    const platforms = await this.prisma.platform.findMany({
      where: {
        id: {
          in: platformIds,
        },
      },
      select: {
        id: true,
        name: true,
      },
    });

    const platformNameMap = new Map(
      platforms.map((platform) => [platform.id, platform.name]),
    );

    return {
      commentsByPlatform: commentsByPlatformGroup.map((item) => ({
        label: item.platformId
          ? platformNameMap.get(item.platformId) ?? 'Unknown Platform'
          : 'Unknown Platform',
        platformId: item.platformId,
        count: item._count.platformId,
      })),

      commentsByLanguage: commentsByLanguageGroup.map((item) => ({
        label: item.language ?? 'Unknown Language',
        language: item.language,
        count: item._count.language,
      })),

      commentsByRegion: commentsByRegionGroup.map((item) => ({
        label: item.region ?? 'Unknown Region',
        region: item.region,
        count: item._count.region,
      })),
    };
  }
}