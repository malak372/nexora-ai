import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  IdeaGenerationRun,
  IdeaGenerationRunStatus,
  IdeaGenerationType,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import { IDEA_GENERATION_STAGE_KEYS } from '../constants/idea-generation-stages.constants';

/**
 * Database client accepted by transaction-aware generation-run
 * operations.
 *
 * The normal PrismaService is used outside transactions, while
 * Prisma.TransactionClient may be provided when a run update
 * must be committed atomically with another operation.
 *
 * @author Malak
 */
type IdeaGenerationRunDatabaseClient = PrismaService | Prisma.TransactionClient;

/**
 * Owner information associated with a generation run.
 *
 * Exactly one owner must be provided:
 * - userId for authenticated generation.
 * - guestSessionId for guest generation.
 *
 * @author Malak
 */
export type IdeaGenerationRunOwner =
  | {
      /**
       * Registered user who owns the generation run.
       */
      userId: string;

      /**
       * Guest ownership is forbidden for user-owned runs.
       */
      guestSessionId?: never;
    }
  | {
      /**
       * User ownership is forbidden for guest-owned runs.
       */
      userId?: never;

      /**
       * Guest session that owns the generation run.
       */
      guestSessionId: string;
    };

/**
 * Input required to create a queued idea-generation run.
 *
 * @author Malak
 */
export type CreateIdeaGenerationRunInput = IdeaGenerationRunOwner & {
  /**
   * Optional application-generated run identifier.
   *
   * Supplying the ID lets the orchestrator create the initial context before
   * the database insert so the QUEUED row and its recovery checkpoint are
   * persisted atomically.
   */
  id?: string;

  /**
   * Authorized generation type selected by the policy layer.
   */
  generationType: IdeaGenerationType;

  /**
   * Optional collection job already associated with the run.
   */
  collectionJobId?: string | null;

  /**
   * Optional durable context available from the moment the run is queued.
   */
  contextSnapshot?: Prisma.InputJsonValue;
};

/**
 * Input used to update the current pipeline stage and overall
 * run progress.
 *
 * @author Malak
 */
export type UpdateIdeaGenerationRunProgressInput = {
  /**
   * Generation-run identifier.
   */
  runId: string;

  /**
   * Stable key of the pipeline stage currently executing.
   */
  currentStageKey: string;

  /**
   * Overall progress percentage between 0 and 100.
   */
  progressPercent: number;
};

/**
 * Input used to mark a generation run as failed.
 *
 * @author Malak
 */
export type FailIdeaGenerationRunInput = {
  /**
   * Generation-run identifier.
   */
  runId: string;

  /**
   * Stable machine-readable failure code.
   */
  errorCode: string;

  /**
   * Safe error message that may be exposed through run status
   * endpoints.
   */
  errorMessage: string;
};

/**
 * Input used to attach generated resources to a run.
 *
 * The method accepts only resources that exist in the current
 * Prisma model:
 * - Idea.
 * - CollectionJob.
 *
 * @author Malak
 */
export type AttachIdeaGenerationRunResourcesInput = {
  /**
   * Generation-run identifier.
   */
  runId: string;

  /**
   * Optional generated idea identifier.
   */
  ideaId?: string;

  /**
   * Optional collection-job identifier.
   */
  collectionJobId?: string;
};

/**
 * Lightweight generation-run cancellation state.
 *
 * @author Malak
 */
export type IdeaGenerationCancellationState = {
  /**
   * Indicates whether cancellation was requested.
   */
  isCancellationRequested: boolean;

  /**
   * Timestamp at which cancellation was requested.
   */
  cancelRequestedAt: Date | null;

  /**
   * Current generation-run status.
   */
  status: IdeaGenerationRunStatus;
};

/**
 * Service responsible for managing the complete lifecycle of an
 * idea-generation run.
 *
 * Responsibilities:
 * - Create queued generation runs.
 * - Start queued generation runs.
 * - Track the active pipeline stage and overall progress.
 * - Update heartbeat timestamps.
 * - Attach collection jobs and generated ideas.
 * - Record cancellation requests.
 * - Mark runs as completed, failed or cancelled.
 * - Protect terminal runs from invalid state transitions.
 *
 * This service does not:
 * - Execute pipeline stages.
 * - Generate ideas.
 * - Deduct credits.
 * - Consume guest-generation eligibility.
 * - Release generation locks.
 *
 * Those responsibilities belong to the generation orchestrator
 * and specialized domain services.
 *
 * @author Malak
 */
@Injectable()
export class IdeaGenerationRunService {
  /**
   * Statuses after which a generation run must no longer be
   * modified through normal lifecycle methods.
   */
  private readonly terminalStatuses = new Set<IdeaGenerationRunStatus>([
    IdeaGenerationRunStatus.COMPLETED,
    IdeaGenerationRunStatus.FAILED,
    IdeaGenerationRunStatus.CANCELLED,
  ]);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a queued generation run.
   *
   * The run is created before expensive pipeline work starts so
   * its identifier can be used by:
   * - Generation locking.
   * - Progress tracking.
   * - Cancellation requests.
   * - Monitoring.
   *
   * @param input Owner and generation configuration.
   * @param db Optional transaction-aware Prisma client.
   * @returns Newly created queued run.
   */
  async createRun(
    input: CreateIdeaGenerationRunInput,
    db: IdeaGenerationRunDatabaseClient = this.prisma,
  ): Promise<IdeaGenerationRun> {
    this.validateOwner(input);
    this.validateGenerationTypeForOwner(input);

    return db.ideaGenerationRun.create({
      data: {
        ...(input.id
          ? {
              id: this.normalizeRequiredValue(
                input.id,
                'Generation-run ID',
              ),
            }
          : {}),
        userId: input.userId ?? null,
        guestSessionId: input.guestSessionId ?? null,
        generationType: input.generationType,
        collectionJobId: input.collectionJobId ?? null,
        status: IdeaGenerationRunStatus.QUEUED,
        progressPercent: 0,
        currentStageKey: null,
        lastHeartbeatAt: null,
        cancelRequestedAt: null,
        startedAt: null,
        completedAt: null,
        errorCode: null,
        errorMessage: null,
        ...(input.contextSnapshot !== undefined
          ? { contextSnapshot: input.contextSnapshot }
          : {}),
      },
    });
  }

  /**
   * Retrieves a generation run by its identifier.
   *
   * @param runId Generation-run identifier.
   * @param db Optional transaction-aware Prisma client.
   * @returns Existing generation run.
   * @throws NotFoundException when the run does not exist.
   */
  async findRunOrThrow(
    runId: string,
    db: IdeaGenerationRunDatabaseClient = this.prisma,
  ): Promise<IdeaGenerationRun> {
    const normalizedRunId = this.normalizeRequiredValue(
      runId,
      'Generation-run ID',
    );

    const run = await db.ideaGenerationRun.findUnique({
      where: {
        id: normalizedRunId,
      },
    });

    if (!run) {
      throw new NotFoundException({
        code: 'IDEA_GENERATION_RUN_NOT_FOUND',
        message: 'The requested idea-generation run was not found.',
      });
    }

    return run;
  }

  /**
   * Starts a queued generation run.
   *
   * The conditional update prevents:
   * - Starting the same run twice.
   * - Starting a cancelled run.
   * - Restarting a completed or failed run.
   *
   * @param runId Generation-run identifier.
   * @returns Updated running generation run.
   */
  async startRun(runId: string): Promise<IdeaGenerationRun> {
    const normalizedRunId = this.normalizeRequiredValue(
      runId,
      'Generation-run ID',
    );

    const now = new Date();

    try {
      return await this.prisma.ideaGenerationRun.update({
        where: {
          id: normalizedRunId,
          status: {
            in: [
              IdeaGenerationRunStatus.QUEUED,
              IdeaGenerationRunStatus.RETRYING,
              IdeaGenerationRunStatus.PAUSED,
            ],
          },
          cancelRequestedAt: null,
        },
        data: {
          status: IdeaGenerationRunStatus.RUNNING,
          startedAt: now,
          lastHeartbeatAt: now,
          nextRetryAt: null,
          pausedAt: null,
          errorCode: null,
          errorMessage: null,
        },
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        await this.throwStartFailure(normalizedRunId);
      }
      throw error;
    }
  }

  /**
   * Updates the pipeline stage and overall progress of a running
   * generation run.
   *
   * Progress is accepted only between 0 and 99. Completion must
   * be recorded through completeRun(), which sets progress to
   * 100 and applies the correct terminal status.
   *
   * @param input Current stage and progress data.
   * @returns Updated running generation run.
   */
  async updateProgress(
    input: UpdateIdeaGenerationRunProgressInput,
  ): Promise<IdeaGenerationRun> {
    const runId = this.normalizeRequiredValue(input.runId, 'Generation-run ID');

    const currentStageKey = this.normalizeRequiredValue(
      input.currentStageKey,
      'Current stage key',
    );

    this.validateRunningProgress(input.progressPercent);

    const result = await this.prisma.ideaGenerationRun.updateMany({
      where: {
        id: runId,
        status: IdeaGenerationRunStatus.RUNNING,
        cancelRequestedAt: null,
      },
      data: {
        currentStageKey,
        progressPercent: input.progressPercent,
        lastHeartbeatAt: new Date(),
      },
    });

    if (result.count !== 1) {
      await this.throwRunningUpdateFailure(runId);
    }

    return this.findRunOrThrow(runId);
  }

  /**
   * Updates the heartbeat timestamp of an active generation run.
   *
   * Heartbeats allow monitoring or recovery services to detect
   * runs that remain RUNNING but stopped making progress.
   *
   * @param runId Generation-run identifier.
   * @returns True when the heartbeat was updated.
   */
  async heartbeat(runId: string): Promise<boolean> {
    const normalizedRunId = this.normalizeRequiredValue(
      runId,
      'Generation-run ID',
    );

    const result = await this.prisma.ideaGenerationRun.updateMany({
      where: {
        id: normalizedRunId,
        status: IdeaGenerationRunStatus.RUNNING,
        cancelRequestedAt: null,

        /*
         * Do not touch IdeaGenerationRun while the serializable persistence
         * transaction is validating and attaching the new idea. The pipeline
         * synchronously sets currentStageKey before entering persistence, so
         * skipping this one heartbeat window removes a write/write conflict
         * without weakening stale-run detection: persistence is bounded and
         * the owner lock continues to refresh independently.
         */
        OR: [
          { currentStageKey: null },
          {
            currentStageKey: {
              not: IDEA_GENERATION_STAGE_KEYS.IDEA_PERSISTENCE,
            },
          },
        ],
      },
      data: {
        lastHeartbeatAt: new Date(),
      },
    });

    return result.count === 1;
  }

  /**
   * Attaches an idea and/or collection job to a non-terminal run.
   *
   * This method is transaction-aware so resource creation and run
   * linkage can be committed atomically.
   *
   * @param input Resource identifiers to attach.
   * @param db Optional transaction-aware Prisma client.
   * @returns Updated generation run.
   */
  async attachResources(
    input: AttachIdeaGenerationRunResourcesInput,
    db: IdeaGenerationRunDatabaseClient = this.prisma,
  ): Promise<IdeaGenerationRun> {
    const runId = this.normalizeRequiredValue(input.runId, 'Generation-run ID');

    if (input.ideaId === undefined && input.collectionJobId === undefined) {
      throw new BadRequestException({
        code: 'IDEA_GENERATION_RESOURCES_REQUIRED',
        message: 'At least one generation resource must be provided.',
      });
    }

    const run = await this.findRunOrThrow(runId, db);

    this.assertNotTerminal(run);

    return db.ideaGenerationRun.update({
      where: {
        id: run.id,
      },
      data: {
        ...(input.ideaId !== undefined
          ? {
              ideaId: this.normalizeRequiredValue(input.ideaId, 'Idea ID'),
            }
          : {}),

        ...(input.collectionJobId !== undefined
          ? {
              collectionJobId: this.normalizeRequiredValue(
                input.collectionJobId,
                'Collection-job ID',
              ),
            }
          : {}),
      },
    });
  }

  /**
   * Records a cancellation request for a queued or running run.
   *
   * This method does not immediately mark the run as CANCELLED.
   * The orchestrator detects the request between pipeline stages,
   * performs stage cleanup and then calls cancelRun().
   *
   * Repeated cancellation requests are idempotent.
   *
   * @param runId Generation-run identifier.
   * @returns Current generation run.
   */
  async requestCancellation(runId: string): Promise<IdeaGenerationRun> {
    const normalizedRunId = this.normalizeRequiredValue(
      runId,
      'Generation-run ID',
    );

    const run = await this.findRunOrThrow(normalizedRunId);

    if (this.terminalStatuses.has(run.status)) {
      return run;
    }

    if (run.cancelRequestedAt) {
      return run;
    }

    await this.prisma.ideaGenerationRun.updateMany({
      where: {
        id: normalizedRunId,
        status: {
          in: [IdeaGenerationRunStatus.QUEUED, IdeaGenerationRunStatus.RUNNING],
        },
        cancelRequestedAt: null,
      },
      data: {
        cancelRequestedAt: new Date(),
      },
    });

    return this.findRunOrThrow(normalizedRunId);
  }

  /**
   * Returns the cancellation state of a generation run.
   *
   * The orchestrator may call this method:
   * - Before starting a stage.
   * - After completing a stage.
   * - Before expensive external API calls.
   *
   * @param runId Generation-run identifier.
   */
  async getCancellationState(
    runId: string,
  ): Promise<IdeaGenerationCancellationState> {
    const normalizedRunId = this.normalizeRequiredValue(
      runId,
      'Generation-run ID',
    );

    const run = await this.prisma.ideaGenerationRun.findUnique({
      where: {
        id: normalizedRunId,
      },
      select: {
        status: true,
        cancelRequestedAt: true,
      },
    });

    if (!run) {
      throw new NotFoundException({
        code: 'IDEA_GENERATION_RUN_NOT_FOUND',
        message: 'The requested idea-generation run was not found.',
      });
    }

    return {
      isCancellationRequested:
        run.cancelRequestedAt !== null ||
        run.status === IdeaGenerationRunStatus.CANCELLED,
      cancelRequestedAt: run.cancelRequestedAt,
      status: run.status,
    };
  }

  /**
   * Returns whether cancellation has been requested.
   *
   * @param runId Generation-run identifier.
   */
  async isCancellationRequested(runId: string): Promise<boolean> {
    const state = await this.getCancellationState(runId);

    return state.isCancellationRequested;
  }

  /**
   * Marks a running generation run as successfully completed.
   *
   * Completion:
   * - Sets status to COMPLETED.
   * - Sets progress to 100.
   * - Clears the current stage.
   * - Records completion and heartbeat timestamps.
   * - Clears previous error information.
   *
   * @param runId Generation-run identifier.
   * @param db Optional transaction-aware Prisma client.
   * @returns Completed generation run.
   */
  async completeRun(
    runId: string,
    db: IdeaGenerationRunDatabaseClient = this.prisma,
  ): Promise<IdeaGenerationRun> {
    const normalizedRunId = this.normalizeRequiredValue(
      runId,
      'Generation-run ID',
    );

    const now = new Date();

    try {
      return await db.ideaGenerationRun.update({
        where: {
          id: normalizedRunId,
          status: {
            in: [
              IdeaGenerationRunStatus.RUNNING,
              IdeaGenerationRunStatus.RETRYING,
            ],
          },
          cancelRequestedAt: null,
        },
        data: {
          status: IdeaGenerationRunStatus.COMPLETED,
          progressPercent: 100,
          currentStageKey: null,
          completedAt: now,
          lastHeartbeatAt: now,
          errorCode: null,
          errorMessage: null,
        },
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        await this.throwCompletionFailure(normalizedRunId, db);
      }
      throw error;
    }
  }

  /**
   * Marks a queued or running generation run as failed.
   *
   * Failure information should be safe for persistence and
   * exposure through status endpoints. Internal stack traces must
   * remain in application logs and must not be stored here.
   *
   * @param input Safe failure information.
   * @param db Optional transaction-aware Prisma client.
   * @returns Failed generation run.
   */
  async failRun(
    input: FailIdeaGenerationRunInput,
    db: IdeaGenerationRunDatabaseClient = this.prisma,
  ): Promise<IdeaGenerationRun> {
    const runId = this.normalizeRequiredValue(input.runId, 'Generation-run ID');

    const errorCode = this.normalizeRequiredValue(
      input.errorCode,
      'Generation error code',
    );

    const errorMessage = this.normalizeRequiredValue(
      input.errorMessage,
      'Generation error message',
    );

    const run = await this.findRunOrThrow(runId, db);

    if (run.status === IdeaGenerationRunStatus.FAILED) {
      return run;
    }

    if (
      run.status !== IdeaGenerationRunStatus.QUEUED &&
      run.status !== IdeaGenerationRunStatus.RUNNING &&
      run.status !== IdeaGenerationRunStatus.RETRYING &&
      run.status !== IdeaGenerationRunStatus.PAUSED
    ) {
      throw new ConflictException({
        code: 'IDEA_GENERATION_RUN_CANNOT_FAIL',
        message: `The generation run cannot be marked as failed from status ${run.status}.`,
      });
    }

    const now = new Date();

    const result = await db.ideaGenerationRun.updateMany({
      where: {
        id: runId,
        status: run.status,
      },
      data: {
        status: IdeaGenerationRunStatus.FAILED,
        currentStageKey: null,
        errorCode,
        errorMessage,
        startedAt: run.startedAt ?? now,
        completedAt: now,
        lastHeartbeatAt: now,
      },
    });

    if (result.count !== 1) {
      const latestRun = await this.findRunOrThrow(runId, db);

      if (latestRun.status === IdeaGenerationRunStatus.FAILED) {
        return latestRun;
      }

      throw new ConflictException({
        code: 'IDEA_GENERATION_RUN_CANNOT_FAIL',
        message: `The generation run changed status while being marked as failed. Current status: ${latestRun.status}.`,
      });
    }

    return this.findRunOrThrow(runId, db);
  }

  /** Persists the latest complete pipeline context as a durable checkpoint. */
  async saveContextCheckpoint(
    runId: string,
    context: Prisma.InputJsonValue,
    db: IdeaGenerationRunDatabaseClient = this.prisma,
  ): Promise<IdeaGenerationRun> {
    const normalizedRunId = this.normalizeRequiredValue(
      runId,
      'Generation-run ID',
    );

    return db.ideaGenerationRun.update({
      where: { id: normalizedRunId },
      data: {
        contextSnapshot: context,
        lastHeartbeatAt: new Date(),
      },
    });
  }

  /** Moves an active run into RETRYING after a transient infrastructure error. */
  async markRetrying(
    runId: string,
    errorMessage: string,
    nextRetryAt: Date,
    incrementRetryCount = true,
  ): Promise<IdeaGenerationRun> {
    const normalizedRunId = this.normalizeRequiredValue(
      runId,
      'Generation-run ID',
    );

    const now = new Date();

    const result = await this.prisma.ideaGenerationRun.updateMany({
      where: {
        id: normalizedRunId,
        status: {
          in: [
            IdeaGenerationRunStatus.RUNNING,
            IdeaGenerationRunStatus.RETRYING,
            IdeaGenerationRunStatus.PAUSED,
          ],
        },
        completedAt: null,
      },
      data: {
        status: IdeaGenerationRunStatus.RETRYING,
        /*
         * Preserve the original execution start time. Resetting startedAt on
         * every infrastructure interruption corrupts duration metrics and can
         * make heartbeat ordering harder to reason about.
         */
        completedAt: null,
        errorCode: 'TRANSIENT_DATABASE_FAILURE',
        errorMessage,
        nextRetryAt,
        pausedAt: null,
        ...(incrementRetryCount
          ? { retryCount: { increment: 1 } }
          : {}),
        lastHeartbeatAt: now,
      },
    });

    if (result.count !== 1) {
      await this.throwRunningUpdateFailure(normalizedRunId);
    }

    return this.findRunOrThrow(normalizedRunId);
  }

  /** Pauses a run after automatic retries have been exhausted. */
  async pauseRun(
    runId: string,
    errorMessage: string,
    nextRetryAt: Date | null,
  ): Promise<IdeaGenerationRun> {
    const normalizedRunId = this.normalizeRequiredValue(
      runId,
      'Generation-run ID',
    );

    const now = new Date();

    const result = await this.prisma.ideaGenerationRun.updateMany({
      where: {
        id: normalizedRunId,
        status: {
          in: [
            IdeaGenerationRunStatus.RUNNING,
            IdeaGenerationRunStatus.RETRYING,
            IdeaGenerationRunStatus.PAUSED,
          ],
        },
        completedAt: null,
      },
      data: {
        status: IdeaGenerationRunStatus.PAUSED,
        completedAt: null,
        errorCode: 'GENERATION_PAUSED_TRANSIENT_FAILURE',
        errorMessage,
        nextRetryAt,
        pausedAt: now,
        lastHeartbeatAt: now,
      },
    });

    if (result.count !== 1) {
      await this.throwRunningUpdateFailure(normalizedRunId);
    }

    return this.findRunOrThrow(normalizedRunId);
  }

  /**
   * Lightweight guard used by the background recovery scanner.
   *
   * Recovery must not compete with a user-facing pipeline for the same
   * Prisma/Supabase connection pool.
   */
  async hasActiveRuns(): Promise<boolean> {
    const activeRun = await this.prisma.ideaGenerationRun.findFirst({
      where: {
        status: IdeaGenerationRunStatus.RUNNING,
        cancelRequestedAt: null,
      },
      select: { id: true },
    });

    return activeRun !== null;
  }

  /**
   * Converts orphaned RUNNING rows into RETRYING after their heartbeat has
   * remained stale long enough to rule out normal in-flight stages.
   *
   * This is used after a process/server interruption. It never touches runs
   * without a durable context checkpoint.
   */
  async requeueStaleRunningRuns(
    staleBefore: Date,
    limit = 5,
    excludedRunIds: readonly string[] = [],
  ): Promise<number> {
    const candidates = await this.prisma.ideaGenerationRun.findMany({
      where: {
        ...(excludedRunIds.length > 0
          ? { id: { notIn: [...excludedRunIds] } }
          : {}),
        status: IdeaGenerationRunStatus.RUNNING,
        completedAt: null,
        cancelRequestedAt: null,
        OR: [
          { lastHeartbeatAt: { lte: staleBefore } },
          { lastHeartbeatAt: null, updatedAt: { lte: staleBefore } },
        ],
      },
      select: {
        id: true,
        contextSnapshot: true,
      },
      orderBy: { updatedAt: 'asc' },
      take: Math.max(5, Math.min(limit * 4, 80)),
    });

    const recoverableIds = candidates
      .filter(({ contextSnapshot }) => this.hasContextSnapshot(contextSnapshot))
      .slice(0, Math.max(1, Math.min(limit, 20)))
      .map(({ id }) => id);

    if (recoverableIds.length === 0) {
      return 0;
    }

    const result = await this.prisma.ideaGenerationRun.updateMany({
      where: {
        id: { in: recoverableIds },
        status: IdeaGenerationRunStatus.RUNNING,
        completedAt: null,
        cancelRequestedAt: null,
      },
      data: {
        status: IdeaGenerationRunStatus.RETRYING,
        nextRetryAt: new Date(),
        pausedAt: null,
        errorCode: 'GENERATION_PROCESS_INTERRUPTED',
        errorMessage:
          'The generation process was interrupted. Automatic checkpoint recovery is resuming it.',
        retryCount: { increment: 1 },
      },
    });

    return result.count;
  }

  /**
   * Marks stale legacy QUEUED/RUNNING rows without a recovery snapshot as
   * failed. New runs always persist their initial context atomically, so this
   * cleanup only prevents old orphaned rows from remaining stuck forever.
   */
  async failStaleUnrecoverableRuns(
    staleBefore: Date,
    limit = 20,
    excludedRunIds: readonly string[] = [],
  ): Promise<number> {
    const candidates = await this.prisma.ideaGenerationRun.findMany({
      where: {
        ...(excludedRunIds.length > 0
          ? { id: { notIn: [...excludedRunIds] } }
          : {}),
        status: {
          in: [
            IdeaGenerationRunStatus.QUEUED,
            IdeaGenerationRunStatus.RUNNING,
          ],
        },
        completedAt: null,
        cancelRequestedAt: null,
        OR: [
          {
            status: IdeaGenerationRunStatus.QUEUED,
            createdAt: { lte: staleBefore },
          },
          {
            status: IdeaGenerationRunStatus.RUNNING,
            OR: [
              { lastHeartbeatAt: { lte: staleBefore } },
              { lastHeartbeatAt: null, updatedAt: { lte: staleBefore } },
            ],
          },
        ],
      },
      select: {
        id: true,
        status: true,
        startedAt: true,
        createdAt: true,
        contextSnapshot: true,
      },
      orderBy: { updatedAt: 'asc' },
      take: Math.max(1, Math.min(limit, 100)),
    });

    const orphaned = candidates.filter(
      ({ contextSnapshot }) => !this.hasContextSnapshot(contextSnapshot),
    );

    if (orphaned.length === 0) {
      return 0;
    }

    let failedCount = 0;

    for (const candidate of orphaned) {
      const result = await this.prisma.ideaGenerationRun.updateMany({
        where: {
          id: candidate.id,
          status: candidate.status,
          completedAt: null,
          cancelRequestedAt: null,
        },
        data: {
          status: IdeaGenerationRunStatus.FAILED,
          currentStageKey: null,
          // FAILED rows must always have startedAt according to the database
          // lifecycle constraint. Legacy QUEUED rows never had one, so use
          // their creation timestamp as the durable lifecycle start.
          startedAt: candidate.startedAt ?? candidate.createdAt,
          completedAt: new Date(),
          lastHeartbeatAt: new Date(),
          errorCode: 'GENERATION_RECOVERY_CHECKPOINT_MISSING',
          errorMessage:
            'The server stopped before a recoverable generation checkpoint was persisted. Please start the generation again.',
        },
      });

      failedCount += result.count;
    }

    return failedCount;
  }

  /** Returns queued/paused/retrying runs that are ready for recovery. */
  async findRecoverableRuns(
    limit = 20,
    queuedBefore = new Date(Date.now() - 30_000),
  ): Promise<IdeaGenerationRun[]> {
    const now = new Date();

    const candidates = await this.prisma.ideaGenerationRun.findMany({
      where: {
        completedAt: null,
        cancelRequestedAt: null,
        OR: [
          {
            status: IdeaGenerationRunStatus.QUEUED,
            createdAt: { lte: queuedBefore },
          },
          {
            status: IdeaGenerationRunStatus.RETRYING,
            OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
          },
          {
            status: IdeaGenerationRunStatus.PAUSED,
            nextRetryAt: { lte: now },
          },
        ],
      },
      orderBy: { updatedAt: 'asc' },
      take: Math.max(5, Math.min(limit * 4, 100)),
    });

    return candidates
      .filter(({ contextSnapshot }) => this.hasContextSnapshot(contextSnapshot))
      .slice(0, Math.max(1, Math.min(limit, 100)));
  }

  /** Checks whether one Prisma JSON field contains a usable context object. */
  private hasContextSnapshot(value: Prisma.JsonValue | null): boolean {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  /**
   * Marks a queued or running run as cancelled.
   *
   * This method should be called by the orchestrator after
   * cancellation-aware cleanup has completed.
   *
   * @param runId Generation-run identifier.
   * @param db Optional transaction-aware Prisma client.
   * @returns Cancelled generation run.
   */
  async cancelRun(
    runId: string,
    db: IdeaGenerationRunDatabaseClient = this.prisma,
  ): Promise<IdeaGenerationRun> {
    const normalizedRunId = this.normalizeRequiredValue(
      runId,
      'Generation-run ID',
    );

    const run = await this.findRunOrThrow(normalizedRunId, db);

    if (run.status === IdeaGenerationRunStatus.CANCELLED) {
      return run;
    }

    if (
      run.status !== IdeaGenerationRunStatus.QUEUED &&
      run.status !== IdeaGenerationRunStatus.RUNNING &&
      run.status !== IdeaGenerationRunStatus.RETRYING &&
      run.status !== IdeaGenerationRunStatus.PAUSED
    ) {
      throw new ConflictException({
        code: 'IDEA_GENERATION_RUN_CANNOT_CANCEL',
        message: `The generation run cannot be cancelled from status ${run.status}.`,
      });
    }

    const now = new Date();

    const result = await db.ideaGenerationRun.updateMany({
      where: {
        id: normalizedRunId,
        status: run.status,
      },
      data: {
        status: IdeaGenerationRunStatus.CANCELLED,
        currentStageKey: null,
        cancelRequestedAt: run.cancelRequestedAt ?? now,
        startedAt: run.startedAt ?? now,
        completedAt: now,
        lastHeartbeatAt: now,
        errorCode: null,
        errorMessage: null,
      },
    });

    if (result.count !== 1) {
      const latestRun = await this.findRunOrThrow(normalizedRunId, db);

      if (latestRun.status === IdeaGenerationRunStatus.CANCELLED) {
        return latestRun;
      }

      throw new ConflictException({
        code: 'IDEA_GENERATION_RUN_CANNOT_CANCEL',
        message: `The generation run changed status while being cancelled. Current status: ${latestRun.status}.`,
      });
    }

    return this.findRunOrThrow(normalizedRunId, db);
  }

  /**
   * Validates that exactly one generation-run owner exists.
   */
  private validateOwner(input: CreateIdeaGenerationRunInput): void {
    const hasUserId =
      typeof input.userId === 'string' && input.userId.trim().length > 0;

    const hasGuestSessionId =
      typeof input.guestSessionId === 'string' &&
      input.guestSessionId.trim().length > 0;

    if (hasUserId === hasGuestSessionId) {
      throw new BadRequestException({
        code: 'INVALID_IDEA_GENERATION_RUN_OWNER',
        message: 'Exactly one generation-run owner must be provided.',
      });
    }
  }

  /**
   * Validates that the generation type matches its owner.
   */
  private validateGenerationTypeForOwner(
    input: CreateIdeaGenerationRunInput,
  ): void {
    const isGuestRun = input.guestSessionId !== undefined;

    if (isGuestRun && input.generationType !== IdeaGenerationType.GUEST_FREE) {
      throw new BadRequestException({
        code: 'INVALID_GUEST_GENERATION_TYPE',
        message: 'Guest sessions may only use GUEST_FREE generation.',
      });
    }

    if (!isGuestRun && input.generationType === IdeaGenerationType.GUEST_FREE) {
      throw new BadRequestException({
        code: 'INVALID_USER_GENERATION_TYPE',
        message: 'Registered users cannot use GUEST_FREE generation.',
      });
    }
  }

  /**
   * Prevents modification of terminal generation runs.
   */
  private assertNotTerminal(run: IdeaGenerationRun): void {
    if (!this.terminalStatuses.has(run.status)) {
      return;
    }

    throw new ConflictException({
      code: 'IDEA_GENERATION_RUN_ALREADY_TERMINAL',
      message: `The generation run is already in terminal status ${run.status}.`,
    });
  }

  /**
   * Validates a progress value used while a run is active.
   */
  private validateRunningProgress(progressPercent: number): void {
    if (
      !Number.isInteger(progressPercent) ||
      progressPercent < 0 ||
      progressPercent > 99
    ) {
      throw new BadRequestException({
        code: 'INVALID_IDEA_GENERATION_PROGRESS',
        message:
          'Running generation progress must be an integer between 0 and 99.',
      });
    }
  }

  /**
   * Determines why a queued run could not start.
   */
  private async throwStartFailure(runId: string): Promise<never> {
    const run = await this.findRunOrThrow(runId);

    if (run.cancelRequestedAt) {
      throw new ConflictException({
        code: 'IDEA_GENERATION_CANCELLATION_REQUESTED',
        message:
          'The generation run cannot start because cancellation was requested.',
      });
    }

    throw new ConflictException({
      code: 'IDEA_GENERATION_RUN_CANNOT_START',
      message: `The generation run cannot start from status ${run.status}.`,
    });
  }

  /**
   * Determines why a running-run update could not be applied.
   */
  private async throwRunningUpdateFailure(runId: string): Promise<never> {
    const run = await this.findRunOrThrow(runId);

    if (run.cancelRequestedAt) {
      throw new ConflictException({
        code: 'IDEA_GENERATION_CANCELLATION_REQUESTED',
        message: 'The generation run has a pending cancellation request.',
      });
    }

    throw new ConflictException({
      code: 'IDEA_GENERATION_RUN_NOT_RUNNING',
      message: `The generation run is not active. Current status: ${run.status}.`,
    });
  }

  /**
   * Determines why a run could not be completed.
   */
  private async throwCompletionFailure(
    runId: string,
    db: IdeaGenerationRunDatabaseClient,
  ): Promise<never> {
    const run = await this.findRunOrThrow(runId, db);

    if (run.cancelRequestedAt) {
      throw new ConflictException({
        code: 'IDEA_GENERATION_CANCELLATION_REQUESTED',
        message:
          'The generation run cannot complete because cancellation was requested.',
      });
    }

    throw new ConflictException({
      code: 'IDEA_GENERATION_RUN_CANNOT_COMPLETE',
      message: `The generation run cannot complete from status ${run.status}.`,
    });
  }

  /**
   * Trims and validates required string values.
   */
  private normalizeRequiredValue(value: string, fieldName: string): string {
    const normalizedValue = value?.trim();

    if (!normalizedValue) {
      throw new BadRequestException({
        code: 'INVALID_IDEA_GENERATION_VALUE',
        message: `${fieldName} is required.`,
      });
    }

    return normalizedValue;
  }
}