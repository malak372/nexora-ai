import { AiEnhancementOutput } from './ai-enhancement-output.type';

/**
 * Types describing the outcome of one AI-enhancement operation.
 *
 * The result explicitly distinguishes between:
 * - AI enhancement not being requested.
 * - AI enhancement successfully applied.
 * - AI enhancement requested but not applied.
 *
 * @author Eman
 */

/**
 * AI enhancement was not requested by the decision layer.
 */
export type AiEnhancementSkippedResult = {
  readonly requested: false;

  readonly applied: false;

  readonly output: null;

  readonly failureReason: null;
};

/**
 * AI enhancement completed successfully and its output was accepted.
 */
export type AiEnhancementAppliedResult = {
  readonly requested: true;

  readonly applied: true;

  readonly output: AiEnhancementOutput;

  readonly failureReason: null;
};

/**
 * AI enhancement was requested but could not be applied.
 *
 * Examples include:
 * - AI service unavailable.
 * - Invalid AI response.
 * - Response validation failure.
 */
export type AiEnhancementFailedResult = {
  readonly requested: true;

  readonly applied: false;

  readonly output: null;

  /**
   * Human-readable explanation describing why the enhancement
   * could not be applied.
   */
  readonly failureReason: string;
};

/**
 * Result returned by the AI-enhancement layer.
 */
export type AiEnhancementResult =
  | AiEnhancementSkippedResult
  | AiEnhancementAppliedResult
  | AiEnhancementFailedResult;
