import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import { UpsertIdeaFeedbackDto } from '../dto/upsert-idea-feedback.dto';

/**
 * Handles authenticated-user idea-feedback operations.
 *
 * Responsibilities:
 * - Create feedback for one owned idea.
 * - Update previously submitted feedback.
 * - Retrieve feedback for one owned idea.
 * - Retrieve all feedback submitted by one user.
 * - Recalculate the idea's average rating and rating count.
 *
 * Security rules:
 * - Users can only rate ideas they own.
 * - Users can only retrieve feedback associated with their account.
 * - Each user can have only one feedback record per idea.
 *
 * Consistency:
 * - Feedback upsert and idea rating aggregation occur in the
 *   same Prisma transaction.
 *
 * @author Eman
 */
@Injectable()
export class UserFeedbackService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Shared feedback response selection.
   */
  private readonly feedbackSelect = {
    id: true,
    rating: true,
    comment: true,
    createdAt: true,
    updatedAt: true,

    idea: {
      select: {
        id: true,
        title: true,
      },
    },
  } satisfies Prisma.IdeaFeedbackSelect;

  /**
   * Creates or updates feedback for one user-owned idea.
   *
   * After the upsert, the idea's aggregate rating fields are
   * recalculated from persisted feedback records.
   */
  async upsertFeedback(
    userId: string,
    ideaId: string,
    dto: UpsertIdeaFeedbackDto,
  ) {
    await this.ensureUserExists(userId);
    await this.ensureUserOwnsIdea(userId, ideaId);

    const normalizedComment =
      dto.comment !== undefined
        ? dto.comment.trim() || null
        : undefined;

    return this.prisma.$transaction(async (tx) => {
      const feedback = await tx.ideaFeedback.upsert({
        where: {
          userId_ideaId: {
            userId,
            ideaId,
          },
        },

        update: {
          rating: dto.rating,

          ...(normalizedComment !== undefined
            ? {
                comment: normalizedComment,
              }
            : {}),
        },

        create: {
          userId,
          ideaId,
          rating: dto.rating,
          comment: normalizedComment ?? null,
        },

        select: this.feedbackSelect,
      });

      const aggregation =
        await tx.ideaFeedback.aggregate({
          where: {
            ideaId,
          },

          _avg: {
            rating: true,
          },

          _count: {
            rating: true,
          },
        });

      const averageRating =
        aggregation._avg.rating ?? 0;

      const ratingsCount =
        aggregation._count.rating;

      await tx.idea.update({
        where: {
          id: ideaId,
        },

        data: {
          averageRating,
          ratingsCount,
        },
      });

      return {
        message: 'Feedback saved successfully',
        feedback,
        ideaRating: {
          averageRating: Number(
            averageRating.toFixed(2),
          ),
          ratingsCount,
        },
      };
    });
  }

  /**
   * Retrieves the authenticated user's feedback for one
   * specific owned idea.
   *
   * Returns null when the user has not submitted feedback yet.
   */
  async getFeedbackByIdea(
    userId: string,
    ideaId: string,
  ) {
    await this.ensureUserExists(userId);
    await this.ensureUserOwnsIdea(userId, ideaId);

    return this.prisma.ideaFeedback.findUnique({
      where: {
        userId_ideaId: {
          userId,
          ideaId,
        },
      },

      select: this.feedbackSelect,
    });
  }

  /**
   * Retrieves all feedback submitted by one authenticated user.
   */
  async getMyFeedback(userId: string) {
    await this.ensureUserExists(userId);

    return this.prisma.ideaFeedback.findMany({
      where: {
        userId,
      },

      orderBy: {
        updatedAt: 'desc',
      },

      select: {
        id: true,
        rating: true,
        comment: true,
        createdAt: true,
        updatedAt: true,

        idea: {
          select: {
            id: true,
            title: true,
            generationType: true,
            isUnlocked: true,
            averageRating: true,
            ratingsCount: true,
            createdAt: true,
          },
        },
      },
    });
  }

  /**
   * Ensures that the authenticated user exists.
   */
  private async ensureUserExists(
    userId: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },

      select: {
        id: true,
      },
    });

    if (!user) {
      throw new NotFoundException(
        'User not found',
      );
    }
  }

  /**
   * Ensures that the requested idea belongs to the user.
   */
  private async ensureUserOwnsIdea(
    userId: string,
    ideaId: string,
  ): Promise<void> {
    const idea = await this.prisma.idea.findFirst({
      where: {
        id: ideaId,
        userId,
      },

      select: {
        id: true,
      },
    });

    if (!idea) {
      throw new NotFoundException(
        'Idea not found',
      );
    }
  }
}