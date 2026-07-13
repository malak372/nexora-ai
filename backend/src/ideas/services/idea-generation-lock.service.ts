import { ConflictException, Injectable, Logger } from '@nestjs/common';

import { Prisma } from '@prisma/client';

import { randomUUID } from 'crypto';

import { PrismaService } from '../../prisma/prisma.service';

import { IDEA_GENERATION_LOCK_TTL_MS } from '../constants/idea-generation.constants';

/**
 * Distributed PostgreSQL-backed lock for expensive idea generation.
 *
 * Unlike an in-memory lock, this implementation protects requests
 * across multiple backend application instances.
 *
 * @author Malak
 */
@Injectable()
export class IdeaGenerationLockService {
  private readonly logger = new Logger(IdeaGenerationLockService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Executes an operation while holding one distributed lock.
   */
  async runExclusive<T>(
    lockKey: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const ownerToken = randomUUID();

    await this.acquire(lockKey, ownerToken);

    try {
      return await operation();
    } finally {
      await this.release(lockKey, ownerToken);
    }
  }

  /**
   * Acquires a lock after deleting an expired lock with the same key.
   */
  private async acquire(lockKey: string, ownerToken: string): Promise<void> {
    await this.prisma.ideaGenerationLock.deleteMany({
      where: {
        lockKey,

        expiresAt: {
          lte: new Date(),
        },
      },
    });

    const expiresAt = new Date(Date.now() + IDEA_GENERATION_LOCK_TTL_MS);

    try {
      await this.prisma.ideaGenerationLock.create({
        data: {
          lockKey,
          ownerToken,
          expiresAt,
        },
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException({
          code: 'IDEA_GENERATION_IN_PROGRESS',

          message:
            'An idea-generation request is already in progress for this account.',
        });
      }

      throw error;
    }
  }

  /**
   * Releases only the lock owned by this operation.
   */
  private async release(lockKey: string, ownerToken: string): Promise<void> {
    try {
      await this.prisma.ideaGenerationLock.deleteMany({
        where: {
          lockKey,
          ownerToken,
        },
      });
    } catch (error: unknown) {
      this.logger.warn(
        `Unable to release idea-generation lock "${lockKey}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
