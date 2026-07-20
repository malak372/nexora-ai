import { Injectable } from '@nestjs/common';

import { Prisma, UserRole } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import { calculateTotalPages } from '../../utilities/analytics/analytics.helper';

import {
  buildDateFilter,
  buildOrderBy,
  buildPagination,
} from '../../utilities/base-query/builder';

import { CollectionAccessContext } from '../types/collection-access-context.type';

import { GetSocialCommentsQueryDto } from './dto/get-social-comments-query.dto';

/**
 * Service responsible for listing collected comments
 * while enforcing ownership through the parent post
 * and collection job.
 *
 * @author Malak
 */
@Injectable()
export class SocialCommentService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns paginated comments visible
   * to the current caller.
   */
  async findComments(
    query: GetSocialCommentsQueryDto,
    access: CollectionAccessContext,
  ) {
    const { skip, take, page, limit } = buildPagination(query);

    const where = this.buildCommentsWhere(query, access);

    const [data, total] = await Promise.all([
      this.prisma.socialComment.findMany({
        where,
        skip,
        take,

        orderBy: buildOrderBy(
          query,
          ['createdAt', 'collectedAt', 'likesCount'] as const,
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

              collectionJob: {
                select: {
                  id: true,
                  createdById: true,
                  status: true,
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

        totalPages: calculateTotalPages(total, limit),
      },
    };
  }

  /**
   * Builds comment filters including caller ownership.
   *
   * Comment ownership is determined through:
   *
   * SocialComment
   * -> SocialPost
   * -> CollectionJob
   * -> createdById
   */
  private buildCommentsWhere(
    query: GetSocialCommentsQueryDto,
    access: CollectionAccessContext,
  ): Prisma.SocialCommentWhereInput {
    const dateFilter = buildDateFilter(query);

    const search = query.search?.trim();

    return {
      ...(query.postId && {
        postId: query.postId,
      }),

      /*
       * Build one nested post relation filter so that
       * collectionJobId and ownership can be combined safely.
       */
      ...((query.collectionJobId || access.role !== UserRole.ADMIN) && {
        post: {
          ...(query.collectionJobId && {
            collectionJobId: query.collectionJobId,
          }),

          ...(access.role !== UserRole.ADMIN && {
            collectionJob: {
              createdById: access.userId,
            },
          }),
        },
      }),

      ...(query.languageCode && {
        languageCode: {
          equals: query.languageCode.trim(),

          mode: 'insensitive',
        },
      }),

      ...(query.sentiment && {
        sentiment: {
          equals: query.sentiment.trim(),

          mode: 'insensitive',
        },
      }),

      ...(query.author && {
        author: {
          contains: query.author.trim(),

          mode: 'insensitive',
        },
      }),

      ...(dateFilter ?? {}),

      ...(search && {
        OR: [
          {
            content: {
              contains: search,
              mode: 'insensitive',
            },
          },

          {
            author: {
              contains: search,
              mode: 'insensitive',
            },
          },

          {
            post: {
              title: {
                contains: search,
                mode: 'insensitive',
              },
            },
          },

          {
            post: {
              dataSource: {
                displayName: {
                  contains: search,
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
