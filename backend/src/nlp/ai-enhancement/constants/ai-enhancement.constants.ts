/**
 * Constants used by the AI enhancement layer.
 *
 * These limits protect the NLP pipeline from oversized AI responses,
 * control prompt size, and standardize AI-enhanced analytical output.
 *
 * Confidence weights are applied when merging rule-based analysis
 * with AI-enhanced results.
 *
 * @author Eman
 */

/**
 * Maximum number of recurring problems accepted from AI enhancement.
 */
export const MAX_AI_RECURRING_PROBLEMS = 15;

/**
 * Maximum number of extracted needs accepted from AI enhancement.
 */
export const MAX_AI_EXTRACTED_NEEDS = 15;

/**
 * Maximum number of feature requests accepted from AI enhancement.
 */
export const MAX_AI_FEATURE_REQUESTS = 15;

/**
 * Maximum number of opportunities accepted from AI enhancement.
 */
export const MAX_AI_OPPORTUNITIES = 15;

/**
 * Maximum number of insights accepted from AI enhancement.
 */
export const MAX_AI_INSIGHTS = 15;

/**
 * Maximum number of evidence identifiers allowed for a single
 * AI-enhanced analytical item.
 */
export const MAX_AI_EVIDENCE_IDS_PER_ITEM = 10;

/**
 * Maximum number of evidence samples included in one AI prompt.
 *
 * Limiting evidence helps control prompt size, execution cost,
 * and response latency.
 */
export const MAX_AI_PROMPT_EVIDENCE_SAMPLES = 40;

/**
 * Weight assigned to the rule-based analysis when calculating
 * the final merged confidence.
 *
 * Rule-based analysis receives the higher weight because it is
 * derived directly from collected community data.
 */
export const RULE_BASED_CONFIDENCE_WEIGHT = 0.65;

/**
 * Weight assigned to the AI enhancement result when calculating
 * the final merged confidence.
 */
export const AI_CONFIDENCE_WEIGHT = 0.35;
