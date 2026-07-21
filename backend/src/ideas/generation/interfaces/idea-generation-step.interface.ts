import type { IdeaGenerationContext } from '../types/idea-generation-context.type';

/**
 * Generic execution result returned by one internal
 * idea-generation step.
 *
 * Unlike a pipeline stage, a step is not necessarily persisted
 * as an IdeaGenerationStage record.
 *
 * @author Malak
 */
export type IdeaGenerationStepResult<TResult> = {
  /**
   * Result produced by the step.
   */
  result: TResult;

  /**
   * Optional updated generation context.
   *
   * This may be omitted when the step does not modify context.
   */
  context?: IdeaGenerationContext;

  /**
   * Optional internal metadata.
   */
  metadata?: Record<string, unknown>;
};

/**
 * Contract for a reusable operation executed inside one or more
 * idea-generation stages.
 *
 * Examples:
 * - Normalize AI output.
 * - Build one output prompt.
 * - Resolve one data source.
 * - Calculate title similarity.
 * - Map a generated output.
 *
 * Steps are smaller than pipeline stages and should focus on one
 * isolated technical responsibility.
 *
 * @author Malak
 */
export interface IdeaGenerationStep<
  TInput = IdeaGenerationContext,
  TResult = unknown,
> {
  /**
   * Stable internal key used for logs and debugging.
   *
   * Step keys are not persisted as pipeline stage keys.
   */
  readonly key: string;

  /**
   * Executes the reusable internal operation.
   *
   * @param input Input required by this step.
   */
  execute(input: TInput): Promise<IdeaGenerationStepResult<TResult>>;
}

/**
 * Synchronous variant used for lightweight operations that do not
 * require database, network, filesystem or AI access.
 *
 * Examples:
 * - Title normalization.
 * - Output mapping.
 * - Validation of an already parsed object.
 *
 * @author Malak
 */
export interface SynchronousIdeaGenerationStep<TInput, TResult> {
  /**
   * Stable internal key used for logs and debugging.
   */
  readonly key: string;

  /**
   * Executes the synchronous operation.
   */
  execute(input: TInput): IdeaGenerationStepResult<TResult>;
}
