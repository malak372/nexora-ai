import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { IdeaGenerationType, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import type { AttachGuestIdeasResult } from './types/attach-guest-ideas-result.type';

/**
 * Transfers guest-owned idea activity to a registered user.
 *
 * Each transferred guest idea counts as one of the user's
 * available free idea generations.
 *
 * The service accepts an optional Prisma transaction client,
 * allowing account creation and guest-activity transfer to
 * execute atomically.
 *
 * @author Eman
 */
@Injectable()
export class AuthGuestService {
  constructor(private readonly prisma: PrismaService) { }

  /**
   * Transfers guest ideas and their related activity
   * to a registered user.
   *
   * A transferred idea changes from:
   *
   * GUEST_FREE + guestSessionId
   *
   * to:
   *
   * NORMAL_FREE + userId
   *
   * No additional AI request is executed because the generated
   * idea data and pipeline results already exist.
   *
   * @param guestSessionToken - Guest-session token stored by the client.
   * @param userId - Identifier of the registered user.
   * @param tx - Optional existing Prisma transaction client.
   * @returns Information about the transferred ideas.
   */
  async attachGuestIdeasToUser(
    guestSessionToken: string | undefined,
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<AttachGuestIdeasResult> {
    const normalizedToken = guestSessionToken?.trim();

    if (!normalizedToken) {
      return {
        transferredCount: 0,
        ideaIds: [],
      };
    }

    const execute = async (
      client: Prisma.TransactionClient,
    ): Promise<AttachGuestIdeasResult> => {
      const user = await client.user.findUnique({
        where: {
          id: userId,
        },
        select: {
          id: true,
          freeGenerationLimit: true,
          freeGenerationsUsed: true,
        },
      });

      if (!user) {
        throw new NotFoundException('Registered user not found.');
      }

      const guestSession = await client.guestSession.findUnique({
        where: {
          sessionToken: normalizedToken,
        },
        select: {
          id: true,
          hasGenerated: true,
        },
      });

      if (!guestSession?.hasGenerated) {
        return {
          transferredCount: 0,
          ideaIds: [],
        };
      }

      const guestIdeas = await client.idea.findMany({
        where: {
          guestSessionId: guestSession.id,
          userId: null,
          generationType: IdeaGenerationType.GUEST_FREE,
        },
        select: {
          id: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
      });

      if (!guestIdeas.length) {
        return {
          transferredCount: 0,
          ideaIds: [],
        };
      }

      const remainingAllowance =
        user.freeGenerationLimit - user.freeGenerationsUsed;

      if (guestIdeas.length > remainingAllowance) {
        throw new ConflictException(
          'The guest ideas cannot be attached because the free-generation allowance would be exceeded.',
        );
      }

      const ideaIds = guestIdeas.map(({ id }) => id);

      const transferResult = await client.idea.updateMany({
        where: {
          id: {
            in: ideaIds,
          },
          guestSessionId: guestSession.id,
          userId: null,
          generationType: IdeaGenerationType.GUEST_FREE,
        },
        data: {
          userId: user.id,
          guestSessionId: null,
          generationType: IdeaGenerationType.NORMAL_FREE,
        },
      });

      if (transferResult.count !== ideaIds.length) {
        throw new ConflictException(
          'Guest idea ownership changed during registration. Please try again.',
        );
      }

      await client.user.update({
        where: {
          id: user.id,
        },
        data: {
          freeGenerationsUsed: {
            increment: transferResult.count,
          },
        },
      });

      /**
       * Transfers the idea-generation pipeline runs.
       *
       * The related stages remain connected automatically
       * through their IdeaGenerationRun relation.
       */
      await client.ideaGenerationRun.updateMany({
        where: {
          ideaId: {
            in: ideaIds,
          },
          guestSessionId: guestSession.id,
          userId: null,
          generationType: IdeaGenerationType.GUEST_FREE,
        },
        data: {
          userId: user.id,
          guestSessionId: null,
          generationType: IdeaGenerationType.NORMAL_FREE,
        },
      });

      /**
       * Transfers prompt histories created by the guest session.
       */
      await client.promptHistory.updateMany({
        where: {
          guestSessionId: guestSession.id,
          userId: null,
        },
        data: {
          userId: user.id,
          guestSessionId: null,
        },
      });

      /**
       * Attaches external API execution logs related
       * to the transferred ideas.
       */
      await client.externalApiLog.updateMany({
        where: {
          ideaId: {
            in: ideaIds,
          },
          userId: null,
        },
        data: {
          userId: user.id,
        },
      });

      return {
        transferredCount: transferResult.count,
        ideaIds,
      };
    };

    if (tx) {
      return execute(tx);
    }

    return this.prisma.$transaction(execute);
  }
}