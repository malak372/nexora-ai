import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';

import { GENERATION_RUN_MAX_RECOVERY_ATTEMPTS } from '../constants/idea-generation.constants';
import { IdeaGenerationOrchestratorService } from './idea-generation-orchestrator.service';
import { IdeaGenerationRunService } from './idea-generation-run.service';

/** Recovers paused/retrying runs from their latest durable checkpoint. */
@Injectable()
export class IdeaGenerationRecoveryService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(IdeaGenerationRecoveryService.name);
  private readonly intervalMs = 15_000;
  private readonly staleRunningThresholdMs = 90_000;
  private timer: NodeJS.Timeout | null = null;
  private recoveryInProgress = false;

  constructor(
    private readonly runService: IdeaGenerationRunService,
    private readonly orchestrator: IdeaGenerationOrchestratorService,
  ) {}

  onApplicationBootstrap(): void {
    // Run one scan immediately so already-paused work is resumed as soon as
    // this process is ready, then keep a lightweight periodic safety scan.
    void this.recoverEligibleRuns();

    this.timer = setInterval(() => {
      void this.recoverEligibleRuns();
    }, this.intervalMs);

    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async recoverEligibleRuns(): Promise<void> {
    if (this.recoveryInProgress) {
      return;
    }

    this.recoveryInProgress = true;

    try {
      const staleBefore = new Date(
        Date.now() - this.staleRunningThresholdMs,
      );
      const requeued = await this.runService.requeueStaleRunningRuns(
        staleBefore,
        5,
      );

      if (requeued > 0) {
        this.logger.warn(
          `Moved ${requeued} stale generation run(s) into checkpoint recovery.`,
        );
      }

      if (await this.runService.hasActiveRuns()) {
        return;
      }

      const runs = await this.runService.findRecoverableRuns(5);

      for (const run of runs) {
        if (run.retryCount >= GENERATION_RUN_MAX_RECOVERY_ATTEMPTS) {
          await this.runService.pauseRun(
            run.id,
            'Automatic recovery attempts were exhausted. The run may be resumed manually.',
            new Date(Date.now() + 5 * 60_000),
          );
          continue;
        }

        try {
          this.logger.log(
            `Resuming generation run "${run.id}" from its latest checkpoint.`,
          );
          await this.orchestrator.resumeRunFromCheckpoint(run.id);
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : 'Unknown recovery error.';
          this.logger.warn(
            `Recovery attempt failed for run "${run.id}": ${message}`,
          );
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
}