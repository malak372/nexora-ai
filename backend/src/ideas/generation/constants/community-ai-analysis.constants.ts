/** Stable structured-output schema name used by AI runtime logs. */
export const COMMUNITY_AI_ANALYSIS_SCHEMA_NAME =
  'nexora_community_opportunity_analysis_v2';

/** Bounded output size for community opportunity extraction. */
export const COMMUNITY_AI_ANALYSIS_MAX_OUTPUT_TOKENS = 4_500;

/** Low temperature keeps extraction repeatable and evidence focused. */
export const COMMUNITY_AI_ANALYSIS_TEMPERATURE = 0.15;

/** Maximum samples sent to the LLM from each persisted NLP sample group. */
export const COMMUNITY_AI_ANALYSIS_MAX_SAMPLES_PER_GROUP = 20;

/** Maximum characters retained from one evidence sample. */
export const COMMUNITY_AI_ANALYSIS_MAX_SAMPLE_LENGTH = 650;

/** Preferred minimum number of distinct opportunities when evidence supports it. */
export const COMMUNITY_AI_ANALYSIS_TARGET_MIN_OPPORTUNITIES = 5;

/** Maximum opportunities accepted from the LLM. */
export const COMMUNITY_AI_ANALYSIS_MAX_OPPORTUNITIES = 8;

/**
 * Maximum domain-level attempts for community analysis.
 *
 * AiExecutionService already performs temporary retries and provider fallback.
 * These attempts are an additional business-validation layer used when a
 * response is technically valid JSON but semantically unreliable.
 */
export const COMMUNITY_AI_ANALYSIS_MAX_ATTEMPTS = 2;

/**
 * Maximum number of routed models attempted by one community-analysis
 * execution. The domain-level retry loop may rotate to another model after a
 * schema-valid but semantically weak response.
 */
export const COMMUNITY_AI_ANALYSIS_MAX_MODELS_PER_OPERATION = 2;

/** Per-provider timeout used only by the non-fatal community-analysis stage. */
export const COMMUNITY_AI_ANALYSIS_REQUEST_TIMEOUT_MS = 120_000;

/** Maximum entries retained from one NLP summary array in the AI prompt. */
export const COMMUNITY_AI_ANALYSIS_MAX_SUMMARY_ITEMS = 12;

/** Minimum overall confidence accepted from one community-analysis response. */
export const COMMUNITY_AI_ANALYSIS_MIN_OVERALL_CONFIDENCE = 45;

/** Minimum confidence required for at least one returned opportunity. */
export const COMMUNITY_AI_ANALYSIS_MIN_OPPORTUNITY_CONFIDENCE = 40;

/** Minimum number of evidence samples required by the accepted response. */
export const COMMUNITY_AI_ANALYSIS_MIN_TOTAL_EVIDENCE_SAMPLES = 2;
