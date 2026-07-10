import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { CollectorPost } from '../../collectors/base/collector.types';
import { PLATFORM_NAMES } from '../../collectors/base/platform-name.constant';
import { GetSocialPostsQueryDto } from './dto/get-social-posts-query.dto';

import {
  buildDateFilter,
  buildOrderBy,
  buildPagination,
} from '../../utilities/base-query/builder';
import { calculateTotalPages } from '../../utilities/analytics/analytics.helper';

/**
 * Service responsible for storing and listing collected social posts.
 *
 * @author Malak
 */
@Injectable()
export class SocialPostService {
  constructor(private readonly prisma: PrismaService) {}

  async createManyWithComments(
    collectionJobId: string,
    location: {
      country: string;
      city?: string | null;
      region?: string | null;
    },
    posts: CollectorPost[],
  ) {
    let totalPosts = 0;
    let totalComments = 0;

    for (const post of posts) {
      if (!post.externalId) continue;

      const comments = post.comments ?? [];
      const platform = await this.findOrCreatePlatform(post);

      const savedPost = await this.prisma.socialPost.upsert({
        where: {
          collectionJobId_sourceType_externalId: {
            collectionJobId,
            sourceType: post.sourceType,
            externalId: post.externalId,
          },
        },
        update: {
          platformId: platform.id,
          title: post.title,
          content: post.content,
          author: post.author,
          url: post.url,
          country: location.country,
          city: location.city,
          region: location.region,
          language: post.language,
          likesCount: post.likesCount ?? 0,
          repliesCount: post.repliesCount ?? comments.length,
          publishedAt: post.publishedAt,
          collectedAt: new Date(),
        },
        create: {
          collectionJobId,
          platformId: platform.id,
          sourceType: post.sourceType,
          externalId: post.externalId,
          title: post.title,
          content: post.content,
          author: post.author,
          url: post.url,
          country: location.country,
          city: location.city,
          region: location.region,
          language: post.language,
          likesCount: post.likesCount ?? 0,
          repliesCount: post.repliesCount ?? comments.length,
          publishedAt: post.publishedAt,
        },
      });

      totalPosts++;

      for (const comment of comments) {
        if (!comment.externalId) continue;

        await this.prisma.socialComment.upsert({
          where: {
            postId_externalId: {
              postId: savedPost.id,
              externalId: comment.externalId,
            },
          },
          update: {
            content: comment.content,
            author: comment.author,
            language: comment.language,
            likesCount: comment.likesCount ?? 0,
            publishedAt: comment.publishedAt,
            collectedAt: new Date(),
          },
          create: {
            postId: savedPost.id,
            externalId: comment.externalId,
            content: comment.content,
            author: comment.author,
            language: comment.language,
            likesCount: comment.likesCount ?? 0,
            publishedAt: comment.publishedAt,
          },
        });

        totalComments++;
      }
    }

    return {
      totalPosts,
      totalComments,
    };
  }

  /**
   * Returns paginated collected posts with filters/search/date/sorting.
   */
  async findPosts(query: GetSocialPostsQueryDto) {
    const { skip, take, page, limit } = buildPagination(query);
    const where = this.buildPostsWhere(query);

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
          platform: {
            select: {
              id: true,
              name: true,
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
      this.prisma.socialPost.count({ where }),
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
   * Builds Prisma filters for social posts.
   */
  private buildPostsWhere(
    query: GetSocialPostsQueryDto,
  ): Prisma.SocialPostWhereInput {
    const dateFilter = buildDateFilter(query);

    return {
      ...(query.collectionJobId && { collectionJobId: query.collectionJobId }),
      ...(query.platformId && { platformId: query.platformId }),
      ...(query.sourceType && { sourceType: query.sourceType }),
      ...(query.language && { language: query.language }),

      ...(query.country && {
        country: {
          contains: query.country,
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
          contains: query.region,
          mode: 'insensitive',
        },
      }),
      ...(query.author && {
        author: {
          contains: query.author,
          mode: 'insensitive',
        },
      }),

      ...(dateFilter ?? {}),

      ...(query.search?.trim() && {
        OR: [
          {
            title: {
              contains: query.search,
              mode: 'insensitive',
            },
          },
          {
            content: {
              contains: query.search,
              mode: 'insensitive',
            },
          },
          {
            author: {
              contains: query.search,
              mode: 'insensitive',
            },
          },
          {
            url: {
              contains: query.search,
              mode: 'insensitive',
            },
          },
          {
            collectionJob: {
              domain: {
                name: {
                  contains: query.search,
                  mode: 'insensitive',
                },
              },
            },
          },
        ],
      }),
    };
  }

  private async findOrCreatePlatform(post: CollectorPost) {
    const platformName = this.resolvePlatformName(post);

    return this.prisma.platform.upsert({
      where: {
        name: platformName,
      },
      update: {
        isActive: true,
      },
      create: {
        name: platformName,
        isActive: true,
      },
    });
  }

  private resolvePlatformName(post: CollectorPost): string {
    return PLATFORM_NAMES[post.sourceType] ?? post.platformName ?? 'Other';
  }
}
