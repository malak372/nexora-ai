/**
 * Defines quality metrics calculated from the rule-based NLP analysis.
 *
 * These metrics are used by the NLP decision engine to evaluate
 * the reliability of the rule-based analysis before deciding whether
 * AI enhancement is required.
 *
 * @author Eman
 */

/**
 * Represents the quality indicators produced by the rule-based NLP pipeline.
 */
export type AnalysisQualityMetrics = {
  /**
   * Overall confidence produced by the rule-based NLP analysis.
   *
   * Value range: 0.0 - 1.0
   */
  readonly confidence: number;

  /**
   * Ratio of meaningful extracted insights relative to the
   * analyzed dataset.
   *
   * Value range: 0.0 - 1.0
   */
  readonly resultDensity: number;

  /**
   * Ratio of extracted insights supported by evidence samples.
   *
   * Value range: 0.0 - 1.0
   */
  readonly evidenceCoverage: number;

  /**
   * Ratio of texts retained after preprocessing.
   *
   * This metric reflects how much of the collected dataset
   * was considered useful for analysis.
   *
   * Value range: 0.0 - 1.0
   */
  readonly dataRetentionRate: number;

  /**
   * Ratio of analyzed texts containing at least one
   * rule-based linguistic signal.
   *
   * Value range: 0.0 - 1.0
   */
  readonly lexicalCoverage: number;
};
