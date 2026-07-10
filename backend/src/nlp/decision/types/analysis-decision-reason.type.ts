/**
 * Defines the reason contracts used to explain NLP decision outcomes.
 *
 * @author Eman
 */

/**
 * Stable machine-readable reason codes produced by the NLP decision engine.
 *
 * These codes support logging, testing, auditing, and future admin dashboards.
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
 * Represents a reason that contributed to the final NLP decision.
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
     * Relative importance of this reason in the final decision.
     *
     * Must be a normalized value between 0 and 1.
     */
    readonly weight: number;
};