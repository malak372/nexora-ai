import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { GetCommentsQueryDto } from './dto/get-comments-query.dto';

import {
  buildDateFilter,
  buildExactFilter,
  buildOrderBy,
  buildPagination,
  buildSearchFilter,
  buildStringFilter,
} from '../../utilities/base-query/builder';

import { calculateTotalPages } from '../../utilities/analytics/analytics.helper';

/**
 * Service responsible for Admin comment management operations.
 *
 * Provides:
 * - Paginated comments list.
 * - Filtering by platform, language, region, and date range.
 * - Search within comment content.
 * - Safe sorting using whitelisted fields.
 * - Summary reports for collected comments.
 * - Chart-ready analytics data.
 *
 * @author Malak
 */
@Injectable()
export class CommentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Builds the shared Prisma where filter for comments.
   */
  private buildCommentsWhere(
    query: GetCommentsQueryDto,
  ): Prisma.CommentWhereInput {
    return {
      ...buildDateFilter(query),
      ...buildExactFilter('platformId', query.platformId),
      ...buildStringFilter('language', query.language),
      ...buildStringFilter('region', query.region),
      ...buildSearchFilter(['content'], query.search),
    };
  }

  /**
   * Adds a minimum createdAt date while preserving existing date filters.
   */
  private mergeCreatedAtGte(
    where: Prisma.CommentWhereInput,
    gte: Date,
  ): Prisma.CommentWhereInput {
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
   * Retrieves collected comments with filtering, searching,
   * sorting, and pagination.
   */
  async getComments(query: GetCommentsQueryDto) {
    const { page, limit, skip } = buildPagination(query);
    const where = this.buildCommentsWhere(query);

    const orderBy = buildOrderBy(
      query,
      ['collectedAt', 'language', 'region', 'sentiment', 'createdAt'] as const,
      'createdAt',
    );

    const [comments, total] = await Promise.all([
      this.prisma.comment.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        select: {
          id: true,
          content: true,
          sentiment: true,
          language: true,
          region: true,
          sourceUrl: true,
          collectedAt: true,
          createdAt: true,

          platform: {
            select: {
              id: true,
              name: true,
            },
          },

          _count: {
            select: {
              ideaComments: true,
            },
          },
        },
      }),

      this.prisma.comment.count({ where }),
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
   * Retrieves summary statistics for collected comments.
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
      this.prisma.comment.count({ where }),
      this.prisma.comment.count({ where: todayWhere }),
      this.prisma.comment.count({ where: monthWhere }),

      this.prisma.comment.groupBy({
        by: ['platformId'],
        where: {
          ...where,
          platformId: {
            not: null,
          },
        },
        _count: {
          platformId: true,
        },
      }),

      this.prisma.comment.groupBy({
        by: ['language'],
        where: {
          ...where,
          language: {
            not: null,
          },
        },
        _count: {
          language: true,
        },
      }),

      this.prisma.comment.groupBy({
        by: ['region'],
        where: {
          ...where,
          region: {
            not: null,
          },
        },
        _count: {
          region: true,
        },
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
   * Retrieves chart-ready analytics for collected comments.
   */
  async getCommentsCharts(query: GetCommentsQueryDto) {
    const where = this.buildCommentsWhere(query);

    const [
      commentsByPlatformGroup,
      commentsByLanguageGroup,
      commentsByRegionGroup,
    ] = await Promise.all([
      this.prisma.comment.groupBy({
        by: ['platformId'],
        where: {
          ...where,
          platformId: {
            not: null,
          },
        },
        _count: {
          platformId: true,
        },
        orderBy: {
          _count: {
            platformId: 'desc',
          },
        },
      }),

      this.prisma.comment.groupBy({
        by: ['language'],
        where: {
          ...where,
          language: {
            not: null,
          },
        },
        _count: {
          language: true,
        },
        orderBy: {
          _count: {
            language: 'desc',
          },
        },
      }),

      this.prisma.comment.groupBy({
        by: ['region'],
        where: {
          ...where,
          region: {
            not: null,
          },
        },
        _count: {
          region: true,
        },
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