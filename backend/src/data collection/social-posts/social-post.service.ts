import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { CollectorPost } from '../../collectors/base/collector.types';
import { GetSocialPostsQueryDto } from './dto/get-social-posts-query.dto';

import {
  buildOrderBy,
  buildPagination,
} from '../../utilities/base-query/builder';
import { calculateTotalPages } from '../../utilities/analytics/analytics.helper';

/**
 * Service responsible for storing and listing collected social posts.
 *
 * Responsibilities:
 * - Store collected posts.
 * - Store collected comments.
 * - Avoid duplicate posts using sourceType + externalId.
 * - Avoid duplicate comments using postId + externalId.
 * - Return paginated posts for admin review.
 *
 * @author Malak
 */
@Injectable()
export class SocialPostService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Stores posts and their comments.
   *
   * Uses upsert to avoid crashing when the same external post/comment
   * is collected more than once.
   */
  async createManyWithComments(collectionJobId: string, posts: CollectorPost[]) {
    let totalPosts = 0;
    let totalComments = 0;

    for (const post of posts) {
      const platform = await this.findPlatformByName(post.platformName);

      const createdPost = await this.prisma.socialPost.upsert({
        where: {
          sourceType_externalId: {
            sourceType: post.sourceType,
            externalId: post.externalId,
          },
        },
        update: {
          collectionJobId,
          platformId: platform?.id,
          title: post.title,
          content: post.content,
          author: post.author,
          url: post.url,
          country: post.country,
          city: post.city,
          region: post.region,
          language: post.language,
          likesCount: post.likesCount ?? 0,
          repliesCount: post.repliesCount ?? post.comments.length,
          publishedAt: post.publishedAt,
          collectedAt: new Date(),
        },
        create: {
          collectionJobId,
          platformId: platform?.id,
          sourceType: post.sourceType,
          externalId: post.externalId,
          title: post.title,
          content: post.content,
          author: post.author,
          url: post.url,
          country: post.country,
          city: post.city,
          region: post.region,
          language: post.language,
          likesCount: post.likesCount ?? 0,
          repliesCount: post.repliesCount ?? post.comments.length,
          publishedAt: post.publishedAt,
        },
      });

      totalPosts++;

      for (const comment of post.comments) {
        await this.prisma.socialComment.upsert({
          where: {
            postId_externalId: {
              postId: createdPost.id,
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
            postId: createdPost.id,
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
   * Returns paginated collected posts.
   */
  async findPosts(query: GetSocialPostsQueryDto) {
    const { skip, take, page, limit } = buildPagination(query);

    const where: Prisma.SocialPostWhereInput = {
      ...(query.collectionJobId && { collectionJobId: query.collectionJobId }),
      ...(query.platformId && { platformId: query.platformId }),
      ...(query.language && { language: query.language }),
      ...(query.region && { region: query.region }),
    };

    const [data, total] = await Promise.all([
      this.prisma.socialPost.findMany({
        where,
        skip,
        take,
        orderBy: buildOrderBy(
          query,
          ['createdAt', 'collectedAt', 'likesCount'] as const,
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
   * Finds an active platform record by platform display name.
   */
  private findPlatformByName(name: string) {
    return this.prisma.platform.findFirst({
      where: {
        name: {
          equals: name,
          mode: 'insensitive',
        },
        isActive: true,
      },
    });
  }
}