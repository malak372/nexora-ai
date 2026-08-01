import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  IdeaVoteValue,
  PublicationFeedbackStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GetReceivedFeedbackQueryDto } from '../dto/get-received-feedback-query.dto';

export interface AudienceResponseRow {
  readonly user: {
    readonly id: string;
    readonly fullName: string;
    readonly userType: string | null;
  };
  readonly rating: number | null;
  readonly vote: IdeaVoteValue | null;
  readonly feedback: {
    readonly id: string;
    readonly comment: string;
    readonly status: PublicationFeedbackStatus;
    readonly createdAt: Date;
    readonly updatedAt: Date;
  } | null;
  readonly lastActivityAt: Date;
}

export interface ReceivedFeedbackResponse {
  readonly publication: {
    readonly id: string;
    readonly publicTitle: string;
    readonly averageRating: number;
    readonly ratingsCount: number;
    readonly feedbackCount: number;
    readonly upvotesCount: number;
    readonly downvotesCount: number;
  };
  readonly data: AudienceResponseRow[];
  readonly meta: {
    readonly page: number;
    readonly limit: number;
    readonly total: number;
    readonly totalPages: number;
  };
}

/**
 * Returns publication-owner audience insights.
 *
 * The response combines each user's rating, vote, and written feedback into
 * one row. Users who rated or voted without writing feedback are still shown.
 *
 * @author Eman
 */
@Injectable()
export class ReceivedFeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  async findReceived(
    userId: string,
    publicationId: string,
    query: GetReceivedFeedbackQueryDto,
  ): Promise<ReceivedFeedbackResponse> {
    const publication = await this.prisma.ideaPublication.findUnique({
      where: { id: publicationId },
      select: {
        id: true,
        publisherId: true,
        publicTitle: true,
        averageRating: true,
        ratingsCount: true,
        feedbackCount: true,
        upvotesCount: true,
        downvotesCount: true,
      },
    });

    if (!publication) {
      throw new NotFoundException('Publication not found');
    }

    if (publication.publisherId !== userId) {
      throw new ForbiddenException(
        'Only the publication owner can view received audience responses.',
      );
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const search = query.search?.trim().toLowerCase() ?? '';
    const feedbackStatus =
      query.status ?? PublicationFeedbackStatus.VISIBLE;

    const [ratings, votes, feedbackEntries] = await Promise.all([
      this.prisma.ideaPublicationRating.findMany({
        where: { publicationId },
        select: {
          value: true,
          createdAt: true,
          updatedAt: true,
          user: {
            select: {
              id: true,
              fullName: true,
              userType: true,
            },
          },
        },
      }),
      this.prisma.ideaPublicationVote.findMany({
        where: { publicationId },
        select: {
          value: true,
          createdAt: true,
          updatedAt: true,
          user: {
            select: {
              id: true,
              fullName: true,
              userType: true,
            },
          },
        },
      }),
      this.prisma.ideaPublicationFeedback.findMany({
        where: {
          publicationId,
          status: feedbackStatus,
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
              userType: true,
            },
          },
        },
      }),
    ]);

    const responseMap = new Map<string, AudienceResponseRow>();

    const ensureRow = (
      user: AudienceResponseRow['user'],
      activityAt: Date,
    ): AudienceResponseRow => {
      const current = responseMap.get(user.id);

      if (current) {
        if (activityAt > current.lastActivityAt) {
          const updated = { ...current, lastActivityAt: activityAt };
          responseMap.set(user.id, updated);
          return updated;
        }

        return current;
      }

      const created: AudienceResponseRow = {
        user: {
          id: user.id,
          fullName: user.fullName,
          userType: user.userType ?? null,
        },
        rating: null,
        vote: null,
        feedback: null,
        lastActivityAt: activityAt,
      };

      responseMap.set(user.id, created);
      return created;
    };

    for (const rating of ratings) {
      const row = ensureRow(rating.user, rating.updatedAt);
      responseMap.set(rating.user.id, {
        ...row,
        rating: rating.value,
      });
    }

    for (const vote of votes) {
      const row = ensureRow(vote.user, vote.updatedAt);
      responseMap.set(vote.user.id, {
        ...row,
        vote: vote.value,
      });
    }

    for (const feedback of feedbackEntries) {
      const row = ensureRow(feedback.user, feedback.updatedAt);
      responseMap.set(feedback.user.id, {
        ...row,
        feedback: {
          id: feedback.id,
          comment: feedback.comment,
          status: feedback.status,
          createdAt: feedback.createdAt,
          updatedAt: feedback.updatedAt,
        },
      });
    }

    const rows = [...responseMap.values()]
      .filter((row) => {
        if (!search) return true;

        return (
          row.user.fullName.toLowerCase().includes(search) ||
          row.feedback?.comment.toLowerCase().includes(search)
        );
      })
      .sort(
        (left, right) =>
          right.lastActivityAt.getTime() - left.lastActivityAt.getTime(),
      );

    const total = rows.length;
    const start = (page - 1) * limit;
    const data = rows.slice(start, start + limit);

    return {
      publication: {
        id: publication.id,
        publicTitle: publication.publicTitle,
        averageRating: Number(publication.averageRating),
        ratingsCount: publication.ratingsCount,
        feedbackCount: publication.feedbackCount,
        upvotesCount: publication.upvotesCount,
        downvotesCount: publication.downvotesCount,
      },
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }
}