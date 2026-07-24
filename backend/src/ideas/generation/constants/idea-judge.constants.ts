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
export const IDEA_JUDGE_MAX_OUTPUT_TOKENS = 4_096;

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