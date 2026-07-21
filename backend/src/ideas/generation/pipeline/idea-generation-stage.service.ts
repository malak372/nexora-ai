import { Injectable, Logger } from '@nestjs/common';

import type {
  IdeaGenerationStage,
  IdeaGenerationStageExecutionResult,
} from '../interfaces/idea-generation-stage.interface';

import type { IdeaGenerationContext } from '../types/idea-generation-context.type';

import type { IdeaGenerationStageKey } from '../constants/idea-generation-stages.constants';

import { IdeaGenerationRunService } from '../services/idea-generation-run.service';

/**
 * Input required to execute one idea-generation pipeline stage.
 *
 * The pipeline provides the current context together with the
 * progress values associated with the selected stage.
 *
 * @author Malak
 */
export type ExecuteIdeaGenerationStageInput = {
  /**
   * Executable pipeline stage.
   */
  stage: IdeaGenerationStage;

  /**
   * Current mutable idea-generation context shared between
   * pipeline stages.
   */
  context: IdeaGenerationContext;

  /**
   * Overall generation progress recorded immediately before
   * executing the stage.
   *
   * The value must be an integer between 0 and 99.
   */
  startProgressPercent: number;

  /**
   * Overall generation progress recorded after successful stage
   * execution.
   *
   * The value must be an integer between 0 and 99.
   */
  completedProgressPercent: number;
};

/**
 * Result returned after evaluating and executing one pipeline
 * stage.
 *
 * @author Malak
 */
export type ExecuteIdeaGenerationStageResult = {
  /**
   * Updated idea-generation context.
   */
  context: IdeaGenerationContext;

  /**
   * Stable key of the evaluated stage.
   */
  stageKey: IdeaGenerationStageKey;

  /**
   * Indicates whether the stage was executed.
   *
   * False means the optional shouldExecute() method rejected the
   * stage.
   */
  executed: boolean;

  /**
   * Optional short result preview returned by the stage.
   *
   * The pipeline may persist this value in the corresponding
   * IdeaGenerationStage record.
   */
  resultPreview?: string;

  /**
   * Optional structured metadata returned by the stage.
   *
   * Metadata is passed back to the pipeline but is not
   * automatically persisted by this service.
   */
  metadata?: Record<string, unknown>;
};

/**
 * Internal workflow error raised when cancellation is detected
 * before, during, or after stage execution.
 *
 * Cancellation is represented as a workflow state rather than an
 * HTTP exception because it is handled internally by the
 * idea-generation pipeline and orchestrator.
 *
 * @author Malak
 */
export class IdeaGenerationCancelledError extends Error {
  /**
   * Identifier of the cancelled generation run.
   */
  readonly runId: string;

  /**
   * Stage active when cancellation was detected.
   */
  readonly stageKey: IdeaGenerationStageKey;

  constructor(runId: string, stageKey: IdeaGenerationStageKey) {
    super(
      `Idea-generation run "${runId}" was cancelled while processing stage "${stageKey}".`,
    );

    this.name = IdeaGenerationCancelledError.name;
    this.runId = runId;
    this.stageKey = stageKey;
  }
}

/**
 * Service responsible for safely evaluating and executing one
 * stage of the idea-generation pipeline.
 *
 * Responsibilities:
 * - Validate stage execution input.
 * - Check cancellation before and after stage execution.
 * - Evaluate the optional shouldExecute() condition.
 * - Update the active run stage and progress.
 * - Execute the stage implementation.
 * - Validate the returned stage context.
 * - Return the updated context, preview, and metadata.
 * - Invoke optional cancellation and failure cleanup hooks.
 * - Preserve the original execution or cancellation error.
 *
 * This service does not:
 * - Select or order pipeline stages.
 * - Create generation runs.
 * - Persist stage-tracking records.
 * - Retry failed stages.
 * - Complete, fail, or cancel generation runs.
 * - Persist generated ideas directly.
 * - Consume credits or free-generation limits directly.
 * - Release generation locks.
 *
 * Business operations such as AI parsing, duplicate detection,
 * entitlement consumption, and idea persistence belong to their
 * corresponding concrete stage implementations and specialized
 * services.
 *
 * @author Malak
 */
@Injectable()
export class IdeaGenerationStageService {
  private readonly logger = new Logger(IdeaGenerationStageService.name);

  constructor(
    private readonly generationRunService: IdeaGenerationRunService,
  ) {}

  /**
   * Evaluates and executes one idea-generation stage.
   *
   * Execution flow:
   * 1. Validate the context and progress configuration.
   * 2. Check whether cancellation was requested.
   * 3. Evaluate the optional shouldExecute() condition.
   * 4. Return a skipped result when execution is not required.
   * 5. Update the run with the current stage and starting progress.
   * 6. Execute the concrete stage implementation.
   * 7. Validate the returned context and run ownership.
   * 8. Check cancellation again.
   * 9. Update completed-stage progress.
   * 10. Return the updated context and optional stage outputs.
   *
   * Retry logic is intentionally not handled here. The pipeline
   * owns retry decisions according to each stage definition.
   *
   * @param input Stage, context, and progress configuration.
   * @returns Stage execution result.
   */
  async executeStage(
    input: ExecuteIdeaGenerationStageInput,
  ): Promise<ExecuteIdeaGenerationStageResult> {
    const { stage, context, startProgressPercent, completedProgressPercent } =
      input;

    this.validateStage(stage);
    this.validateContext(context);

    this.validateProgressRange(startProgressPercent, 'Stage start progress');

    this.validateProgressRange(
      completedProgressPercent,
      'Stage completed progress',
    );

    this.validateProgressOrder(startProgressPercent, completedProgressPercent);

    await this.throwIfCancellationRequested(context, stage);

    try {
      const shouldExecute = await this.shouldExecuteStage(stage, context);

      if (!shouldExecute) {
        this.logger.debug(
          `Skipped idea-generation stage "${stage.key}" for run "${context.runId}".`,
        );

        return {
          context,
          stageKey: stage.key,
          executed: false,
        };
      }

      await this.generationRunService.updateProgress({
        runId: context.runId,
        currentStageKey: stage.key,
        progressPercent: startProgressPercent,
      });

      this.logger.debug(
        `Started idea-generation stage "${stage.key}" for run "${context.runId}".`,
      );

      const executionResult = await stage.execute(context);

      this.validateExecutionResult(executionResult, stage.key, context.runId);

      await this.throwIfCancellationRequested(executionResult.context, stage);

      await this.generationRunService.updateProgress({
        runId: executionResult.context.runId,
        currentStageKey: stage.key,
        progressPercent: completedProgressPercent,
      });

      this.logger.debug(
        `Completed idea-generation stage "${stage.key}" for run "${executionResult.context.runId}".`,
      );

      return {
        context: executionResult.context,
        stageKey: stage.key,
        executed: true,

        ...(executionResult.resultPreview !== undefined
          ? {
              resultPreview: executionResult.resultPreview,
            }
          : {}),

        ...(executionResult.metadata !== undefined
          ? {
              metadata: executionResult.metadata,
            }
          : {}),
      };
    } catch (error: unknown) {
      if (error instanceof IdeaGenerationCancelledError) {
        throw error;
      }

      const normalizedError = this.normalizeError(error);

      await this.handleStageFailure(stage, context, normalizedError);

      throw normalizedError;
    }
  }

  /**
   * Evaluates the optional shouldExecute() stage condition.
   *
   * When the stage does not define shouldExecute(), execution is
   * enabled by default.
   *
   * @param stage Stage being evaluated.
   * @param context Current generation context.
   * @returns Whether the stage should execute.
   */
  private async shouldExecuteStage(
    stage: IdeaGenerationStage,
    context: IdeaGenerationContext,
  ): Promise<boolean> {
    if (!stage.shouldExecute) {
      return true;
    }

    return stage.shouldExecute(context);
  }

  /**
   * Checks whether cancellation was requested for the active run.
   *
   * When cancellation is detected:
   * - The optional onCancel() hook is invoked.
   * - IdeaGenerationCancelledError is thrown.
   *
   * Cleanup failures are logged but do not replace the original
   * cancellation state.
   *
   * @param context Current generation context.
   * @param stage Active pipeline stage.
   */
  private async throwIfCancellationRequested(
    context: IdeaGenerationContext,
    stage: IdeaGenerationStage,
  ): Promise<void> {
    const cancellationRequested =
      await this.generationRunService.isCancellationRequested(context.runId);

    if (!cancellationRequested) {
      return;
    }

    await this.handleStageCancellation(stage, context);

    throw new IdeaGenerationCancelledError(context.runId, stage.key);
  }

  /**
   * Invokes the optional stage cancellation cleanup hook.
   *
   * Cleanup failures are logged without replacing the
   * cancellation error.
   *
   * @param stage Cancelled stage.
   * @param context Current generation context.
   */
  private async handleStageCancellation(
    stage: IdeaGenerationStage,
    context: IdeaGenerationContext,
  ): Promise<void> {
    if (!stage.onCancel) {
      return;
    }

    try {
      await stage.onCancel(context);

      this.logger.debug(
        `Executed cancellation cleanup for stage "${stage.key}" and run "${context.runId}".`,
      );
    } catch (error: unknown) {
      const cleanupError = this.normalizeError(error);

      this.logger.error(
        `Cancellation cleanup failed for stage "${stage.key}" and run "${context.runId}": ${cleanupError.message}`,
        cleanupError.stack,
      );
    }
  }

  /**
   * Invokes the optional stage failure cleanup hook.
   *
   * Cleanup errors are logged without replacing the original
   * stage failure.
   *
   * @param stage Failed stage.
   * @param context Context available before stage execution.
   * @param error Original stage execution error.
   */
  private async handleStageFailure(
    stage: IdeaGenerationStage,
    context: IdeaGenerationContext,
    error: Error,
  ): Promise<void> {
    this.logger.error(
      `Idea-generation stage "${stage.key}" failed for run "${context.runId}": ${error.message}`,
      error.stack,
    );

    if (!stage.onFailure) {
      return;
    }

    try {
      await stage.onFailure(context, error);
    } catch (failureCleanupError: unknown) {
      const normalizedCleanupError = this.normalizeError(failureCleanupError);

      this.logger.error(
        `Failure cleanup also failed for stage "${stage.key}" and run "${context.runId}": ${normalizedCleanupError.message}`,
        normalizedCleanupError.stack,
      );
    }
  }

  /**
   * Validates the stage object required for execution.
   *
   * @param stage Stage implementation to validate.
   */
  private validateStage(stage: IdeaGenerationStage): void {
    if (!stage) {
      throw new Error('Idea-generation stage is required.');
    }

    if (typeof stage.key !== 'string' || !stage.key.trim()) {
      throw new Error('Idea-generation stage must contain a valid key.');
    }

    if (typeof stage.execute !== 'function') {
      throw new Error(
        `Idea-generation stage "${stage.key}" must define an execute() method.`,
      );
    }
  }

  /**
   * Validates the context required for stage execution.
   *
   * The run identifier must remain available throughout the
   * pipeline because it is used for progress tracking,
   * cancellation checks, and monitoring.
   *
   * @param context Generation context to validate.
   */
  private validateContext(context: IdeaGenerationContext): void {
    if (!context) {
      throw new Error('Idea-generation context is required.');
    }

    if (typeof context.runId !== 'string' || !context.runId.trim()) {
      throw new Error('Idea-generation context must contain a valid run ID.');
    }
  }

  /**
   * Validates the result returned by a concrete stage
   * implementation.
   *
   * Every executed stage must return:
   * - A result object.
   * - A valid updated context.
   * - A context associated with the same generation run.
   *
   * @param result Stage execution result.
   * @param stageKey Executed stage key.
   * @param expectedRunId Original generation-run identifier.
   */
  private validateExecutionResult(
    result: IdeaGenerationStageExecutionResult,
    stageKey: IdeaGenerationStageKey,
    expectedRunId: string,
  ): void {
    if (!result) {
      throw new Error(
        `Idea-generation stage "${stageKey}" did not return an execution result.`,
      );
    }

    this.validateContext(result.context);

    if (result.context.runId.trim() !== expectedRunId.trim()) {
      throw new Error(
        `Idea-generation stage "${stageKey}" returned a context for another generation run.`,
      );
    }

    if (
      result.metadata !== undefined &&
      (typeof result.metadata !== 'object' ||
        result.metadata === null ||
        Array.isArray(result.metadata))
    ) {
      throw new Error(
        `Idea-generation stage "${stageKey}" returned invalid metadata.`,
      );
    }
  }

  /**
   * Validates a progress percentage used while a generation run
   * is active.
   *
   * Progress 100 is reserved for the final completeRun()
   * operation.
   *
   * @param progressPercent Progress value to validate.
   * @param fieldName Field name included in the error message.
   */
  private validateProgressRange(
    progressPercent: number,
    fieldName: string,
  ): void {
    if (
      !Number.isInteger(progressPercent) ||
      progressPercent < 0 ||
      progressPercent > 99
    ) {
      throw new Error(`${fieldName} must be an integer between 0 and 99.`);
    }
  }

  /**
   * Ensures completed-stage progress is not lower than its
   * starting progress.
   *
   * Equal values are permitted for lightweight stages that do not
   * represent a visible progress increase.
   *
   * @param startProgressPercent Stage starting progress.
   * @param completedProgressPercent Stage completed progress.
   */
  private validateProgressOrder(
    startProgressPercent: number,
    completedProgressPercent: number,
  ): void {
    if (completedProgressPercent < startProgressPercent) {
      throw new Error(
        'Stage completed progress cannot be lower than stage start progress.',
      );
    }
  }

  /**
   * Converts an unknown thrown value into a standard Error.
   *
   * @param error Unknown thrown value.
   * @returns Standard Error instance.
   */
  private normalizeError(error: unknown): Error {
    if (error instanceof Error) {
      return error;
    }

    if (typeof error === 'string') {
      return new Error(error);
    }

    return new Error('Unknown idea-generation stage execution error.');
  }
}
