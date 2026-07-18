import {
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import {
  IdeaGenerationRun,
  IdeaGenerationRunStatus,
  IdeaGenerationStageStatus,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';

import {
  IDEA_OWNER_TYPES,
} from '../../shared/constants/ideas.constants';

import type {
  IdeaOwner,
} from '../../shared/types/idea-owner.type';

import {
  IdeaGenerationRunService,
} from '../services/idea-generation-run.service';

/**
 * Database client accepted by transaction-aware cancellation
 * operations.
 *
 * @author Malak
 */
type IdeaGenerationCancellationDatabaseClient =
  | PrismaService
  | Prisma.TransactionClient;

/**
 * Result returned after cancellation is requested by a run
 * owner.
 *
 * @author Malak
 */
export type RequestIdeaGenerationCancellationResult = {
  /**
   * Updated or existing generation run.
   */
  run: IdeaGenerationRun;

  /**
   * Indicates whether the run was already in a terminal state.
   */
  alreadyTerminal: boolean;

  /**
   * Indicates whether cancellation had already been requested.
   */
  alreadyRequested: boolean;
};

/**
 * Result returned after cancellation is finalized.
 *
 * @author Malak
 */
export type FinalizeIdeaGenerationCancellationResult = {
  /**
   * Cancelled generation run.
   */
  run: IdeaGenerationRun;

  /**
   * Number of pending stage records marked as skipped.
   */
  skippedStagesCount: number;
};

/**
 * Service responsible for coordinating cooperative
 * idea-generation cancellation.
 *
 * Responsibilities:
 * - Verify that a requester owns a generation run.
 * - Record cancellation requests.
 * - Expose cancellation checkpoints to pipeline stages.
 * - Mark pending stage records as skipped.
 * - Finalize a generation run as cancelled.
 * - Preserve idempotent cancellation behavior.
 *
 * Cancellation is cooperative:
 * - The request sets cancelRequestedAt.
 * - The pipeline checks the cancellation state between stages.
 * - Active external operations may finish before the next safe
 *   checkpoint.
 * - The pipeline invokes final cancellation after cleanup.
 *
 * This service does not:
 * - Interrupt an in-flight network request forcefully.
 * - Release generation locks.
 * - Stop collection jobs directly.
 * - Handle HTTP authentication.
 *
 * Generation-lock cleanup belongs to the orchestrator. External
 * job cancellation may be performed by the concrete collection
 * stage through its onCancel() hook.
 *
 * @author Malak
 */
@Injectable()
export class IdeaGenerationCancellationService {
  /**
   * Generation-run statuses after which cancellation no longer
   * changes normal workflow execution.
   */
  private readonly terminalStatuses =
    new Set<IdeaGenerationRunStatus>([
      IdeaGenerationRunStatus.COMPLETED,
      IdeaGenerationRunStatus.FAILED,
      IdeaGenerationRunStatus.CANCELLED,
    ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly runService:
      IdeaGenerationRunService,
  ) {}

  /**
   * Requests cancellation for one owner-accessible generation
   * run.
   *
   * Repeated requests are idempotent.
   *
   * @param runId Generation-run identifier.
   * @param owner Requesting owner.
   * @returns Cancellation-request result.
   */
  async requestCancellation(
    runId: string,
    owner: IdeaOwner,
  ): Promise<RequestIdeaGenerationCancellationResult> {
    const run = await this.findOwnedRunOrThrow(
      runId,
      owner,
    );

    const alreadyTerminal =
      this.terminalStatuses.has(run.status);

    const alreadyRequested =
      run.cancelRequestedAt !== null ||
      run.status ===
        IdeaGenerationRunStatus.CANCELLED;

    if (
      alreadyTerminal ||
      alreadyRequested
    ) {
      return {
        run,
        alreadyTerminal,
        alreadyRequested,
      };
    }

    const updatedRun =
      await this.runService
        .requestCancellation(run.id);

    return {
      run: updatedRun,
      alreadyTerminal: false,
      alreadyRequested: false,
    };
  }

  /**
   * Returns whether cancellation has been requested for one run.
   *
   * This method may be called before and after expensive stage
   * operations.
   *
   * @param runId Generation-run identifier.
   * @returns Whether cancellation was requested.
   */
  async isCancellationRequested(
    runId: string,
  ): Promise<boolean> {
    return this.runService
      .isCancellationRequested(runId);
  }

  /**
   * Returns the complete cancellation state for one run.
   *
   * @param runId Generation-run identifier.
   * @returns Cancellation state.
   */
  async getCancellationState(
    runId: string,
  ) {
    return this.runService
      .getCancellationState(runId);
  }

  /**
   * Marks all pending stage records as skipped.
   *
   * Running, completed, failed, and already-skipped stages are
   * not modified.
   *
   * @param runId Generation-run identifier.
   * @param db Optional transaction-aware database client.
   * @returns Number of stage records updated.
   */
  async skipPendingStages(
    runId: string,
    db: IdeaGenerationCancellationDatabaseClient =
      this.prisma,
  ): Promise<number> {
    const normalizedRunId =
      this.normalizeRequiredValue(
        runId,
        'Generation-run ID',
      );

    const now = new Date();

    const result =
      await db.ideaGenerationStage.updateMany({
        where: {
          runId: normalizedRunId,
          status:
            IdeaGenerationStageStatus.PENDING,
        },
        data: {
          status:
            IdeaGenerationStageStatus.SKIPPED,
          completedAt: now,
        },
      });

    return result.count;
  }

  /**
   * Finalizes cancellation atomically.
   *
   * Pending stages are marked as skipped before the generation
   * run becomes cancelled.
   *
   * @param runId Generation-run identifier.
   * @returns Cancelled run and skipped-stage count.
   */
  async finalizeCancellation(
    runId: string,
  ): Promise<FinalizeIdeaGenerationCancellationResult> {
    const normalizedRunId =
      this.normalizeRequiredValue(
        runId,
        'Generation-run ID',
      );

    return this.prisma.$transaction(
      async (transaction) => {
        const skippedStagesCount =
          await this.skipPendingStages(
            normalizedRunId,
            transaction,
          );

        const run =
          await this.runService.cancelRun(
            normalizedRunId,
            transaction,
          );

        return {
          run,
          skippedStagesCount,
        };
      },
    );
  }

  /**
   * Verifies that one run belongs to the provided owner.
   *
   * @param runId Generation-run identifier.
   * @param owner Requesting owner.
   * @returns Owned generation run.
   * @throws ForbiddenException when ownership does not match.
   */
  async findOwnedRunOrThrow(
    runId: string,
    owner: IdeaOwner,
  ): Promise<IdeaGenerationRun> {
    const normalizedRunId =
      this.normalizeRequiredValue(
        runId,
        'Generation-run ID',
      );

    const run =
      await this.runService.findRunOrThrow(
        normalizedRunId,
      );

    const ownsRun =
      owner.type === IDEA_OWNER_TYPES.USER
        ? run.userId === owner.userId
        : run.guestSessionId ===
          owner.guestSessionId;

    if (!ownsRun) {
      throw new ForbiddenException({
        code:
          'IDEA_GENERATION_RUN_ACCESS_DENIED',
        message:
          'You do not have access to this idea-generation run.',
      });
    }

    return run;
  }

  /**
   * Converts and validates one required text identifier.
   *
   * @param value Raw value.
   * @param fieldName Field name used in validation errors.
   * @returns Normalized required value.
   */
  private normalizeRequiredValue(
    value: string,
    fieldName: string,
  ): string {
    if (typeof value !== 'string') {
      throw new Error(
        `${fieldName} is required.`,
      );
    }

    const normalizedValue = value.trim();

    if (!normalizedValue) {
      throw new Error(
        `${fieldName} is required.`,
      );
    }

    return normalizedValue;
  }
}