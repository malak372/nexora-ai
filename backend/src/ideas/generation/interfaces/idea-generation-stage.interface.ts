import type { IdeaGenerationContext } from '../types/idea-generation-context.type';

import type {
  IdeaGenerationStageDefinition,
  IdeaGenerationStageKey,
} from '../constants/idea-generation-stages.constants';

/**
 * Result returned after executing one generation stage.
 *
 * The pipeline uses this result to:
 * - Update the generation context.
 * - Persist a stage preview.
 * - Update generation progress.
 * - Decide whether pipeline execution may continue.
 *
 * @author Malak
 */
export type IdeaGenerationStageExecutionResult = {
  /**
   * Updated context after stage execution.
   *
   * The stage may return the same context instance after
   * modifying it or return a new context object.
   */
  context: IdeaGenerationContext;

  /**
   * Optional short result preview stored in
   * IdeaGenerationStage.resultPreview.
   *
   * Large results should be persisted in their dedicated models.
   */
  resultPreview?: string;

  /**
   * Optional structured metadata used internally by
   * the pipeline or monitoring services.
   *
   * This value is not automatically persisted.
   */
  metadata?: Record<string, unknown>;
};

/**
 * Contract implemented by every executable generation stage.
 *
 * Each stage must:
 * - Declare its stable stage key.
 * - Declare its pipeline configuration.
 * - Execute one isolated generation responsibility.
 * - Return the updated generation context.
 *
 * Stages should remain independent and should not manually
 * update IdeaGenerationRun or IdeaGenerationStage records.
 * Pipeline tracking is handled by the orchestrator and stage
 * management services.
 *
 * @author Malak
 */
export interface IdeaGenerationStage {
  /**
   * Stable key identifying the stage.
   */
  readonly key: IdeaGenerationStageKey;

  /**
   * Static configuration associated with this stage.
   */
  readonly definition: IdeaGenerationStageDefinition;

  /**
   * Executes the stage using the current pipeline context.
   *
   * @param context Current idea-generation context.
   * @returns Updated context and optional result preview.
   */
  execute(
    context: IdeaGenerationContext,
  ): Promise<IdeaGenerationStageExecutionResult>;

  /**
   * Determines whether the stage should execute.
   *
   * Most core stages always execute. Premium output stages may
   * use this method to verify that premium outputs are enabled.
   *
   * When omitted, the pipeline assumes that the stage should run.
   *
   * @param context Current idea-generation context.
   */
  shouldExecute?(context: IdeaGenerationContext): boolean | Promise<boolean>;

  /**
   * Optional cancellation cleanup hook.
   *
   * This hook may be used when a stage owns temporary resources
   * that must be released after cancellation.
   *
   * It must not hide or suppress the original cancellation.
   */
  onCancel?(context: IdeaGenerationContext): Promise<void>;

  /**
   * Optional failure cleanup hook.
   *
   * This hook is invoked after the stage exhausts all configured
   * retry attempts.
   *
   * It must not throw unless cleanup failure is itself critical.
   */
  onFailure?(context: IdeaGenerationContext, error: Error): Promise<void>;
}
