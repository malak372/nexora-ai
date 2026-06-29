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
 * Used by the Admin panel to monitor collected community feedback
 * and support comment-based idea generation analytics.
 *
 * @author Malak
 */
@Injectable()
export class CommentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves collected comments with filtering, searching,
   * sorting, and pagination.
   *
   * @param query - Query parameters for pagination, filtering, searching, and sorting.
   * @returns Paginated comments list with metadata.
   */
  async getComments(query: GetCommentsQueryDto) {
    const { page, limit, skip } = buildPagination(query);

    const where: Prisma.CommentWhereInput = {
      ...buildDateFilter(query),
      ...buildExactFilter('platformId', query.platformId),
      ...buildExactFilter('language', query.language),
      ...buildStringFilter('region', query.region),
      ...buildSearchFilter(['content'], query.search),
    };

    const orderBy = buildOrderBy(
      query,
      [
        'collectedAt',
        'language',
        'region',
        'sentiment',
        'createdAt',
      ] as const,
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
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Retrieves summary statistics for collected comments.
   *
   * Used by:
   * GET /admin/comments/summary
   *
   * Summary includes:
   * - Total comments.
   * - Comments created today.
   * - Comments created this month.
   * - Number of platforms that have comments.
   * - Number of detected languages.
   * - Number of detected regions.
   *
   * @returns Comment summary statistics.
   */
  async getCommentsSummary() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [
      totalComments,
      todayComments,
      thisMonthComments,
      platformsGroup,
      languagesGroup,
      regionsGroup,
    ] = await Promise.all([
      this.prisma.comment.count(),

      this.prisma.comment.count({
        where: {
          createdAt: {
            gte: todayStart,
          },
        },
      }),

      this.prisma.comment.count({
        where: {
          createdAt: {
            gte: monthStart,
          },
        },
      }),

      this.prisma.comment.groupBy({
        by: ['platformId'],
        where: {
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
   *
   * Used by:
   * GET /admin/comments/charts
   *
   * Charts include:
   * - Comments grouped by platform.
   * - Comments grouped by language.
   * - Comments grouped by region.
   *
   * @returns Chart-ready comment analytics.
   */
  async getCommentsCharts() {
    const [
      commentsByPlatformGroup,
      commentsByLanguageGroup,
      commentsByRegionGroup,
    ] = await Promise.all([
      this.prisma.comment.groupBy({
        by: ['platformId'],
        where: {
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
        platformId: item.platformId,
        platformName: item.platformId
          ? platformNameMap.get(item.platformId) ?? 'Unknown Platform'
          : 'Unknown Platform',
        count: item._count.platformId,
      })),

      commentsByLanguage: commentsByLanguageGroup.map((item) => ({
        language: item.language,
        count: item._count.language,
      })),

      commentsByRegion: commentsByRegionGroup.map((item) => ({
        region: item.region,
        count: item._count.region,
      })),
    };
  }
}