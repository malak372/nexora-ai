/**
 * Defines the final decision contract used by the NLP decision engine.
 *
 */

import type { AnalysisDecisionReason } from './analysis-decision-reason.type';
import type { AnalysisQualityMetrics } from './analysis-quality-metrics.type';
import type { TextComplexityMetrics } from './text-complexity-metrics.type';

/**
 * Represents the final action selected by the NLP decision engine.
 *
 * These actions determine whether the rule-based NLP result
 * can be used directly, should be enhanced by AI, or whether
 * the available dataset is insufficient for reliable analysis.
 *
 * @author Eman
 */
export enum AnalysisDecisionAction {
  /**
   * The rule-based NLP result is reliable enough to be used directly.
   */
  RULE_BASED_ONLY = 'RULE_BASED_ONLY',

  /**
   * The rule-based result contains useful signals but requires
   * AI enhancement because of ambiguity, complexity, or weak coverage.
   */
  AI_ENHANCEMENT_REQUIRED = 'AI_ENHANCEMENT_REQUIRED',

  /**
   * The collected data is insufficient to produce a reliable result,
   * even when AI enhancement is available.
   */
  INSUFFICIENT_DATA = 'INSUFFICIENT_DATA',
}

/**
 * Represents the complete decision produced by the NLP decision engine.
 *
 * This result combines the selected action, calculated suitability score,
 * aggregated quality and complexity metrics, and the detailed reasons that
 * explain how the decision was reached.
 *
 */
export type AnalysisDecisionResult = {
  /**
   * Final action selected by the decision engine.
   */
  readonly action: AnalysisDecisionAction;

  /**
   * Overall rule-based suitability score.
   *
   * Values are normalized between 0 and 1, where higher values indicate
   * that the rule-based analysis is more reliable and less likely to
   * require AI enhancement.
   */
  readonly ruleBasedSuitabilityScore: number;

  /**
   * Quality indicators calculated from the rule-based NLP output.
   */
  readonly qualityMetrics: AnalysisQualityMetrics;

  /**
   * Complexity indicators calculated from the analyzed posts and comments.
   */
  readonly complexityMetrics: TextComplexityMetrics;

  /**
   * Detailed reasons explaining the final decision.
   *
   * Reasons are ordered by their relative importance to improve
   * transparency, debugging, logging, and future administrative reporting.
   */
  readonly reasons: readonly AnalysisDecisionReason[];
};
