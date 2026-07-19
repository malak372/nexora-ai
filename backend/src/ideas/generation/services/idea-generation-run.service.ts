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
type IdeaGenerationRunDatabaseClient =
  | PrismaService
  | Prisma.TransactionClient;

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
export type CreateIdeaGenerationRunInput =
  IdeaGenerationRunOwner & {
    /**
     * Authorized generation type selected by the policy layer.
     */
    generationType: IdeaGenerationType;

    /**
     * Optional collection job already associated with the run.
     */
    collectionJobId?: string | null;
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
  private readonly terminalStatuses =
    new Set<IdeaGenerationRunStatus>([
      IdeaGenerationRunStatus.COMPLETED,
      IdeaGenerationRunStatus.FAILED,
      IdeaGenerationRunStatus.CANCELLED,
    ]);

  constructor(
    private readonly prisma: PrismaService,
  ) {}

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
        userId: input.userId ?? null,
        guestSessionId:
          input.guestSessionId ?? null,
        generationType: input.generationType,
        collectionJobId:
          input.collectionJobId ?? null,
        status: IdeaGenerationRunStatus.QUEUED,
        progressPercent: 0,
        currentStageKey: null,
        lastHeartbeatAt: null,
        cancelRequestedAt: null,
        startedAt: null,
        completedAt: null,
        errorCode: null,
        errorMessage: null,
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
    const normalizedRunId =
      this.normalizeRequiredValue(
        runId,
        'Generation-run ID',
      );

    const run =
      await db.ideaGenerationRun.findUnique({
        where: {
          id: normalizedRunId,
        },
      });

    if (!run) {
      throw new NotFoundException({
        code: 'IDEA_GENERATION_RUN_NOT_FOUND',
        message:
          'The requested idea-generation run was not found.',
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
  async startRun(
    runId: string,
  ): Promise<IdeaGenerationRun> {
    const normalizedRunId =
      this.normalizeRequiredValue(
        runId,
        'Generation-run ID',
      );

    const now = new Date();

    const result =
      await this.prisma.ideaGenerationRun.updateMany({
        where: {
          id: normalizedRunId,
          status: IdeaGenerationRunStatus.QUEUED,
          cancelRequestedAt: null,
        },
        data: {
          status: IdeaGenerationRunStatus.RUNNING,
          startedAt: now,
          lastHeartbeatAt: now,
          progressPercent: 0,
          errorCode: null,
          errorMessage: null,
        },
      });

    if (result.count !== 1) {
      await this.throwStartFailure(normalizedRunId);
    }

    return this.findRunOrThrow(normalizedRunId);
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
    const runId = this.normalizeRequiredValue(
      input.runId,
      'Generation-run ID',
    );

    const currentStageKey =
      this.normalizeRequiredValue(
        input.currentStageKey,
        'Current stage key',
      );

    this.validateRunningProgress(
      input.progressPercent,
    );

    const result =
      await this.prisma.ideaGenerationRun.updateMany({
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
    const normalizedRunId =
      this.normalizeRequiredValue(
        runId,
        'Generation-run ID',
      );

    const result =
      await this.prisma.ideaGenerationRun.updateMany({
        where: {
          id: normalizedRunId,
          status: IdeaGenerationRunStatus.RUNNING,
          cancelRequestedAt: null,
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
    const runId = this.normalizeRequiredValue(
      input.runId,
      'Generation-run ID',
    );

    if (
      input.ideaId === undefined &&
      input.collectionJobId === undefined
    ) {
      throw new BadRequestException({
        code:
          'IDEA_GENERATION_RESOURCES_REQUIRED',
        message:
          'At least one generation resource must be provided.',
      });
    }

    const run = await this.findRunOrThrow(
      runId,
      db,
    );

    this.assertNotTerminal(run);

    return db.ideaGenerationRun.update({
      where: {
        id: run.id,
      },
      data: {
        ...(input.ideaId !== undefined
          ? {
              ideaId: this.normalizeRequiredValue(
                input.ideaId,
                'Idea ID',
              ),
            }
          : {}),

        ...(input.collectionJobId !== undefined
          ? {
              collectionJobId:
                this.normalizeRequiredValue(
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
  async requestCancellation(
    runId: string,
  ): Promise<IdeaGenerationRun> {
    const normalizedRunId =
      this.normalizeRequiredValue(
        runId,
        'Generation-run ID',
      );

    const run = await this.findRunOrThrow(
      normalizedRunId,
    );

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
          in: [
            IdeaGenerationRunStatus.QUEUED,
            IdeaGenerationRunStatus.RUNNING,
          ],
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
    const normalizedRunId =
      this.normalizeRequiredValue(
        runId,
        'Generation-run ID',
      );

    const run =
      await this.prisma.ideaGenerationRun.findUnique({
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
        message:
          'The requested idea-generation run was not found.',
      });
    }

    return {
      isCancellationRequested:
        run.cancelRequestedAt !== null ||
        run.status ===
          IdeaGenerationRunStatus.CANCELLED,
      cancelRequestedAt: run.cancelRequestedAt,
      status: run.status,
    };
  }

  /**
   * Returns whether cancellation has been requested.
   *
   * @param runId Generation-run identifier.
   */
  async isCancellationRequested(
    runId: string,
  ): Promise<boolean> {
    const state =
      await this.getCancellationState(runId);

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
    const normalizedRunId =
      this.normalizeRequiredValue(
        runId,
        'Generation-run ID',
      );

    const now = new Date();

    const result =
      await db.ideaGenerationRun.updateMany({
        where: {
          id: normalizedRunId,
          status: IdeaGenerationRunStatus.RUNNING,
          cancelRequestedAt: null,
        },
        data: {
          status:
            IdeaGenerationRunStatus.COMPLETED,
          progressPercent: 100,
          currentStageKey: null,
          completedAt: now,
          lastHeartbeatAt: now,
          errorCode: null,
          errorMessage: null,
        },
      });

    if (result.count !== 1) {
      await this.throwCompletionFailure(
        normalizedRunId,
        db,
      );
    }

    return this.findRunOrThrow(
      normalizedRunId,
      db,
    );
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
    const runId = this.normalizeRequiredValue(
      input.runId,
      'Generation-run ID',
    );

    const errorCode =
      this.normalizeRequiredValue(
        input.errorCode,
        'Generation error code',
      );

    const errorMessage =
      this.normalizeRequiredValue(
        input.errorMessage,
        'Generation error message',
      );

    const now = new Date();

    const result =
      await db.ideaGenerationRun.updateMany({
        where: {
          id: runId,
          status: {
            in: [
              IdeaGenerationRunStatus.QUEUED,
              IdeaGenerationRunStatus.RUNNING,
            ],
          },
        },
        data: {
          status: IdeaGenerationRunStatus.FAILED,
          currentStageKey: null,
          errorCode,
          errorMessage,
          completedAt: now,
          lastHeartbeatAt: now,
        },
      });

    if (result.count !== 1) {
      const run = await this.findRunOrThrow(
        runId,
        db,
      );

      if (
        run.status ===
        IdeaGenerationRunStatus.FAILED
      ) {
        return run;
      }

      throw new ConflictException({
        code:
          'IDEA_GENERATION_RUN_CANNOT_FAIL',
        message:
          `The generation run cannot be marked as failed from status ${run.status}.`,
      });
    }

    return this.findRunOrThrow(runId, db);
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
    const normalizedRunId =
      this.normalizeRequiredValue(
        runId,
        'Generation-run ID',
      );

    const now = new Date();

    const result =
      await db.ideaGenerationRun.updateMany({
        where: {
          id: normalizedRunId,
          status: {
            in: [
              IdeaGenerationRunStatus.QUEUED,
              IdeaGenerationRunStatus.RUNNING,
            ],
          },
        },
        data: {
          status:
            IdeaGenerationRunStatus.CANCELLED,
          currentStageKey: null,
          cancelRequestedAt: now,
          completedAt: now,
          lastHeartbeatAt: now,
          errorCode: null,
          errorMessage: null,
        },
      });

    if (result.count !== 1) {
      const run = await this.findRunOrThrow(
        normalizedRunId,
        db,
      );

      if (
        run.status ===
        IdeaGenerationRunStatus.CANCELLED
      ) {
        return run;
      }

      throw new ConflictException({
        code:
          'IDEA_GENERATION_RUN_CANNOT_CANCEL',
        message:
          `The generation run cannot be cancelled from status ${run.status}.`,
      });
    }

    return this.findRunOrThrow(
      normalizedRunId,
      db,
    );
  }

  /**
   * Validates that exactly one generation-run owner exists.
   */
  private validateOwner(
    input: CreateIdeaGenerationRunInput,
  ): void {
    const hasUserId =
      typeof input.userId === 'string' &&
      input.userId.trim().length > 0;

    const hasGuestSessionId =
      typeof input.guestSessionId === 'string' &&
      input.guestSessionId.trim().length > 0;

    if (hasUserId === hasGuestSessionId) {
      throw new BadRequestException({
        code:
          'INVALID_IDEA_GENERATION_RUN_OWNER',
        message:
          'Exactly one generation-run owner must be provided.',
      });
    }
  }

  /**
   * Validates that the generation type matches its owner.
   */
  private validateGenerationTypeForOwner(
    input: CreateIdeaGenerationRunInput,
  ): void {
    const isGuestRun =
      input.guestSessionId !== undefined;

    if (
      isGuestRun &&
      input.generationType !==
        IdeaGenerationType.GUEST_FREE
    ) {
      throw new BadRequestException({
        code:
          'INVALID_GUEST_GENERATION_TYPE',
        message:
          'Guest sessions may only use GUEST_FREE generation.',
      });
    }

    if (
      !isGuestRun &&
      input.generationType ===
        IdeaGenerationType.GUEST_FREE
    ) {
      throw new BadRequestException({
        code:
          'INVALID_USER_GENERATION_TYPE',
        message:
          'Registered users cannot use GUEST_FREE generation.',
      });
    }
  }

  /**
   * Prevents modification of terminal generation runs.
   */
  private assertNotTerminal(
    run: IdeaGenerationRun,
  ): void {
    if (!this.terminalStatuses.has(run.status)) {
      return;
    }

    throw new ConflictException({
      code:
        'IDEA_GENERATION_RUN_ALREADY_TERMINAL',
      message:
        `The generation run is already in terminal status ${run.status}.`,
    });
  }

  /**
   * Validates a progress value used while a run is active.
   */
  private validateRunningProgress(
    progressPercent: number,
  ): void {
    if (
      !Number.isInteger(progressPercent) ||
      progressPercent < 0 ||
      progressPercent > 99
    ) {
      throw new BadRequestException({
        code:
          'INVALID_IDEA_GENERATION_PROGRESS',
        message:
          'Running generation progress must be an integer between 0 and 99.',
      });
    }
  }

  /**
   * Determines why a queued run could not start.
   */
  private async throwStartFailure(
    runId: string,
  ): Promise<never> {
    const run = await this.findRunOrThrow(runId);

    if (run.cancelRequestedAt) {
      throw new ConflictException({
        code:
          'IDEA_GENERATION_CANCELLATION_REQUESTED',
        message:
          'The generation run cannot start because cancellation was requested.',
      });
    }

    throw new ConflictException({
      code: 'IDEA_GENERATION_RUN_CANNOT_START',
      message:
        `The generation run cannot start from status ${run.status}.`,
    });
  }

  /**
   * Determines why a running-run update could not be applied.
   */
  private async throwRunningUpdateFailure(
    runId: string,
  ): Promise<never> {
    const run = await this.findRunOrThrow(runId);

    if (run.cancelRequestedAt) {
      throw new ConflictException({
        code:
          'IDEA_GENERATION_CANCELLATION_REQUESTED',
        message:
          'The generation run has a pending cancellation request.',
      });
    }

    throw new ConflictException({
      code:
        'IDEA_GENERATION_RUN_NOT_RUNNING',
      message:
        `The generation run is not active. Current status: ${run.status}.`,
    });
  }

  /**
   * Determines why a run could not be completed.
   */
  private async throwCompletionFailure(
    runId: string,
    db: IdeaGenerationRunDatabaseClient,
  ): Promise<never> {
    const run = await this.findRunOrThrow(
      runId,
      db,
    );

    if (run.cancelRequestedAt) {
      throw new ConflictException({
        code:
          'IDEA_GENERATION_CANCELLATION_REQUESTED',
        message:
          'The generation run cannot complete because cancellation was requested.',
      });
    }

    throw new ConflictException({
      code:
        'IDEA_GENERATION_RUN_CANNOT_COMPLETE',
      message:
        `The generation run cannot complete from status ${run.status}.`,
    });
  }

  /**
   * Trims and validates required string values.
   */
  private normalizeRequiredValue(
    value: string,
    fieldName: string,
  ): string {
    const normalizedValue = value?.trim();

    if (!normalizedValue) {
      throw new BadRequestException({
        code:
          'INVALID_IDEA_GENERATION_VALUE',
        message: `${fieldName} is required.`,
      });
    }

    return normalizedValue;
  }
}