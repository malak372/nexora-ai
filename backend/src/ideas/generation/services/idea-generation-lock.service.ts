import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';

import { CACHE_MANAGER } from '@nestjs/cache-manager';

import type { Cache } from 'cache-manager';

import {
  IDEA_GENERATION_ERROR_CODES,
  IDEA_GENERATION_LOCK_PREFIX,
  IDEA_GENERATION_LOCK_TTL_MS,
} from '../constants/idea-generation.constants';

import type { IdeaOwner } from '../../shared/types/idea-owner.type';

/**
 * Information persisted for an active idea-generation lock.
 *
 * The value is stored in the application cache and identifies
 * the generation run that currently owns the lock.
 *
 * @author Malak
 */
type IdeaGenerationLockValue = {
  /**
   * Identifier of the generation run that acquired the lock.
   */
  runId: string;

  /**
   * ISO timestamp indicating when the lock was acquired.
   */
  acquiredAt: string;
};

/**
 * Parameters required to acquire an idea-generation lock.
 *
 * @author Malak
 */
export type AcquireIdeaGenerationLockInput = {
  /**
   * Owner for whom generation is being started.
   */
  owner: IdeaOwner;

  /**
   * Generation-run identifier that will own the lock.
   */
  runId: string;
};

/**
 * Parameters required to release an idea-generation lock.
 *
 * @author Malak
 */
export type ReleaseIdeaGenerationLockInput = {
  /**
   * Owner whose lock should be released.
   */
  owner: IdeaOwner;

  /**
   * Generation-run identifier expected to own the lock.
   *
   * The lock is not removed when it belongs to another run.
   */
  runId: string;
};

/**
 * Service responsible for preventing concurrent idea-generation
 * runs for the same registered user or guest session.
 *
 * The lock protects the generation workflow from:
 * - Repeated frontend button clicks.
 * - Concurrent requests.
 * - Automatic network retries.
 * - Starting a second run before the first run completes.
 *
 * Locks are stored in the configured NestJS cache and expire
 * automatically after IDEA_GENERATION_LOCK_TTL_MS.
 *
 * The service also uses a process-local acquisition guard to
 * reduce race conditions between requests handled by the same
 * application instance.
 *
 * For a multi-instance production deployment, the configured
 * cache should support an atomic distributed-lock operation,
 * such as Redis SET with NX and PX options.
 *
 * @author Malak
 */
@Injectable()
export class IdeaGenerationLockService {
  private readonly logger = new Logger(
    IdeaGenerationLockService.name,
  );

  /**
   * Tracks lock keys currently being acquired in this Node.js
   * process.
   *
   * This guard prevents two simultaneous requests in the same
   * process from both passing the cache lookup before either one
   * writes the lock.
   */
  private readonly localAcquisitionGuards = new Set<string>();

  constructor(
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  /**
   * Acquires an owner-specific generation lock.
   *
   * A ConflictException is thrown when another generation run
   * already owns the lock.
   *
   * @param input Owner and generation-run information.
   */
  async acquire(
    input: AcquireIdeaGenerationLockInput,
  ): Promise<void> {
    const lockKey = this.buildLockKey(input.owner);

    if (this.localAcquisitionGuards.has(lockKey)) {
      this.throwGenerationAlreadyRunning();
    }

    this.localAcquisitionGuards.add(lockKey);

    try {
      const existingLock =
        await this.getLockByKey(lockKey);

      if (existingLock) {
        this.throwGenerationAlreadyRunning(
          existingLock.runId,
        );
      }

      const lockValue: IdeaGenerationLockValue = {
        runId: input.runId,
        acquiredAt: new Date().toISOString(),
      };

      await this.cacheManager.set(
        lockKey,
        lockValue,
        IDEA_GENERATION_LOCK_TTL_MS,
      );

      this.logger.debug(
        `Acquired idea-generation lock "${lockKey}" for run "${input.runId}".`,
      );
    } finally {
      this.localAcquisitionGuards.delete(lockKey);
    }
  }

  /**
   * Releases an active generation lock.
   *
   * The lock is deleted only when it is owned by the supplied
   * generation run. This prevents an old or failed run from
   * accidentally releasing the lock of a newer run.
   *
   * Missing or expired locks are treated as already released.
   *
   * @param input Owner and expected lock-owning run.
   */
  async release(
    input: ReleaseIdeaGenerationLockInput,
  ): Promise<void> {
    const lockKey = this.buildLockKey(input.owner);

    const existingLock =
      await this.getLockByKey(lockKey);

    if (!existingLock) {
      return;
    }

    if (existingLock.runId !== input.runId) {
      this.logger.warn(
        `Skipped release of idea-generation lock "${lockKey}" because it belongs to run "${existingLock.runId}", not "${input.runId}".`,
      );

      return;
    }

    await this.cacheManager.del(lockKey);

    this.logger.debug(
      `Released idea-generation lock "${lockKey}" for run "${input.runId}".`,
    );
  }

  /**
   * Checks whether an owner currently has an active generation
   * lock.
   *
   * @param owner Registered user or guest-session owner.
   */
  async isLocked(owner: IdeaOwner): Promise<boolean> {
    const lock = await this.getLock(owner);

    return lock !== null;
  }

  /**
   * Returns the generation run that currently owns the lock.
   *
   * Null is returned when no active lock exists.
   *
   * @param owner Registered user or guest-session owner.
   */
  async getActiveRunId(
    owner: IdeaOwner,
  ): Promise<string | null> {
    const lock = await this.getLock(owner);

    return lock?.runId ?? null;
  }

  /**
   * Extends the expiration time of a lock owned by an active
   * generation run.
   *
   * This method may be called by the generation heartbeat to
   * prevent a long-running valid pipeline from losing its lock.
   *
   * The lock is refreshed only when it still belongs to the
   * supplied run.
   *
   * @param owner Registered user or guest-session owner.
   * @param runId Expected lock-owning generation run.
   * @returns True when the lock was refreshed.
   */
  async refresh(
    owner: IdeaOwner,
    runId: string,
  ): Promise<boolean> {
    const lockKey = this.buildLockKey(owner);

    const existingLock =
      await this.getLockByKey(lockKey);

    if (
      !existingLock ||
      existingLock.runId !== runId
    ) {
      return false;
    }

    const refreshedLock: IdeaGenerationLockValue = {
      ...existingLock,
      acquiredAt: new Date().toISOString(),
    };

    await this.cacheManager.set(
      lockKey,
      refreshedLock,
      IDEA_GENERATION_LOCK_TTL_MS,
    );

    return true;
  }

  /**
   * Forcefully removes an owner's lock without checking its
   * generation-run identifier.
   *
   * This method should be restricted to recovery, maintenance or
   * administrative workflows. Normal generation completion must
   * use release() instead.
   *
   * @param owner Registered user or guest-session owner.
   */
  async forceRelease(owner: IdeaOwner): Promise<void> {
    const lockKey = this.buildLockKey(owner);

    await this.cacheManager.del(lockKey);

    this.logger.warn(
      `Force-released idea-generation lock "${lockKey}".`,
    );
  }

  /**
   * Reads an owner's active generation lock.
   */
  private async getLock(
    owner: IdeaOwner,
  ): Promise<IdeaGenerationLockValue | null> {
    const lockKey = this.buildLockKey(owner);

    return this.getLockByKey(lockKey);
  }

  /**
   * Reads and validates a generation-lock value from cache.
   *
   * Invalid cache values are removed to avoid permanently
   * blocking the owner.
   */
  private async getLockByKey(
    lockKey: string,
  ): Promise<IdeaGenerationLockValue | null> {
    const value =
      await this.cacheManager.get<unknown>(lockKey);

    if (value === undefined || value === null) {
      return null;
    }

    if (!this.isValidLockValue(value)) {
      await this.cacheManager.del(lockKey);

      this.logger.warn(
        `Removed invalid idea-generation lock value stored under "${lockKey}".`,
      );

      return null;
    }

    return value;
  }

  /**
   * Builds a stable cache key for a registered user or guest
   * session.
   */
  private buildLockKey(owner: IdeaOwner): string {
    if (owner.type === 'USER') {
      return [
        IDEA_GENERATION_LOCK_PREFIX,
        'user',
        owner.userId,
      ].join(':');
    }

    return [
      IDEA_GENERATION_LOCK_PREFIX,
      'guest',
      owner.guestSessionId,
    ].join(':');
  }

  /**
   * Validates an unknown cached lock value.
   */
  private isValidLockValue(
    value: unknown,
  ): value is IdeaGenerationLockValue {
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value)
    ) {
      return false;
    }

    const candidate =
      value as Partial<IdeaGenerationLockValue>;

    return (
      typeof candidate.runId === 'string' &&
      candidate.runId.length > 0 &&
      typeof candidate.acquiredAt === 'string' &&
      !Number.isNaN(
        Date.parse(candidate.acquiredAt),
      )
    );
  }

  /**
   * Throws the standard conflict response used when an owner
   * already has an active idea-generation run.
   */
  private throwGenerationAlreadyRunning(
    activeRunId?: string,
  ): never {
    throw new ConflictException({
      code:
        IDEA_GENERATION_ERROR_CODES
          .GENERATION_ALREADY_RUNNING,
      message:
        'An idea-generation run is already active for this owner.',
      activeRunId: activeRunId ?? null,
    });
  }
}