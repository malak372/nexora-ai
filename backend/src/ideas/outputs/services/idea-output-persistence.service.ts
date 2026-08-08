import {
  BadRequestException,
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
/**
 * Stable output key used as the durable direct-unlock generation claim.
 *
 * It intentionally matches the registered advanced-output definition and the
 * unique GeneratedOutput (ideaId, outputKey) constraint.
 */
const DIRECT_UNLOCK_CLAIM_OUTPUT_KEY = 'full-abstract' as const;

/**
 * A pending claim older than this duration may be safely reclaimed.
 */
const DIRECT_UNLOCK_CLAIM_TTL_MS = 10 * 60 * 1000;

/** Maximum time a duplicate reconciliation waits for the active worker. */
const DIRECT_UNLOCK_WAIT_TIMEOUT_MS = 90 * 1000;

/** Poll interval used while another worker owns the durable claim. */
const DIRECT_UNLOCK_WAIT_POLL_MS = 1000;

/** Maximum time Prisma may wait to acquire a transaction connection. */
const DIRECT_UNLOCK_TRANSACTION_MAX_WAIT_MS = 60 * 1000;

/** Number of retries for transient interactive-transaction acquisition failures. */
const DIRECT_UNLOCK_TRANSACTION_RETRY_ATTEMPTS = 3;

/** Base delay used between transaction retries. */
const DIRECT_UNLOCK_TRANSACTION_RETRY_BASE_DELAY_MS = 300;

/**
 * Maximum lifetime of the interactive persistence transaction.
 *
 * Direct unlock persists several advanced-output rows against a remote
 * PostgreSQL database. Prisma's default interactive-transaction timeout is
 * too short for this workload and can close the transaction before the final
 * Idea update, causing P2028 (Transaction not found).
 */
const DIRECT_UNLOCK_TRANSACTION_TIMEOUT_MS = 120 * 1000;
import type {
  BeginIdeaUnlockResult,
  IdeaOutputDatabaseClient,
  PersistedIdeaUnlockResult,
  PersistIdeaUnlockOutputInput,
  WaitForIdeaUnlockResult,
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
  constructor(private readonly prisma: PrismaService) { }

  async beginDirectUnlock(
    ideaId: string,
    userId: string,
  ): Promise<BeginIdeaUnlockResult> {
    /*
     * Do not use an interactive transaction for the claim step.
     *
     * The claim is already protected by the unique (ideaId, outputKey)
     * constraint plus conditional updateMany below. Keeping this step on the
     * regular Prisma pool avoids consuming a dedicated transaction connection
     * while payment/webhook requests are running concurrently.
     */
    const idea = await this.prisma.idea.findFirst({
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
        'Only a registered-user free idea can be unlocked.',
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
        inProgress: false,
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
    const existing = await this.prisma.generatedOutput.findUnique({
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
      const claim = await this.prisma.generatedOutput.updateMany({
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
        return {
          ideaId: idea.id,
          alreadyUnlocked: false,
          inProgress: true,
        };
      }
    } else {
      try {
        await this.prisma.generatedOutput.create({
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
          return {
            ideaId: idea.id,
            alreadyUnlocked: false,
            inProgress: true,
          };
        }

        throw error;
      }
    }

    return {
      ideaId: idea.id,
      alreadyUnlocked: false,
      inProgress: false,
    };
  }

  /**
   * Waits for a concurrently running direct unlock to reach a terminal state.
   *
   * This prevents repeated webhook or reconcile requests from turning a valid
   * in-flight unlock into an HTTP 500. The caller may retry acquisition when
   * the previous claim failed or became stale.
   */
  async waitForDirectUnlockCompletion(
    ideaId: string,
    userId: string,
  ): Promise<WaitForIdeaUnlockResult> {
    const deadline = Date.now() + DIRECT_UNLOCK_WAIT_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const state = await this.prisma.idea.findFirst({
        where: {
          id: ideaId,
          userId,
          deletedAt: null,
        },
        select: {
          isUnlocked: true,
          unlockedAt: true,
          generatedOutputs: {
            where: { outputKey: DIRECT_UNLOCK_CLAIM_OUTPUT_KEY },
            take: 1,
            select: {
              status: true,
              updatedAt: true,
            },
          },
        },
      });

      if (!state) {
        throw new NotFoundException('The selected idea was not found.');
      }

      if (state.isUnlocked && state.unlockedAt) {
        return {
          completed: true,
          failed: false,
          retryable: false,
          unlockedAt: state.unlockedAt,
        };
      }

      const claim = state.generatedOutputs[0];

      if (!claim || claim.status === GeneratedOutputStatus.FAILED) {
        return {
          completed: false,
          failed: true,
          retryable: true,
        };
      }

      if (
        claim.status === GeneratedOutputStatus.PENDING &&
        claim.updatedAt.getTime() <= Date.now() - DIRECT_UNLOCK_CLAIM_TTL_MS
      ) {
        return {
          completed: false,
          failed: false,
          retryable: true,
        };
      }

      await new Promise<void>((resolve) => {
        setTimeout(resolve, DIRECT_UNLOCK_WAIT_POLL_MS);
      });
    }

    return {
      completed: false,
      failed: false,
      retryable: false,
    };
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
    let lastError: unknown;

    for (
      let attempt = 1;
      attempt <= DIRECT_UNLOCK_TRANSACTION_RETRY_ATTEMPTS;
      attempt += 1
    ) {
      try {
        return await this.prisma.$transaction(
          (tx) => this.persistDirectUnlockWithClient(input, tx),
          {
            maxWait: DIRECT_UNLOCK_TRANSACTION_MAX_WAIT_MS,
            timeout: DIRECT_UNLOCK_TRANSACTION_TIMEOUT_MS,
          },
        );
      } catch (error) {
        lastError = error;

        if (
          !this.isRetryableTransactionError(error) ||
          attempt === DIRECT_UNLOCK_TRANSACTION_RETRY_ATTEMPTS
        ) {
          throw error;
        }

        await this.sleep(
          DIRECT_UNLOCK_TRANSACTION_RETRY_BASE_DELAY_MS * attempt,
        );
      }
    }

    throw lastError;
  }

  /**
   * P2028 is safe to retry here because a failed interactive transaction is
   * rolled back, and the persistence body itself uses idempotent upserts.
   */
  private isRetryableTransactionError(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
      return false;
    }

    if (error.code !== 'P2028') {
      return false;
    }

    const message = `${error.message} ${JSON.stringify(error.meta ?? {})}`;

    return (
      message.includes('Unable to start a transaction') ||
      message.includes('Transaction not found') ||
      message.includes('transaction already closed')
    );
  }

  private sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
        'Only a registered-user free idea can be unlocked.',
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
        unlockMethod: input.unlockMethod ?? UnlockMethod.DIRECT_PAYMENT,
        unlockedAt,
      },
    });

    return { ideaId: idea.id, unlockedAt };
  }
}