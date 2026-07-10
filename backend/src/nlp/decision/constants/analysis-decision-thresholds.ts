/**
 * Default thresholds used by the NLP decision engine.
 *
 * These thresholds determine whether the available dataset is sufficient,
 * whether the rule-based NLP result can be trusted directly, or whether
 * AI enhancement is expected to improve the final analysis.
 *
 * All ratio and score thresholds are normalized between 0 and 1.
 *
 * @author Eman
 */
export const ANALYSIS_DECISION_THRESHOLDS = {
    /**
     * Dataset-level thresholds.
     */
    dataset: {
        /**
         * Minimum number of analyzed texts required to produce
         * a reliable aggregated NLP result.
         */
        minimumTexts: 30,
    },

    /**
     * Rule-based analysis quality thresholds.
     */
    quality: {
        /**
         * Minimum acceptable overall confidence for the rule-based analysis.
         */
        minimumConfidence: 0.8,

        /**
         * Minimum ratio of meaningful extracted results relative
         * to the analyzed dataset.
         */
        minimumResultDensity: 0.5,

        /**
         * Minimum ratio of evidence-eligible results supported
         * by representative evidence samples.
         */
        minimumEvidenceCoverage: 0.6,

        /**
         * Minimum ratio of collected texts retained after cleaning,
         * duplicate removal, spam filtering, and relevance filtering.
         */
        minimumDataRetentionRate: 0.5,

        /**
         * Minimum ratio of analyzed texts containing at least one
         * meaningful rule-based lexicon signal.
         */
        minimumLexicalCoverage: 0.6,
    },

    /**
     * Text-complexity thresholds.
     *
     * Exceeding these thresholds contributes to the decision to request
     * AI enhancement.
     */
    complexity: {
        /**
         * Maximum acceptable overall complexity score.
         */
        maximumComplexityScore: 0.45,

        /**
         * Maximum acceptable ratio of low-confidence text results.
         */
        maximumLowConfidenceRatio: 0.4,

        /**
         * Maximum acceptable ratio of texts containing negation.
         */
        maximumNegationRatio: 0.45,

        /**
         * Maximum acceptable ratio of texts containing contrastive language.
         */
        maximumContrastRatio: 0.4,

        /**
         * Maximum acceptable ratio of texts containing both positive
         * and negative sentiment signals.
         */
        maximumMixedSentimentRatio: 0.35,

        /**
         * Maximum acceptable ratio of texts associated with multiple topics.
         */
        maximumMultiTopicRatio: 0.4,

        /**
         * Maximum acceptable ratio of texts containing no meaningful
         * lexicon matches.
         */
        maximumUnmatchedLexiconRatio: 0.4,
    },

    /**
     * Weights used to calculate the rule-based suitability score.
     *
     * Quality contributes positively, while complexity is inverted
     * before being included in the final score.
     *
     * The sum of all weights must equal 1.
     */
    suitabilityWeights: {
        confidence: 0.25,
        resultDensity: 0.15,
        evidenceCoverage: 0.15,
        dataRetentionRate: 0.1,
        lexicalCoverage: 0.15,
        inverseComplexity: 0.2,
    },
} as const;