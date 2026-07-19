/**
 * Target number of meaningful extracted results expected
 * per analyzed text.
 *
 * This value is used to normalize the result-density metric.
 * Results beyond this target do not increase the normalized
 * density score above 1.
 *
 * @author Eman
 */
export const TARGET_RESULTS_PER_TEXT = 2;

/**
 * Weights used to calculate the overall confidence of the
 * rule-based NLP analysis.
 *
 * The sum of all configured weights must equal 1.
 *
 * @author Eman
 */
export const ANALYSIS_CONFIDENCE_WEIGHTS = {
  textConfidence: 0.4,
  resultDensity: 0.2,
  evidenceCoverage: 0.15,
  dataRetentionRate: 0.15,
  lexicalCoverage: 0.1,
} as const;