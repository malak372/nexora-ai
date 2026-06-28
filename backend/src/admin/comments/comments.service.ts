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
} from '../../utilities/base-query/builder';

/**
 * Service responsible for Admin comment management operations.
 *
 * Provides:
 * - Pagination
 * - Filtering (platform, language, region)
 * - Full-text search (content)
 * - Sorting (whitelisted fields only)
 *
 * Used for analytics and comment intelligence system.
 *
 * @author Malak
 */
@Injectable()
export class CommentsService {
  constructor(private readonly prisma: PrismaService) { }

  /**
   * Retrieves comments with filtering, search, sorting, and pagination.
   *
   * Supports:
   * - platformId filtering
   * - language filtering
   * - region filtering (case-insensitive)
   * - content search
   * - date filtering
   * - pagination
   */
  async getComments(query: GetCommentsQueryDto) {
    const { page, limit, skip } = buildPagination(query);

    const where: Prisma.CommentWhereInput = {
      ...buildDateFilter(query),
      ...buildExactFilter('platformId', query.platformId),
      ...buildExactFilter('language', query.language),

      ...(query.region && {
        region: {
          contains: query.region,
          mode: 'insensitive',
        },
      }),

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
}
/**
 * Builds a case-insensitive string filter for Prisma.
 *
 * Used for partial matching (LIKE %value%) on string fields.
 *
 * Example:
 * buildStringFilter('region', 'Palestine')
 *
 * Output:
 * {
 *   region: {
 *     contains: 'Palestine',
 *     mode: 'insensitive'
 *   }
 * }
 *
 * @param field - Prisma field name
 * @param value - search value
 * @returns Prisma filter or undefined
 */
export function buildStringFilter(
  field: string,
  value?: string,
) {
  if (!value) return undefined;

  return {
    [field]: {
      contains: value,
      mode: 'insensitive',
    },
  };
}