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

import { TOP_RATED_PUBLICATIONS_LIMIT } from '../constants/feedback.constants';

import { GetFeedbackQueryDto } from '../dto/get-feedback-query.dto';

/**
 * Handles administrator publication-feedback monitoring
 * and analytics.
 *
 * @author Malak
 */
@Injectable()
export class AdminFeedbackService {
  constructor(private readonly prisma: PrismaService) { }

  /**
   * Returns paginated textual publication feedback.
   */
  async getFeedbackComments(query: GetFeedbackQueryDto) {
    const { page, limit, skip, take } = buildPagination(query);

    const where = this.buildCommentWhere(query);

    const orderBy = buildOrderBy(
      query,
      ['createdAt', 'updatedAt', 'status'] as const,
      'createdAt',
    );

    const [feedback, total] = await Promise.all([
      this.prisma.ideaPublicationFeedback.findMany({
        where,
        skip,
        take,
        orderBy,

        select: {
          id: true,
          comment: true,
          status: true,
          createdAt: true,
          updatedAt: true,

          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },

          publication: {
            select: {
              id: true,
              publicTitle: true,
              feedbackCount: true,

              idea: {
                select: {
                  id: true,
                },
              },
            },
          },
        },
      }),

      this.prisma.ideaPublicationFeedback.count({
        where,
      }),
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

  /**
   * Returns paginated publication ratings.
   */
  async getRatings(query: GetFeedbackQueryDto) {
    const { page, limit, skip, take } = buildPagination(query);

    const where = this.buildRatingWhere(query);

    const orderBy = buildOrderBy(
      query,
      ['value', 'createdAt', 'updatedAt'] as const,
      'createdAt',
    );

    const [ratings, total] = await Promise.all([
      this.prisma.ideaPublicationRating.findMany({
        where,
        skip,
        take,
        orderBy,

        select: {
          id: true,
          value: true,
          createdAt: true,
          updatedAt: true,

          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },

          publication: {
            select: {
              id: true,
              publicTitle: true,
              averageRating: true,
              ratingsCount: true,

              idea: {
                select: {
                  id: true,
                },
              },
            },
          },
        },
      }),

      this.prisma.ideaPublicationRating.count({
        where,
      }),
    ]);

    return {
      data: ratings,

      meta: {
        page,
        limit,
        total,
        totalPages: calculateTotalPages(total, limit),
      },
    };
  }

  /**
   * Returns combined rating and textual-feedback statistics.
   */
  async getFeedbackSummary(query: GetFeedbackQueryDto) {
    const commentWhere = this.buildCommentWhere(query);
    const ratingWhere = this.buildRatingWhere(query);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [
      totalComments,
      totalRatings,
      todayComments,
      todayRatings,
      monthComments,
      monthRatings,
      averageResult,
    ] = await Promise.all([
      this.prisma.ideaPublicationFeedback.count({
        where: commentWhere,
      }),

      this.prisma.ideaPublicationRating.count({
        where: ratingWhere,
      }),

      this.prisma.ideaPublicationFeedback.count({
        where: this.mergeCreatedAtGte(commentWhere, todayStart),
      }),

      this.prisma.ideaPublicationRating.count({
        where: this.mergeCreatedAtGte(ratingWhere, todayStart),
      }),

      this.prisma.ideaPublicationFeedback.count({
        where: this.mergeCreatedAtGte(commentWhere, monthStart),
      }),

      this.prisma.ideaPublicationRating.count({
        where: this.mergeCreatedAtGte(ratingWhere, monthStart),
      }),

      this.prisma.ideaPublicationRating.aggregate({
        where: ratingWhere,

        _avg: {
          value: true,
        },
      }),
    ]);

    return {
      totalComments,
      totalRatings,

      todayComments,
      todayRatings,

      thisMonthComments: monthComments,
      thisMonthRatings: monthRatings,

      averageRating: Number(
        (averageResult._avg.value ?? 0).toFixed(2),
      ),
    };
  }

  /**
   * Returns rating distribution and top-rated publications.
   */
  async getFeedbackCharts(query: GetFeedbackQueryDto) {
    const ratingWhere = this.buildRatingWhere(query);

    const [ratingDistribution, topRatedPublications] =
      await Promise.all([
        this.prisma.ideaPublicationRating.groupBy({
          by: ['value'],
          where: ratingWhere,

          _count: {
            value: true,
          },

          orderBy: {
            value: 'desc',
          },
        }),

        this.findTopRatedPublications(query),
      ]);

    const distribution = Array.from(
      {
        length: 5,
      },
      (_, index) => {
        const value = index + 1;

        const item = ratingDistribution.find(
          (rating) => rating.value === value,
        );

        return {
          label: `${value} Star`,
          rating: value,
          count: item?._count.value ?? 0,
        };
      },
    );

    return {
      ratingDistribution: distribution,

      topRatedPublications: topRatedPublications.map(
        (publication) => ({
          id: publication.id,
          title: publication.publicTitle,
          averageRating: Number(publication.averageRating),
          ratingsCount: publication.ratingsCount,
          feedbackCount: publication.feedbackCount,
        }),
      ),
    };
  }

  /**
   * Exports textual feedback as CSV.
   */
  async exportFeedbackCsv(query: GetFeedbackQueryDto) {
    const feedback =
      await this.prisma.ideaPublicationFeedback.findMany({
        where: this.buildCommentWhere(query),

        orderBy: {
          createdAt: 'desc',
        },

        select: {
          id: true,
          comment: true,
          status: true,
          createdAt: true,
          updatedAt: true,

          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },

          publication: {
            select: {
              id: true,
              publicTitle: true,

              idea: {
                select: {
                  id: true,
                },
              },
            },
          },
        },
      });

    const headers = [
      'Feedback ID',
      'Comment',
      'Status',
      'User ID',
      'User Name',
      'User Email',
      'Publication ID',
      'Publication Title',
      'Idea ID',
      'Created At',
      'Updated At',
    ];

    const rows = feedback.map((item) => [
      item.id,
      item.comment,
      item.status,
      item.user.id,
      item.user.fullName,
      item.user.email,
      item.publication.id,
      item.publication.publicTitle,
      item.publication.idea.id,
      item.createdAt.toISOString(),
      item.updatedAt.toISOString(),
    ]);

    return buildCsv(headers, rows);
  }

  /**
   * Exports ratings as CSV.
   */
  async exportRatingsCsv(query: GetFeedbackQueryDto) {
    const ratings =
      await this.prisma.ideaPublicationRating.findMany({
        where: this.buildRatingWhere(query),

        orderBy: {
          createdAt: 'desc',
        },

        select: {
          id: true,
          value: true,
          createdAt: true,
          updatedAt: true,

          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },

          publication: {
            select: {
              id: true,
              publicTitle: true,

              idea: {
                select: {
                  id: true,
                },
              },
            },
          },
        },
      });

    const headers = [
      'Rating ID',
      'Rating',
      'User ID',
      'User Name',
      'User Email',
      'Publication ID',
      'Publication Title',
      'Idea ID',
      'Created At',
      'Updated At',
    ];

    const rows = ratings.map((item) => [
      item.id,
      item.value,
      item.user.id,
      item.user.fullName,
      item.user.email,
      item.publication.id,
      item.publication.publicTitle,
      item.publication.idea.id,
      item.createdAt.toISOString(),
      item.updatedAt.toISOString(),
    ]);

    return buildCsv(headers, rows);
  }

  /**
   * Returns the highest-rated publications.
   */
  private findTopRatedPublications(query: GetFeedbackQueryDto) {
    const publicationWhere: Prisma.IdeaPublicationWhereInput = {
      ratingsCount: {
        gt: 0,
      },

      ...(query.publicationId
        ? {
          id: query.publicationId,
        }
        : {}),

      ...(query.ideaId
        ? {
          ideaId: query.ideaId,
        }
        : {}),

      ...(query.userId || query.rating
        ? {
          ratings: {
            some: {
              ...(query.userId
                ? {
                  userId: query.userId,
                }
                : {}),

              ...(query.rating
                ? {
                  value: query.rating,
                }
                : {}),

              ...(buildDateFilter(query) ?? {}),
            },
          },
        }
        : {}),
    };

    return this.prisma.ideaPublication.findMany({
      where: publicationWhere,

      orderBy: [
        {
          averageRating: 'desc',
        },
        {
          ratingsCount: 'desc',
        },
      ],

      take: TOP_RATED_PUBLICATIONS_LIMIT,

      select: {
        id: true,
        publicTitle: true,
        averageRating: true,
        ratingsCount: true,
        feedbackCount: true,
      },
    });
  }

  /**
   * Builds textual-feedback filters.
   */
  private buildCommentWhere(
    query: GetFeedbackQueryDto,
  ): Prisma.IdeaPublicationFeedbackWhereInput {
    const where: Prisma.IdeaPublicationFeedbackWhereInput = {
      ...(buildDateFilter(query) ?? {}),

      ...(buildExactFilter('status', query.status) ?? {}),

      ...(buildExactFilter('userId', query.userId) ?? {}),

      ...(buildExactFilter(
        'publicationId',
        query.publicationId,
      ) ?? {}),

      ...(query.ideaId
        ? {
          publication: {
            is: {
              ideaId: query.ideaId,
            },
          },
        }
        : {}),
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
          publication: {
            is: {
              publicTitle: {
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
   * Builds publication-rating filters.
   */
  private buildRatingWhere(
    query: GetFeedbackQueryDto,
  ): Prisma.IdeaPublicationRatingWhereInput {
    const where: Prisma.IdeaPublicationRatingWhereInput = {
      ...(buildDateFilter(query) ?? {}),

      ...(buildExactFilter('value', query.rating) ?? {}),

      ...(buildExactFilter('userId', query.userId) ?? {}),

      ...(buildExactFilter(
        'publicationId',
        query.publicationId,
      ) ?? {}),

      ...(query.ideaId
        ? {
          publication: {
            is: {
              ideaId: query.ideaId,
            },
          },
        }
        : {}),
    };

    const search = query.search?.trim();

    if (search) {
      where.OR = [
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
          publication: {
            is: {
              publicTitle: {
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
   * Adds a lower createdAt bound while preserving
   * existing date-filter values.
   */
  private mergeCreatedAtGte<
    T extends {
      createdAt?: unknown;
    },
  >(where: T, gte: Date): T {
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