import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  IdeaPublicationStatus,
  Prisma,
  PublicationFeedbackStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UpsertPublicationFeedbackDto } from '../dto/upsert-publication-feedback.dto';
import { UpsertPublicationRatingDto } from '../dto/upsert-publication-rating.dto';

export type FeedbackActor =
  | { userId: string; guestSessionId?: never }
  | { guestSessionId: string; userId?: never };

/** Handles ratings and textual feedback for users and secure guest sessions. */
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

  async upsertRating(
    actor: FeedbackActor,
    publicationId: string,
    dto: UpsertPublicationRatingDto,
  ) {
    await this.ensurePublicationAllowsRatings(publicationId);

    return this.prisma.$transaction(async (tx) => {
      const rating = actor.userId
        ? await tx.ideaPublicationRating.upsert({
          where: {
            publicationId_userId: { publicationId, userId: actor.userId },
          },
          update: { value: dto.value },
          create: { publicationId, userId: actor.userId, value: dto.value },
          select: this.ratingSelect,
        })
        : await tx.ideaPublicationRating.upsert({
          where: {
            publicationId_guestSessionId: {
              publicationId,
              guestSessionId: actor.guestSessionId,
            },
          },
          update: { value: dto.value },
          create: {
            publicationId,
            guestSessionId: actor.guestSessionId,
            value: dto.value,
          },
          select: this.ratingSelect,
        });

      const publicationRating = await this.recalculateRatings(tx, publicationId);
      return {
        message: 'Publication rating saved successfully',
        rating,
        publicationRating,
      };
    });
  }

  async getMyRating(actor: FeedbackActor, publicationId: string) {
    await this.ensurePublishedPublicationExists(publicationId);

    return actor.userId
      ? this.prisma.ideaPublicationRating.findUnique({
        where: {
          publicationId_userId: { publicationId, userId: actor.userId },
        },
        select: this.ratingSelect,
      })
      : this.prisma.ideaPublicationRating.findUnique({
        where: {
          publicationId_guestSessionId: {
            publicationId,
            guestSessionId: actor.guestSessionId,
          },
        },
        select: this.ratingSelect,
      });
  }

  async deleteRating(actor: FeedbackActor, publicationId: string) {
    await this.ensurePublishedPublicationExists(publicationId);
    const existing = await this.getMyRating(actor, publicationId);
    if (!existing) throw new NotFoundException('Publication rating not found');

    return this.prisma.$transaction(async (tx) => {
      await tx.ideaPublicationRating.delete({ where: { id: existing.id } });
      const publicationRating = await this.recalculateRatings(tx, publicationId);
      return {
        message: 'Publication rating deleted successfully',
        publicationRating,
      };
    });
  }

  async upsertFeedback(
    actor: FeedbackActor,
    publicationId: string,
    dto: UpsertPublicationFeedbackDto,
  ) {
    await this.ensurePublicationAllowsFeedback(publicationId);

    return this.prisma.$transaction(async (tx) => {
      const feedback = actor.userId
        ? await tx.ideaPublicationFeedback.upsert({
          where: {
            publicationId_userId: { publicationId, userId: actor.userId },
          },
          update: {
            comment: dto.comment,
            status: PublicationFeedbackStatus.VISIBLE,
          },
          create: { publicationId, userId: actor.userId, comment: dto.comment },
          select: this.feedbackSelect,
        })
        : await tx.ideaPublicationFeedback.upsert({
          where: {
            publicationId_guestSessionId: {
              publicationId,
              guestSessionId: actor.guestSessionId,
            },
          },
          update: {
            comment: dto.comment,
            status: PublicationFeedbackStatus.VISIBLE,
          },
          create: {
            publicationId,
            guestSessionId: actor.guestSessionId,
            comment: dto.comment,
          },
          select: this.feedbackSelect,
        });

      const feedbackCount = await this.recalculateFeedback(tx, publicationId);
      return {
        message: 'Publication feedback saved successfully',
        feedback,
        feedbackCount,
      };
    });
  }

  async getMyFeedback(actor: FeedbackActor, publicationId: string) {
    await this.ensurePublishedPublicationExists(publicationId);

    return actor.userId
      ? this.prisma.ideaPublicationFeedback.findUnique({
        where: {
          publicationId_userId: { publicationId, userId: actor.userId },
        },
        select: this.feedbackSelect,
      })
      : this.prisma.ideaPublicationFeedback.findUnique({
        where: {
          publicationId_guestSessionId: {
            publicationId,
            guestSessionId: actor.guestSessionId,
          },
        },
        select: this.feedbackSelect,
      });
  }

  async deleteFeedback(actor: FeedbackActor, publicationId: string) {
    await this.ensurePublishedPublicationExists(publicationId);
    const existing = await this.getMyFeedback(actor, publicationId);
    if (!existing) throw new NotFoundException('Publication feedback not found');

    return this.prisma.$transaction(async (tx) => {
      await tx.ideaPublicationFeedback.delete({ where: { id: existing.id } });
      const feedbackCount = await this.recalculateFeedback(tx, publicationId);
      return {
        message: 'Publication feedback deleted successfully',
        feedbackCount,
      };
    });
  }

  private async recalculateRatings(
    tx: Prisma.TransactionClient,
    publicationId: string,
  ) {
    const aggregate = await tx.ideaPublicationRating.aggregate({
      where: { publicationId },
      _avg: { value: true },
      _count: { value: true },
    });
    const averageRating = aggregate._avg.value ?? 0;
    const ratingsCount = aggregate._count.value;
    await tx.ideaPublication.update({
      where: { id: publicationId },
      data: { averageRating, ratingsCount },
    });
    return {
      averageRating: Number(averageRating.toFixed(2)),
      ratingsCount,
    };
  }

  private async recalculateFeedback(
    tx: Prisma.TransactionClient,
    publicationId: string,
  ) {
    const feedbackCount = await tx.ideaPublicationFeedback.count({
      where: { publicationId, status: PublicationFeedbackStatus.VISIBLE },
    });
    await tx.ideaPublication.update({
      where: { id: publicationId },
      data: { feedbackCount },
    });
    return feedbackCount;
  }

  private async ensurePublishedPublicationExists(publicationId: string) {
    const publication = await this.prisma.ideaPublication.findFirst({
      where: {
        id: publicationId,
        status: IdeaPublicationStatus.PUBLISHED,
        isHidden: false,
      },
      select: { id: true },
    });
    if (!publication) throw new NotFoundException('Published idea not found');
  }

  private async ensurePublicationAllowsRatings(publicationId: string) {
    const publication = await this.prisma.ideaPublication.findFirst({
      where: { id: publicationId, status: IdeaPublicationStatus.PUBLISHED },
      select: { allowRatings: true, isHidden: true },
    });
    if (!publication || publication.isHidden) {
      throw new NotFoundException('Published publication not found');
    }
    if (!publication.allowRatings) {
      throw new BadRequestException('Ratings are disabled for this publication');
    }
  }

  private async ensurePublicationAllowsFeedback(publicationId: string) {
    const publication = await this.prisma.ideaPublication.findFirst({
      where: { id: publicationId, status: IdeaPublicationStatus.PUBLISHED },
      select: { allowFeedback: true, isHidden: true },
    });
    if (!publication || publication.isHidden) {
      throw new NotFoundException('Published publication not found');
    }
    if (!publication.allowFeedback) {
      throw new BadRequestException('Feedback is disabled for this publication');
    }
  }
}