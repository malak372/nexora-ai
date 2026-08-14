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
import { PublicationCacheService } from '../../ideas/publication/cache/publication-cache.service';
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
  /**
   * The default Prisma interactive-transaction timeout is 5 seconds.
   *
   * Rating/feedback mutations perform an actor upsert/delete, an aggregate
   * query, and a publication counter update in the same transaction. With a
   * remote pooled PostgreSQL connection this can occasionally exceed the
   * default even when every individual query is healthy.
   *
   * Keep the transaction atomic, but give the remote database enough room for
   * normal network/pool latency instead of failing with Prisma P2028.
   */
  private readonly transactionOptions = {
    maxWait: 10_000,
    timeout: 20_000,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly publicationCache: PublicationCacheService,
  ) { }

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
    await this.ensurePublicationAllowsRatings(actor, publicationId);

    const result = await this.prisma.$transaction(async (tx) => {
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
    }, this.transactionOptions);

    await this.publicationCache.invalidateDiscovery(publicationId);
    return result;
  }

  /**
   * Returns the current actor's rating for a publication.
   */
  async getMyRating(actor: FeedbackActor, publicationId: string) {
    await this.ensurePublicationAccessibleToActor(actor, publicationId);

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
    await this.ensurePublicationAccessibleToActor(actor, publicationId);

    const existing = await this.getMyRating(actor, publicationId);

    if (!existing) {
      throw new NotFoundException('Publication rating not found');
    }

    const result = await this.prisma.$transaction(async (tx) => {
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
    }, this.transactionOptions);

    await this.publicationCache.invalidateDiscovery(publicationId);
    return result;
  }

  /**
   * Creates or updates the actor's textual feedback.
   */
  async upsertFeedback(
    actor: FeedbackActor,
    publicationId: string,
    dto: UpsertPublicationFeedbackDto,
  ) {
    await this.ensurePublicationAllowsFeedback(actor, publicationId);

    const result = await this.prisma.$transaction(async (tx) => {
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

      const feedbackCount = await this.recalculateFeedback(tx, publicationId);

      return {
        message: 'Publication feedback saved successfully',
        feedback,
        feedbackCount,
      };
    }, this.transactionOptions);

    await this.publicationCache.invalidateDiscovery(publicationId);
    return result;
  }

  /**
   * Returns the current actor's feedback for a publication.
   */
  async getMyFeedback(actor: FeedbackActor, publicationId: string) {
    await this.ensurePublicationAccessibleToActor(actor, publicationId);

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
    await this.ensurePublicationAccessibleToActor(actor, publicationId);

    const existing = await this.getMyFeedback(actor, publicationId);

    if (!existing) {
      throw new NotFoundException('Publication feedback not found');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.ideaPublicationFeedback.delete({
        where: {
          id: existing.id,
        },
      });

      const feedbackCount = await this.recalculateFeedback(tx, publicationId);

      return {
        message: 'Publication feedback deleted successfully',
        feedbackCount,
      };
    }, this.transactionOptions);

    await this.publicationCache.invalidateDiscovery(publicationId);
    return result;
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
   * Ensures that the actor may still access the publication.
   *
   * Live publications remain available to registered users and guests.
   * After archiving, only authenticated users with a recorded acceptance keep
   * access. This preserves the accepted-user workspace without exposing the
   * archived publication through public discovery.
   */
  private async ensurePublicationAccessibleToActor(
    actor: FeedbackActor,
    publicationId: string,
  ) {
    const publication = await this.prisma.ideaPublication.findFirst({
      where: {
        id: publicationId,
        isHidden: false,
        OR: [
          {
            status: IdeaPublicationStatus.PUBLISHED,
          },
          ...(this.isUserActor(actor)
            ? [
                {
                  acceptances: {
                    some: {
                      userId: actor.userId,
                    },
                  },
                },
              ]
            : []),
        ],
      },
      select: {
        id: true,
      },
    });

    if (!publication) {
      throw new NotFoundException('Publication not found or no longer accessible');
    }
  }

  /**
   * Ensures that rating is enabled and the actor keeps publication access.
   */
  private async ensurePublicationAllowsRatings(
    actor: FeedbackActor,
    publicationId: string,
  ) {
    const publication = await this.prisma.ideaPublication.findFirst({
      where: {
        id: publicationId,
        isHidden: false,
        OR: [
          {
            status: IdeaPublicationStatus.PUBLISHED,
          },
          ...(this.isUserActor(actor)
            ? [
                {
                  acceptances: {
                    some: {
                      userId: actor.userId,
                    },
                  },
                },
              ]
            : []),
        ],
      },
      select: {
        allowRatings: true,
      },
    });

    if (!publication) {
      throw new NotFoundException('Publication not found or no longer accessible');
    }

    if (!publication.allowRatings) {
      throw new BadRequestException(
        'Ratings are disabled for this publication',
      );
    }
  }

  /**
   * Ensures that feedback is enabled and the actor keeps publication access.
   */
  private async ensurePublicationAllowsFeedback(
    actor: FeedbackActor,
    publicationId: string,
  ) {
    const publication = await this.prisma.ideaPublication.findFirst({
      where: {
        id: publicationId,
        isHidden: false,
        OR: [
          {
            status: IdeaPublicationStatus.PUBLISHED,
          },
          ...(this.isUserActor(actor)
            ? [
                {
                  acceptances: {
                    some: {
                      userId: actor.userId,
                    },
                  },
                },
              ]
            : []),
        ],
      },
      select: {
        allowFeedback: true,
      },
    });

    if (!publication) {
      throw new NotFoundException('Publication not found or no longer accessible');
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