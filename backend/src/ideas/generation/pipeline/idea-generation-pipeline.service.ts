import { ConflictException, Injectable, Logger } from '@nestjs/common';

import {
  IdeaGenerationStageStatus,
  IdeaGenerationType,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';

import {
  getIdeaGenerationStageDefinitions,
  IDEA_GENERATION_STAGE_KEYS,
  type IdeaGenerationStageDefinition,
  type IdeaGenerationStageKey,
} from '../constants/idea-generation-stages.constants';

import type { IdeaGenerationStage } from '../interfaces/idea-generation-stage.interface';

import type { IdeaGenerationContext } from '../types/idea-generation-context.type';

import {
  IdeaGenerationCancelledError,
  IdeaGenerationStageService,
  type ExecuteIdeaGenerationStageResult,
} from './idea-generation-stage.service';

import { IdeaGenerationRunService } from '../services/idea-generation-run.service';
import { IdeaGenerationRealtimeService } from '../services/idea-generation-realtime.service';
import { IdeaGenerationDatabaseRetryService } from '../services/idea-generation-database-retry.service';
import {
  GENERATION_PAUSED_RETRY_DELAY_MS,
  IDEA_GENERATION_EXECUTION_DEADLINE_MS,
  IDEA_GENERATION_FINALIZATION_RESERVE_MS,
} from '../constants/idea-generation.constants';
import { isTransientDatabaseError } from '../utils/transient-database-error.util';

/**
 * Input required to execute an idea-generation pipeline.
 *
 * @author Malak
 */
export type ExecuteIdeaGenerationPipelineInput = {
  /**
   * Initial context created for the generation run.
   */
  context: IdeaGenerationContext;

  /**
   * Executable stage implementations available to the pipeline.
   *
   * Every stage required by the selected generation type must
   * have exactly one matching implementation.
   */
  stages: readonly IdeaGenerationStage[];

  /**
   * True only when restarting an interrupted run from a durable context
   * checkpoint. Completed/skipped stage rows are preserved and not executed
   * again, while the interrupted stage is safely retried.
   */
  resumeFromCheckpoint?: boolean;
};

/**
 * Summary of one processed pipeline stage.
 *
 * @author Malak
 */
export type IdeaGenerationPipelineStageResult = {
  /**
   * Stable stage key.
   */
  stageKey: IdeaGenerationStageKey;

  /**
   * Final persisted stage status.
   */
  status: IdeaGenerationStageStatus;

  /**
   * Number of execution attempts used by the stage.
   */
  attemptCount: number;

  /**
   * Optional preview returned after successful execution.
   */
  resultPreview?: string;
};

/**
 * Result returned after successfully executing the complete
 * idea-generation pipeline.
 *
 * @author Malak
 */
export type IdeaGenerationPipelineResult = {
  /**
   * Final context produced by the pipeline.
   */
  context: IdeaGenerationContext;

  /**
   * Ordered summaries of all evaluated stages.
   */
  stages: IdeaGenerationPipelineStageResult[];
};

/**
 * Internal representation of a stage implementation combined
 * with its central pipeline definition.
 *
 * @author Malak
 */
type ResolvedPipelineStage = {
  /**
   * Static pipeline configuration.
   */
  definition: IdeaGenerationStageDefinition;

  /**
   * Executable stage implementation.
   */
  implementation: IdeaGenerationStage;
};

/**
 * Service responsible for orchestrating the ordered execution of
 * all stages belonging to one idea-generation pipeline.
 *
 * Responsibilities:
 * - Resolve stage definitions for the selected generation type.
 * - Validate executable stage registration.
 * - Initialize persistent IdeaGenerationStage records.
 * - Start the associated IdeaGenerationRun.
 * - Execute stages according to their sequence.
 * - Apply configured retry attempts.
 * - Persist stage progress and result previews.
 * - Mark skipped, completed and failed stages.
 * - Persist run cancellation or failure.
 * - Complete the run after all stages succeed.
 *
 * This service does not:
 * - Implement individual pipeline stages.
 * - Create the initial generation run.
 * - Select or consume user entitlements.
 * - Deduct credits.
 * - Acquire or release generation locks.
 * - Handle HTTP responses.
 *
 * Those responsibilities belong to specialized generation
 * services and the main generation orchestrator.
 *
 * @author Malak
 */
@Injectable()
export class IdeaGenerationPipelineService {
  private readonly logger = new Logger(IdeaGenerationPipelineService.name);

  /**
   * Serializes non-critical stage checkpoint writes per run. The pipeline no
   * longer waits for a remote Supabase round-trip after every completed stage,
   * but writes still reach PostgreSQL in the exact stage order.
   */
  private readonly stageCheckpointQueues = new Map<string, Promise<void>>();

  /** Serializes compact recovery snapshots without blocking normal stage work. */
  private readonly contextCheckpointQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly stageService: IdeaGenerationStageService,
    private readonly runService: IdeaGenerationRunService,
    private readonly realtime: IdeaGenerationRealtimeService,
    private readonly databaseRetry: IdeaGenerationDatabaseRetryService,
  ) {}

  /**
   * Executes the complete pipeline associated with the context's
   * generation type.
   *
   * Execution flow:
   * 1. Resolve the required stage definitions.
   * 2. Match each definition with its implementation.
   * 3. Initialize persistent stage records.
   * 4. Start the generation run.
   * 5. Execute every stage in sequence.
   * 6. Retry failed stages when permitted.
   * 7. Complete the run after all stages succeed.
   *
   * Cancellation and failure are persisted before the error is
   * propagated to the higher-level orchestrator.
   *
   * @param input Initial context and available stage implementations.
   * @returns Final context and processed-stage summaries.
   */
  async executePipeline(
    input: ExecuteIdeaGenerationPipelineInput,
  ): Promise<IdeaGenerationPipelineResult> {
    const pipelineStartedAt = Date.now();
    const deadlineAt = pipelineStartedAt + IDEA_GENERATION_EXECUTION_DEADLINE_MS;

    this.validateContext(input.context);

    const resolvedStages = this.resolvePipelineStages(
      input.context,
      input.stages,
    );

    const recoveryCheckpointSequence = input.resumeFromCheckpoint
      ? this.resolveRecoveryCheckpointSequence(input.context, resolvedStages)
      : null;

    const persistedStageStates = input.resumeFromCheckpoint
      ? await this.prisma.ideaGenerationStage.findMany({
          where: { runId: input.context.runId },
          select: {
            stageKey: true,
            status: true,
            attemptCount: true,
            resultPreview: true,
          },
        })
      : [];

    const persistedStageStateByKey = new Map(
      persistedStageStates.map((stage) => [stage.stageKey, stage]),
    );

    const [startedRun] = await Promise.all([
      this.databaseRetry.execute(
        () => this.runService.startRun(input.context.runId),
        {
          operationName: 'start generation run',
          runId: input.context.runId,
        },
      ),
      this.initializeStageRecords(
        input.context.runId,
        resolvedStages.map(({ definition }) => definition),
      ),
    ]);
    this.realtime.publishRunUpdated(startedRun);

    // The run already exists durably. Queue the initial recovery snapshot so
    // request validation can begin without another remote database round-trip.
    void this.enqueueContextCheckpoint(
      input.context,
      input.context.recoveryCheckpointStageKey,
    );

    let currentContext = input.context;

    const processedStages: IdeaGenerationPipelineStageResult[] = [];

    try {
      for (const resolvedStage of resolvedStages) {
        const persistedStage = persistedStageStateByKey.get(
          resolvedStage.definition.key,
        );

        if (
          input.resumeFromCheckpoint &&
          recoveryCheckpointSequence !== null &&
          resolvedStage.definition.sequence <= recoveryCheckpointSequence &&
          persistedStage &&
          (
            persistedStage.status === IdeaGenerationStageStatus.COMPLETED ||
            persistedStage.status === IdeaGenerationStageStatus.SKIPPED
          )
        ) {
          processedStages.push({
            stageKey: resolvedStage.definition.key,
            status: persistedStage.status,
            attemptCount: persistedStage.attemptCount,
            ...(typeof persistedStage.resultPreview === 'string'
              ? { resultPreview: persistedStage.resultPreview }
              : {}),
          });
          continue;
        }

        this.assertExecutionBudget(
          currentContext.runId,
          resolvedStage.definition.key,
          deadlineAt,
        );
        /*
         * This queued execution is fresh: stage records were initialized just
         * before the loop. Reading every stage back from remote PostgreSQL added
         * one network round-trip per stage without changing the result.
         *
         * Interrupted-run recovery should use a dedicated resume entry point
         * instead of penalizing every normal generation.
         */
        if (currentContext.noResultOutcome) {
          await this.markStageSkipped(
            currentContext.runId,
            resolvedStage.definition,
            0,
          );
          processedStages.push({
            stageKey: resolvedStage.definition.key,
            status: IdeaGenerationStageStatus.SKIPPED,
            attemptCount: 0,
            resultPreview: currentContext.noResultOutcome.message,
          });
          continue;
        }

        const stageResult = await this.executeResolvedStage(
          currentContext,
          resolvedStage,
          deadlineAt,
        );

        currentContext = stageResult.context;

        /*
         * The idea is already transactionally committed at this boundary.
         * Publish its identifier immediately so the frontend can open the
         * workspace while final run bookkeeping and the completion alert finish.
         */
        if (
          resolvedStage.definition.key ===
            IDEA_GENERATION_STAGE_KEYS.IDEA_PERSISTENCE &&
          currentContext.ideaId
        ) {
          this.realtime.publishRunProgress({
            runId: currentContext.runId,
            currentStageKey: IDEA_GENERATION_STAGE_KEYS.FINALIZATION,
            progressPercent: 99,
            ideaId: currentContext.ideaId,
          });
        }

        if (this.shouldCheckpointAfterStage(resolvedStage.definition.key)) {
          const checkpoint = this.enqueueContextCheckpoint(
            currentContext,
            resolvedStage.definition.key,
          );

          // Only durable success boundaries wait for the ordered checkpoint
          // queue. Collection, community analysis, and core generation already
          // persist their own source-of-truth rows, so their compact run
          // snapshots may overlap the next stage safely.
          if (this.requiresSynchronousContextCheckpoint(
            resolvedStage.definition.key,
          )) {
            await checkpoint;
          }
        }

        processedStages.push(stageResult.summary);
      }

      this.assertCompletionIntegrity(currentContext);

      /*
       * A no-result outcome is a durable product result, not an error. Persist
       * its final context synchronously before completing the run so API clients
       * receive the real recovery metadata, collection job IDs, and no-result
       * payload instead of the last asynchronous pre-ranking snapshot.
       */
      if (currentContext.noResultOutcome) {
        await this.enqueueContextCheckpoint(
          currentContext,
          IDEA_GENERATION_STAGE_KEYS.OPPORTUNITY_RANKING,
        );
      }

      const completedRun = await this.runService.completeRun(
        currentContext.runId,
      );
      this.realtime.publishRunUpdated(completedRun);

      this.logger.log(
        `Idea-generation pipeline completed successfully for run "${currentContext.runId}".`,
      );

      return {
        context: currentContext,
        stages: processedStages,
      };
    } catch (error: unknown) {
      if (error instanceof IdeaGenerationCancelledError) {
        await this.cancelRunSafely(currentContext.runId);

        this.logger.warn(
          `Idea-generation pipeline was cancelled for run "${currentContext.runId}" at stage "${error.stageKey}".`,
        );

        throw error;
      }

      const normalizedError = this.normalizeError(error);

      if (isTransientDatabaseError(error)) {
        await this.markRunRetryingSafely(currentContext.runId, normalizedError);

        this.logger.warn(
          `Idea-generation pipeline paused for transient infrastructure recovery for run "${currentContext.runId}": ${normalizedError.message}`,
        );

        throw normalizedError;
      }

      await this.failRunSafely(currentContext.runId, normalizedError);

      this.logger.error(
        `Idea-generation pipeline failed for run "${currentContext.runId}": ${normalizedError.message}`,
        normalizedError.stack,
      );

      throw normalizedError;
    }
  }

  /**
   * Rejects additional expensive work when the run has consumed its execution
   * budget. The reserve protects persistence and finalization from being
   * starved by external AI or collection calls.
   */
  private assertExecutionBudget(
    runId: string,
    stageKey: IdeaGenerationStageKey,
    deadlineAt: number,
  ): void {
    const remainingMs = deadlineAt - Date.now();

    /*
     * Only the hard safety deadline stops the pipeline. The 60-second target is
     * measured for observability, but a run that already has valid evidence
     * must not be marked FAILED merely because remote PostgreSQL persistence
     * consumed the remaining performance target.
     */
    if (remainingMs > 0) {
      return;
    }

    this.logger.warn(
      `Generation run "${runId}" exceeded the ${IDEA_GENERATION_EXECUTION_DEADLINE_MS}ms performance target before stage "${stageKey}". The run will continue to a durable terminal state.`,
    );
  }

  /**
   * Validates the only two states that may complete successfully:
   *
   * 1. A normal generation with a persisted idea and a validated core title.
   * 2. A documented no-result outcome produced by the strict evidence gate.
   *
   * A no-result completion is intentional, not a generation failure. Later AI,
   * persistence, and finalization stages are skipped, so no idea is created and
   * no entitlement is consumed. The guard still rejects contradictory states
   * such as a no-result outcome that also contains a partially persisted idea.
   */
  private assertCompletionIntegrity(
    context: IdeaGenerationContext,
  ): void {
    if (context.noResultOutcome) {
      this.assertValidNoResultCompletion(context);
      return;
    }

    if (!context.ideaId?.trim() || !context.coreIdea?.title?.trim()) {
      throw new ConflictException({
        code: 'IDEA_GENERATION_COMPLETED_WITHOUT_IDEA',
        message:
          'The pipeline produced neither a persisted idea nor a documented no-result outcome. Completion was blocked to preserve generation integrity.',
      });
    }
  }

  /**
   * Ensures that a successful no-result run is internally consistent.
   *
   * No-result is allowed only after evidence processing created the explicit
   * NO_RECURRING_OPPORTUNITY checkpoint. It must never coexist with an idea ID,
   * generated output IDs, or a core idea because those fields would indicate a
   * partially executed persistence path.
   */
  private assertValidNoResultCompletion(
    context: IdeaGenerationContext,
  ): void {
    const outcome = context.noResultOutcome;

    if (!outcome || outcome.code !== 'NO_RECURRING_OPPORTUNITY') {
      throw new ConflictException({
        code: 'IDEA_GENERATION_INVALID_NO_RESULT_OUTCOME',
        message:
          'The pipeline produced an unsupported no-result outcome. Completion was blocked to preserve generation integrity.',
      });
    }

    const hasPersistedIdea = Boolean(context.ideaId?.trim());
    const hasCoreIdea = Boolean(context.coreIdea?.title?.trim());
    const hasPersistedOutputs =
      Object.keys(context.generatedOutputIdsByKey ?? {}).length > 0;

    if (hasPersistedIdea || hasCoreIdea || hasPersistedOutputs) {
      throw new ConflictException({
        code: 'IDEA_GENERATION_CONTRADICTORY_NO_RESULT_STATE',
        message:
          'The pipeline produced both a no-result outcome and partial idea data. Completion was blocked to prevent an inconsistent run state.',
      });
    }

    if (!context.collection?.collectionJobId?.trim() || !context.nlp) {
      throw new ConflictException({
        code: 'IDEA_GENERATION_INCOMPLETE_NO_RESULT_STATE',
        message:
          'The no-result outcome is missing its collection or NLP evidence checkpoint. Completion was blocked to preserve auditability.',
      });
    }
  }

  /**
   * Resolves the correct pipeline definitions and matches them
   * with executable stage implementations.
   *
   * Every generation type receives the same compact runtime stages:
   * - Core evidence, AI, validation, and persistence stages.
   * - Finalization.
   *
   * Premium fields are returned in the same structured core AI response and
   * validated atomically; separate premium checkpoint stages are intentionally
   * excluded because they add database writes without generating new content.
   *
   * @param context Current generation context.
   * @param implementations Registered stage implementations.
   * @returns Ordered resolved pipeline stages.
   */
  private resolvePipelineStages(
    context: IdeaGenerationContext,
    implementations: readonly IdeaGenerationStage[],
  ): ResolvedPipelineStage[] {
    const includePremiumStages =
      context.generationType === IdeaGenerationType.PREMIUM_CREDIT;

    const definitions = getIdeaGenerationStageDefinitions(includePremiumStages);

    const implementationMap = this.buildImplementationMap(implementations);

    const resolvedStages = definitions.map((definition) => {
      const implementation = implementationMap.get(definition.key);

      if (!implementation) {
        throw new ConflictException({
          code: 'IDEA_GENERATION_STAGE_NOT_REGISTERED',
          message: `No implementation is registered for pipeline stage "${definition.key}".`,
        });
      }

      this.validateStageDefinition(implementation, definition);

      return {
        definition,
        implementation,
      };
    });

    return resolvedStages.sort(
      (first, second) => first.definition.sequence - second.definition.sequence,
    );
  }

  /**
   * Builds a stage-key lookup and rejects duplicate stage
   * implementations.
   *
   * Duplicate keys would make pipeline execution ambiguous and
   * could cause different implementations to execute depending
   * on registration order.
   *
   * @param implementations Available stage implementations.
   * @returns Stage implementation lookup.
   */
  private buildImplementationMap(
    implementations: readonly IdeaGenerationStage[],
  ): Map<IdeaGenerationStageKey, IdeaGenerationStage> {
    const implementationMap = new Map<
      IdeaGenerationStageKey,
      IdeaGenerationStage
    >();

    for (const implementation of implementations) {
      if (implementationMap.has(implementation.key)) {
        throw new ConflictException({
          code: 'DUPLICATE_IDEA_GENERATION_STAGE',
          message: `Multiple implementations are registered for stage "${implementation.key}".`,
        });
      }

      implementationMap.set(implementation.key, implementation);
    }

    return implementationMap;
  }

  /**
   * Ensures that the definition declared by a stage implementation
   * matches the central pipeline definition.
   *
   * This prevents an individual implementation from silently
   * changing:
   * - Stage sequence.
   * - Starting progress.
   * - Ending progress.
   * - Retry attempts.
   * - Premium-stage classification.
   *
   * @param implementation Executable stage implementation.
   * @param expectedDefinition Central stage definition.
   */
  private validateStageDefinition(
    implementation: IdeaGenerationStage,
    expectedDefinition: IdeaGenerationStageDefinition,
  ): void {
    const actualDefinition = implementation.definition;

    if (
      implementation.key !== expectedDefinition.key ||
      actualDefinition.key !== expectedDefinition.key
    ) {
      throw new ConflictException({
        code: 'IDEA_GENERATION_STAGE_KEY_MISMATCH',
        message: `Stage implementation "${implementation.key}" declares a mismatched definition key.`,
      });
    }

    if (
      actualDefinition.sequence !== expectedDefinition.sequence ||
      actualDefinition.progressStart !== expectedDefinition.progressStart ||
      actualDefinition.progressEnd !== expectedDefinition.progressEnd ||
      actualDefinition.maxAttempts !== expectedDefinition.maxAttempts ||
      actualDefinition.requiredForPremium !==
        expectedDefinition.requiredForPremium
    ) {
      throw new ConflictException({
        code: 'IDEA_GENERATION_STAGE_DEFINITION_MISMATCH',
        message: `Stage "${implementation.key}" configuration does not match the central pipeline definition.`,
      });
    }
  }

  /**
   * Creates or resets persistent stage records before execution.
   *
   * Upsert makes initialization idempotent when pipeline
   * preparation is called more than once before the run starts.
   *
   * This method resets existing stage state because it initializes
   * a new queued execution. It does not resume interrupted runs.
   *
   * @param runId Generation-run identifier.
   * @param definitions Ordered pipeline definitions.
   */
  private async initializeStageRecords(
    runId: string,
    definitions: readonly IdeaGenerationStageDefinition[],
  ): Promise<void> {
    /*
     * Generation runs are newly created before entering this pipeline. A single
     * createMany replaces a transaction containing one upsert per stage, which
     * removed several seconds before request-validation on remote PostgreSQL.
     * skipDuplicates keeps the operation safe for an accidental repeated call.
     */
    await this.prisma.ideaGenerationStage.createMany({
      data: definitions.map((definition) => ({
        runId,
        stageKey: definition.key,
        displayName: definition.displayName,
        sequence: definition.sequence,
        status: IdeaGenerationStageStatus.PENDING,
        progressPercent: definition.progressStart,
        resultPreview: Prisma.JsonNull,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
        attemptCount: 0,
        maxAttempts: definition.maxAttempts,
      })),
      skipDuplicates: true,
    });
  }

  /**
   * Executes one resolved stage with its configured retry policy.
   *
   * The stage record becomes RUNNING before each attempt.
   *
   * A successful stage becomes:
   * - COMPLETED when it executes.
   * - SKIPPED when shouldExecute() returns false.
   *
   * When all configured attempts fail, the stage becomes FAILED
   * and the final error is propagated.
   *
   * @param context Current generation context.
   * @param resolvedStage Definition and implementation.
   * @param deadlineAt Absolute fast-pipeline deadline.
   * @returns Updated context and final stage summary.
   */
  private async executeResolvedStage(
    context: IdeaGenerationContext,
    resolvedStage: ResolvedPipelineStage,
    deadlineAt: number,
  ): Promise<{
    context: IdeaGenerationContext;
    summary: IdeaGenerationPipelineStageResult;
  }> {
    const { definition, implementation } = resolvedStage;

    const startProgressPercent = this.resolveActiveRunProgress(
      definition.progressStart,
    );

    const completedProgressPercent = this.resolveActiveRunProgress(
      definition.progressEnd,
    );

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= definition.maxAttempts; attempt += 1) {
      await this.markStageRunning(context, definition, attempt);

      try {
        const result = await this.executeStageWithinBudget(
          {
            stage: implementation,
            context,
            startProgressPercent,
            completedProgressPercent,
          },
          definition.key,
          deadlineAt,
        );

        if (!result.executed) {
          await this.markStageSkipped(context.runId, definition, attempt);

          return {
            context: result.context,
            summary: {
              stageKey: definition.key,
              status: IdeaGenerationStageStatus.SKIPPED,
              attemptCount: attempt,
            },
          };
        }

        const completionWrite = this.markStageCompleted(
          context.runId,
          definition,
          attempt,
          result.resultPreview,
        );

        if (this.requiresSynchronousCompletionCheckpoint(definition.key)) {
          await completionWrite;
        }

        return {
          context: result.context,
          summary: {
            stageKey: definition.key,
            status: IdeaGenerationStageStatus.COMPLETED,
            attemptCount: attempt,

            ...(result.resultPreview !== undefined
              ? {
                  resultPreview: result.resultPreview,
                }
              : {}),
          },
        };
      } catch (error: unknown) {
        if (error instanceof IdeaGenerationCancelledError) {
          await this.markStageCancellation(context.runId, definition, attempt);

          throw error;
        }

        lastError = this.normalizeError(error);

        if (attempt < definition.maxAttempts) {
          await this.recordRetryableFailure(
            context.runId,
            definition,
            attempt,
            lastError,
          );

          this.logger.warn(
            `Stage "${definition.key}" failed on attempt ${attempt}/${definition.maxAttempts} for run "${context.runId}". Retrying: ${lastError.message}`,
          );

          continue;
        }

        await this.markStageFailed(
          context.runId,
          definition,
          attempt,
          lastError,
        );

        throw lastError;
      }
    }

    throw (
      lastError ??
      new Error(`Stage "${definition.key}" failed without an execution error.`)
    );
  }

  /**
   * Executes every stage inside the remaining fast-pipeline budget.
   *
   * Collector and AI adapters still keep their own shorter timeouts. Expensive
   * external-I/O stages must also preserve a deterministic reserve for output
   * validation, persistence, finalization, and realtime publication.
   */
  private async executeStageWithinBudget(
    input: Parameters<IdeaGenerationStageService['executeStage']>[0],
    stageKey: IdeaGenerationStageKey,
    deadlineAt: number,
  ): Promise<ExecuteIdeaGenerationStageResult> {
    const reserveMs = this.requiresFinalizationReserve(stageKey)
      ? IDEA_GENERATION_FINALIZATION_RESERVE_MS
      : 0;
    const remainingExecutionMs = deadlineAt - Date.now() - reserveMs;

    if (remainingExecutionMs <= 0) {
      this.logger.warn(
        `Stage "${stageKey}" started after the fast-pipeline performance budget was exhausted. Stage-local provider and database timeouts remain authoritative.`,
      );
    }

    return this.stageService.executeStage(input);
  }

  /**
   * Identifies expensive stages that must leave time for validation,
   * persistence, and finalization. Every stage is deadline-bounded, but only
   * these external-I/O stages consume the protected reserve.
   */
  private requiresFinalizationReserve(stageKey: IdeaGenerationStageKey): boolean {
    return (
      stageKey === IDEA_GENERATION_STAGE_KEYS.COLLECTION_JOB_RESOLUTION ||
      stageKey === IDEA_GENERATION_STAGE_KEYS.COMMUNITY_AI_ANALYSIS ||
      stageKey === IDEA_GENERATION_STAGE_KEYS.CORE_IDEA_GENERATION
    );
  }


  /**
   * Marks a stage as running and records the current attempt.
   *
   * @param runId Generation-run identifier.
   * @param definition Stage definition.
   * @param attempt Current attempt number.
   */
  private async markStageRunning(
    context: IdeaGenerationContext,
    definition: IdeaGenerationStageDefinition,
    attempt: number,
  ): Promise<void> {
    const runId = context.runId;

    /*
     * Context checkpoints update IdeaGenerationRun.contextSnapshot. Let any
     * already-started checkpoint finish before opening the serializable idea
     * persistence transaction. Otherwise a background checkpoint can update
     * the same run row while persistence is reading/attaching it, forcing the
     * entire 4-8 second transaction to retry. This changes only scheduling of
     * recovery metadata; generation quality, entitlement atomicity, duplicate
     * protection, and generated outputs are unchanged.
     */
    if (
      definition.key === IDEA_GENERATION_STAGE_KEYS.IDEA_PERSISTENCE
    ) {
      await this.flushContextCheckpoints(runId);
    }
    this.realtime.publishStageTransition({
      runId,
      stageKey: definition.key,
      displayName: definition.displayName,
      sequence: definition.sequence,
      status: IdeaGenerationStageStatus.RUNNING,
      progressPercent: definition.progressStart,
      attemptCount: attempt,
      maxAttempts: definition.maxAttempts,
    });

    this.realtime.publishRunProgress({
      runId,
      currentStageKey: definition.key,
      progressPercent: definition.progressStart,
    });

    /*
     * Keep the cancellation guard as one lightweight updateMany instead of a
     * two-statement transaction. The stage-row checkpoint is observability
     * metadata, so it is serialized in the existing per-run queue and does not
     * block the actual workload.
     *
     * Cheap in-memory stages do not need a remote cancellation round-trip at
     * every boundary. Cancellation is guarded before each expensive/external
     * stage and before persistence/finalization, which keeps cancellation safe
     * while removing repeated 1-3 second Supabase gaps between tiny stages.
     */
    if (this.requiresSynchronousStartGuard(definition.key)) {
      const runUpdate = await this.databaseRetry.execute(
        () =>
          this.prisma.ideaGenerationRun.updateMany({
            where: {
              id: runId,
              status: 'RUNNING',
              cancelRequestedAt: null,
            },
            data: {
              currentStageKey: definition.key,
              progressPercent: definition.progressStart,
              lastHeartbeatAt: new Date(),

              /*
               * CollectionJobResolutionStage has already validated and
               * completed this exact job. Attach it to the run during the
               * existing guarded persistence-stage update so
               * IdeaPersistenceService does not need a second defensive
               * CollectionJob lookup inside the serializable transaction.
               *
               * Direct/non-pipeline callers still keep the persistence
               * service's fallback validation when run.collectionJobId is null.
               */
              ...(definition.key ===
                IDEA_GENERATION_STAGE_KEYS.IDEA_PERSISTENCE &&
              context.collection?.collectionJobId
                ? {
                    collectionJobId: context.collection.collectionJobId,
                  }
                : {}),
            },
          }),
        {
          operationName: 'guard stage start and update run progress',
          runId,
        },
      );

      if (runUpdate.count !== 1) {
        throw new ConflictException(
          'The generation run is no longer active or cancellation was requested.',
        );
      }
    }

    void this.enqueueStageCheckpoint(runId, async () => {
      const stage = await this.databaseRetry.execute(
        () =>
          this.prisma.ideaGenerationStage.update({
            where: {
              runId_stageKey: {
                runId,
                stageKey: definition.key,
              },
            },
            data: {
              status: IdeaGenerationStageStatus.RUNNING,
              progressPercent: definition.progressStart,
              attemptCount: attempt,
              startedAt: new Date(),
              completedAt: null,
              errorMessage: null,
            },
          }),
        {
          operationName: 'checkpoint stage running',
          runId,
        },
      );

      this.realtime.publishStageUpdated(stage);
    });
  }

  /**
   * Stages that touch external systems or cross the durable success boundary
   * keep an awaited cancellation guard. Small deterministic stages are allowed
   * to flow without paying a database round-trip before each one.
   */
  private requiresSynchronousStartGuard(
    stageKey: IdeaGenerationStageKey,
  ): boolean {
    return (
      stageKey === IDEA_GENERATION_STAGE_KEYS.COLLECTION_JOB_RESOLUTION ||
      stageKey === IDEA_GENERATION_STAGE_KEYS.CORE_IDEA_GENERATION ||
      stageKey === IDEA_GENERATION_STAGE_KEYS.IDEA_PERSISTENCE
    );
  }

  /**
   * Marks a successfully executed stage as completed.
   *
   * @param runId Generation-run identifier.
   * @param definition Stage definition.
   * @param attempt Final successful attempt.
   * @param resultPreview Optional short stage preview.
   */
  private async markStageCompleted(
    runId: string,
    definition: IdeaGenerationStageDefinition,
    attempt: number,
    resultPreview?: string,
  ): Promise<void> {
    this.realtime.publishStageTransition({
      runId,
      stageKey: definition.key,
      displayName: definition.displayName,
      sequence: definition.sequence,
      status: IdeaGenerationStageStatus.COMPLETED,
      progressPercent: definition.progressEnd,
      attemptCount: attempt,
      maxAttempts: definition.maxAttempts,
      resultPreview,
    });

    this.realtime.publishRunProgress({
      runId,
      currentStageKey: definition.key,
      progressPercent: definition.progressEnd,
    });

    /*
     * Do not update IdeaGenerationRun again here. markStageRunning() for the
     * next stage performs the guarded run update and cancellation check. The
     * old completion transaction wrote both rows after every stage, creating
     * an unnecessary remote query and several seconds of idle time.
     */
    return this.enqueueStageCheckpoint(runId, async () => {
      const stage = await this.databaseRetry.execute(
        () =>
          this.prisma.ideaGenerationStage.update({
            where: {
              runId_stageKey: {
                runId,
                stageKey: definition.key,
              },
            },
            data: {
              status: IdeaGenerationStageStatus.COMPLETED,
              progressPercent: definition.progressEnd,
              attemptCount: attempt,
              resultPreview:
                resultPreview !== undefined ? resultPreview : Prisma.JsonNull,
              errorMessage: null,
              completedAt: new Date(),
            },
          }),
        {
          operationName: 'mark stage completed',
          runId,
        },
      );

      this.realtime.publishStageUpdated(stage);
    });
  }

  /**
   * Persistence and finalization checkpoints are awaited because they define
   * the durable success boundary. Earlier completion checkpoints are ordered
   * in the background to remove repeated network idle time only.
   */
  private requiresSynchronousCompletionCheckpoint(
    stageKey: IdeaGenerationStageKey,
  ): boolean {
    return (
      stageKey === IDEA_GENERATION_STAGE_KEYS.IDEA_PERSISTENCE
    );
  }

  /** Enqueues one ordered stage-checkpoint write for a generation run. */
  private enqueueStageCheckpoint(
    runId: string,
    operation: () => Promise<void>,
  ): Promise<void> {
    const previous = this.stageCheckpointQueues.get(runId) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(operation);

    this.stageCheckpointQueues.set(runId, current);

    void current
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Deferred stage checkpoint failed for run "${runId}": ${message}`,
        );
      })
      .finally(() => {
        if (this.stageCheckpointQueues.get(runId) === current) {
          this.stageCheckpointQueues.delete(runId);
        }
      });

    return current;
  }

  /**
   * Marks a stage skipped by its optional shouldExecute() method.
   *
   * A skipped stage reaches its configured ending progress because
   * the pipeline successfully passed its position.
   *
   * @param runId Generation-run identifier.
   * @param definition Stage definition.
   * @param attempt Attempt on which the stage was skipped.
   */
  private async markStageSkipped(
    runId: string,
    definition: IdeaGenerationStageDefinition,
    attempt: number,
  ): Promise<void> {
    const stage = await this.prisma.ideaGenerationStage.update({
      where: {
        runId_stageKey: {
          runId,
          stageKey: definition.key,
        },
      },
      data: {
        status: IdeaGenerationStageStatus.SKIPPED,
        progressPercent: definition.progressEnd,
        attemptCount: attempt,
        resultPreview: Prisma.JsonNull,
        errorMessage: null,
        completedAt: new Date(),
      },
    });

    this.realtime.publishStageUpdated(stage);
  }

  /**
   * Stores a cancelled stage using the available SKIPPED status.
   *
   * The current Prisma enum does not provide a dedicated CANCELLED
   * status for IdeaGenerationStage. The associated generation run
   * still receives its dedicated cancelled lifecycle state through
   * IdeaGenerationRunService.cancelRun().
   *
   * Unlike a normally skipped stage, a cancelled stage remains at
   * its starting progress because it did not successfully pass its
   * configured pipeline position.
   *
   * @param runId Generation-run identifier.
   * @param definition Cancelled stage definition.
   * @param attempt Active attempt number.
   */
  private async markStageCancellation(
    runId: string,
    definition: IdeaGenerationStageDefinition,
    attempt: number,
  ): Promise<void> {
    const stage = await this.prisma.ideaGenerationStage.update({
      where: {
        runId_stageKey: {
          runId,
          stageKey: definition.key,
        },
      },
      data: {
        status: IdeaGenerationStageStatus.SKIPPED,
        progressPercent: definition.progressStart,
        attemptCount: attempt,
        resultPreview: Prisma.JsonNull,
        errorMessage: 'Stage execution was cancelled.',
        completedAt: new Date(),
      },
    });

    this.realtime.publishStageUpdated(stage);
  }

  /**
   * Stores an intermediate retryable failure while keeping the
   * stage available for another execution attempt.
   *
   * @param runId Generation-run identifier.
   * @param definition Stage definition.
   * @param attempt Failed attempt number.
   * @param error Retryable execution error.
   */
  private async recordRetryableFailure(
    runId: string,
    definition: IdeaGenerationStageDefinition,
    attempt: number,
    error: Error,
  ): Promise<void> {
    const stage = await this.databaseRetry.execute(
      () =>
        this.prisma.ideaGenerationStage.update({
          where: {
            runId_stageKey: {
              runId,
              stageKey: definition.key,
            },
          },
          data: {
            /*
             * Return the stage to a clean pending lifecycle state before the
             * next attempt. A pending stage is not actively executing, so both
             * lifecycle timestamps must be null.
             *
             * The bounded error message is intentionally retained to make the
             * previous failed attempt observable while the retry is pending.
             */
            status: IdeaGenerationStageStatus.PENDING,
            progressPercent: definition.progressStart,
            attemptCount: attempt,
            resultPreview: Prisma.JsonNull,
            errorMessage: this.toSafeErrorMessage(error),
            startedAt: null,
            completedAt: null,
          },
        }),
      {
        operationName: 'record retryable generation-stage failure',
        runId,
      },
    );

    this.realtime.publishStageUpdated(stage);
  }

  /**
   * Marks a stage as failed after all configured attempts have
   * been exhausted.
   *
   * @param runId Generation-run identifier.
   * @param definition Stage definition.
   * @param attempt Final failed attempt.
   * @param error Final stage error.
   */
  private async markStageFailed(
    runId: string,
    definition: IdeaGenerationStageDefinition,
    attempt: number,
    error: Error,
  ): Promise<void> {
    /*
     * markStageRunning() uses a deferred ordered checkpoint. A very fast stage
     * can fail before that RUNNING write reaches PostgreSQL, leaving
     * started_at=null. Updating such a row directly to FAILED violates the
     * generation_stages_status_consistency_check constraint.
     *
     * Wait for the pending checkpoint first. The fallback startedAt value below
     * keeps the FAILED lifecycle valid even if the deferred RUNNING write itself
     * failed because of a transient database issue.
     */
    const pendingCheckpoint = this.stageCheckpointQueues.get(runId);

    if (pendingCheckpoint) {
      await pendingCheckpoint.catch(() => undefined);
    }

    const failedAt = new Date();

    const stage = await this.databaseRetry.execute(
      () =>
        this.prisma.ideaGenerationStage.update({
          where: {
            runId_stageKey: {
              runId,
              stageKey: definition.key,
            },
          },
          data: {
            status: IdeaGenerationStageStatus.FAILED,
            attemptCount: attempt,
            errorMessage: this.toSafeErrorMessage(error),
            startedAt: failedAt,
            completedAt: failedAt,
          },
        }),
      {
        operationName: 'mark generation stage failed',
        runId,
      },
    );

    this.realtime.publishStageUpdated(stage);
  }

  /**
   * Restricts active run progress to the range accepted by
   * IdeaGenerationRunService.updateProgress().
   *
   * Stage records may reach 100 during finalization, but an active
   * IdeaGenerationRun remains at 99 until completeRun() changes
   * its status to COMPLETED and progress to 100.
   *
   * @param progressPercent Configured stage progress.
   * @returns Active-run-safe progress value.
   */
  private resolveActiveRunProgress(progressPercent: number): number {
    return Math.min(progressPercent, 99);
  }

  /**
   * Marks the run as cancelled without hiding the original
   * cancellation error when persistence fails.
   *
   * @param runId Generation-run identifier.
   */
  private async cancelRunSafely(runId: string): Promise<void> {
    try {
      const cancelledRun = await this.runService.cancelRun(runId);
      this.realtime.publishRunUpdated(cancelledRun);
    } catch (error: unknown) {
      const cancellationError = this.normalizeError(error);

      this.logger.error(
        `Failed to persist cancellation for generation run "${runId}": ${cancellationError.message}`,
        cancellationError.stack,
      );
    }
  }

  /**
   * Marks the run as failed without replacing the original
   * pipeline error.
   *
   * @param runId Generation-run identifier.
   * @param error Original pipeline error.
   */
  private async failRunSafely(runId: string, error: Error): Promise<void> {
    try {
      const failedRun = await this.runService.failRun({
        runId,
        errorCode: 'IDEA_GENERATION_PIPELINE_FAILED',
        errorMessage: this.toSafeErrorMessage(error),
      });
      this.realtime.publishRunUpdated(failedRun);
    } catch (persistenceError: unknown) {
      const normalizedPersistenceError = this.normalizeError(persistenceError);

      this.logger.error(
        `Failed to persist failure for generation run "${runId}": ${normalizedPersistenceError.message}`,
        normalizedPersistenceError.stack,
      );
    }
  }

  /**
   * Validates the initial generation context required by the
   * pipeline.
   *
   * @param context Initial generation context.
   */
  private validateContext(context: IdeaGenerationContext): void {
    if (
      !context ||
      typeof context.runId !== 'string' ||
      !context.runId.trim()
    ) {
      throw new ConflictException({
        code: 'INVALID_IDEA_GENERATION_CONTEXT',
        message: 'The idea-generation context must contain a valid run ID.',
      });
    }

    if (!context.generationType) {
      throw new ConflictException({
        code: 'MISSING_IDEA_GENERATION_TYPE',
        message: 'The idea-generation context must contain a generation type.',
      });
    }
  }

  /**
   * Converts an unknown thrown value into a standard Error.
   *
   * @param error Unknown thrown value.
   * @returns Normalized Error instance.
   */
  /** Persists a JSON-safe copy of the current pipeline context. */
  /**
   * Persists only recovery-critical context boundaries.
   *
   * Writing the complete context after every small validation/checkpoint stage
   * was the largest avoidable source of remote-database latency.
   */
  /**
   * Resolves the highest stage sequence that may be skipped during recovery.
   *
   * A persisted stage row alone is insufficient because its updated context
   * may not have reached the run checkpoint before a process interruption.
   */
  private resolveRecoveryCheckpointSequence(
    context: IdeaGenerationContext,
    resolvedStages: readonly ResolvedPipelineStage[],
  ): number | null {
    const checkpointStageKey = context.recoveryCheckpointStageKey;

    if (!checkpointStageKey) {
      return null;
    }

    const checkpoint = resolvedStages.find(
      ({ definition }) => definition.key === checkpointStageKey,
    );

    return checkpoint?.definition.sequence ?? null;
  }

  /** Waits only for recovery snapshots that were already queued for this run. */
  private async flushContextCheckpoints(runId: string): Promise<void> {
    const pending = this.contextCheckpointQueues.get(runId);

    if (!pending) {
      return;
    }

    try {
      await pending;
    } catch {
      // enqueueContextCheckpoint already records the failure. A recovery
      // snapshot must never replace a valid generation result.
    }
  }

  private shouldCheckpointAfterStage(stageKey: IdeaGenerationStageKey): boolean {
    return (
      stageKey === IDEA_GENERATION_STAGE_KEYS.COLLECTION_JOB_RESOLUTION ||
      stageKey === IDEA_GENERATION_STAGE_KEYS.COMMUNITY_AI_ANALYSIS ||
      stageKey === IDEA_GENERATION_STAGE_KEYS.CORE_IDEA_GENERATION ||
      stageKey === IDEA_GENERATION_STAGE_KEYS.IDEA_PERSISTENCE
    );
  }

  /** Idea persistence is the only snapshot boundary that must finish before
   * the pipeline advances. Finalization contains no recovery-critical payload. */
  private requiresSynchronousContextCheckpoint(
    stageKey: IdeaGenerationStageKey,
  ): boolean {
    return stageKey === IDEA_GENERATION_STAGE_KEYS.IDEA_PERSISTENCE;
  }

  /** Queues compact context snapshots in run order and coalesces work with the
   * active pipeline instead of adding an idle Supabase gap after each stage. */
  private enqueueContextCheckpoint(
    context: IdeaGenerationContext,
    recoveryCheckpointStageKey: string | null,
  ): Promise<void> {
    const runId = context.runId;
    const checkpointContext: IdeaGenerationContext = {
      ...context,
      recoveryCheckpointStageKey,
    };
    const previous =
      this.contextCheckpointQueues.get(runId) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => this.saveContextCheckpoint(checkpointContext));

    this.contextCheckpointQueues.set(runId, current);

    void current
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Deferred context checkpoint failed for run "${runId}": ${message}`,
        );
      })
      .finally(() => {
        if (this.contextCheckpointQueues.get(runId) === current) {
          this.contextCheckpointQueues.delete(runId);
        }
      });

    return current;
  }

  private async saveContextCheckpoint(
    context: IdeaGenerationContext,
  ): Promise<void> {
    const compactContext: IdeaGenerationContext = {
      ...context,
      nlp: context.nlp
        ? {
            ...context.nlp,
            // Representative samples already exist in persisted collection and
            // NLP tables. Keeping them in every run checkpoint duplicates large
            // text payloads without improving recovery.
            samplePosts: null,
            sampleComments: null,
          }
        : null,
      prompt: context.prompt
        ? {
            ...context.prompt,
            // After core generation succeeds the persisted candidate/output is
            // the recovery source of truth, so the rendered prompt no longer
            // needs to remain inside the run row.
            promptText: context.coreIdea ? '' : context.prompt.promptText,
            responseSchema: context.coreIdea
              ? { type: 'object' }
              : context.prompt.responseSchema,
          }
        : null,
      // Persisted output rows are referenced by generatedOutputIdsByKey. An
      // empty array after ideaId is assigned means "content compacted after
      // persistence", not "no outputs generated". The generated IDs remain the
      // canonical checkpoint representation.
      advancedOutputs: context.ideaId ? [] : context.advancedOutputs,
    };

    const snapshot = JSON.parse(
      JSON.stringify(compactContext),
    ) as Prisma.InputJsonValue;

    const run = await this.databaseRetry.execute(
      () => this.runService.saveContextCheckpoint(context.runId, snapshot),
      {
        operationName: 'save generation checkpoint',
        runId: context.runId,
      },
    );

    this.realtime.publishRunUpdated(run);
  }

  /** Records a recoverable infrastructure interruption without failing the run. */
  private async markRunRetryingSafely(
    runId: string,
    error: Error,
  ): Promise<void> {
    try {
      const nextRetryAt = new Date(
        Date.now() + GENERATION_PAUSED_RETRY_DELAY_MS,
      );

      const run = await this.databaseRetry.execute(
        () =>
          this.runService.markRetrying(
            runId,
            error.message.slice(0, 2_000),
            nextRetryAt,
          ),
        {
          operationName: 'mark generation run retrying',
          runId,
        },
      );

      this.realtime.publishRunUpdated(run);
    } catch (persistenceError: unknown) {
      const normalized = this.normalizeError(persistenceError);
      this.logger.error(
        `Failed to persist RETRYING state for run "${runId}": ${normalized.message}`,
        normalized.stack,
      );
    }
  }

  private normalizeError(error: unknown): Error {
    if (error instanceof Error) {
      return error;
    }

    if (typeof error === 'string') {
      return new Error(error);
    }

    return new Error('Unknown idea-generation pipeline error.');
  }

  /**
   * Produces a bounded safe error message suitable for database
   * persistence and status endpoints.
   *
   * Internal stack traces remain available only in application
   * logs.
   *
   * @param error Error whose message should be persisted.
   * @returns Safe bounded error message.
   */
  private toSafeErrorMessage(error: Error): string {
    const message =
      error.message.trim() || 'Idea-generation stage execution failed.';

    return message.slice(0, 1_000);
  }
}