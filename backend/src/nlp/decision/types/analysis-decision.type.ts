/**
 * Defines the final decision contract used by the NLP decision engine.
 *
 * @author Eman
 */

import type { AnalysisDecisionReason } from './analysis-decision-reason.type';
import type { AnalysisQualityMetrics } from './analysis-quality-metrics.type';
import type { TextComplexityMetrics } from './text-complexity-metrics.type';

/**
 * Represents the final action selected by the NLP decision engine.
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
 * Represents the final result returned by the NLP decision engine.
 */
export type AnalysisDecisionResult = {
    /**
     * Final action selected by the decision engine.
     */
    readonly action: AnalysisDecisionAction;

    /**
     * Overall rule-based suitability score from 0 to 1.
     *
     * A higher value indicates that the rule-based analysis is more reliable
     * and less likely to require AI enhancement.
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
     */
    readonly reasons: readonly AnalysisDecisionReason[];
};