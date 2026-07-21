import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  IdeaPublicationStatus,
  Prisma,
  PublicationFeedbackStatus,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import { UpsertPublicationFeedbackDto } from '../dto/upsert-publication-feedback.dto';
import { UpsertPublicationRatingDto } from '../dto/upsert-publication-rating.dto';

/**
 * Handles authenticated-user publication feedback
 * and rating operations.
 *
 * Responsibilities:
 * - Create and update publication ratings.
 * - Delete publication ratings.
 * - Create and update textual publication feedback.
 * - Delete textual publication feedback.
 * - Maintain publication aggregate fields.
 *
 * Consistency:
 * - Rating mutations and rating aggregate updates run
 *   inside the same database transaction.
 * - Feedback mutations and feedback-count updates run
 *   inside the same database transaction.
 *
 * @author Eman
 */
@Injectable()
export class UserFeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Shared publication-rating response selection.
   */
  private readonly ratingSelect = {
    id: true,
    value: true,
    createdAt: true,
    updatedAt: true,

    publication: {
      select: {
        id: true,
        publicTitle: true,
        averageRating: true,
        ratingsCount: true,
      },
    },
  } satisfies Prisma.IdeaPublicationRatingSelect;

  /**
   * Shared publication-feedback response selection.
   */
  private readonly feedbackSelect = {
    id: true,
    comment: true,
    status: true,
    createdAt: true,
    updatedAt: true,

    publication: {
      select: {
        id: true,
        publicTitle: true,
        feedbackCount: true,
      },
    },
  } satisfies Prisma.IdeaPublicationFeedbackSelect;

  /**
   * Creates or updates the authenticated user's rating.
   */
  async upsertRating(
    userId: string,
    publicationId: string,
    dto: UpsertPublicationRatingDto,
  ) {
    await this.ensurePublicationAllowsRatings(publicationId);

    return this.prisma.$transaction(async (tx) => {
      const rating = await tx.ideaPublicationRating.upsert({
        where: {
          publicationId_userId: {
            publicationId,
            userId,
          },
        },

        update: {
          value: dto.value,
        },

        create: {
          publicationId,
          userId,
          value: dto.value,
        },

        select: this.ratingSelect,
      });

      const aggregate = await tx.ideaPublicationRating.aggregate({
        where: {
          publicationId,
        },

        _avg: {
          value: true,
        },

        _count: {
          value: true,
        },
      });

      const averageRating = aggregate._avg.value ?? 0;
      const ratingsCount = aggregate._count.value;

      await tx.ideaPublication.update({
        where: {
          id: publicationId,
        },

        data: {
          averageRating,
          ratingsCount,
        },
      });

      return {
        message: 'Publication rating saved successfully',

        rating,

        publicationRating: {
          averageRating: Number(averageRating.toFixed(2)),
          ratingsCount,
        },
      };
    });
  }

  /**
   * Returns the authenticated user's rating
   * for one publication.
   */
  async getMyRating(userId: string, publicationId: string) {
    await this.ensurePublishedPublicationExists(publicationId);

    return this.prisma.ideaPublicationRating.findUnique({
      where: {
        publicationId_userId: {
          publicationId,
          userId,
        },
      },

      select: this.ratingSelect,
    });
  }

  /**
   * Deletes the authenticated user's rating and recalculates
   * publication rating aggregates.
   */
  async deleteRating(userId: string, publicationId: string) {
    await this.ensurePublishedPublicationExists(publicationId);

    const existingRating = await this.prisma.ideaPublicationRating.findUnique({
      where: {
        publicationId_userId: {
          publicationId,
          userId,
        },
      },

      select: {
        id: true,
      },
    });

    if (!existingRating) {
      throw new NotFoundException('Publication rating not found');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.ideaPublicationRating.delete({
        where: {
          id: existingRating.id,
        },
      });

      const aggregate = await tx.ideaPublicationRating.aggregate({
        where: {
          publicationId,
        },

        _avg: {
          value: true,
        },

        _count: {
          value: true,
        },
      });

      const averageRating = aggregate._avg.value ?? 0;
      const ratingsCount = aggregate._count.value;

      await tx.ideaPublication.update({
        where: {
          id: publicationId,
        },

        data: {
          averageRating,
          ratingsCount,
        },
      });

      return {
        message: 'Publication rating deleted successfully',

        publicationRating: {
          averageRating: Number(averageRating.toFixed(2)),
          ratingsCount,
        },
      };
    });
  }

  /**
   * Creates or updates textual feedback for one publication.
   *
   * Updating feedback resets its moderation status to VISIBLE.
   */
  async upsertFeedback(
    userId: string,
    publicationId: string,
    dto: UpsertPublicationFeedbackDto,
  ) {
    await this.ensurePublicationAllowsFeedback(publicationId);

    return this.prisma.$transaction(async (tx) => {
      const feedback = await tx.ideaPublicationFeedback.upsert({
        where: {
          publicationId_userId: {
            publicationId,
            userId,
          },
        },

        update: {
          comment: dto.comment,
          status: PublicationFeedbackStatus.VISIBLE,
        },

        create: {
          publicationId,
          userId,
          comment: dto.comment,
        },

        select: this.feedbackSelect,
      });

      const feedbackCount = await tx.ideaPublicationFeedback.count({
        where: {
          publicationId,
          status: PublicationFeedbackStatus.VISIBLE,
        },
      });

      await tx.ideaPublication.update({
        where: {
          id: publicationId,
        },

        data: {
          feedbackCount,
        },
      });

      return {
        message: 'Publication feedback saved successfully',
        feedback,
        feedbackCount,
      };
    });
  }

  /**
   * Returns the authenticated user's textual feedback
   * for one publication.
   */
  async getMyFeedback(userId: string, publicationId: string) {
    await this.ensurePublishedPublicationExists(publicationId);

    return this.prisma.ideaPublicationFeedback.findUnique({
      where: {
        publicationId_userId: {
          publicationId,
          userId,
        },
      },

      select: this.feedbackSelect,
    });
  }

  /**
   * Deletes the authenticated user's textual feedback.
   */
  async deleteFeedback(userId: string, publicationId: string) {
    await this.ensurePublishedPublicationExists(publicationId);

    const existingFeedback =
      await this.prisma.ideaPublicationFeedback.findUnique({
        where: {
          publicationId_userId: {
            publicationId,
            userId,
          },
        },

        select: {
          id: true,
        },
      });

    if (!existingFeedback) {
      throw new NotFoundException('Publication feedback not found');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.ideaPublicationFeedback.delete({
        where: {
          id: existingFeedback.id,
        },
      });

      const feedbackCount = await tx.ideaPublicationFeedback.count({
        where: {
          publicationId,
          status: PublicationFeedbackStatus.VISIBLE,
        },
      });

      await tx.ideaPublication.update({
        where: {
          id: publicationId,
        },

        data: {
          feedbackCount,
        },
      });

      return {
        message: 'Publication feedback deleted successfully',
        feedbackCount,
      };
    });
  }

  /**
   * Ensures that a published publication exists.
   */
  private async ensurePublishedPublicationExists(
    publicationId: string,
  ): Promise<void> {
    const publication = await this.prisma.ideaPublication.findFirst({
      where: {
        id: publicationId,
        status: IdeaPublicationStatus.PUBLISHED,
      },

      select: {
        id: true,
      },
    });

    if (!publication) {
      throw new NotFoundException('Published idea not found');
    }
  }

  /**
   * Ensures that the publication accepts ratings.
   */
  private async ensurePublicationAllowsRatings(
    publicationId: string,
  ): Promise<void> {
    const publication = await this.prisma.ideaPublication.findFirst({
      where: {
        id: publicationId,
        status: IdeaPublicationStatus.PUBLISHED,
      },

      select: {
        allowRatings: true,
        isHidden: true,
      },
    });

    if (!publication) {
      throw new NotFoundException('Published idea not found');
    }

    if (publication.isHidden) {
      throw new NotFoundException('Published publication not found');
    }

    if (!publication.allowRatings) {
      throw new BadRequestException(
        'Ratings are disabled for this publication',
      );
    }
  }

  /**
   * Ensures that the publication accepts textual feedback.
   */
  private async ensurePublicationAllowsFeedback(
    publicationId: string,
  ): Promise<void> {
    const publication = await this.prisma.ideaPublication.findFirst({
      where: {
        id: publicationId,
        status: IdeaPublicationStatus.PUBLISHED,
      },

      select: {
        allowFeedback: true,
        isHidden: true,
      },
    });

    if (!publication) {
      throw new NotFoundException('Published idea not found');
    }

    if (publication.isHidden) {
      throw new NotFoundException('Published publication not found');
    }

    if (!publication.allowFeedback) {
      throw new BadRequestException(
        'Feedback is disabled for this publication',
      );
    }
  }
}
