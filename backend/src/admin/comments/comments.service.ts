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
 * Used by the Admin panel to monitor collected community feedback
 * and support comment-based idea generation analytics.
 *
 * @author Malak
 */
@Injectable()
export class CommentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Builds the shared Prisma where filter for comments.
   *
   * This method keeps the comments list, summary, and charts
   * consistent when the same query filters are applied.
   *
   * @param query - Query parameters used for filtering comments.
   * @returns Prisma CommentWhereInput object.
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
   * Retrieves collected comments with filtering, searching,
   * sorting, and pagination.
   *
   * Endpoint:
   * GET /admin/comments
   *
   * @param query - Query parameters for pagination, filtering, searching, and sorting.
   * @returns Paginated comments list with metadata.
   */
  async getComments(query: GetCommentsQueryDto) {
    const { page, limit, skip } = buildPagination(query);
    const where = this.buildCommentsWhere(query);

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
        totalPages: calculateTotalPages(total, limit),
      },
    };
  }

  /**
   * Retrieves summary statistics for collected comments.
   *
   * Endpoint:
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
   * @param query - Optional filters used to scope the summary.
   * @returns Comment summary statistics.
   */
  async getCommentsSummary(query: GetCommentsQueryDto) {
    const where = this.buildCommentsWhere(query);

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
      this.prisma.comment.count({ where }),

      this.prisma.comment.count({
        where: {
          ...where,
          createdAt: {
            gte: todayStart,
          },
        },
      }),

      this.prisma.comment.count({
        where: {
          ...where,
          createdAt: {
            gte: monthStart,
          },
        },
      }),

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
   *
   * Endpoint:
   * GET /admin/comments/charts
   *
   * Charts include:
   * - Comments grouped by platform.
   * - Comments grouped by language.
   * - Comments grouped by region.
   *
   * @param query - Optional filters used to scope the charts.
   * @returns Chart-ready comment analytics.
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