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

type UserFeedbackActor = {
  userId: string;
  guestSessionId?: never;
};

type GuestFeedbackActor = {
  guestSessionId: string;
  userId?: never;
};

export type FeedbackActor = UserFeedbackActor | GuestFeedbackActor;

/**
 * Handles publication ratings and textual feedback for authenticated users
 * and secure guest sessions.
 *
 * @author Eman
 */
@Injectable()
export class UserFeedbackService {
  constructor(private readonly prisma: PrismaService) { }

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
   * Creates or updates the actor's rating for a publication.
   */
  async upsertRating(
    actor: FeedbackActor,
    publicationId: string,
    dto: UpsertPublicationRatingDto,
  ) {
    await this.ensurePublicationAllowsRatings(publicationId);

    return this.prisma.$transaction(async (tx) => {
      let rating;

      if (this.isUserActor(actor)) {
        const userId = actor.userId;

        rating = await tx.ideaPublicationRating.upsert({
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
      } else {
        const guestSessionId = actor.guestSessionId;

        rating = await tx.ideaPublicationRating.upsert({
          where: {
            publicationId_guestSessionId: {
              publicationId,
              guestSessionId,
            },
          },
          update: {
            value: dto.value,
          },
          create: {
            publicationId,
            guestSessionId,
            value: dto.value,
          },
          select: this.ratingSelect,
        });
      }

      const publicationRating = await this.recalculateRatings(
        tx,
        publicationId,
      );

      return {
        message: 'Publication rating saved successfully',
        rating,
        publicationRating,
      };
    });
  }

  /**
   * Returns the current actor's rating for a publication.
   */
  async getMyRating(actor: FeedbackActor, publicationId: string) {
    await this.ensurePublishedPublicationExists(publicationId);

    if (this.isUserActor(actor)) {
      const userId = actor.userId;

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

    const guestSessionId = actor.guestSessionId;

    return this.prisma.ideaPublicationRating.findUnique({
      where: {
        publicationId_guestSessionId: {
          publicationId,
          guestSessionId,
        },
      },
      select: this.ratingSelect,
    });
  }

  /**
   * Deletes the current actor's rating and recalculates publication totals.
   */
  async deleteRating(actor: FeedbackActor, publicationId: string) {
    await this.ensurePublishedPublicationExists(publicationId);

    const existing = await this.getMyRating(actor, publicationId);

    if (!existing) {
      throw new NotFoundException('Publication rating not found');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.ideaPublicationRating.delete({
        where: {
          id: existing.id,
        },
      });

      const publicationRating = await this.recalculateRatings(
        tx,
        publicationId,
      );

      return {
        message: 'Publication rating deleted successfully',
        publicationRating,
      };
    });
  }

  /**
   * Creates or updates the actor's textual feedback.
   */
  async upsertFeedback(
    actor: FeedbackActor,
    publicationId: string,
    dto: UpsertPublicationFeedbackDto,
  ) {
    await this.ensurePublicationAllowsFeedback(publicationId);

    return this.prisma.$transaction(async (tx) => {
      let feedback;

      if (this.isUserActor(actor)) {
        const userId = actor.userId;

        feedback = await tx.ideaPublicationFeedback.upsert({
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
      } else {
        const guestSessionId = actor.guestSessionId;

        feedback = await tx.ideaPublicationFeedback.upsert({
          where: {
            publicationId_guestSessionId: {
              publicationId,
              guestSessionId,
            },
          },
          update: {
            comment: dto.comment,
            status: PublicationFeedbackStatus.VISIBLE,
          },
          create: {
            publicationId,
            guestSessionId,
            comment: dto.comment,
          },
          select: this.feedbackSelect,
        });
      }

      const feedbackCount = await this.recalculateFeedback(
        tx,
        publicationId,
      );

      return {
        message: 'Publication feedback saved successfully',
        feedback,
        feedbackCount,
      };
    });
  }

  /**
   * Returns the current actor's feedback for a publication.
   */
  async getMyFeedback(actor: FeedbackActor, publicationId: string) {
    await this.ensurePublishedPublicationExists(publicationId);

    if (this.isUserActor(actor)) {
      const userId = actor.userId;

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

    const guestSessionId = actor.guestSessionId;

    return this.prisma.ideaPublicationFeedback.findUnique({
      where: {
        publicationId_guestSessionId: {
          publicationId,
          guestSessionId,
        },
      },
      select: this.feedbackSelect,
    });
  }

  /**
   * Deletes the current actor's feedback and recalculates its count.
   */
  async deleteFeedback(actor: FeedbackActor, publicationId: string) {
    await this.ensurePublishedPublicationExists(publicationId);

    const existing = await this.getMyFeedback(actor, publicationId);

    if (!existing) {
      throw new NotFoundException('Publication feedback not found');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.ideaPublicationFeedback.delete({
        where: {
          id: existing.id,
        },
      });

      const feedbackCount = await this.recalculateFeedback(
        tx,
        publicationId,
      );

      return {
        message: 'Publication feedback deleted successfully',
        feedbackCount,
      };
    });
  }

  /**
   * Recalculates and persists the publication rating statistics.
   */
  private async recalculateRatings(
    tx: Prisma.TransactionClient,
    publicationId: string,
  ) {
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
      averageRating: Number(averageRating.toFixed(2)),
      ratingsCount,
    };
  }

  /**
   * Recalculates and persists the number of visible feedback records.
   */
  private async recalculateFeedback(
    tx: Prisma.TransactionClient,
    publicationId: string,
  ) {
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

    return feedbackCount;
  }

  /**
   * Ensures that the requested publication is publicly available.
   */
  private async ensurePublishedPublicationExists(publicationId: string) {
    const publication = await this.prisma.ideaPublication.findFirst({
      where: {
        id: publicationId,
        status: IdeaPublicationStatus.PUBLISHED,
        isHidden: false,
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
   * Ensures that rating is enabled for the requested publication.
   */
  private async ensurePublicationAllowsRatings(publicationId: string) {
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

    if (!publication || publication.isHidden) {
      throw new NotFoundException('Published publication not found');
    }

    if (!publication.allowRatings) {
      throw new BadRequestException(
        'Ratings are disabled for this publication',
      );
    }
  }

  /**
   * Ensures that feedback is enabled for the requested publication.
   */
  private async ensurePublicationAllowsFeedback(publicationId: string) {
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

    if (!publication || publication.isHidden) {
      throw new NotFoundException('Published publication not found');
    }

    if (!publication.allowFeedback) {
      throw new BadRequestException(
        'Feedback is disabled for this publication',
      );
    }
  }

  /**
   * Narrows the feedback actor to an authenticated user.
   */
  private isUserActor(actor: FeedbackActor): actor is UserFeedbackActor {
    return typeof actor.userId === 'string';
  }
}