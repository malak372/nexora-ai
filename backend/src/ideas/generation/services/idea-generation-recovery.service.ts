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
  private readonly intervalMs = 120_000;
  private timer: NodeJS.Timeout | null = null;
  private recoveryInProgress = false;

  constructor(
    private readonly runService: IdeaGenerationRunService,
    private readonly orchestrator: IdeaGenerationOrchestratorService,
  ) {}

  onApplicationBootstrap(): void {
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