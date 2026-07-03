import { Injectable } from '@nestjs/common';
import { CollectionSourceType, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { RunCollectionDto } from '../dto/run-collection.dto';
import { GetSocialPostsQueryDto } from './dto/get-social-posts-query.dto';

import {
  buildOrderBy,
  buildPagination,
} from '../../utilities/base-query/builder';
import { calculateTotalPages } from '../../utilities/analytics/analytics.helper';

type MockCollectedPost = {
  externalId?: string;
  title?: string;
  content: string;
  author?: string;
  url?: string | null;
  language?: string;
  likesCount?: number;
  comments: {
    externalId?: string;
    content: string;
    author?: string;
    language?: string;
    likesCount?: number;
  }[];
};

/**
 * Service responsible for SocialPost operations.
 *
 * @author Malak
 */
@Injectable()
export class SocialPostsService {
  constructor(private readonly prisma: PrismaService) { }

  async createManyWithComments(
    collectionJobId: string,
    posts: MockCollectedPost[],
    dto: RunCollectionDto,
  ) {
    let totalComments = 0;

    for (const post of posts) {
      const createdPost = await this.prisma.socialPost.create({
        data: {
          collectionJobId,
          sourceType: CollectionSourceType.MOCK,
          externalId: post.externalId,
          title: post.title,
          content: post.content,
          author: post.author,
          url: post.url,
          country: dto.country,
          city: dto.city,
          region: dto.region,
          language: post.language,
          likesCount: post.likesCount ?? 0,
          repliesCount: post.comments.length,
        },
      });

      if (post.comments.length > 0) {
        await this.prisma.socialComment.createMany({
          data: post.comments.map((comment) => ({
            postId: createdPost.id,
            externalId: comment.externalId,
            content: comment.content,
            author: comment.author,
            language: comment.language,
            likesCount: comment.likesCount ?? 0,
          })),
        });

        totalComments += post.comments.length;
      }
    }

    return {
      totalPosts: posts.length,
      totalComments,
    };
  }

  async findPosts(query: GetSocialPostsQueryDto) {
    const { skip, take, page, limit } = buildPagination(query);

    const where: Prisma.SocialPostWhereInput = {
      collectionJobId: query.collectionJobId,
      platformId: query.platformId,
      language: query.language,
      region: query.region,
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
}