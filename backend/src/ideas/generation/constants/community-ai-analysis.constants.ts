/**
 * Stable structured-output schema name used by AI runtime logs.
 *
 * Increment the version whenever the provider-facing contract or
 * grounding requirements change materially.
 *
 * @author Malak
 */
export const COMMUNITY_AI_ANALYSIS_SCHEMA_NAME =
  'nexora_community_opportunity_analysis_v4';

/**
 * Maximum generated tokens for one community-analysis response.
 *
 * The value is sufficient for a compact structured response while keeping the
 * community-analysis stage inside the bounded fast-generation budget.
 */
export const COMMUNITY_AI_ANALYSIS_MAX_OUTPUT_TOKENS = 900;

/**
 * Low temperature keeps extraction deterministic, evidence-focused,
 * and less likely to invent unsupported opportunities.
 */
export const COMMUNITY_AI_ANALYSIS_TEMPERATURE = 0.1;

/**
 * Maximum evidence samples included from each persisted NLP group.
 *
 * Bounding the sample count reduces prompt size and provider latency.
 */
export const COMMUNITY_AI_ANALYSIS_MAX_SAMPLES_PER_GROUP = 4;

/**
 * Maximum number of characters retained from one evidence sample.
 */
export const COMMUNITY_AI_ANALYSIS_MAX_SAMPLE_LENGTH = 220;

/**
 * Preferred minimum number of grounded opportunities.
 *
 * Fewer opportunities may still be accepted when the available evidence cannot
 * safely support three distinct candidates.
 */
export const COMMUNITY_AI_ANALYSIS_TARGET_MIN_OPPORTUNITIES = 1;

/**
 * Maximum number of opportunities accepted from one AI response.
 */
export const COMMUNITY_AI_ANALYSIS_MAX_OPPORTUNITIES = 2;

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
 * The bounded timeout prevents the community-analysis stage from becoming a
 * bottleneck in the one-minute generation path.
 */
export const COMMUNITY_AI_ANALYSIS_REQUEST_TIMEOUT_MS = 4_800;

/** Hard wall-clock cap for the complete online fallback chain. */
export const COMMUNITY_AI_ANALYSIS_TOTAL_TIMEOUT_MS = 5_300;

/**
 * Disables the explicit Ollama fallback in the strict fast-generation path.
 *
 * Deterministic NLP remains available as the non-blocking fallback whenever
 * online AI analysis fails or exceeds its bounded attempts.
 */
export const COMMUNITY_AI_ANALYSIS_ALLOW_LOCAL_FALLBACK = false;

/**
 * Maximum entries retained from one persisted NLP summary array.
 */
export const COMMUNITY_AI_ANALYSIS_MAX_SUMMARY_ITEMS = 12;

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