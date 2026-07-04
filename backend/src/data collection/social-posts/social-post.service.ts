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
 * - Store collected social posts.
 * - Store collected comments related to each post.
 * - Link each post to its platform record.
 * - Create the platform automatically if it does not exist.
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
   * Stores collected posts and their related comments.
   *
   * Uses upsert to:
   * - Update an existing post if it was already collected.
   * - Create a new post if it does not exist.
   * - Update or create comments without causing duplicate errors.
   *
   * @param collectionJobId The collection job that produced these posts.
   * @param posts The posts returned from the selected collector.
   *
   * @returns Total number of stored posts and comments.
   */
  async createManyWithComments(collectionJobId: string, posts: CollectorPost[]) {
    let totalPosts = 0;
    let totalComments = 0;

    for (const post of posts) {
      if (!post.externalId) {
        continue;
      }

      const comments = post.comments ?? [];

      const platform = await this.findOrCreatePlatformByName(post.platformName);

      const savedPost = await this.prisma.socialPost.upsert({
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
          repliesCount: post.repliesCount ?? comments.length,
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
          repliesCount: post.repliesCount ?? comments.length,
          publishedAt: post.publishedAt,
        },
      });

      totalPosts++;

      for (const comment of comments) {
        if (!comment.externalId) {
          continue;
        }

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
   * Returns paginated collected posts with optional filters.
   *
   * Supported filters:
   * - collectionJobId
   * - platformId
   * - language
   * - region
   *
   * Includes:
   * - Platform basic information.
   * - Collection job basic information.
   * - Domain basic information.
   * - Number of related comments.
   *
   * @param query Filtering, sorting, and pagination options.
   *
   * @returns Paginated social posts response.
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
   * Finds a platform by name or creates it if it does not exist.
   *
   * This guarantees that collected posts are linked to their source platform,
   * such as GitHub, Reddit, YouTube, or other supported collectors.
   *
   * If the platform already exists but is inactive, it will be reactivated.
   *
   * @param name Platform display name returned by the collector.
   *
   * @returns Existing or newly created platform, or null if no name is provided.
   */
  private async findOrCreatePlatformByName(name?: string) {
    if (!name) {
      return null;
    }

    return this.prisma.platform.upsert({
      where: {
        name,
      },
      update: {
        isActive: true,
      },
      create: {
        name,
        isActive: true,
      },
    });
  }
}