/**
 * Defines text complexity metrics used by the NLP decision engine
 * to determine whether AI enhancement is required.
 *
 * @author Eman
 */

/**
 * Represents the aggregated complexity indicators calculated
 * from the analyzed texts.
 *
 * These metrics estimate how difficult the dataset is for the
 * rule-based NLP engine and help determine whether AI
 * enhancement is likely to improve the final analysis.
 */
export type TextComplexityMetrics = {
  /**
   * Average number of normalized words across analyzed texts.
   *
   * Unlike the ratio-based metrics below, this value is not normalized
   * and may be greater than 1.
   *
   * Example:
   * - 12.5 indicates that analyzed texts contain an average of
   *   approximately twelve and a half words.
   */
  readonly averageTextLength: number;

  /**
   * Ratio of texts containing negation signals.
   *
   * Examples:
   * - not
   * - never
   * - no longer
   *
   * Value range: 0.0 - 1.0
   */
  readonly negationRatio: number;

  /**
   * Ratio of texts containing contrastive expressions such as:
   * - but
   * - however
   * - although
   *
   * Value range: 0.0 - 1.0
   */
  readonly contrastRatio: number;

  /**
   * Ratio of texts expressing mixed or conflicting sentiment.
   *
   * Value range: 0.0 - 1.0
   */
  readonly mixedSentimentRatio: number;

  /**
   * Ratio of texts whose rule-based confidence is below
   * the accepted threshold.
   *
   * Value range: 0.0 - 1.0
   */
  readonly lowConfidenceRatio: number;

  /**
   * Ratio of texts discussing multiple independent topics
   * or problems.
   *
   * Value range: 0.0 - 1.0
   */
  readonly multiTopicRatio: number;

  /**
   * Ratio of texts that produced no meaningful rule-based
   * lexical matches.
   *
   * Value range: 0.0 - 1.0
   */
  readonly unmatchedLexiconRatio: number;

  /**
   * Overall text complexity score calculated from the
   * previous indicators.
   *
   * A higher value indicates that AI enhancement is more
   * likely to improve the final analysis.
   *
   * Value range: 0.0 - 1.0
   */
  readonly complexityScore: number;
};