import { Injectable } from '@nestjs/common';

import {
  Prisma,
  UserRole,
} from '@prisma/client';

import { CollectorPost } from '../../collectors/base/collector.types';

import { PrismaService } from '../../prisma/prisma.service';

import { calculateTotalPages } from '../../utilities/analytics/analytics.helper';

import {
  buildDateFilter,
  buildOrderBy,
  buildPagination,
} from '../../utilities/base-query/builder';

import { CollectionAccessContext } from '../types/collection-access-context.type';

import { GetSocialPostsQueryDto } from './dto/get-social-posts-query.dto';

/**
 * Service responsible for:
 * - Persisting collected posts.
 * - Persisting collected comments.
 * - Preventing duplicate records through upsert.
 * - Listing posts with ownership enforcement.
 *
 * @author Malak
 */
@Injectable()
export class SocialPostService {
  constructor(
    private readonly prisma:
      PrismaService,
  ) {}

  /**
   * Saves normalized posts and comments for one
   * CollectionJobSource.
   *
   * The unique constraints:
   * - collectionJobId + dataSourceId + externalId
   * - postId + comment externalId
   *
   * make the persistence operation idempotent for
   * repeated collector results.
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
      const externalId =
        post.externalId.trim();

      const content =
        post.content.trim();

      /*
       * Ignore malformed external records.
       */
      if (!externalId || !content) {
        continue;
      }

      const comments =
        post.comments ?? [];

      const result =
        await this.prisma.$transaction(
          async (transaction) => {
            const savedPost =
              await transaction.socialPost
                .upsert({
                  where: {
                    collectionJobId_dataSourceId_externalId:
                      {
                        collectionJobId,
                        dataSourceId,
                        externalId,
                      },
                  },

                  update: {
                    title:
                      this.normalizeOptionalText(
                        post.title,
                      ),

                    content,

                    author:
                      this.normalizeOptionalText(
                        post.author,
                      ),

                    url:
                      this.normalizeOptionalText(
                        post.url,
                      ),

                    country:
                      this.normalizeOptionalText(
                        post.country ??
                          location.country,
                      ),

                    city:
                      this.normalizeOptionalText(
                        post.city ??
                          location.city,
                      ),

                    region:
                      this.normalizeOptionalText(
                        post.region ??
                          location.region,
                      ),

                    languageCode:
                      this.normalizeOptionalText(
                        post.languageCode,
                      ),

                    likesCount:
                      this.toNonNegativeInteger(
                        post.likesCount,
                      ),

                    repliesCount:
                      this.toNonNegativeInteger(
                        post.repliesCount ??
                          comments.length,
                      ),

                    publishedAt:
                      post.publishedAt,

                    collectedAt:
                      new Date(),
                  },

                  create: {
                    collectionJobId,
                    dataSourceId,
                    externalId,

                    title:
                      this.normalizeOptionalText(
                        post.title,
                      ),

                    content,

                    author:
                      this.normalizeOptionalText(
                        post.author,
                      ),

                    url:
                      this.normalizeOptionalText(
                        post.url,
                      ),

                    country:
                      this.normalizeOptionalText(
                        post.country ??
                          location.country,
                      ),

                    city:
                      this.normalizeOptionalText(
                        post.city ??
                          location.city,
                      ),

                    region:
                      this.normalizeOptionalText(
                        post.region ??
                          location.region,
                      ),

                    languageCode:
                      this.normalizeOptionalText(
                        post.languageCode,
                      ),

                    likesCount:
                      this.toNonNegativeInteger(
                        post.likesCount,
                      ),

                    repliesCount:
                      this.toNonNegativeInteger(
                        post.repliesCount ??
                          comments.length,
                      ),

                    publishedAt:
                      post.publishedAt,
                  },
                });

            let persistedComments = 0;

            for (
              const comment of comments
            ) {
              const commentExternalId =
                comment.externalId.trim();

              const commentContent =
                comment.content.trim();

              /*
               * Ignore malformed comments.
               */
              if (
                !commentExternalId ||
                !commentContent
              ) {
                continue;
              }

              await transaction.socialComment
                .upsert({
                  where: {
                    postId_externalId: {
                      postId:
                        savedPost.id,

                      externalId:
                        commentExternalId,
                    },
                  },

                  update: {
                    content:
                      commentContent,

                    author:
                      this.normalizeOptionalText(
                        comment.author,
                      ),

                    languageCode:
                      this.normalizeOptionalText(
                        comment.languageCode,
                      ),

                    likesCount:
                      this.toNonNegativeInteger(
                        comment.likesCount,
                      ),

                    publishedAt:
                      comment.publishedAt,

                    collectedAt:
                      new Date(),
                  },

                  create: {
                    postId:
                      savedPost.id,

                    externalId:
                      commentExternalId,

                    content:
                      commentContent,

                    author:
                      this.normalizeOptionalText(
                        comment.author,
                      ),

                    languageCode:
                      this.normalizeOptionalText(
                        comment.languageCode,
                      ),

                    likesCount:
                      this.toNonNegativeInteger(
                        comment.likesCount,
                      ),

                    publishedAt:
                      comment.publishedAt,
                  },
                });

              persistedComments += 1;
            }

            return {
              posts: 1,
              comments:
                persistedComments,
            };
          },
        );

      totalPosts +=
        result.posts;

      totalComments +=
        result.comments;
    }

    return {
      totalPosts,
      totalComments,
    };
  }

  /**
   * Returns paginated posts visible
   * to the current caller.
   */
  async findPosts(
    query: GetSocialPostsQueryDto,
    access: CollectionAccessContext,
  ) {
    const {
      skip,
      take,
      page,
      limit,
    } = buildPagination(query);

    const where =
      this.buildPostsWhere(
        query,
        access,
      );

    const [data, total] =
      await Promise.all([
        this.prisma.socialPost
          .findMany({
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
                  createdById: true,
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
   * Builds post filters including caller ownership.
   */
  private buildPostsWhere(
    query: GetSocialPostsQueryDto,
    access: CollectionAccessContext,
  ): Prisma.SocialPostWhereInput {
    const dateFilter =
      buildDateFilter(query);

    const search =
      query.search?.trim();

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
          key:
            query.dataSourceKey
              .trim()
              .toLowerCase(),
        },
      }),

      /*
       * Users can see only posts whose parent job
       * belongs to them.
       */
      ...(access.role !==
        UserRole.ADMIN && {
        collectionJob: {
          createdById:
            access.userId,
        },
      }),

      ...(query.languageCode && {
        languageCode: {
          equals:
            query.languageCode.trim(),

          mode: 'insensitive',
        },
      }),

      ...(query.country && {
        country: {
          contains:
            query.country.trim(),

          mode: 'insensitive',
        },
      }),

      ...(query.city && {
        city: {
          contains:
            query.city.trim(),

          mode: 'insensitive',
        },
      }),

      ...(query.region && {
        region: {
          contains:
            query.region.trim(),

          mode: 'insensitive',
        },
      }),

      ...(query.author && {
        author: {
          contains:
            query.author.trim(),

          mode: 'insensitive',
        },
      }),

      ...(dateFilter ?? {}),

      ...(search && {
        OR: [
          {
            title: {
              contains: search,
              mode: 'insensitive',
            },
          },

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
            url: {
              contains: search,
              mode: 'insensitive',
            },
          },

          {
            dataSource: {
              displayName: {
                contains: search,
                mode: 'insensitive',
              },
            },
          },

          {
            collectionJob: {
              domain: {
                name: {
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

  /**
   * Normalizes optional external text.
   *
   * Empty strings become null.
   */
  private normalizeOptionalText(
    value?: string | null,
  ): string | null {
    const normalized =
      value?.trim();

    return normalized
      ? normalized
      : null;
  }

  /**
   * Converts an external numeric value into
   * a safe non-negative integer.
   */
  private toNonNegativeInteger(
    value?: number,
  ): number {
    if (!Number.isFinite(value)) {
      return 0;
    }

    return Math.max(
      0,
      Math.trunc(value ?? 0),
    );
  }
}