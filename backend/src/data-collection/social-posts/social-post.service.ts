import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { Prisma, UserRole } from '@prisma/client';

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
  /**
   * Bounds concurrent post transactions during fast collection. A small pool
   * removes the old one-post-at-a-time latency while avoiding an unbounded
   * burst of interactive transactions against Supabase.
   */
  private static readonly POST_PERSISTENCE_CONCURRENCY = 4;

  constructor(private readonly prisma: PrismaService) {}


  /**
   * Fast-generation persistence path for a brand-new collection job.
   *
   * FAST_GENERATION always writes into a newly created CollectionJob, so the
   * expensive per-post interactive upsert transactions are unnecessary on
   * this path. We deduplicate collector rows in memory, generate stable row
   * ids locally, then persist all posts and all comments with two bulk writes.
   *
   * The normal/manual path continues to use createManyWithComments(), which
   * preserves full upsert/update semantics for reruns.
   */
  async createManyWithCommentsFast(
    collectionJobId: string,
    dataSourceId: string,
    location: {
      country?: string | null;
      city?: string | null;
      region?: string | null;
    },
    posts: CollectorPost[],
  ): Promise<{ totalPosts: number; totalComments: number }> {
    const uniquePosts = new Map<string, CollectorPost>();

    for (const post of posts) {
      const externalId = post.externalId.trim();
      const content = post.content.trim();
      if (!externalId || !content || uniquePosts.has(externalId)) continue;
      uniquePosts.set(externalId, post);
    }

    const now = new Date();
    const preparedPosts = [...uniquePosts.values()].map((post) => ({
      id: crypto.randomUUID(),
      post,
    }));

    if (preparedPosts.length === 0) {
      return { totalPosts: 0, totalComments: 0 };
    }

    await this.prisma.socialPost.createMany({
      data: preparedPosts.map(({ id, post }) => ({
        id,
        collectionJobId,
        dataSourceId,
        externalId: post.externalId.trim(),
        title: this.normalizeOptionalText(post.title),
        content: post.content.trim(),
        author: this.normalizeOptionalText(post.author),
        url: this.normalizeOptionalText(post.url),
        country: this.normalizeOptionalText(post.country ?? location.country),
        city: this.normalizeOptionalText(post.city ?? location.city),
        region: this.normalizeOptionalText(post.region ?? location.region),
        languageCode: this.normalizeOptionalText(post.languageCode),
        likesCount: this.toNonNegativeInteger(post.likesCount),
        repliesCount: this.toNonNegativeInteger(
          post.repliesCount ?? (post.comments ?? []).length,
        ),
        publishedAt: post.publishedAt,
        collectedAt: now,
      })),
    });

    const seenComments = new Set<string>();
    const comments = preparedPosts.flatMap(({ id: postId, post }) =>
      (post.comments ?? []).flatMap((comment) => {
        const externalId = comment.externalId.trim();
        const content = comment.content.trim();
        if (!externalId || !content) return [];

        const dedupeKey = `${postId}:${externalId}`;
        if (seenComments.has(dedupeKey)) return [];
        seenComments.add(dedupeKey);

        return [{
          postId,
          externalId,
          content,
          author: this.normalizeOptionalText(comment.author),
          languageCode: this.normalizeOptionalText(comment.languageCode),
          likesCount: this.toNonNegativeInteger(comment.likesCount),
          publishedAt: comment.publishedAt,
          collectedAt: now,
        }];
      }),
    );

    if (comments.length > 0) {
      await this.prisma.socialComment.createMany({ data: comments });
    }

    return {
      totalPosts: preparedPosts.length,
      totalComments: comments.length,
    };
  }

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
  ): Promise<{
    totalPosts: number;
    totalComments: number;
  }> {
    const validPosts = posts.filter(
      (post) => post.externalId.trim().length > 0 && post.content.trim().length > 0,
    );

    /*
     * The previous implementation persisted every post in a sequential
     * interactive transaction. With 10-20 posts and a remote Supabase region,
     * network latency accumulated linearly and consumed most of the NLP stage.
     *
     * A bounded worker pool preserves one atomic transaction per post while
     * allowing independent posts to be written concurrently. Four workers are
     * intentionally conservative: fast enough to remove serial latency, but
     * small enough to avoid exhausting the Prisma/Supabase connection pool.
     */
    let nextIndex = 0;
    const workerCount = Math.min(
      SocialPostService.POST_PERSISTENCE_CONCURRENCY,
      validPosts.length,
    );

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (true) {
          const currentIndex = nextIndex;
          nextIndex += 1;

          const post = validPosts[currentIndex];
          if (!post) {
            return;
          }

          await this.persistPostWithComments(
            collectionJobId,
            dataSourceId,
            location,
            post,
          );
        }
      }),
    );

    return {
      totalPosts: validPosts.length,
      totalComments: validPosts.reduce(
        (total, post) =>
          total +
          (post.comments ?? []).filter(
            (comment) =>
              comment.externalId.trim().length > 0 &&
              comment.content.trim().length > 0,
          ).length,
        0,
      ),
    };
  }

  /** Persists one post and its comments atomically. */
  private async persistPostWithComments(
    collectionJobId: string,
    dataSourceId: string,
    location: {
      country?: string | null;
      city?: string | null;
      region?: string | null;
    },
    post: CollectorPost,
  ): Promise<void> {
    const externalId = post.externalId.trim();
    const content = post.content.trim();
    const comments = post.comments ?? [];

    await this.prisma.$transaction(
      async (transaction) => {
        const savedPost = await transaction.socialPost.upsert({
          where: {
            collectionJobId_dataSourceId_externalId: {
              collectionJobId,
              dataSourceId,
              externalId,
            },
          },
          update: {
            title: this.normalizeOptionalText(post.title),
            content,
            author: this.normalizeOptionalText(post.author),
            url: this.normalizeOptionalText(post.url),
            country: this.normalizeOptionalText(post.country ?? location.country),
            city: this.normalizeOptionalText(post.city ?? location.city),
            region: this.normalizeOptionalText(post.region ?? location.region),
            languageCode: this.normalizeOptionalText(post.languageCode),
            likesCount: this.toNonNegativeInteger(post.likesCount),
            repliesCount: this.toNonNegativeInteger(
              post.repliesCount ?? comments.length,
            ),
            publishedAt: post.publishedAt,
            collectedAt: new Date(),
          },
          create: {
            collectionJobId,
            dataSourceId,
            externalId,
            title: this.normalizeOptionalText(post.title),
            content,
            author: this.normalizeOptionalText(post.author),
            url: this.normalizeOptionalText(post.url),
            country: this.normalizeOptionalText(post.country ?? location.country),
            city: this.normalizeOptionalText(post.city ?? location.city),
            region: this.normalizeOptionalText(post.region ?? location.region),
            languageCode: this.normalizeOptionalText(post.languageCode),
            likesCount: this.toNonNegativeInteger(post.likesCount),
            repliesCount: this.toNonNegativeInteger(
              post.repliesCount ?? comments.length,
            ),
            publishedAt: post.publishedAt,
          },
        });

        await Promise.all(
          comments
            .filter(
              (comment) =>
                comment.externalId.trim().length > 0 &&
                comment.content.trim().length > 0,
            )
            .map((comment) =>
              transaction.socialComment.upsert({
                where: {
                  postId_externalId: {
                    postId: savedPost.id,
                    externalId: comment.externalId.trim(),
                  },
                },
                update: {
                  content: comment.content.trim(),
                  author: this.normalizeOptionalText(comment.author),
                  languageCode: this.normalizeOptionalText(comment.languageCode),
                  likesCount: this.toNonNegativeInteger(comment.likesCount),
                  publishedAt: comment.publishedAt,
                  collectedAt: new Date(),
                },
                create: {
                  postId: savedPost.id,
                  externalId: comment.externalId.trim(),
                  content: comment.content.trim(),
                  author: this.normalizeOptionalText(comment.author),
                  languageCode: this.normalizeOptionalText(comment.languageCode),
                  likesCount: this.toNonNegativeInteger(comment.likesCount),
                  publishedAt: comment.publishedAt,
                },
              }),
            ),
        );
      },
      {
        maxWait: 5_000,
        timeout: 30_000,
      },
    );
  }

  /**
   * Counts persisted posts and comments for one collection-job source.
   *
   * The method is used both after successful persistence and after a partial
   * source failure so administrative counters always match stored data.
   */
  async countByCollectionJobSource(
    collectionJobId: string,
    dataSourceId: string,
  ): Promise<{
    totalPosts: number;
    totalComments: number;
  }> {
    const [totalPosts, totalComments] = await Promise.all([
      this.prisma.socialPost.count({
        where: {
          collectionJobId,
          dataSourceId,
        },
      }),
      this.prisma.socialComment.count({
        where: {
          post: {
            collectionJobId,
            dataSourceId,
          },
        },
      }),
    ]);

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
    const { skip, take, page, limit } = buildPagination(query);

    const where = this.buildPostsWhere(query, access);

    const [data, total] = await Promise.all([
      this.prisma.socialPost.findMany({
        where,
        skip,
        take,

        orderBy: buildOrderBy(
          query,
          ['createdAt', 'collectedAt', 'likesCount', 'repliesCount'] as const,
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

        totalPages: calculateTotalPages(total, limit),
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
    const dateFilter = buildDateFilter(query);

    const search = query.search?.trim();

    return {
      ...(query.collectionJobId && {
        collectionJobId: query.collectionJobId,
      }),

      ...(query.dataSourceId && {
        dataSourceId: query.dataSourceId,
      }),

      ...(query.dataSourceKey && {
        dataSource: {
          key: query.dataSourceKey.trim().toLowerCase(),
        },
      }),

      /*
       * Users can see only posts whose parent job
       * belongs to them.
       */
      ...(access.role !== UserRole.ADMIN && {
        collectionJob: {
          createdById: access.userId,
        },
      }),

      ...(query.languageCode && {
        languageCode: {
          equals: query.languageCode.trim(),

          mode: 'insensitive',
        },
      }),

      ...(query.country && {
        country: {
          contains: query.country.trim(),

          mode: 'insensitive',
        },
      }),

      ...(query.city && {
        city: {
          contains: query.city.trim(),

          mode: 'insensitive',
        },
      }),

      ...(query.region && {
        region: {
          contains: query.region.trim(),

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
  private normalizeOptionalText(value?: string | null): string | null {
    const normalized = value?.trim();

    return normalized ? normalized : null;
  }

  /**
   * Converts an external numeric value into
   * a safe non-negative integer.
   */
  private toNonNegativeInteger(value?: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }

    return Math.max(0, Math.trunc(value ?? 0));
  }
}