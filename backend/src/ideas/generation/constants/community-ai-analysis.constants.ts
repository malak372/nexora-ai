/**
 * Stable structured-output schema name used by AI runtime logs.
 *
 * Increment the version whenever the provider-facing contract or
 * grounding requirements change materially.
 *
 * @author Malak
 */
export const COMMUNITY_AI_ANALYSIS_SCHEMA_NAME =
  'nexora_community_opportunity_analysis_v3';

/**
 * Maximum generated tokens for one community-analysis response.
 *
 * The value intentionally fits the configured local Qwen fallback
 * while remaining sufficient for a compact structured response.
 */
export const COMMUNITY_AI_ANALYSIS_MAX_OUTPUT_TOKENS = 1_400;

/**
 * Low temperature keeps extraction deterministic, evidence-focused,
 * and less likely to invent unsupported opportunities.
 */
export const COMMUNITY_AI_ANALYSIS_TEMPERATURE = 0.1;

/**
 * Maximum evidence samples included from each persisted NLP group.
 *
 * Bounding the sample count reduces prompt size and improves local
 * fallback latency.
 */
export const COMMUNITY_AI_ANALYSIS_MAX_SAMPLES_PER_GROUP = 8;

/**
 * Maximum number of characters retained from one evidence sample.
 */
export const COMMUNITY_AI_ANALYSIS_MAX_SAMPLE_LENGTH = 450;

/**
 * Preferred minimum number of grounded opportunities.
 *
 * Fewer opportunities may still be accepted when the available
 * evidence cannot safely support three distinct candidates.
 */
export const COMMUNITY_AI_ANALYSIS_TARGET_MIN_OPPORTUNITIES = 3;

/**
 * Maximum number of opportunities accepted from one AI response.
 */
export const COMMUNITY_AI_ANALYSIS_MAX_OPPORTUNITIES = 5;

/**
 * Number of domain-validation attempts using different online models.
 */
export const COMMUNITY_AI_ANALYSIS_MAX_ATTEMPTS = 2;

/**
 * Maximum models routed by AiExecutionService during one attempt.
 *
 * CommunityAiAnalysisService performs explicit cross-attempt rotation.
 */
export const COMMUNITY_AI_ANALYSIS_MAX_MODELS_PER_OPERATION = 1;

/**
 * Maximum duration of one provider request.
 *
 * The longer timeout gives the local Ollama fallback enough time to
 * return valid structured JSON on consumer hardware.
 */
export const COMMUNITY_AI_ANALYSIS_REQUEST_TIMEOUT_MS = 75_000;

/**
 * Maximum entries retained from one persisted NLP summary array.
 */
export const COMMUNITY_AI_ANALYSIS_MAX_SUMMARY_ITEMS = 8;

/**
 * Minimum overall confidence accepted after grounding.
 */
export const COMMUNITY_AI_ANALYSIS_MIN_OVERALL_CONFIDENCE = 40;

/**
 * Minimum confidence required for an opportunity to participate
 * in business-quality validation.
 */
export const COMMUNITY_AI_ANALYSIS_MIN_OPPORTUNITY_CONFIDENCE = 35;

/**
 * Minimum total grounded evidence samples required in an accepted
 * community-analysis response.
 */
export const COMMUNITY_AI_ANALYSIS_MIN_TOTAL_EVIDENCE_SAMPLES = 1;