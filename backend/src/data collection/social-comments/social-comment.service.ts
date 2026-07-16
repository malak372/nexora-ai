import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import { GetSocialCommentsQueryDto } from './dto/get-social-comments-query.dto';

import {
  buildDateFilter,
  buildOrderBy,
  buildPagination,
} from '../../utilities/base-query/builder';

import { calculateTotalPages } from '../../utilities/analytics/analytics.helper';

/**
 * Service responsible for listing collected comments.
 *
 * @author Malak
 */
@Injectable()
export class SocialCommentService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Returns paginated comments.
   */
  async findComments(
    query: GetSocialCommentsQueryDto,
  ) {
    const {
      skip,
      take,
      page,
      limit,
    } = buildPagination(query);

    const where =
      this.buildCommentsWhere(query);

    const [data, total] =
      await Promise.all([
        this.prisma.socialComment.findMany({
          where,
          skip,
          take,

          orderBy: buildOrderBy(
            query,
            [
              'createdAt',
              'collectedAt',
              'likesCount',
            ] as const,
            'createdAt',
          ),

          include: {
            post: {
              select: {
                id: true,
                title: true,
                region: true,
                collectionJobId: true,

                dataSource: {
                  select: {
                    id: true,
                    key: true,
                    displayName: true,
                  },
                },
              },
            },
          },
        }),

        this.prisma.socialComment.count({
          where,
        }),
      ]);

    return {
      data,

      meta: {
        page,
        limit,
        total,

        totalPages:
          calculateTotalPages(
            total,
            limit,
          ),
      },
    };
  }

  /**
   * Builds Prisma comment filters.
   */
  private buildCommentsWhere(
    query: GetSocialCommentsQueryDto,
  ): Prisma.SocialCommentWhereInput {
    const dateFilter =
      buildDateFilter(query);

    return {
      ...(query.postId && {
        postId: query.postId,
      }),

      ...(query.collectionJobId && {
        post: {
          collectionJobId:
            query.collectionJobId,
        },
      }),

      ...(query.languageCode && {
        languageCode: {
          equals:
            query.languageCode,
          mode: 'insensitive',
        },
      }),

      ...(query.sentiment && {
        sentiment: {
          equals:
            query.sentiment,
          mode: 'insensitive',
        },
      }),

      ...(query.author && {
        author: {
          contains:
            query.author,
          mode: 'insensitive',
        },
      }),

      ...(dateFilter ?? {}),

      ...(query.search?.trim() && {
        OR: [
          {
            content: {
              contains:
                query.search,
              mode: 'insensitive',
            },
          },

          {
            author: {
              contains:
                query.search,
              mode: 'insensitive',
            },
          },

          {
            post: {
              title: {
                contains:
                  query.search,
                mode: 'insensitive',
              },
            },
          },

          {
            post: {
              dataSource: {
                displayName: {
                  contains:
                    query.search,
                  mode: 'insensitive',
                },
              },
            },
          },
        ],
      }),
    };
  }
}