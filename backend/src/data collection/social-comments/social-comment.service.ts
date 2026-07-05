import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { GetSocialCommentsQueryDto } from './dto/get-social-comments-query.dto';

import {
  buildOrderBy,
  buildPagination,
} from '../../utilities/base-query/builder';
import { calculateTotalPages } from '../../utilities/analytics/analytics.helper';

/**
 * Service responsible for listing collected social comments.
 *
 * @author Malak
 */
@Injectable()
export class SocialCommentService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns paginated collected comments with optional filters.
   */
  async findComments(query: GetSocialCommentsQueryDto) {
    const { skip, take, page, limit } = buildPagination(query);

    const where: Prisma.SocialCommentWhereInput = {
      ...(query.postId && { postId: query.postId }),
      ...(query.language && { language: query.language }),
      ...(query.sentiment && { sentiment: query.sentiment }),
    };

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
              sourceType: true,
              region: true,
              collectionJobId: true,
            },
          },
        },
      }),
      this.prisma.socialComment.count({ where }),
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