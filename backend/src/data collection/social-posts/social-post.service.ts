import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import { CollectorPost } from '../../collectors/base/collector.types';

import { GetSocialPostsQueryDto } from './dto/get-social-posts-query.dto';

import {
  buildDateFilter,
  buildOrderBy,
  buildPagination,
} from '../../utilities/base-query/builder';

import { calculateTotalPages } from '../../utilities/analytics/analytics.helper';

/**
 * Service responsible for storing and listing
 * collected social posts.
 *
 * Data-source identity is supplied explicitly using dataSourceId.
 *
 * @author Malak
 */
@Injectable()
export class SocialPostService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Saves posts and comments for one CollectionJobSource.
   *
   * @param collectionJobId Parent collection job.
   * @param dataSourceId Persistent DataSource identifier.
   * @param location Collection request location.
   * @param posts Normalized collector posts.
   */
  async createManyWithComments(
    collectionJobId: string,
    dataSourceId: string,

    location: {
      country?: string | null;
      city?: string | null;
      region?: string | null;
    },

    posts: CollectorPost[],
  ) {
    let totalPosts = 0;
    let totalComments = 0;

    for (const post of posts) {
      if (!post.externalId.trim()) {
        continue;
      }

      const comments =
        post.comments ?? [];

      await this.prisma.$transaction(
        async (transaction) => {
          const savedPost =
            await transaction.socialPost.upsert({
              where: {
                collectionJobId_dataSourceId_externalId:
                  {
                    collectionJobId,
                    dataSourceId,
                    externalId:
                      post.externalId,
                  },
              },

              update: {
                title: post.title,
                content: post.content,
                author: post.author,
                url: post.url,

                country:
                  post.country ??
                  location.country,

                city:
                  post.city ??
                  location.city,

                region:
                  post.region ??
                  location.region,

                languageCode:
                  post.languageCode,

                likesCount:
                  post.likesCount ?? 0,

                repliesCount:
                  post.repliesCount ??
                  comments.length,

                publishedAt:
                  post.publishedAt,

                collectedAt:
                  new Date(),
              },

              create: {
                collectionJobId,
                dataSourceId,

                externalId:
                  post.externalId,

                title: post.title,
                content: post.content,
                author: post.author,
                url: post.url,

                country:
                  post.country ??
                  location.country,

                city:
                  post.city ??
                  location.city,

                region:
                  post.region ??
                  location.region,

                languageCode:
                  post.languageCode,

                likesCount:
                  post.likesCount ?? 0,

                repliesCount:
                  post.repliesCount ??
                  comments.length,

                publishedAt:
                  post.publishedAt,
              },
            });

          totalPosts += 1;

          for (const comment of comments) {
            if (
              !comment.externalId.trim()
            ) {
              continue;
            }

            await transaction.socialComment.upsert({
              where: {
                postId_externalId: {
                  postId: savedPost.id,
                  externalId:
                    comment.externalId,
                },
              },

              update: {
                content:
                  comment.content,

                author:
                  comment.author,

                languageCode:
                  comment.languageCode,

                likesCount:
                  comment.likesCount ??
                  0,

                publishedAt:
                  comment.publishedAt,

                collectedAt:
                  new Date(),
              },

              create: {
                postId:
                  savedPost.id,

                externalId:
                  comment.externalId,

                content:
                  comment.content,

                author:
                  comment.author,

                languageCode:
                  comment.languageCode,

                likesCount:
                  comment.likesCount ??
                  0,

                publishedAt:
                  comment.publishedAt,
              },
            });

            totalComments += 1;
          }
        },
      );
    }

    return {
      totalPosts,
      totalComments,
    };
  }

  /**
   * Returns paginated collected posts.
   */
  async findPosts(
    query: GetSocialPostsQueryDto,
  ) {
    const {
      skip,
      take,
      page,
      limit,
    } = buildPagination(query);

    const where =
      this.buildPostsWhere(query);

    const [data, total] =
      await Promise.all([
        this.prisma.socialPost.findMany({
          where,
          skip,
          take,

          orderBy: buildOrderBy(
            query,
            [
              'createdAt',
              'collectedAt',
              'likesCount',
              'repliesCount',
            ] as const,
            'createdAt',
          ),

          include: {
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
                status: true,

                domain: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },

            _count: {
              select: {
                comments: true,
              },
            },
          },
        }),

        this.prisma.socialPost.count({
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
   * Builds Prisma post filters.
   */
  private buildPostsWhere(
    query: GetSocialPostsQueryDto,
  ): Prisma.SocialPostWhereInput {
    const dateFilter =
      buildDateFilter(query);

    return {
      ...(query.collectionJobId && {
        collectionJobId:
          query.collectionJobId,
      }),

      ...(query.dataSourceId && {
        dataSourceId:
          query.dataSourceId,
      }),

      ...(query.dataSourceKey && {
        dataSource: {
          key: query.dataSourceKey
            .trim()
            .toLowerCase(),
        },
      }),

      ...(query.languageCode && {
        languageCode: {
          equals:
            query.languageCode,
          mode: 'insensitive',
        },
      }),

      ...(query.country && {
        country: {
          contains:
            query.country,
          mode: 'insensitive',
        },
      }),

      ...(query.city && {
        city: {
          contains: query.city,
          mode: 'insensitive',
        },
      }),

      ...(query.region && {
        region: {
          contains:
            query.region,
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
            title: {
              contains:
                query.search,
              mode: 'insensitive',
            },
          },

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
            url: {
              contains:
                query.search,
              mode: 'insensitive',
            },
          },

          {
            dataSource: {
              displayName: {
                contains:
                  query.search,
                mode: 'insensitive',
              },
            },
          },

          {
            collectionJob: {
              domain: {
                name: {
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