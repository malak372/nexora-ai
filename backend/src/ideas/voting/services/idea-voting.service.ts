import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IdeaPublicationStatus, IdeaVoteValue, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { VotePublicationDto } from '../dto/vote-publication.dto';

export type PublicationEngagementActor =
  | { userId: string; guestSessionId?: never }
  | { guestSessionId: string; userId?: never };

/** Handles registered-user and secure guest-session publication votes. */
@Injectable()
export class IdeaVotingService {
  constructor(private readonly prisma: PrismaService) { }

  async upsertVote(
    actor: PublicationEngagementActor,
    publicationId: string,
    dto: VotePublicationDto,
  ) {
    const publication = await this.ensureVotingAllowed(publicationId);

    if (actor.userId && publication.publisherId === actor.userId) {
      throw new ForbiddenException('Publishers cannot vote on their own ideas.');
    }

    return this.prisma.$transaction(async (tx) => {
      const vote = actor.userId
        ? await tx.ideaPublicationVote.upsert({
          where: {
            publicationId_userId: { publicationId, userId: actor.userId },
          },
          create: { publicationId, userId: actor.userId, value: dto.value },
          update: { value: dto.value },
          select: this.voteSelect,
        })
        : await tx.ideaPublicationVote.upsert({
          where: {
            publicationId_guestSessionId: {
              publicationId,
              guestSessionId: actor.guestSessionId,
            },
          },
          create: {
            publicationId,
            guestSessionId: actor.guestSessionId,
            value: dto.value,
          },
          update: { value: dto.value },
          select: this.voteSelect,
        });

      const publicationVotes = await this.recalculate(tx, publicationId);
      return { vote, publicationVotes };
    });
  }

  async getMyVote(actor: PublicationEngagementActor, publicationId: string) {
    await this.ensurePublished(publicationId);

    return actor.userId
      ? this.prisma.ideaPublicationVote.findUnique({
        where: {
          publicationId_userId: { publicationId, userId: actor.userId },
        },
        select: this.voteSelect,
      })
      : this.prisma.ideaPublicationVote.findUnique({
        where: {
          publicationId_guestSessionId: {
            publicationId,
            guestSessionId: actor.guestSessionId,
          },
        },
        select: this.voteSelect,
      });
  }

  async deleteVote(actor: PublicationEngagementActor, publicationId: string) {
    await this.ensurePublished(publicationId);

    const existing = await this.getMyVote(actor, publicationId);
    if (!existing) throw new NotFoundException('Publication vote not found');

    return this.prisma.$transaction(async (tx) => {
      await tx.ideaPublicationVote.delete({ where: { id: existing.id } });
      const publicationVotes = await this.recalculate(tx, publicationId);
      return {
        message: 'Publication vote deleted successfully',
        publicationVotes,
      };
    });
  }

  private readonly voteSelect = {
    id: true,
    value: true,
    createdAt: true,
    updatedAt: true,
  } satisfies Prisma.IdeaPublicationVoteSelect;

  private async ensureVotingAllowed(publicationId: string) {
    const publication = await this.prisma.ideaPublication.findUnique({
      where: { id: publicationId },
      select: {
        status: true,
        allowVoting: true,
        isHidden: true,
        publisherId: true,
      },
    });

    if (
      !publication ||
      publication.status !== IdeaPublicationStatus.PUBLISHED ||
      publication.isHidden
    ) {
      throw new NotFoundException('Published publication not found');
    }

    if (!publication.allowVoting) {
      throw new BadRequestException('Voting is disabled for this publication.');
    }

    return publication;
  }

  private async ensurePublished(publicationId: string) {
    const publication = await this.prisma.ideaPublication.findUnique({
      where: { id: publicationId },
      select: { status: true, isHidden: true },
    });

    if (
      !publication ||
      publication.status !== IdeaPublicationStatus.PUBLISHED ||
      publication.isHidden
    ) {
      throw new NotFoundException('Published publication not found');
    }
  }

  private async recalculate(
    tx: Prisma.TransactionClient,
    publicationId: string,
  ) {
    const grouped = await tx.ideaPublicationVote.groupBy({
      by: ['value'],
      where: { publicationId },
      _count: { _all: true },
    });

    const upvotesCount =
      grouped.find((row) => row.value === IdeaVoteValue.UP)?._count._all ?? 0;
    const downvotesCount =
      grouped.find((row) => row.value === IdeaVoteValue.DOWN)?._count._all ?? 0;

    await tx.ideaPublication.update({
      where: { id: publicationId },
      data: { upvotesCount, downvotesCount },
    });

    return {
      upvotesCount,
      downvotesCount,
      score: upvotesCount - downvotesCount,
    };
  }
}