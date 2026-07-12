import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { IdeaGenerationType, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

import type { AttachGuestIdeasResult } from './types/attach-guest-ideas-result.type';

/**
 * Transfers guest-owned activity to a newly registered account.
 *
 * A transferred guest idea counts as one of the user's three free
 * generations.
 *
 * The service accepts an optional Prisma transaction client so account
 * creation and ownership transfer can execute atomically.
 *
 * @author Eman
 */
@Injectable()
export class AuthGuestService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Transfers guest ideas, prompt histories, and AI logs.
   *
   * The transferred Idea changes from:
   *
   * GUEST_FREE + guestSessionId
   *
   * to:
   *
   * NORMAL_FREE + userId
   *
   * No AI request is executed during registration because the regular
   * free-tier fields were already generated and persisted internally.
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

      if (guestIdeas.length === 0) {
        return {
          transferredCount: 0,
          ideaIds: [],
        };
      }

      const remainingAllowance =
        user.freeGenerationLimit - user.freeGenerationsUsed;

      if (remainingAllowance < guestIdeas.length) {
        throw new ConflictException(
          'The guest idea cannot be attached because the free-generation allowance would be exceeded.',
        );
      }

      const ideaIds = guestIdeas.map((idea) => idea.id);

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
       * Transfer every prompt related to the guest session.
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
       * Attach external AI execution logs to the registered user.
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
