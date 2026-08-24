import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';

import { IdeaGenerationRunStatus } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import { GENERATION_RUN_MAX_RECOVERY_ATTEMPTS } from '../constants/idea-generation.constants';
import { IdeaGenerationOrchestratorService } from './idea-generation-orchestrator.service';
import { IdeaGenerationRunService } from './idea-generation-run.service';

/**
 * Recovers interrupted idea-generation runs without changing or slowing
 * the normal foreground pipeline.
 *
 * Recovery rules:
 * - RUNNING / QUEUED rows from a previous server process are prepared once
 *   during application startup.
 * - RUNNING rows are never scanned as stale during normal runtime.
 * - Only RETRYING / PAUSED rows are considered by the periodic retry loop.
 * - Foreground QUEUED / RUNNING work always has priority over recovery.
 *
 * This implementation is intentionally compatible with the existing
 * IdeaGenerationOrchestratorService and IdeaGenerationRunService APIs.
 *
 * @author Eman
 */
@Injectable()
export class IdeaGenerationRecoveryService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(IdeaGenerationRecoveryService.name);

  /**
   * Runtime recovery is deliberately infrequent.
   * It never scans RUNNING rows, so it cannot classify a long AI stage as dead.
   */
  private readonly intervalMs = 30_000;

  /**
   * Wait briefly after startup before attempting the first resumed pipeline.
   * This gives a fresh foreground request priority if one arrives immediately.
   */
  private readonly firstRecoveryDelayMs = 2_500;

  /**
   * Only interrupted rows created recently are touched automatically.
   * This prevents old test/backlog rows from being resurrected on every boot.
   */
  private readonly startupRecoveryLookbackMs = this.readPositiveInteger(
    process.env.IDEA_GENERATION_RECOVERY_LOOKBACK_MS,
    10 * 60_000,
  );

  private startupAt = new Date();

  private timer: NodeJS.Timeout | null = null;

  private firstRecoveryTimer: NodeJS.Timeout | null = null;

  private recoveryInProgress = false;

  private shuttingDown = false;

  constructor(
    private readonly runService: IdeaGenerationRunService,
    private readonly orchestrator: IdeaGenerationOrchestratorService,
    private readonly prisma: PrismaService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.startupAt = new Date();

    /*
     * Prepare only work that belonged to the previous server process.
     * This DB-only step is fast and does not execute the expensive pipeline.
     */
    await this.prepareStartupInterruptedRuns();

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
   * Converts only pre-start RUNNING / QUEUED rows into a safe terminal or
   * recoverable state.
   *
   * Important:
   * - This is the only place where RUNNING rows are inspected by recovery.
   * - It happens once per process start.
   * - Runtime scans never touch RUNNING rows.
   */
  private async prepareStartupInterruptedRuns(): Promise<void> {
    const createdAfter = new Date(
      this.startupAt.getTime() - this.startupRecoveryLookbackMs,
    );

    try {
      const candidates = await this.prisma.ideaGenerationRun.findMany({
        where: {
          status: {
            in: [
              IdeaGenerationRunStatus.QUEUED,
              IdeaGenerationRunStatus.RUNNING,
            ],
          },

          completedAt: null,

          cancelRequestedAt: null,

          createdAt: {
            gte: createdAfter,
            lt: this.startupAt,
          },
        },

        orderBy: {
          updatedAt: 'desc',
        },

        take: 20,
      });

      if (candidates.length === 0) {
        return;
      }

      let preparedCount = 0;

      let failedCount = 0;

      for (const candidate of candidates) {
        if (this.shuttingDown) {
          return;
        }

        const hasCheckpoint =
          candidate.contextSnapshot !== null &&
          typeof candidate.contextSnapshot === 'object' &&
          !Array.isArray(candidate.contextSnapshot);

        /*
         * A queued run may have been created immediately before the process
         * stopped. If it has no durable checkpoint there is not enough
         * information to safely reconstruct the generation request.
         */
        if (!hasCheckpoint) {
          try {
            await this.runService.failRun({
              runId: candidate.id,

              errorCode: 'GENERATION_RECOVERY_CHECKPOINT_MISSING',

              errorMessage:
                'The server stopped before a recoverable generation checkpoint was saved. Please start generation again.',
            });

            failedCount += 1;
          } catch (error: unknown) {
            const message =
              error instanceof Error
                ? error.message
                : 'Unknown failure.';

            this.logger.warn(
              `Could not close interrupted generation run "${candidate.id}": ${message}`,
            );
          }

          continue;
        }

        const now = new Date();

        const result =
          await this.prisma.ideaGenerationRun.updateMany({
            where: {
              id: candidate.id,

              status: candidate.status,

              completedAt: null,

              cancelRequestedAt: null,
            },

            data: {
              status: IdeaGenerationRunStatus.RETRYING,

              /*
               * RETRYING requires startedAt to be non-null according to the
               * generation-run database consistency constraint.
               */
              startedAt:
                candidate.startedAt ??
                candidate.createdAt,

              completedAt: null,

              nextRetryAt: now,

              pausedAt: null,

              lastHeartbeatAt: now,

              errorCode:
                'GENERATION_PROCESS_INTERRUPTED',

              errorMessage:
                'The previous server process stopped during generation. The run is ready to resume from its saved checkpoint.',

              retryCount: {
                increment: 1,
              },
            },
          });

        preparedCount += result.count;
      }

      if (preparedCount > 0) {
        this.logger.warn(
          `Prepared ${preparedCount} interrupted generation run(s) for checkpoint recovery.`,
        );
      }

      if (failedCount > 0) {
        this.logger.warn(
          `Marked ${failedCount} interrupted generation run(s) without a checkpoint as failed.`,
        );
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown startup recovery preparation error.';

      this.logger.warn(
        `Startup generation recovery preparation failed: ${message}`,
      );
    }
  }

  /**
   * Resumes at most one RETRYING / PAUSED run.
   *
   * Recovery is skipped whenever a normal foreground generation is queued or
   * running, so recovery cannot compete with the fast pipeline for collectors,
   * database connections, AI requests or event-loop time.
   */
  private async recoverOneRetryWhenIdle(): Promise<void> {
    if (
      this.recoveryInProgress ||
      this.shuttingDown
    ) {
      return;
    }

    try {
      /*
       * Foreground generation always wins.
       *
       * The existing hasActiveRuns() method checks QUEUED / RUNNING rows.
       */
      if (
        this.orchestrator.getLocallyActiveRunIds().length > 0 ||
        (await this.runService.hasActiveRuns())
      ) {
        return;
      }

      const now = new Date();

      const createdAfter = new Date(
        this.startupAt.getTime() -
          this.startupRecoveryLookbackMs,
      );

      /*
       * Do not use findRecoverableRuns() here because the current version of
       * that method does not accept date/filter options.
       *
       * Query Prisma directly so only recent recovery work is considered.
       */
      const run =
        await this.prisma.ideaGenerationRun.findFirst({
          where: {
            status: {
              in: [
                IdeaGenerationRunStatus.RETRYING,
                IdeaGenerationRunStatus.PAUSED,
              ],
            },

            cancelRequestedAt: null,

            createdAt: {
              gte: createdAfter,
            },

            OR: [
              {
                nextRetryAt: null,
              },
              {
                nextRetryAt: {
                  lte: now,
                },
              },
            ],
          },

          /*
           * Prefer the most recently interrupted run instead of resurrecting
           * an old backlog before current user work.
           */
          orderBy: {
            updatedAt: 'desc',
          },
        });

      if (
        !run ||
        this.shuttingDown
      ) {
        return;
      }

      const hasCheckpoint =
        run.contextSnapshot !== null &&
        typeof run.contextSnapshot === 'object' &&
        !Array.isArray(run.contextSnapshot);

      if (!hasCheckpoint) {
        await this.runService.failRun({
          runId: run.id,

          errorCode:
            'GENERATION_RECOVERY_CHECKPOINT_MISSING',

          errorMessage:
            'The generation run does not contain a recoverable checkpoint. Please start generation again.',
        });

        return;
      }

      if (
        run.retryCount >=
        GENERATION_RUN_MAX_RECOVERY_ATTEMPTS
      ) {
        await this.runService.failRun({
          runId: run.id,

          errorCode:
            'GENERATION_RECOVERY_EXHAUSTED',

          errorMessage:
            'Automatic generation recovery attempts were exhausted. Please start generation again.',
        });

        this.logger.warn(
          `Generation recovery attempts were exhausted for run "${run.id}".`,
        );

        return;
      }

      /*
       * Re-check immediately before starting expensive recovery work.
       *
       * A foreground request may have been queued while the recoverable row
       * was being loaded.
       */
      if (
        this.orchestrator.getLocallyActiveRunIds().length > 0 ||
        (await this.runService.hasActiveRuns())
      ) {
        return;
      }

      this.recoveryInProgress = true;

      try {
        this.logger.log(
          `Resuming generation run "${run.id}" from its latest durable checkpoint.`,
        );

        await this.orchestrator.resumeRunFromCheckpoint(
          run.id,
        );
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unknown recovery error.';

        this.logger.warn(
          `Recovery attempt failed for run "${run.id}": ${message}`,
        );
      } finally {
        this.recoveryInProgress = false;
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown recovery scan error.';

      this.logger.warn(
        `Generation recovery scan failed: ${message}`,
      );

      this.recoveryInProgress = false;
    }
  }

  private readPositiveInteger(
    rawValue: string | undefined,
    fallback: number,
  ): number {
    if (!rawValue?.trim()) {
      return fallback;
    }

    const parsed = Number.parseInt(
      rawValue.trim(),
      10,
    );

    return Number.isFinite(parsed) &&
      parsed > 0
      ? parsed
      : fallback;
  }
}