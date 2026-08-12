import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IdeaPublicationStatus, IdeaVoteValue, Prisma } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import { VotePublicationDto } from '../dto/vote-publication.dto';
import { PublicationCacheService } from '../../publication/cache/publication-cache.service';

type RegisteredPublicationActor = {
  userId: string;
  guestSessionId?: never;
};

type GuestPublicationActor = {
  guestSessionId: string;
  userId?: never;
};

export type PublicationEngagementActor =
  | RegisteredPublicationActor
  | GuestPublicationActor;

/**
 * Handles registered-user and secure guest-session publication votes.
 *
 * @author Eman
 */
@Injectable()
export class IdeaVotingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly publicationCache: PublicationCacheService,
  ) { }

  async upsertVote(
    actor: PublicationEngagementActor,
    publicationId: string,
    dto: VotePublicationDto,
  ) {
    const publication = await this.ensureVotingAllowed(actor, publicationId);

    if (
      this.isRegisteredActor(actor) &&
      publication.publisherId === actor.userId
    ) {
      throw new ForbiddenException(
        'Publishers cannot vote on their own ideas.',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      let vote;

      if (this.isRegisteredActor(actor)) {
        const userId = actor.userId;

        vote = await tx.ideaPublicationVote.upsert({
          where: {
            publicationId_userId: {
              publicationId,
              userId,
            },
          },
          create: {
            publicationId,
            userId,
            value: dto.value,
          },
          update: {
            value: dto.value,
          },
          select: this.voteSelect,
        });
      } else {
        const guestSessionId = actor.guestSessionId;

        vote = await tx.ideaPublicationVote.upsert({
          where: {
            publicationId_guestSessionId: {
              publicationId,
              guestSessionId,
            },
          },
          create: {
            publicationId,
            guestSessionId,
            value: dto.value,
          },
          update: {
            value: dto.value,
          },
          select: this.voteSelect,
        });
      }

      const publicationVotes = await this.recalculate(tx, publicationId);

      return {
        vote,
        publicationVotes,
      };
    });

    // Return as soon as the mutation and exact counters are committed.
    void this.publicationCache
      .invalidateDiscovery(publicationId)
      .catch(() => undefined);

    return result;
  }

  async getMyVote(actor: PublicationEngagementActor, publicationId: string) {
    await this.ensureAccessible(actor, publicationId);

    if (this.isRegisteredActor(actor)) {
      const userId = actor.userId;

      return this.prisma.ideaPublicationVote.findUnique({
        where: {
          publicationId_userId: {
            publicationId,
            userId,
          },
        },
        select: this.voteSelect,
      });
    }

    const guestSessionId = actor.guestSessionId;

    return this.prisma.ideaPublicationVote.findUnique({
      where: {
        publicationId_guestSessionId: {
          publicationId,
          guestSessionId,
        },
      },
      select: this.voteSelect,
    });
  }

  async deleteVote(actor: PublicationEngagementActor, publicationId: string) {
    await this.ensureAccessible(actor, publicationId);

    // getMyVote() performs its own access check. Use the indexed identity key
    // directly after the single access check above to keep removal responsive.
    const existing = this.isRegisteredActor(actor)
      ? await this.prisma.ideaPublicationVote.findUnique({
          where: {
            publicationId_userId: {
              publicationId,
              userId: actor.userId,
            },
          },
          select: {
            id: true,
          },
        })
      : await this.prisma.ideaPublicationVote.findUnique({
          where: {
            publicationId_guestSessionId: {
              publicationId,
              guestSessionId: actor.guestSessionId,
            },
          },
          select: {
            id: true,
          },
        });

    if (!existing) {
      throw new NotFoundException('Publication vote not found');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.ideaPublicationVote.delete({
        where: {
          id: existing.id,
        },
      });

      const publicationVotes = await this.recalculate(tx, publicationId);

      return {
        message: 'Publication vote deleted successfully',
        publicationVotes,
      };
    });

    // Return as soon as the mutation and exact counters are committed.
    void this.publicationCache
      .invalidateDiscovery(publicationId)
      .catch(() => undefined);

    return result;
  }

  private readonly voteSelect = {
    id: true,
    value: true,
    createdAt: true,
    updatedAt: true,
  } satisfies Prisma.IdeaPublicationVoteSelect;

  /**
   * Ensures that voting is enabled for a live publication or for an archived
   * publication previously accepted by the authenticated actor.
   *
   * Guest sessions may vote only while a publication is live.
   */
  private async ensureVotingAllowed(
    actor: PublicationEngagementActor,
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
          ...(this.isRegisteredActor(actor)
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
        allowVoting: true,
        publisherId: true,
      },
    });

    if (!publication) {
      throw new NotFoundException('Publication not found or no longer accessible');
    }

    if (!publication.allowVoting) {
      throw new BadRequestException('Voting is disabled for this publication.');
    }

    return publication;
  }

  /**
   * Ensures that the actor may read or remove their existing vote.
   */
  private async ensureAccessible(
    actor: PublicationEngagementActor,
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
          ...(this.isRegisteredActor(actor)
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

  private async recalculate(
    tx: Prisma.TransactionClient,
    publicationId: string,
  ) {
    const grouped = await tx.ideaPublicationVote.groupBy({
      by: ['value'],
      where: {
        publicationId,
      },
      _count: {
        _all: true,
      },
    });

    const upvotesCount =
      grouped.find((row) => row.value === IdeaVoteValue.UP)?._count._all ?? 0;

    const downvotesCount =
      grouped.find((row) => row.value === IdeaVoteValue.DOWN)?._count._all ?? 0;

    await tx.ideaPublication.update({
      where: {
        id: publicationId,
      },
      data: {
        upvotesCount,
        downvotesCount,
      },
    });

    return {
      upvotesCount,
      downvotesCount,
      score: upvotesCount - downvotesCount,
    };
  }

  private isRegisteredActor(
    actor: PublicationEngagementActor,
  ): actor is RegisteredPublicationActor {
    return typeof actor.userId === 'string';
  }
}