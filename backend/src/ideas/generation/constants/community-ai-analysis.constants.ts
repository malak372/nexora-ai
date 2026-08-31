/**
 * Stable structured-output schema name used by AI runtime logs.
 *
 * Increment the version whenever the provider-facing contract or
 * grounding requirements change materially.
 *
 * @author Malak
 */
export const COMMUNITY_AI_ANALYSIS_SCHEMA_NAME =
  'nexora_community_opportunity_analysis_v6_strict';

export const COMMUNITY_AI_ANALYSIS_DOMAINS_ONLY_SCHEMA_NAME =
  'nexora_community_opportunity_analysis_v6_domains_only';

/**
 * Maximum generated tokens for one community-analysis response.
 *
 * The value is sufficient for a compact structured response while keeping the
 * community-analysis stage inside the bounded fast-generation budget.
 */
export const COMMUNITY_AI_ANALYSIS_MAX_OUTPUT_TOKENS = 1_500;

/**
 * Low temperature keeps extraction deterministic, evidence-focused,
 * and less likely to invent unsupported opportunities.
 */
export const COMMUNITY_AI_ANALYSIS_TEMPERATURE = 0.1;

/**
 * Dedicated schema used by the compact raw-evidence semantic triage phase.
 * Keeping classification separate from opportunity synthesis prevents a large
 * collector corpus from exhausting the synthesis response token budget.
 */
export const COMMUNITY_AI_EVIDENCE_TRIAGE_SCHEMA_NAME =
  'nexora_community_evidence_triage_v13_compact_transport_per_item_admission';

/** Canonical provider-facing semantic labels. Keep prompt/schema/parser in sync by importing these arrays. */
export const COMMUNITY_AI_PROVIDER_EVIDENCE_CLASSIFICATIONS = [
  'DIRECT_PROBLEM',
  'SUPPORTING_SIGNAL',
  'CONTEXT_ONLY',
  'UNRELATED',
] as const;

export const COMMUNITY_AI_EVIDENCE_NATURES = [
  'LIVED_EXPERIENCE',
  'DOCUMENTED_FINDING',
  'MARKET_RESEARCH',
  'PROMOTIONAL',
  'NEUTRAL_CONTEXT',
  'OTHER',
] as const;

export const COMMUNITY_AI_SEMANTIC_ALIGNMENTS = [
  'MATCH',
  'PARTIAL',
  'NONE',
] as const;

export const COMMUNITY_AI_PROBLEM_FAMILY_BASES = [
  'OBSERVED_PROBLEM',
  'CAUSAL_EXPLANATION',
  'SOLUTION_OPINION',
  'NONE',
] as const;

/** Maximum evidence items one complete full-corpus Community AI request may classify. */
export const COMMUNITY_AI_EVIDENCE_TRIAGE_MAX_ITEMS_PER_REQUEST = 96;

/**
 * Maximum representative raw evidence items sent to online semantic triage.
 *
 * The raw collector corpus may contain many repeated comments from one source or
 * thread. Non-semantic duplicate/source/thread hygiene is still applied, but the
 * selected corpus is kept as one semantic unit. The collector-side corpus is
 * already bounded below this transport ceiling in normal generation. Up to
 * three online models receive the exact same complete evidence picture. The
 * first complete or strong-majority per-item-valid response wins and aborts its
 * slower sibling. Low-coverage partial responses never cancel a sibling that
 * may still return better coverage of the same complete corpus.
 */
export const COMMUNITY_AI_EVIDENCE_TRIAGE_MAX_CANDIDATES = 96;

/** Maximum items one source may contribute when multiple sources are present. */
export const COMMUNITY_AI_EVIDENCE_TRIAGE_MAX_ITEMS_PER_SOURCE = 28;

/** Maximum comments sampled from one parent post/thread before online triage. */
export const COMMUNITY_AI_EVIDENCE_TRIAGE_MAX_COMMENTS_PER_THREAD = 2;

/** Token-set Jaccard threshold used only for lexical near-duplicate collapse. */
export const COMMUNITY_AI_EVIDENCE_TRIAGE_NEAR_DUPLICATE_THRESHOLD = 0.9;

/**
 * Safety brake across full-corpus attempts/recovery retries.
 */
export const COMMUNITY_AI_EVIDENCE_TRIAGE_MAX_ONLINE_ATTEMPTS = 64;

/**
 * Full-corpus triage returns one compact semantic verdict object per evidence
 * row. This budget is intentionally independent from the richer opportunity
 * synthesis response and leaves enough headroom to avoid omitted fields.
 */
export const COMMUNITY_AI_EVIDENCE_TRIAGE_MAX_OUTPUT_TOKENS = 12_000;

/**
 * Generous per-model safety cap for full-corpus triage. The service uses an
 * adaptive deadline and still returns immediately when the first sufficiently
 * complete per-item-valid model response arrives, so this cap prevents provider
 * hangs without turning a normal slow response into lost evidence.
 */
export const COMMUNITY_AI_EVIDENCE_TRIAGE_REQUEST_TIMEOUT_MS = 28_000;

/** Absolute safety ceiling for the provider-diverse first-complete race. */
export const COMMUNITY_AI_EVIDENCE_TRIAGE_TOTAL_TIMEOUT_MS = 52_000;

/** Number of parallel online models allowed for the full-corpus triage availability race. */
export const COMMUNITY_AI_EVIDENCE_TRIAGE_PARALLEL_MODELS = 4;

/** Number of accepted classified items sent to opportunity synthesis. */
export const COMMUNITY_AI_EVIDENCE_SYNTHESIS_MAX_ITEMS = 36;


/**
 * Maximum evidence samples included from each persisted NLP group.
 *
 * Bounding the sample count reduces prompt size and provider latency.
 */
export const COMMUNITY_AI_ANALYSIS_MAX_SAMPLES_PER_GROUP = 3;

/**
 * Maximum number of characters retained from one evidence sample.
 */
export const COMMUNITY_AI_ANALYSIS_MAX_SAMPLE_LENGTH = 180;

/**
 * Preferred minimum number of grounded opportunities.
 *
 * Fewer opportunities may still be accepted when the available evidence cannot
 * safely support multiple distinct candidates.
 */
export const COMMUNITY_AI_ANALYSIS_TARGET_MIN_OPPORTUNITIES = 1;

/**
 * Maximum number of opportunities accepted from one AI response.
 */
export const COMMUNITY_AI_ANALYSIS_MAX_OPPORTUNITIES = 2;

/**
 * Number of domain-validation attempts using different online models.
 */
export const COMMUNITY_AI_ANALYSIS_MAX_ATTEMPTS = 4;

/**
 * Only routes with a known hard transport/configuration failure are excluded
 * from the Community race. Slower structured-output models remain eligible as
 * parallel availability hedges; the first complete valid verdict cancels them,
 * so they improve provider resilience without adding a serial timeout window.
 */
export const COMMUNITY_AI_ANALYSIS_EXCLUDED_MODEL_API_IDS = new Set<string>([
  'nvidia/nemotron-nano-9b-v2:free',
]);

/**
 * Maximum models routed by AiExecutionService during one attempt.
 *
 * CommunityAiAnalysisService performs explicit cross-attempt rotation.
 */
export const COMMUNITY_AI_ANALYSIS_MAX_MODELS_PER_OPERATION = 1;

/**
 * Maximum duration of one provider request.
 *
 * Community models run concurrently, so this timeout can be long enough for a
 * healthy provider response without multiplying latency by the number of
 * fallback models.
 */
export const COMMUNITY_AI_ANALYSIS_REQUEST_TIMEOUT_MS = 8_400;

/** Hard wall-clock cap shared by the complete concurrent online fallback chain. */
export const COMMUNITY_AI_ANALYSIS_TOTAL_TIMEOUT_MS = 8_800;

/**
 * Intermediate budget used when deterministic filtering retained at least two
 * requester-related texts, but no single item yet satisfies the strict
 * request-alignment contract. This lane gives Community AI enough time to
 * synthesize complementary evidence without paying the full online budget on
 * zero-evidence runs.
 */
export const COMMUNITY_AI_ANALYSIS_COMPOSITE_REQUEST_TIMEOUT_MS = 6_200;

/** Shared wall-clock cap for the complementary-evidence synthesis lane. */
export const COMMUNITY_AI_ANALYSIS_COMPOSITE_TOTAL_TIMEOUT_MS = 6_800;

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