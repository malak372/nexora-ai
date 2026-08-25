import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';

import {
  GeneratedOutputStatus,
  IdeaGenerationRunStatus,
  IdeaGenerationStageStatus,
  IdeaGenerationType,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import {
  GENERATION_HEARTBEAT_INTERVAL_MS,
  GENERATION_RUN_MAX_RECOVERY_ATTEMPTS,
} from '../constants/idea-generation.constants';
import {
  findIdeaGenerationStageDefinition,
  IDEA_GENERATION_STAGE_KEYS,
} from '../constants/idea-generation-stages.constants';
import { REQUIRED_PREMIUM_IDEA_OUTPUT_KEYS } from '../constants/idea-output.constants';
import { IdeaGenerationOrchestratorService } from './idea-generation-orchestrator.service';
import { IdeaGenerationRealtimeService } from './idea-generation-realtime.service';
import { IdeaGenerationRunService } from './idea-generation-run.service';

/**
 * Recovers interrupted idea-generation runs after graceful shutdown, process
 * crash, machine restart, or power loss.
 *
 * Recovery is intentionally DB/checkpoint driven:
 * - Every fresh run stores an initial context snapshot atomically with QUEUED.
 * - A stale RUNNING/QUEUED row is converted to RETRYING.
 * - A worker atomically leases one RETRYING/PAUSED run before resuming it.
 * - A run whose Idea was already committed is finalized from durable DB state
 *   instead of rerunning IdeaPersistence (and therefore can never consume the
 *   same generation entitlement twice because of a restart).
 *
 * Foreground work still wins. The scanner distinguishes a healthy current
 * RUNNING/QUEUED row from an orphaned stale row so an old crash can never block
 * recovery forever.
 *
 * @author Eman
 */
@Injectable()
export class IdeaGenerationRecoveryService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(IdeaGenerationRecoveryService.name);

  /** Frequent enough to recover a short restart without polling aggressively. */
  private readonly intervalMs = this.readPositiveInteger(
    process.env.IDEA_GENERATION_RECOVERY_INTERVAL_MS,
    15_000,
  );

  /** Give the application/cache/database a brief moment to finish booting. */
  private readonly firstRecoveryDelayMs = this.readPositiveInteger(
    process.env.IDEA_GENERATION_FIRST_RECOVERY_DELAY_MS,
    1_500,
  );

  /**
   * A valid foreground run heartbeats every GENERATION_HEARTBEAT_INTERVAL_MS.
   * Three missed heartbeats are enough to call it orphaned while remaining safe
   * in multi-instance deployments.
   */
  private readonly staleRunningMs = this.readPositiveInteger(
    process.env.IDEA_GENERATION_STALE_RUNNING_MS,
    Math.max(45_000, GENERATION_HEARTBEAT_INTERVAL_MS * 3),
  );

  /** A queued run normally starts immediately; older queued rows are orphaned. */
  private readonly staleQueuedMs = this.readPositiveInteger(
    process.env.IDEA_GENERATION_STALE_QUEUED_MS,
    20_000,
  );

  /**
   * Do not resurrect ancient abandoned test rows forever. Seven days is long
   * enough for an extended power outage and is configurable for deployments
   * that need a different retention window.
   */
  private readonly maxAutomaticRecoveryAgeMs = this.readPositiveInteger(
    process.env.IDEA_GENERATION_MAX_AUTOMATIC_RECOVERY_AGE_MS,
    7 * 24 * 60 * 60_000,
  );

  /**
   * Lease duration used to stop two server instances from resuming the same
   * RETRYING row concurrently. startRun() clears the lease once execution owns
   * the run.
   */
  private readonly recoveryLeaseMs = this.readPositiveInteger(
    process.env.IDEA_GENERATION_RECOVERY_LEASE_MS,
    2 * 60_000,
  );

  /** Delay before another attempt when resume fails before the pipeline starts. */
  private readonly recoveryFailureDelayMs = this.readPositiveInteger(
    process.env.IDEA_GENERATION_RECOVERY_FAILURE_DELAY_MS,
    30_000,
  );

  private timer: NodeJS.Timeout | null = null;

  private firstRecoveryTimer: NodeJS.Timeout | null = null;

  private recoveryInProgress = false;

  private maintenanceInProgress = false;

  private shuttingDown = false;

  constructor(
    private readonly runService: IdeaGenerationRunService,
    private readonly orchestrator: IdeaGenerationOrchestratorService,
    private readonly realtime: IdeaGenerationRealtimeService,
    private readonly prisma: PrismaService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    /*
     * Reconcile a committed idea first. A power loss can happen after the
     * serializable idea/credit transaction commits but before completeRun().
     * That state is already a successful generation and must never be sent
     * through IdeaPersistence a second time.
     */
    await this.reconcileCommittedIdeaRuns();

    /*
     * Prepare stale rows from the previous process immediately when their
     * heartbeat/queue age proves they are no longer live. Unlike the previous
     * implementation this is not limited to "created in the last 10 minutes".
     */
    await this.performRecoveryMaintenance();

    this.firstRecoveryTimer = setTimeout(() => {
      void this.recoverOneRetryWhenIdle();
    }, this.firstRecoveryDelayMs);
    this.firstRecoveryTimer.unref();

    this.timer = setInterval(() => {
      void this.recoverOneRetryWhenIdle();
    }, this.intervalMs);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    this.shuttingDown = true;

    if (this.firstRecoveryTimer) {
      clearTimeout(this.firstRecoveryTimer);
      this.firstRecoveryTimer = null;
    }

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Performs bounded maintenance that is safe to run repeatedly:
   * - finalize already committed ideas;
   * - requeue stale RUNNING rows;
   * - requeue stale QUEUED rows;
   * - fail old rows that cannot be reconstructed;
   * - fail rows that exceeded the configurable automatic-recovery age.
   */
  private async performRecoveryMaintenance(): Promise<void> {
    if (this.maintenanceInProgress || this.shuttingDown) {
      return;
    }

    this.maintenanceInProgress = true;

    try {
      await this.reconcileCommittedIdeaRuns();

      const now = Date.now();
      const staleRunningBefore = new Date(now - this.staleRunningMs);
      const staleQueuedBefore = new Date(now - this.staleQueuedMs);
      const localRunIds = this.orchestrator.getLocallyActiveRunIds();

      const [requeuedRunning, requeuedQueued, failedUnrecoverable] =
        await Promise.all([
          this.runService.requeueStaleRunningRuns(
            staleRunningBefore,
            20,
            localRunIds,
          ),
          this.runService.requeueStaleQueuedRuns(staleQueuedBefore, 20),
          this.runService.failStaleUnrecoverableRuns(
            staleRunningBefore,
            20,
            localRunIds,
          ),
        ]);

      if (requeuedRunning > 0 || requeuedQueued > 0) {
        this.logger.warn(
          `Prepared interrupted generation runs for recovery: running=${requeuedRunning}, queued=${requeuedQueued}.`,
        );
      }

      if (failedUnrecoverable > 0) {
        this.logger.warn(
          `Closed ${failedUnrecoverable} stale generation run(s) that had no durable checkpoint.`,
        );
      }

      await this.failExpiredAutomaticRecoveryRuns();
      await this.failExhaustedRecoveryRuns();
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown recovery-maintenance error.';

      this.logger.warn(`Generation recovery maintenance failed: ${message}`);
    } finally {
      this.maintenanceInProgress = false;
    }
  }

  /**
   * Resumes at most one recoverable run.
   *
   * Healthy foreground work has priority, but stale database rows do not count
   * as healthy foreground work and therefore cannot deadlock the scanner.
   */
  private async recoverOneRetryWhenIdle(): Promise<void> {
    if (this.recoveryInProgress || this.shuttingDown) {
      return;
    }

    /*
     * Acquire the process-local scanner mutex before the first await. Timers
     * can otherwise overlap and claim two different recovery rows in one Node
     * process before either call reaches the old late mutex assignment.
     */
    this.recoveryInProgress = true;

    try {
      await this.performRecoveryMaintenance();

      if (this.shuttingDown) {
        return;
      }

      if (this.orchestrator.getLocallyActiveRunIds().length > 0) {
        return;
      }

      const now = Date.now();
      const healthyForeground = await this.runService.hasHealthyForegroundRuns(
        new Date(now - this.staleRunningMs),
        new Date(now - this.staleQueuedMs),
      );

      if (healthyForeground) {
        return;
      }

      const cutoff = new Date(now - this.maxAutomaticRecoveryAgeMs);
      const candidates = await this.runService.findRecoverableRuns(
        20,
        new Date(now - this.staleQueuedMs),
      );

      const run = candidates.find(
        (candidate) =>
          candidate.createdAt >= cutoff &&
          candidate.retryCount < GENERATION_RUN_MAX_RECOVERY_ATTEMPTS,
      );

      if (!run) {
        return;
      }

      const leaseUntil = new Date(now + this.recoveryLeaseMs);
      const claimed = await this.runService.claimRecoverableRun(
        run.id,
        GENERATION_RUN_MAX_RECOVERY_ATTEMPTS,
        leaseUntil,
      );

      if (!claimed || this.shuttingDown) {
        return;
      }

      try {
        this.logger.warn(
          `Resuming interrupted generation run "${claimed.id}" from its latest durable checkpoint (attempt ${claimed.retryCount}/${GENERATION_RUN_MAX_RECOVERY_ATTEMPTS}).`,
        );

        await this.orchestrator.resumeRunFromCheckpoint(claimed.id);
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Unknown recovery error.';

        this.logger.warn(
          `Recovery attempt failed for run "${claimed.id}": ${message}`,
        );

        /*
         * If the pipeline already started it will have persisted RUNNING,
         * RETRYING, FAILED, CANCELLED, or COMPLETED itself. Only a still-leased
         * RETRYING row needs to be scheduled again here (for example owner-lock
         * contention before startRun()).
         */
        const latest = await this.runService
          .findRunOrThrow(claimed.id)
          .catch(() => null);

        if (
          latest?.status === IdeaGenerationRunStatus.RETRYING &&
          latest.completedAt === null &&
          latest.cancelRequestedAt === null
        ) {
          await this.runService
            .markRetrying(
              claimed.id,
              `Automatic recovery could not start yet: ${message}`,
              new Date(Date.now() + this.recoveryFailureDelayMs),
              false,
            )
            .catch((rescheduleError: unknown) => {
              const rescheduleMessage =
                rescheduleError instanceof Error
                  ? rescheduleError.message
                  : String(rescheduleError);
              this.logger.warn(
                `Could not reschedule recovery for run "${claimed.id}": ${rescheduleMessage}`,
              );
            });
        }
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown recovery scan error.';

      this.logger.warn(`Generation recovery scan failed: ${message}`);
    } finally {
      this.recoveryInProgress = false;
    }
  }

  /**
   * Finalizes runs for which the atomic IdeaPersistence transaction had already
   * committed before the server stopped.
   *
   * This is the most important idempotency boundary in restart recovery:
   * - idea exists;
   * - run.ideaId points to it;
   * - premium outputs exist when required;
   * - entitlement consumption happened in the same transaction.
   *
   * Therefore re-running IdeaPersistence would be both unnecessary and unsafe.
   */
  private async reconcileCommittedIdeaRuns(): Promise<void> {
    if (this.shuttingDown) {
      return;
    }

    const runs = await this.prisma.ideaGenerationRun.findMany({
      where: {
        status: {
          in: [
            IdeaGenerationRunStatus.QUEUED,
            IdeaGenerationRunStatus.RUNNING,
            IdeaGenerationRunStatus.RETRYING,
            IdeaGenerationRunStatus.PAUSED,
          ],
        },
        ideaId: { not: null },
        completedAt: null,
        cancelRequestedAt: null,
      },
      select: {
        id: true,
        ideaId: true,
        generationType: true,
        contextSnapshot: true,
        idea: {
          select: {
            id: true,
            generatedOutputs: {
              select: {
                id: true,
                outputKey: true,
                status: true,
              },
            },
          },
        },
      },
      orderBy: { updatedAt: 'asc' },
      take: 50,
    });

    for (const run of runs) {
      if (this.shuttingDown) {
        return;
      }

      if (!run.ideaId || !run.idea) {
        continue;
      }

      const completedOutputs = run.idea.generatedOutputs.filter(
        (output) => output.status === GeneratedOutputStatus.COMPLETED,
      );

      if (run.generationType === IdeaGenerationType.PREMIUM_CREDIT) {
        const completedKeys = new Set(
          completedOutputs.map((output) => output.outputKey),
        );

        const missingRequiredOutput = REQUIRED_PREMIUM_IDEA_OUTPUT_KEYS.some(
          (outputKey) => !completedKeys.has(outputKey),
        );

        if (missingRequiredOutput) {
          /*
           * A healthy persistence transaction creates required outputs and
           * attaches the idea atomically. Missing outputs therefore indicate a
           * genuinely inconsistent row; do not hide it by claiming completion.
           */
          this.logger.error(
            `Run "${run.id}" is linked to persisted idea "${run.ideaId}" but required premium outputs are missing; automatic completion was refused.`,
          );
          continue;
        }
      }

      const generatedOutputIdsByKey = Object.fromEntries(
        completedOutputs.map((output) => [output.outputKey, output.id]),
      );

      const checkpoint = this.asJsonObject(run.contextSnapshot);
      const snapshot: Prisma.InputJsonObject = {
        ...checkpoint,
        runId: run.id,
        ideaId: run.ideaId,
        generationType: run.generationType,
        generatedOutputIdsByKey,
        recoveryCheckpointStageKey: IDEA_GENERATION_STAGE_KEYS.IDEA_PERSISTENCE,
      };

      const persistenceDefinition = findIdeaGenerationStageDefinition(
        IDEA_GENERATION_STAGE_KEYS.IDEA_PERSISTENCE,
      );
      const finalizationDefinition = findIdeaGenerationStageDefinition(
        IDEA_GENERATION_STAGE_KEYS.FINALIZATION,
      );
      const now = new Date();

      const completedRun = await this.prisma.$transaction(async (transaction) => {
        if (persistenceDefinition) {
          await transaction.ideaGenerationStage.updateMany({
            where: {
              runId: run.id,
              stageKey: IDEA_GENERATION_STAGE_KEYS.IDEA_PERSISTENCE,
            },
            data: {
              status: IdeaGenerationStageStatus.COMPLETED,
              progressPercent: persistenceDefinition.progressEnd,
              errorMessage: null,
              startedAt: now,
              completedAt: now,
              attemptCount: 1,
            },
          });
        }

        if (finalizationDefinition) {
          await transaction.ideaGenerationStage.updateMany({
            where: {
              runId: run.id,
              stageKey: IDEA_GENERATION_STAGE_KEYS.FINALIZATION,
            },
            data: {
              status: IdeaGenerationStageStatus.COMPLETED,
              progressPercent: finalizationDefinition.progressEnd,
              errorMessage: null,
              startedAt: now,
              completedAt: now,
              attemptCount: 1,
              resultPreview:
                'Recovered after restart from an already committed idea.',
            },
          });
        }

        return this.runService.completeRecoveredPersistedRun(
          run.id,
          snapshot as Prisma.InputJsonValue,
          transaction,
        );
      });

      this.realtime.publishRunUpdated(completedRun);

      this.logger.warn(
        `Completed interrupted generation run "${run.id}" from already committed idea "${run.ideaId}" without rerunning persistence or consuming entitlement again.`,
      );
    }
  }

  /**
   * Terminally closes very old recoverable rows instead of silently leaving
   * them in RETRYING/PAUSED forever. The default is seven days, configurable by
   * environment variable.
   */
  private async failExpiredAutomaticRecoveryRuns(): Promise<void> {
    const cutoff = new Date(
      Date.now() - this.maxAutomaticRecoveryAgeMs,
    );

    const expired = await this.prisma.ideaGenerationRun.findMany({
      where: {
        status: {
          in: [
            IdeaGenerationRunStatus.QUEUED,
            IdeaGenerationRunStatus.RETRYING,
            IdeaGenerationRunStatus.PAUSED,
          ],
        },
        ideaId: null,
        completedAt: null,
        cancelRequestedAt: null,
        createdAt: { lt: cutoff },
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });

    for (const run of expired) {
      await this.runService
        .failRun({
          runId: run.id,
          errorCode: 'GENERATION_RECOVERY_EXPIRED',
          errorMessage:
            'The interrupted generation exceeded the automatic recovery retention window. Please start generation again.',
        })
        .catch((error: unknown) => {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Could not close expired recovery run "${run.id}": ${message}`,
          );
        });
    }
  }

  /**
   * Stops rows that consumed every real recovery execution attempt. This keeps
   * a permanently broken run from sitting in RETRYING forever.
   */
  private async failExhaustedRecoveryRuns(): Promise<void> {
    const exhausted = await this.prisma.ideaGenerationRun.findMany({
      where: {
        status: {
          in: [
            IdeaGenerationRunStatus.RETRYING,
            IdeaGenerationRunStatus.PAUSED,
          ],
        },
        ideaId: null,
        completedAt: null,
        cancelRequestedAt: null,
        retryCount: { gte: GENERATION_RUN_MAX_RECOVERY_ATTEMPTS },
      },
      select: { id: true },
      orderBy: { updatedAt: 'asc' },
      take: 20,
    });

    for (const run of exhausted) {
      await this.runService
        .failRun({
          runId: run.id,
          errorCode: 'GENERATION_RECOVERY_EXHAUSTED',
          errorMessage:
            'Automatic generation recovery attempts were exhausted. Please start generation again.',
        })
        .catch((error: unknown) => {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Could not close exhausted recovery run "${run.id}": ${message}`,
          );
        });
    }
  }

  private asJsonObject(
    value: Prisma.JsonValue | null,
  ): Prisma.InputJsonObject {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as Prisma.InputJsonObject;
  }

  private readPositiveInteger(
    rawValue: string | undefined,
    fallback: number,
  ): number {
    if (!rawValue?.trim()) {
      return fallback;
    }

    const parsed = Number.parseInt(rawValue.trim(), 10);

    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
