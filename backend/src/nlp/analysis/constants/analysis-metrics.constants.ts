/**
 * Expected number of distinct aggregate NLP findings per analyzed text.
 *
 * Keywords, topics, problems, needs, feature requests, and opportunities are
 * corpus-level aggregates rather than one result per input text. A target of
 * two results per text made a healthy 40-text corpus require 80 distinct
 * findings, which systematically understated confidence. The revised target
 * expects roughly one meaningful aggregate finding per four retained texts.
 *
 * The metrics service also applies lower and upper bounds so very small and
 * very large collection jobs remain comparable.
 *
 * @author Eman
 */
export const TARGET_RESULTS_PER_TEXT = 0.25;

/** Minimum aggregate findings expected from a usable collection job. */
export const MINIMUM_TARGET_RESULTS = 5;

/** Prevents large corpora from requiring an unbounded number of aggregates. */
export const MAXIMUM_TARGET_RESULTS = 20;

/**
 * Weights used to calculate deterministic rule-based analysis confidence.
 *
 * These weights deliberately keep text-level confidence and direct evidence
 * as the strongest signals. Result density is supportive, not dominant, so
 * adding many weak labels cannot manufacture a high confidence score.
 *
 * The sum of all configured weights must equal 1.
 *
 * @author Eman
 */
export const ANALYSIS_CONFIDENCE_WEIGHTS = {
  textConfidence: 0.35,
  resultDensity: 0.15,
  evidenceCoverage: 0.25,
  dataRetentionRate: 0.15,
  lexicalCoverage: 0.1,
} as const;
