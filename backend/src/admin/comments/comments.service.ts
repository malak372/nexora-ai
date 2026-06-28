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
 * This service allows administrators to view, search,
 * filter, sort, and paginate collected comments.
 *
 * @author Malak
 */
@Injectable()
export class CommentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves collected comments with optional filtering,
   * searching, sorting, and pagination.
   *
   * @param query Query parameters used for pagination,
   * filtering, searching, and sorting comments.
   * @returns Paginated comments list with metadata.
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