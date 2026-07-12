import { Injectable } from '@nestjs/common';

import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

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

import {
  MAX_FEEDBACK_RATING,
  MIN_FEEDBACK_RATING,
  TOP_RATED_IDEAS_LIMIT,
} from '../constants/feedback.constants';

import { GetFeedbackQueryDto } from '../dto/get-feedback-query.dto';

/**
 * Handles administrator idea-feedback monitoring and analytics.
 *
 * Responsibilities:
 * - List idea feedback.
 * - Search, filter, sort, and paginate feedback.
 * - Generate summary statistics.
 * - Generate chart-ready analytics.
 * - Export filtered feedback as CSV.
 *
 * @author Malak
 */
@Injectable()
export class AdminFeedbackService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Returns paginated feedback for administrator monitoring.
   */
  async getFeedback(
    query: GetFeedbackQueryDto,
  ) {
    const {
      page,
      limit,
      skip,
      take,
    } = buildPagination(query);

    const where = this.buildFeedbackWhere(query);

    const orderBy = buildOrderBy(
      query,
      [
        'rating',
        'createdAt',
        'updatedAt',
      ] as const,
      'createdAt',
    );

    const [feedback, total] = await Promise.all([
      this.prisma.ideaFeedback.findMany({
        where,
        skip,
        take,
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

      this.prisma.ideaFeedback.count({
        where,
      }),
    ]);

    return {
      data: feedback,

      meta: {
        page,
        limit,
        total,
        totalPages: calculateTotalPages(
          total,
          limit,
        ),
      },
    };
  }

  /**
   * Returns feedback summary statistics.
   */
  async getFeedbackSummary(
    query: GetFeedbackQueryDto,
  ) {
    const where = this.buildFeedbackWhere(query);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const todayWhere = this.mergeCreatedAtGte(
      where,
      todayStart,
    );

    const monthWhere = this.mergeCreatedAtGte(
      where,
      monthStart,
    );

    const [
      totalFeedback,
      todayFeedback,
      thisMonthFeedback,
      averageResult,
      feedbackByRating,
    ] = await Promise.all([
      this.prisma.ideaFeedback.count({
        where,
      }),

      this.prisma.ideaFeedback.count({
        where: todayWhere,
      }),

      this.prisma.ideaFeedback.count({
        where: monthWhere,
      }),

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
      switch (item.rating) {
        case 1:
          distribution.oneStar = item._count.rating;
          break;

        case 2:
          distribution.twoStars = item._count.rating;
          break;

        case 3:
          distribution.threeStars = item._count.rating;
          break;

        case 4:
          distribution.fourStars = item._count.rating;
          break;

        case 5:
          distribution.fiveStars = item._count.rating;
          break;
      }
    }

    return {
      totalFeedback,
      todayFeedback,
      thisMonthFeedback,

      averageRating: Number(
        (averageResult._avg.rating ?? 0).toFixed(2),
      ),

      ...distribution,
    };
  }

  /**
   * Returns rating distribution and highest-rated ideas.
   */
  async getFeedbackCharts(
    query: GetFeedbackQueryDto,
  ) {
    const where = this.buildFeedbackWhere(query);

    const [
      ratingDistribution,
      topRatedIdeas,
    ] = await Promise.all([
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

      this.findTopRatedIdeas(query),
    ]);

    return {
      ratingDistribution:
        ratingDistribution.map((item) => ({
          label: `${item.rating} Star`,
          rating: item.rating,
          count: item._count.rating,
        })),

      topRatedIdeas: topRatedIdeas.map((idea) => ({
        id: idea.id,
        title: idea.title,
        averageRating: Number(
          idea.averageRating,
        ),
        ratingsCount: idea.ratingsCount,
      })),
    };
  }

  /**
   * Exports filtered feedback as CSV.
   */
  async exportFeedbackCsv(
    query: GetFeedbackQueryDto,
  ) {
    const where = this.buildFeedbackWhere(query);

    const orderBy = buildOrderBy(
      query,
      [
        'rating',
        'createdAt',
        'updatedAt',
      ] as const,
      'createdAt',
    );

    const feedback =
      await this.prisma.ideaFeedback.findMany({
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

    return buildCsv(
      headers,
      rows,
    );
  }

  /**
   * Returns top-rated ideas while respecting relevant
   * feedback query filters.
   *
   * userId, ideaId, rating, and date filters are applied
   * through the related feedback records.
   */
  private findTopRatedIdeas(
    query: GetFeedbackQueryDto,
  ) {
    const feedbackWhere =
      this.buildFeedbackWhere(query);

    return this.prisma.idea.findMany({
      where: {
        ratingsCount: {
          gt: 0,
        },

        feedback: {
          some: feedbackWhere,
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

      take: TOP_RATED_IDEAS_LIMIT,

      select: {
        id: true,
        title: true,
        averageRating: true,
        ratingsCount: true,
      },
    });
  }

  /**
   * Builds the shared administrator feedback filter.
   */
  private buildFeedbackWhere(
    query: GetFeedbackQueryDto,
  ): Prisma.IdeaFeedbackWhereInput {
    const where: Prisma.IdeaFeedbackWhereInput = {
      ...(buildDateFilter(query) ?? {}),

      ...(buildExactFilter(
        'rating',
        query.rating,
      ) ?? {}),

      ...(buildExactFilter(
        'userId',
        query.userId,
      ) ?? {}),

      ...(buildExactFilter(
        'ideaId',
        query.ideaId,
      ) ?? {}),
    };

    const search = query.search?.trim();

    if (search) {
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

  /**
   * Adds a minimum createdAt value while preserving
   * an existing date filter.
   */
  private mergeCreatedAtGte(
    where: Prisma.IdeaFeedbackWhereInput,
    gte: Date,
  ): Prisma.IdeaFeedbackWhereInput {
    const existingCreatedAt =
      typeof where.createdAt === 'object' &&
      where.createdAt !== null
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
}