import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  GeneratedOutputStatus,
  IdeaGenerationType,
  Prisma,
  UnlockMethod,
} from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import { IDEA_ADVANCED_OUTPUT_DEFINITIONS } from '../../generation/constants/idea-output.constants';
import {
  DIRECT_UNLOCK_CLAIM_OUTPUT_KEY,
  DIRECT_UNLOCK_CLAIM_TTL_MS,
} from '../constants/idea-outputs.constants';
import type {
  BeginIdeaUnlockResult,
  IdeaOutputDatabaseClient,
  PersistedIdeaUnlockResult,
  PersistIdeaUnlockOutputInput,
} from '../types/idea-output.type';

type OutputDatabaseClient = PrismaService | IdeaOutputDatabaseClient;

/**
 * Owns the database state transitions of the direct-unlock workflow.
 *
 * A PENDING full-abstract GeneratedOutput row acts as a durable claim. The
 * unique (ideaId, outputKey) constraint prevents two webhook workers from
 * executing the same paid AI unlock concurrently. Failed or stale claims can
 * be retried safely without charging the user again.
 */
@Injectable()
export class IdeaOutputPersistenceService {
  constructor(private readonly prisma: PrismaService) {}

  async beginDirectUnlock(
    ideaId: string,
    userId: string,
  ): Promise<BeginIdeaUnlockResult> {
    return this.prisma.$transaction(async (tx) => {
      const idea = await tx.idea.findFirst({
        where: {
          id: ideaId,
          userId,
          deletedAt: null,
        },
        select: {
          id: true,
          generationType: true,
          isUnlocked: true,
          unlockedAt: true,
        },
      });

      if (!idea) {
        throw new NotFoundException('The selected idea was not found.');
      }

      if (idea.generationType !== IdeaGenerationType.NORMAL_FREE) {
        throw new BadRequestException(
          'Only a registered-user free idea can be unlocked by direct payment.',
        );
      }

      if (idea.isUnlocked) {
        if (!idea.unlockedAt) {
          throw new BadRequestException(
            'The idea has an inconsistent unlock state.',
          );
        }

        return {
          ideaId: idea.id,
          alreadyUnlocked: true,
          unlockedAt: idea.unlockedAt,
        };
      }

      const definition = IDEA_ADVANCED_OUTPUT_DEFINITIONS.find(
        (item) => item.outputKey === DIRECT_UNLOCK_CLAIM_OUTPUT_KEY,
      );

      if (!definition) {
        throw new BadRequestException(
          'The full-abstract output definition is not registered.',
        );
      }

      const staleBefore = new Date(Date.now() - DIRECT_UNLOCK_CLAIM_TTL_MS);
      const existing = await tx.generatedOutput.findUnique({
        where: {
          ideaId_outputKey: {
            ideaId: idea.id,
            outputKey: DIRECT_UNLOCK_CLAIM_OUTPUT_KEY,
          },
        },
        select: {
          id: true,
          status: true,
          updatedAt: true,
        },
      });

      if (existing) {
        const claim = await tx.generatedOutput.updateMany({
          where: {
            id: existing.id,
            OR: [
              { status: GeneratedOutputStatus.FAILED },
              { status: GeneratedOutputStatus.COMPLETED },
              {
                status: GeneratedOutputStatus.PENDING,
                updatedAt: { lte: staleBefore },
              },
            ],
          },
          data: {
            title: definition.title,
            sequence: 1,
            status: GeneratedOutputStatus.PENDING,
            content: null,
            structuredContent: Prisma.JsonNull,
            errorMessage: null,
            generatedAt: null,
          },
        });

        if (claim.count !== 1) {
          throw new ConflictException(
            'Advanced-output generation is already in progress for this idea.',
          );
        }
      } else {
        try {
          await tx.generatedOutput.create({
            data: {
              ideaId: idea.id,
              outputKey: definition.outputKey,
              title: definition.title,
              sequence: 1,
              status: GeneratedOutputStatus.PENDING,
              content: null,
              structuredContent: Prisma.JsonNull,
              errorMessage: null,
              generatedAt: null,
            },
          });
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            throw new ConflictException(
              'Advanced-output generation is already in progress for this idea.',
            );
          }

          throw error;
        }
      }

      return {
        ideaId: idea.id,
        alreadyUnlocked: false,
      };
    });
  }

  async markDirectUnlockFailed(
    ideaId: string,
    userId: string,
    error: unknown,
  ): Promise<void> {
    const errorMessage =
      error instanceof Error
        ? error.message.slice(0, 1000)
        : 'Advanced-output generation failed.';

    await this.prisma.generatedOutput.updateMany({
      where: {
        ideaId,
        outputKey: DIRECT_UNLOCK_CLAIM_OUTPUT_KEY,
        status: GeneratedOutputStatus.PENDING,
        idea: {
          userId,
          isUnlocked: false,
          deletedAt: null,
        },
      },
      data: {
        status: GeneratedOutputStatus.FAILED,
        errorMessage,
        generatedAt: null,
      },
    });
  }

  async persistDirectUnlock(
    input: PersistIdeaUnlockOutputInput,
  ): Promise<PersistedIdeaUnlockResult> {
    return this.prisma.$transaction((tx) =>
      this.persistDirectUnlockWithClient(input, tx),
    );
  }

  async persistDirectUnlockWithClient(
    input: PersistIdeaUnlockOutputInput,
    db: OutputDatabaseClient,
  ): Promise<PersistedIdeaUnlockResult> {
    const unlockedAt = new Date();

    const idea = await db.idea.findFirst({
      where: {
        id: input.ideaId,
        userId: input.userId,
        deletedAt: null,
      },
      select: {
        id: true,
        generationType: true,
        isUnlocked: true,
        unlockedAt: true,
      },
    });

    if (!idea) {
      throw new NotFoundException(
        'The idea does not exist or is not owned by the user.',
      );
    }

    if (idea.generationType !== IdeaGenerationType.NORMAL_FREE) {
      throw new BadRequestException(
        'Only a registered-user free idea can be unlocked by direct payment.',
      );
    }

    if (idea.isUnlocked) {
      if (!idea.unlockedAt) {
        throw new BadRequestException(
          'The idea has an inconsistent unlock state.',
        );
      }

      return { ideaId: idea.id, unlockedAt: idea.unlockedAt };
    }

    const outputByKey = new Map(
      input.output.advancedOutputs.map((output) => [output.outputKey, output]),
    );

    for (const [
      index,
      definition,
    ] of IDEA_ADVANCED_OUTPUT_DEFINITIONS.entries()) {
      const output = outputByKey.get(definition.outputKey);

      if (!output && definition.requiredForPremium) {
        throw new BadRequestException(
          `Required generated output "${definition.outputKey}" is missing.`,
        );
      }

      if (!output) {
        continue;
      }

      await db.generatedOutput.upsert({
        where: {
          ideaId_outputKey: {
            ideaId: idea.id,
            outputKey: output.outputKey,
          },
        },
        create: {
          ideaId: idea.id,
          outputKey: output.outputKey,
          title: output.title,
          sequence: index + 1,
          status: GeneratedOutputStatus.COMPLETED,
          content: output.content,
          structuredContent:
            output.structuredContent === undefined
              ? Prisma.JsonNull
              : (output.structuredContent as Prisma.InputJsonValue),
          errorMessage: null,
          generatedAt: unlockedAt,
        },
        update: {
          title: output.title,
          sequence: index + 1,
          status: GeneratedOutputStatus.COMPLETED,
          content: output.content,
          structuredContent:
            output.structuredContent === undefined
              ? Prisma.JsonNull
              : (output.structuredContent as Prisma.InputJsonValue),
          errorMessage: null,
          generatedAt: unlockedAt,
        },
      });
    }

    await db.idea.update({
      where: { id: idea.id },
      data: {
        fullAbstract: input.output.fullAbstract,
        isUnlocked: true,
        unlockMethod: UnlockMethod.DIRECT_PAYMENT,
        unlockedAt,
      },
    });

    return { ideaId: idea.id, unlockedAt };
  }
}
