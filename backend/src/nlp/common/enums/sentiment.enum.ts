/**
 * Represents the overall sentiment detected during NLP analysis.
 *
 * This enum is used throughout the Nexora AI NLP pipeline to classify
 * the emotional tone of collected community content, including social
 * posts and comments.
 *
 * Sentiment analysis contributes to:
 * - Measuring overall user satisfaction.
 * - Identifying frustration and recurring pain points.
 * - Supporting idea generation with real community feedback.
 * - Building sentiment statistics for analytics and dashboards.
 *
 * Values:
 * - POSITIVE: Content expresses satisfaction, approval, or positive feedback.
 * - NEGATIVE: Content expresses complaints, issues, dissatisfaction, or unmet needs.
 * - NEUTRAL: Content is informational or does not express a clear sentiment.
 *
 * @author Eman
 */
export enum Sentiment {
  /**
   * Positive user opinion or feedback.
   */
  POSITIVE = 'POSITIVE',

  /**
   * Negative user opinion, complaint, or problem.
   */
  NEGATIVE = 'NEGATIVE',

  /**
   * Neutral or informational content.
   */
  NEUTRAL = 'NEUTRAL',
}
