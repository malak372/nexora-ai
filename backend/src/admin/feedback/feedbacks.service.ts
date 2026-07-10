import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { GetFeedbacksQueryDto } from './dto/get-feedbacks-query.dto';

import {
  buildDateFilter,
  buildExactFilter,
  buildOrderBy,
  buildPagination,
} from '../../utilities/base-query/builder';

import {
  buildCsv,
  calculateTotalPages,
} from '../../utilities/analytics/analytics.helper';

/**
 * Service responsible for admin idea feedback analytics.
 *
 * Provides:
 * - Listing idea feedback with pagination, filtering, searching, and sorting.
 * - Summary statistics.
 * - Chart-ready analytics.
 * - CSV export.
 *
 * @author Malak
 */
@Injectable()
export class FeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  private buildFeedbackWhere(
    query: GetFeedbacksQueryDto,
  ): Prisma.IdeaFeedbackWhereInput {
    const where: Prisma.IdeaFeedbackWhereInput = {
      ...buildDateFilter(query),
      ...buildExactFilter('rating', query.rating),
      ...buildExactFilter('userId', query.userId),
      ...buildExactFilter('ideaId', query.ideaId),
    };

    if (query.search?.trim()) {
      const search = query.search.trim();

      where.OR = [
        {
          comment: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          user: {
            is: {
              OR: [
                {
                  fullName: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
                {
                  email: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              ],
            },
          },
        },
        {
          idea: {
            is: {
              title: {
                contains: search,
                mode: 'insensitive',
              },
            },
          },
        },
      ];
    }

    return where;
  }

  private mergeCreatedAtGte(
    where: Prisma.IdeaFeedbackWhereInput,
    gte: Date,
  ): Prisma.IdeaFeedbackWhereInput {
    const existingCreatedAt =
      typeof where.createdAt === 'object' && where.createdAt !== null
        ? where.createdAt
        : {};

    return {
      ...where,
      createdAt: {
        ...existingCreatedAt,
        gte,
      },
    };
  }

  async getFeedback(query: GetFeedbacksQueryDto) {
    const { page, limit, skip } = buildPagination(query);
    const where = this.buildFeedbackWhere(query);

    const orderBy = buildOrderBy(
      query,
      ['rating', 'createdAt', 'updatedAt'] as const,
      'createdAt',
    );

    const [feedback, total] = await Promise.all([
      this.prisma.ideaFeedback.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        select: {
          id: true,
          rating: true,
          comment: true,
          createdAt: true,
          updatedAt: true,
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
          idea: {
            select: {
              id: true,
              title: true,
              averageRating: true,
              ratingsCount: true,
            },
          },
        },
      }),
      this.prisma.ideaFeedback.count({ where }),
    ]);

    return {
      data: feedback,
      meta: {
        page,
        limit,
        total,
        totalPages: calculateTotalPages(total, limit),
      },
    };
  }

  async getFeedbackSummary(query: GetFeedbacksQueryDto) {
    const where = this.buildFeedbackWhere(query);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const todayWhere = this.mergeCreatedAtGte(where, todayStart);
    const monthWhere = this.mergeCreatedAtGte(where, monthStart);

    const [
      totalFeedback,
      todayFeedback,
      thisMonthFeedback,
      averageResult,
      feedbackByRating,
    ] = await Promise.all([
      this.prisma.ideaFeedback.count({ where }),
      this.prisma.ideaFeedback.count({ where: todayWhere }),
      this.prisma.ideaFeedback.count({ where: monthWhere }),
      this.prisma.ideaFeedback.aggregate({
        where,
        _avg: {
          rating: true,
        },
      }),
      this.prisma.ideaFeedback.groupBy({
        by: ['rating'],
        where,
        _count: {
          rating: true,
        },
      }),
    ]);

    const distribution = {
      oneStar: 0,
      twoStars: 0,
      threeStars: 0,
      fourStars: 0,
      fiveStars: 0,
    };

    for (const item of feedbackByRating) {
      if (item.rating === 1) distribution.oneStar = item._count.rating;
      if (item.rating === 2) distribution.twoStars = item._count.rating;
      if (item.rating === 3) distribution.threeStars = item._count.rating;
      if (item.rating === 4) distribution.fourStars = item._count.rating;
      if (item.rating === 5) distribution.fiveStars = item._count.rating;
    }

    return {
      totalFeedback,
      todayFeedback,
      thisMonthFeedback,
      averageRating: Number((averageResult._avg.rating ?? 0).toFixed(2)),
      ...distribution,
    };
  }

  async getFeedbackCharts(query: GetFeedbacksQueryDto) {
    const where = this.buildFeedbackWhere(query);

    const [ratingDistribution, topRatedIdeas] = await Promise.all([
      this.prisma.ideaFeedback.groupBy({
        by: ['rating'],
        where,
        _count: {
          rating: true,
        },
        orderBy: {
          rating: 'desc',
        },
      }),

      this.prisma.idea.findMany({
        where: {
          ratingsCount: {
            gt: 0,
          },
        },
        orderBy: [
          {
            averageRating: 'desc',
          },
          {
            ratingsCount: 'desc',
          },
        ],
        take: 5,
        select: {
          id: true,
          title: true,
          averageRating: true,
          ratingsCount: true,
        },
      }),
    ]);

    return {
      ratingDistribution: ratingDistribution.map((item) => ({
        label: `${item.rating} Star`,
        rating: item.rating,
        count: item._count.rating,
      })),
      topRatedIdeas: topRatedIdeas.map((idea) => ({
        id: idea.id,
        title: idea.title,
        averageRating: Number(idea.averageRating),
        ratingsCount: idea.ratingsCount,
      })),
    };
  }

  async exportFeedbackCsv(query: GetFeedbacksQueryDto) {
    const where = this.buildFeedbackWhere(query);

    const orderBy = buildOrderBy(
      query,
      ['rating', 'createdAt', 'updatedAt'] as const,
      'createdAt',
    );

    const feedback = await this.prisma.ideaFeedback.findMany({
      where,
      orderBy,
      select: {
        id: true,
        rating: true,
        comment: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        idea: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    });

    const headers = [
      'Feedback ID',
      'Rating',
      'Comment',
      'User ID',
      'User Name',
      'User Email',
      'Idea ID',
      'Idea Title',
      'Created At',
      'Updated At',
    ];

    const rows = feedback.map((item) => [
      item.id,
      item.rating,
      item.comment ?? '',
      item.user.id,
      item.user.fullName,
      item.user.email,
      item.idea.id,
      item.idea.title,
      item.createdAt.toISOString(),
      item.updatedAt.toISOString(),
    ]);

    return buildCsv(headers, rows);
  }
}
