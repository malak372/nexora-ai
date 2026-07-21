/**
 * Defines the reason contracts used to explain NLP decision outcomes.
 *
 * @author Eman
 */

/**
 * Stable machine-readable reason codes produced by the NLP decision engine.
 *
 * These codes support logging, testing, auditing, and future
 * administrative dashboards while remaining independent of
 * presentation-specific wording.
 *
 */
export enum AnalysisDecisionReasonCode {
  INSUFFICIENT_TEXTS = 'INSUFFICIENT_TEXTS',

  LOW_CONFIDENCE = 'LOW_CONFIDENCE',
  LOW_RESULT_DENSITY = 'LOW_RESULT_DENSITY',
  LOW_EVIDENCE_COVERAGE = 'LOW_EVIDENCE_COVERAGE',
  LOW_DATA_RETENTION = 'LOW_DATA_RETENTION',
  LOW_LEXICAL_COVERAGE = 'LOW_LEXICAL_COVERAGE',

  HIGH_TEXT_COMPLEXITY = 'HIGH_TEXT_COMPLEXITY',
  HIGH_LOW_CONFIDENCE_RATIO = 'HIGH_LOW_CONFIDENCE_RATIO',
  HIGH_NEGATION_RATIO = 'HIGH_NEGATION_RATIO',
  HIGH_CONTRAST_RATIO = 'HIGH_CONTRAST_RATIO',
  HIGH_MIXED_SENTIMENT_RATIO = 'HIGH_MIXED_SENTIMENT_RATIO',
  HIGH_MULTI_TOPIC_RATIO = 'HIGH_MULTI_TOPIC_RATIO',
  HIGH_UNMATCHED_LEXICON_RATIO = 'HIGH_UNMATCHED_LEXICON_RATIO',

  STRONG_RULE_BASED_RESULT = 'STRONG_RULE_BASED_RESULT',
}

/**
 * Represents one explanation that contributed to the final
 * NLP decision.
 *
 * Each decision may contain multiple reasons describing why
 * the decision engine selected the final outcome.
 *
 */
export type AnalysisDecisionReason = {
  /**
   * Stable machine-readable reason identifier.
   */
  readonly code: AnalysisDecisionReasonCode;

  /**
   * Human-readable explanation of the decision reason.
   */
  readonly message: string;

  /**
   * Relative contribution of this reason to the final decision.
   *
   * Values are normalized between 0 and 1 and are intended
   * for explanation, ranking, and auditing purposes only.
   *
   * This value does not affect the decision itself. It only
   * describes the significance of the reported reason.
   */
  readonly weight: number;
};