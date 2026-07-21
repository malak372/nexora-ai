import { ConflictException, Injectable, Logger } from '@nestjs/common';

import {
  IdeaGenerationStageStatus,
  IdeaGenerationType,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';

import {
  getIdeaGenerationStageDefinitions,
  type IdeaGenerationStageDefinition,
  type IdeaGenerationStageKey,
} from '../constants/idea-generation-stages.constants';

import type { IdeaGenerationStage } from '../interfaces/idea-generation-stage.interface';

import type { IdeaGenerationContext } from '../types/idea-generation-context.type';

import {
  IdeaGenerationCancelledError,
  IdeaGenerationStageService,
} from './idea-generation-stage.service';

import { IdeaGenerationRunService } from '../services/idea-generation-run.service';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly stageService: IdeaGenerationStageService,
    private readonly runService: IdeaGenerationRunService,
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
    this.validateContext(input.context);

    const resolvedStages = this.resolvePipelineStages(
      input.context,
      input.stages,
    );

    await this.initializeStageRecords(
      input.context.runId,
      resolvedStages.map(({ definition }) => definition),
    );

    await this.runService.startRun(input.context.runId);

    let currentContext = input.context;

    const processedStages: IdeaGenerationPipelineStageResult[] = [];

    try {
      for (const resolvedStage of resolvedStages) {
        const stageResult = await this.executeResolvedStage(
          currentContext,
          resolvedStage,
        );

        currentContext = stageResult.context;

        processedStages.push(stageResult.summary);
      }

      await this.runService.completeRun(currentContext.runId);

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

      await this.failRunSafely(currentContext.runId, normalizedError);

      this.logger.error(
        `Idea-generation pipeline failed for run "${currentContext.runId}": ${normalizedError.message}`,
        normalizedError.stack,
      );

      throw normalizedError;
    }
  }

  /**
   * Resolves the correct pipeline definitions and matches them
   * with executable stage implementations.
   *
   * Premium-credit generation receives:
   * - Core stages.
   * - Premium-output stages.
   * - Finalization.
   *
   * Guest-free and normal-free generation receive:
   * - Core stages.
   * - Finalization.
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
    await this.prisma.$transaction(
      definitions.map((definition) =>
        this.prisma.ideaGenerationStage.upsert({
          where: {
            runId_stageKey: {
              runId,
              stageKey: definition.key,
            },
          },
          create: {
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
          },
          update: {
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
          },
        }),
      ),
    );
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
   * @returns Updated context and final stage summary.
   */
  private async executeResolvedStage(
    context: IdeaGenerationContext,
    resolvedStage: ResolvedPipelineStage,
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
      await this.markStageRunning(context.runId, definition, attempt);

      try {
        const result = await this.stageService.executeStage({
          stage: implementation,
          context,
          startProgressPercent,
          completedProgressPercent,
        });

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

        await this.markStageCompleted(
          context.runId,
          definition,
          attempt,
          result.resultPreview,
        );

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
   * Marks a stage as running and records the current attempt.
   *
   * @param runId Generation-run identifier.
   * @param definition Stage definition.
   * @param attempt Current attempt number.
   */
  private async markStageRunning(
    runId: string,
    definition: IdeaGenerationStageDefinition,
    attempt: number,
  ): Promise<void> {
    await this.prisma.ideaGenerationStage.update({
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
    });
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
    await this.prisma.ideaGenerationStage.update({
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
    });
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
    await this.prisma.ideaGenerationStage.update({
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
    await this.prisma.ideaGenerationStage.update({
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
    await this.prisma.ideaGenerationStage.update({
      where: {
        runId_stageKey: {
          runId,
          stageKey: definition.key,
        },
      },
      data: {
        status: IdeaGenerationStageStatus.PENDING,
        attemptCount: attempt,
        errorMessage: this.toSafeErrorMessage(error),
        completedAt: null,
      },
    });
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
    await this.prisma.ideaGenerationStage.update({
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
        completedAt: new Date(),
      },
    });
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
      await this.runService.cancelRun(runId);
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
      await this.runService.failRun({
        runId,
        errorCode: 'IDEA_GENERATION_PIPELINE_FAILED',
        errorMessage: this.toSafeErrorMessage(error),
      });
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
