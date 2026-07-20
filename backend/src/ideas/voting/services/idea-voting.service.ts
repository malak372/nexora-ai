import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  IdeaPublicationStatus,
  IdeaVoteValue,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';

import { VotePublicationDto } from '../dto/vote-publication.dto';

/**
 * Manages voting operations for published idea publications.
 *
 * This service is responsible for:
 * - Creating or updating a user's vote.
 * - Retrieving the authenticated user's current vote.
 * - Deleting an existing vote.
 * - Preventing publishers from voting on their own publications.
 * - Enforcing publication status and voting availability.
 * - Recalculating publication vote counters after write operations.
 *
 * Each user can have only one vote per publication, enforced by the
 * composite publication-user uniqueness constraint in the database.
 *
 * @author Malak
 */
@Injectable()
export class IdeaVotingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates or updates the authenticated user's vote on a publication.
   *
   * When the user has not voted before, a new vote is created.
   * When a vote already exists, its value is updated.
   *
   * The publication must:
   * - Exist.
   * - Be published.
   * - Have voting enabled.
   *
   * Publishers are not allowed to vote on their own publications.
   *
   * Vote persistence and publication-counter recalculation are executed
   * inside the same transaction to keep the stored counters consistent.
   *
   * @param userId Authenticated user identifier.
   * @param publicationId Publication identifier.
   * @param dto Requested vote value.
   * @returns Created or updated vote with refreshed publication counters.
   *
   * @throws NotFoundException When the publication does not exist or is not
   * published.
   * @throws BadRequestException When voting is disabled.
   * @throws ForbiddenException When the publisher attempts to vote on their
   * own publication.
   */
  async upsertVote(
    userId: string,
    publicationId: string,
    dto: VotePublicationDto,
  ) {
    const publication =
      await this.ensureVotingAllowed(publicationId);

    if (publication.publisherId === userId) {
      throw new ForbiddenException(
        'Publishers cannot vote on their own ideas.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const vote = await tx.ideaPublicationVote.upsert({
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
        select: {
          id: true,
          value: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      const counts = await this.recalculate(
        tx,
        publicationId,
      );

      return {
        vote,
        publicationVotes: counts,
      };
    });
  }

  /**
   * Retrieves the authenticated user's current vote on a publication.
   *
   * The publication must exist and be published. When the user has not voted,
   * Prisma returns null.
   *
   * This method does not require voting to remain enabled because an existing
   * vote may still need to be displayed after voting has been disabled.
   *
   * @param userId Authenticated user identifier.
   * @param publicationId Publication identifier.
   * @returns Current vote or null when no vote exists.
   *
   * @throws NotFoundException When the publication does not exist or is not
   * published.
   */
  async getMyVote(
    userId: string,
    publicationId: string,
  ) {
    await this.ensurePublished(publicationId);

    return this.prisma.ideaPublicationVote.findUnique({
      where: {
        publicationId_userId: {
          publicationId,
          userId,
        },
      },
      select: {
        id: true,
        value: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  /**
   * Deletes the authenticated user's vote from a publication.
   *
   * The vote deletion and publication-counter recalculation are executed
   * inside the same transaction.
   *
   * This method only requires the publication to remain published. It does
   * not require voting to be enabled, allowing users to remove old votes
   * after the publisher disables future voting.
   *
   * @param userId Authenticated user identifier.
   * @param publicationId Publication identifier.
   * @returns Success message with refreshed publication counters.
   *
   * @throws NotFoundException When the publication is unavailable or when
   * the user has no vote on it.
   */
  async deleteVote(
    userId: string,
    publicationId: string,
  ) {
    await this.ensurePublished(publicationId);

    const existing =
      await this.prisma.ideaPublicationVote.findUnique({
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

    if (!existing) {
      throw new NotFoundException(
        'Publication vote not found',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.ideaPublicationVote.delete({
        where: {
          id: existing.id,
        },
      });

      const counts = await this.recalculate(
        tx,
        publicationId,
      );

      return {
        message:
          'Publication vote deleted successfully',
        publicationVotes: counts,
      };
    });
  }

  /**
   * Validates that a publication is available for new or updated votes.
   *
   * @param publicationId Publication identifier.
   * @returns Minimal publication data required by the voting operation.
   *
   * @throws NotFoundException When the publication does not exist or is not
   * published.
   * @throws BadRequestException When voting is disabled.
   */
  private async ensureVotingAllowed(
    publicationId: string,
  ) {
    const publication =
      await this.prisma.ideaPublication.findUnique({
        where: {
          id: publicationId,
        },
        select: {
          id: true,
          status: true,
          allowVoting: true,
          publisherId: true,
        },
      });

    if (
      !publication ||
      publication.status !==
        IdeaPublicationStatus.PUBLISHED
    ) {
      throw new NotFoundException(
        'Published publication not found',
      );
    }

    if (!publication.allowVoting) {
      throw new BadRequestException(
        'Voting is disabled for this publication.',
      );
    }

    return publication;
  }

  /**
   * Validates that a publication exists and is currently published.
   *
   * This validation is used by read and delete operations that should remain
   * available even when new voting has been disabled.
   *
   * @param publicationId Publication identifier.
   *
   * @throws NotFoundException When the publication does not exist or is not
   * published.
   */
  private async ensurePublished(
    publicationId: string,
  ) {
    const publication =
      await this.prisma.ideaPublication.findUnique({
        where: {
          id: publicationId,
        },
        select: {
          status: true,
        },
      });

    if (
      !publication ||
      publication.status !==
        IdeaPublicationStatus.PUBLISHED
    ) {
      throw new NotFoundException(
        'Published publication not found',
      );
    }
  }

  /**
   * Recalculates and persists publication vote counters.
   *
   * Votes are grouped by value, then the total number of upvotes and
   * downvotes is written to the publication record.
   *
   * Recalculating from the vote table avoids counter drift and keeps the
   * denormalized publication counters synchronized with the source records.
   *
   * @param tx Active Prisma transaction client.
   * @param publicationId Publication identifier.
   * @returns Updated upvote count, downvote count, and net score.
   */
  private async recalculate(
    tx: Prisma.TransactionClient,
    publicationId: string,
  ) {
    const grouped =
      await tx.ideaPublicationVote.groupBy({
        by: ['value'],
        where: {
          publicationId,
        },
        _count: {
          _all: true,
        },
      });

    const upvotesCount =
      grouped.find(
        (row) => row.value === IdeaVoteValue.UP,
      )?._count._all ?? 0;

    const downvotesCount =
      grouped.find(
        (row) => row.value === IdeaVoteValue.DOWN,
      )?._count._all ?? 0;

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
}
