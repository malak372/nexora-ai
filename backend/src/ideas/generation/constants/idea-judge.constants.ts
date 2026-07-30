/**
 * Stable structured-output schema name used by the central AI runtime.
 *
 * @author Malak
 */
export const IDEA_JUDGE_RESPONSE_SCHEMA_NAME = 'idea_candidate_evaluation';

/**
 * Maximum output-token budget requested for comparative evaluation.
 *
 * AiExecutionService still clamps this value to the selected judge model's
 * configured maximum. The larger budget allows the judge to score every
 * successful candidate instead of limiting the comparison to a fixed top-N.
 *
 * @author Malak
 */
export const IDEA_JUDGE_MAX_OUTPUT_TOKENS = 2_048;

/**
 * Low temperature used to keep comparative decisions stable and repeatable.
 *
 * @author Malak
 */
export const IDEA_JUDGE_TEMPERATURE = 0.1;

/**
 * Relative criteria weights used exclusively by the comparative AI judge.
 *
 * These weights add up to 100. They guide the judge's own overallScore; they
 * are not combined with the deterministic quality score.
 *
 * @author Malak
 */
export const IDEA_JUDGE_CRITERIA_WEIGHTS = {
  localRelevance: 20,
  problemImportance: 18,
  innovation: 17,
  regulatoryFeasibility: 12,
  technicalFeasibility: 13,
  marketPotential: 12,
  implementationClarity: 8,
} as const;

/**
 * Relative contribution of the comparative AI judge to the final winner score.
 *
 * @author Malak
 */
export const IDEA_JUDGE_FINAL_SCORE_WEIGHT = 0.7;

/**
 * Relative contribution of the deterministic quality evaluator to the final
 * winner score. Both final-score weights must add up to exactly 1.
 *
 * @author Malak
 */
export const IDEA_DETERMINISTIC_FINAL_SCORE_WEIGHT = 0.3;

/**
 * Minimum comparative-judge confidence required before judge scores may
 * influence the final hybrid winner score.
 *
 * Judge confidence is normalized to the canonical 0-100 range before this
 * threshold is applied. Fractional provider responses in the 0-1 range are
 * converted to percentages by IdeaCandidateJudgeService for compatibility.
 * When confidence is below this threshold, deterministic quality scoring
 * remains the source of truth and judge scores are retained for diagnostics
 * only.
 *
 * @author Malak
 */
export const IDEA_JUDGE_MIN_CONFIDENCE_FOR_HYBRID_SELECTION = 65;

/** Maximum number of candidates included in one comparative judge request. */
export const IDEA_JUDGE_MAX_CANDIDATES = 3;

/** Maximum number of bounded comparative-judge execution attempts. */
export const IDEA_JUDGE_MAX_ATTEMPTS = 2;

/** Maximum characters retained from each long advanced-output summary. */
export const IDEA_JUDGE_ADVANCED_OUTPUT_SUMMARY_MAX_CHARS = 280;

/** Advanced outputs that provide the highest comparative decision value. */
export const IDEA_JUDGE_RELEVANT_ADVANCED_OUTPUT_KEYS = new Set<string>([
  'value-proposition',
  'market-potential',
  'feasibility-assessment',
  'implementation-timeline',
  'local-regulations',
]);
