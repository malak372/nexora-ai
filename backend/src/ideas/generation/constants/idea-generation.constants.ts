/**
 * Shared constants used by the idea-generation workflow.
 *
 * These values control:
 * - Generation entitlements.
 * - Distributed generation locking.
 * - Pipeline heartbeat behavior.
 * - Collection-job reuse.
 * - Pipeline-stage retries.
 * - Duplicate-idea detection.
 * - Progress boundaries.
 * - Error-code reporting.
 *
 * @author Malak
 */

/**
 * Legacy default retained for compatibility with older imports.
 *
 * @deprecated Runtime Premium-generation cost must be read from
 * SystemSetting.premiumIdeaCreditCost. Do not use this constant for billing,
 * entitlement checks, or low-credit thresholds.
 */
export const PREMIUM_IDEA_CREDIT_COST = 15;

/**
 * Default number of free idea generations available to a
 * registered user.
 *
 * The effective limit should still be read from
 * User.freeGenerationLimit because administrators or future
 * business rules may configure a user-specific value.
 */
export const DEFAULT_FREE_GENERATION_LIMIT = 3;

/**
 * Maximum number of ideas that one guest session may generate.
 */
export const GUEST_GENERATION_LIMIT = 1;

/**
 * Maximum number of active generation runs allowed for the
 * same generation owner.
 *
 * A generation owner is either:
 * - An authenticated user.
 * - A guest session.
 */
export const MAX_ACTIVE_GENERATION_RUNS_PER_OWNER = 1;

/**
 * Duration of the distributed idea-generation lock.
 *
 * The lock prevents duplicate generation requests caused by:
 * - Repeated button clicks.
 * - Client-side retries.
 * - Network retries.
 * - Concurrent requests.
 * - Multiple backend instances processing the same owner.
 *
 * Current value: five minutes.
 */
export const IDEA_GENERATION_LOCK_TTL_MS = 5 * 60 * 1000;

/**
 * Interval used to update the heartbeat of a running
 * idea-generation workflow.
 *
 * Current value: fifteen seconds.
 */
export const GENERATION_HEARTBEAT_INTERVAL_MS = 15 * 1000;

/**
 * Target wall-clock budget for one complete generation run.
 *
 * This is a strict application budget, not a guarantee that third-party
 * providers will respond. The pipeline must never mark a run completed unless
 * a persisted idea exists and FinalizationStage succeeds.
 */
export const IDEA_GENERATION_TARGET_BUDGET_MS = 120_000;

/**
 * Hard safety deadline. The 60-second target is a performance objective, not
 * a reason to destroy a valid run while persistence or a provider call is
 * finishing. External adapters keep their own short timeouts.
 */
export const IDEA_GENERATION_EXECUTION_DEADLINE_MS = 300_000;

/** Maximum provider time allocated to one non-specialized core model. */
export const IDEA_CORE_MODEL_TIMEOUT_MS = 22_000;

/**
 * Provider-specific core-generation deadlines. Google receives a wider window
 * because structured idea generation can legitimately exceed sixteen seconds.
 * OpenRouter remains bounded more aggressively so a slow upstream endpoint does
 * not consume the complete generation budget.
 */
export const IDEA_CORE_OPENROUTER_TIMEOUT_MS = 18_000;
export const IDEA_CORE_GOOGLE_TIMEOUT_MS = 28_000;

/** Use a configured local model only after every online core model fails. */
export const IDEA_BENCHMARK_ALLOW_LOCAL_FALLBACK = true;

/**
 * Enables comparative AI judging when at least two quality-approved candidates
 * survive the existing benchmark flow. The one-candidate early-stop path is
 * unchanged, and deterministic selection remains the fallback when judge
 * confidence is insufficient or no comparison can be performed.
 */
export const IDEA_BENCHMARK_COMPARATIVE_JUDGE_ENABLED = true;

/**
 * Maximum number of milliseconds reserved for deterministic cleanup and
 * persistence after the AI phase.
 */
export const IDEA_GENERATION_FINALIZATION_RESERVE_MS = 12_000;

/**
 * Maximum duration a running generation may remain without
 * receiving a heartbeat before it is considered stale.
 *
 * Current value: two minutes.
 */
export const GENERATION_STALE_AFTER_MS = 2 * 60 * 1000;

/**
 * Default maximum number of execution attempts for one
 * pipeline stage.
 *
 * This value includes the initial execution attempt.
 * Individual stages may override it when required.
 */
export const DEFAULT_STAGE_MAX_ATTEMPTS = 1;

/**
 * Default delay between pipeline-stage execution attempts.
 *
 * Current value: 250 milliseconds.
 */
export const DEFAULT_STAGE_RETRY_DELAY_MS = 250;
/** Maximum number of database reconnect attempts before a run is paused. */
/**
 * Maximum immediate retries for one critical database operation.
 *
 * A prolonged outage is handled by the persisted RETRYING/PAUSED lifecycle;
 * keeping this bounded prevents a single request from blocking for minutes.
 */
export const GENERATION_DATABASE_RETRY_MAX_ATTEMPTS = 2;

/** Initial delay used by exponential database retry backoff. */
export const GENERATION_DATABASE_RETRY_BASE_DELAY_MS = 150;

/** Maximum delay between database retry attempts. */
export const GENERATION_DATABASE_RETRY_MAX_DELAY_MS = 500;

/** Delay before a paused generation run becomes eligible for recovery. */
export const GENERATION_PAUSED_RETRY_DELAY_MS = 60_000;

/** Maximum automatic recovery attempts for one generation run. */
export const GENERATION_RUN_MAX_RECOVERY_ATTEMPTS = 5;

/**
 * Minimum valid progress percentage for a generation run
 * or generation stage.
 */
export const MIN_GENERATION_PROGRESS_PERCENT = 0;

/**
 * Maximum valid progress percentage for a generation run
 * or generation stage.
 */
export const MAX_GENERATION_PROGRESS_PERCENT = 100;

/**
 * Maximum number of characters stored in a pipeline-stage
 * result preview.
 *
 * Complete stage outputs must be persisted in their dedicated
 * models instead of IdeaGenerationStage.resultPreview.
 */
export const MAX_STAGE_RESULT_PREVIEW_LENGTH = 1_000;

/**
 * Maximum number of characters stored in a generation
 * error message.
 */
export const MAX_GENERATION_ERROR_MESSAGE_LENGTH = 2_000;

/**
 * Default number of generation runs returned when the caller
 * does not provide an explicit pagination limit.
 */
export const DEFAULT_GENERATION_RUNS_LIMIT = 20;

/**
 * Maximum number of generation runs that may be returned in
 * one paginated response.
 */
export const MAX_GENERATION_RUNS_LIMIT = 100;

/**
 * Maximum age of a completed CollectionJob that may be reused
 * by the idea-generation workflow.
 *
 * Older collection jobs are ignored so generated ideas rely
 * on reasonably recent community data.
 *
 * Current value: seven days.
 */
export const COLLECTION_JOB_REUSE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Backward-compatible day representation of the canonical
 * collection-job reuse duration.
 *
 * New code should prefer COLLECTION_JOB_REUSE_MAX_AGE_MS
 * when performing Date calculations.
 *
 * This constant is derived instead of hard-coded to prevent
 * both reuse-duration values from becoming inconsistent.
 */
export const REUSABLE_COLLECTION_JOB_MAX_AGE_DAYS =
  COLLECTION_JOB_REUSE_MAX_AGE_MS / (24 * 60 * 60 * 1000);

/**
 * Minimum number of collected posts required for a completed
 * CollectionJob to be considered reusable.
 */
export const MIN_REUSABLE_COLLECTION_POSTS = 5;

/**
 * Minimum total number of analyzed texts required before a completed
 * collection job may be reused by idea generation.
 *
 * Reuse is deliberately stricter than the absolute generation minimum so a
 * tiny historical test job cannot keep supplying weak data to new runs.
 */
export const MIN_REUSABLE_COLLECTION_TEXTS = 30;

/**
 * Minimum total number of collected texts required before
 * NLP analysis and idea generation may continue.
 *
 * Total collected texts include:
 * - Social posts.
 * - Social comments.
 */
export const MIN_COLLECTED_TEXTS_FOR_GENERATION = 30;

/**
 * Maximum number of previously generated idea titles loaded
 * when performing duplicate detection for one user.
 *
 * Limiting the candidate set prevents duplicate comparison
 * from becoming increasingly expensive as user history grows.
 */
export const DUPLICATE_DETECTION_CANDIDATE_LIMIT = 16;
export const DUPLICATE_DETECTION_BATCH_SIZE = 8;

/**
 * Similarity threshold used when comparing normalized idea
 * titles.
 *
 * The value must remain between zero and one:
 * - 0 means completely different.
 * - 1 means identical.
 */
export const IDEA_TITLE_SIMILARITY_THRESHOLD = 0.96;

/** Semantic similarity threshold across the complete core idea. */
export const IDEA_SEMANTIC_SIMILARITY_THRESHOLD = 0.9;

/**
 * Maximum length of a normalized idea title used during
 * duplicate detection.
 */
export const MAX_DUPLICATE_TITLE_LENGTH = 200;

/** Maximum normalized text length used by semantic duplicate detection. */
export const MAX_DUPLICATE_TEXT_LENGTH = 4_000;

/**
 * Maximum number of characters stored from a raw AI response
 * in logs or pipeline previews.
 *
 * The complete provider response should not be stored in
 * pipeline previews.
 */
export const MAX_AI_RESPONSE_PREVIEW_LENGTH = 2_000;

/**
 * Maximum number of repair attempts allowed after receiving
 * invalid or malformed AI output.
 *
 * This value does not include the initial AI request.
 */
export const MAX_AI_OUTPUT_REPAIR_ATTEMPTS = 1;

/**
 * Internal fallback region identifier used when no
 * geographical region was selected.
 *
 * This value is intended for:
 * - Cache keys.
 * - Lock keys.
 * - Internal request normalization.
 *
 * It must not be persisted as an actual user-selected region.
 */
export const UNSPECIFIED_REGION_KEY = 'unspecified';

/**
 * Prefix used to build distributed generation-lock keys.
 *
 * Example:
 * idea-generation:user:<userId>
 */
export const IDEA_GENERATION_LOCK_PREFIX = 'idea-generation';

/**
 * Prefix used to build generation-owner identifiers.
 *
 * Example:
 * idea-owner:user:<userId>
 */
export const IDEA_GENERATION_OWNER_KEY_PREFIX = 'idea-owner';

/**
 * Stable machine-readable error codes exposed by the
 * idea-generation workflow.
 *
 * Human-readable error details must be stored separately in:
 * - IdeaGenerationRun.errorMessage.
 * - IdeaGenerationStage.errorMessage.
 * - Application exceptions.
 *
 * These identifiers should not be changed casually because
 * frontend applications and monitoring tools may depend on
 * their exact values.
 */
export const IDEA_GENERATION_ERROR_CODES = {
  /**
   * The generation request is missing required data or
   * contains unsupported values.
   */
  INVALID_REQUEST: 'INVALID_REQUEST',

  /**
   * The authenticated user or guest session could not
   * be resolved.
   */
  OWNER_NOT_FOUND: 'OWNER_NOT_FOUND',

  /**
   * The authenticated account is inactive or soft deleted.
   */
  ACCOUNT_INACTIVE: 'ACCOUNT_INACTIVE',

  /**
   * The authenticated account has not completed email
   * verification.
   */
  ACCOUNT_NOT_VERIFIED: 'ACCOUNT_NOT_VERIFIED',

  /**
   * The guest session has already consumed its generation.
   */
  GUEST_LIMIT_REACHED: 'GUEST_LIMIT_REACHED',

  /**
   * The registered user has consumed all free generations.
   */
  FREE_LIMIT_REACHED: 'FREE_LIMIT_REACHED',

  /**
   * The user does not have enough credits for a premium
   * generation.
   */
  INSUFFICIENT_CREDITS: 'INSUFFICIENT_CREDITS',

  /**
   * A NORMAL account attempted to use Premium-credit generation
   * without completing Premium activation through checkout.
   */
  PREMIUM_REQUIRED: 'PREMIUM_REQUIRED',

  /**
   * Another generation is already running for the same
   * owner.
   */
  GENERATION_ALREADY_RUNNING: 'GENERATION_ALREADY_RUNNING',

  /**
   * The requested generation-run record does not exist.
   */
  GENERATION_RUN_NOT_FOUND: 'GENERATION_RUN_NOT_FOUND',

  /**
   * The generation run was cancelled by the user or system.
   */
  GENERATION_CANCELLED: 'GENERATION_CANCELLED',

  /**
   * The requested software domain does not exist.
   */
  DOMAIN_NOT_FOUND: 'DOMAIN_NOT_FOUND',

  /**
   * The requested software domain is inactive.
   */
  DOMAIN_INACTIVE: 'DOMAIN_INACTIVE',

  /**
   * No active and implemented data-source collectors are
   * available for the request.
   */
  NO_DATA_SOURCES_AVAILABLE: 'NO_DATA_SOURCES_AVAILABLE',

  /**
   * Community-data collection failed.
   */
  COLLECTION_FAILED: 'COLLECTION_FAILED',

  /**
   * The collection job did not provide enough usable text.
   */
  INSUFFICIENT_COLLECTED_DATA: 'INSUFFICIENT_COLLECTED_DATA',

  /**
   * NLP analysis failed or did not produce valid output.
   */
  NLP_ANALYSIS_FAILED: 'NLP_ANALYSIS_FAILED',

  /**
   * No evidence-backed opportunity passed the strict selection gate even
   * after the bounded targeted evidence-recovery attempt.
   */
  INSUFFICIENT_EVIDENCE_FOR_IDEA_GENERATION:
    'INSUFFICIENT_EVIDENCE_FOR_IDEA_GENERATION',

  /**
   * The idea-generation prompt could not be constructed.
   */
  PROMPT_BUILD_FAILED: 'PROMPT_BUILD_FAILED',

  /**
   * The AI provider failed to generate a response.
   */
  AI_GENERATION_FAILED: 'AI_GENERATION_FAILED',

  /**
   * The AI response could not be parsed or did not satisfy
   * the expected generation contract.
   */
  INVALID_AI_OUTPUT: 'INVALID_AI_OUTPUT',

  /**
   * The generated idea is too similar to another idea owned
   * by the same user.
   */
  DUPLICATE_IDEA: 'DUPLICATE_IDEA',

  /**
   * The base idea or generation entitlement could not be
   * persisted atomically.
   */
  PERSISTENCE_FAILED: 'PERSISTENCE_FAILED',

  /**
   * One or more premium GeneratedOutput records could not
   * be generated or persisted.
   */
  OUTPUT_GENERATION_FAILED: 'OUTPUT_GENERATION_FAILED',

  /**
   * The final generation-run completion process failed.
   */
  FINALIZATION_FAILED: 'FINALIZATION_FAILED',

  /**
   * An unclassified pipeline-level failure occurred.
   */
  PIPELINE_FAILED: 'PIPELINE_FAILED',
} as const;

/**
 * Union type containing all supported idea-generation
 * error-code values.
 */
export type IdeaGenerationErrorCode =
  (typeof IDEA_GENERATION_ERROR_CODES)[keyof typeof IDEA_GENERATION_ERROR_CODES];

/**
 * Supported generation-owner categories.
 *
 * These values distinguish authenticated-user generations
 * from guest-session generations without introducing a
 * database enum.
 */
export const GENERATION_OWNER_TYPES = {
  USER: 'USER',
  GUEST: 'GUEST',
} as const;

/**
 * Union type containing all supported generation-owner
 * categories.
 */
export type GenerationOwnerType =
  (typeof GENERATION_OWNER_TYPES)[keyof typeof GENERATION_OWNER_TYPES];

/**
 * Internal result values returned when resolving a suitable
 * CollectionJob.
 */
export const COLLECTION_JOB_RESOLUTION_TYPES = {
  /**
   * An existing recent completed collection job was reused.
   */
  REUSED: 'REUSED',

  /**
   * A new collection job was created for the request.
   */
  CREATED: 'CREATED',
} as const;

/**
 * Union type containing all CollectionJob resolution values.
 */
export type CollectionJobResolutionType =
  (typeof COLLECTION_JOB_RESOLUTION_TYPES)[keyof typeof COLLECTION_JOB_RESOLUTION_TYPES];

/**
 * Maximum targeted evidence-recovery attempts per generation run.
 *
 * The pipeline allows exactly one targeted evidence-recovery pass when the
 * initial bounded parallel collection yields no independently verified direct
 * evidence. If recovery also yields zero verified evidence, generation ends
 * with a normal no-result outcome and consumes no entitlement.
 */
export const MAX_EVIDENCE_RECOVERY_ATTEMPTS = 1;

/** Minimum evidence-quality score required for the selected opportunity. */
export const MIN_SELECTED_EVIDENCE_SCORE_BEFORE_RECOVERY = 0;

/** Minimum number of representative samples required before skipping recovery. */
export const MIN_SELECTED_EVIDENCE_SAMPLES_BEFORE_RECOVERY = 1;

/** Minimum number of independent source families required before skipping recovery. */
export const MIN_SELECTED_INDEPENDENT_SOURCES_BEFORE_RECOVERY = 1;

/** Minimum deterministic quality score required for an AI idea candidate. */
export const IDEA_MIN_ACCEPTED_QUALITY_SCORE = 70;

/**
 * Maximum number of bounded quality-improvement attempts sent to the same
 * model after its initial candidate scores below the accepted threshold.
 */
export const IDEA_QUALITY_REVISION_MAX_ATTEMPTS = 1;

/** Skip expensive self-revision when the first pass is already usable. */
export const IDEA_QUALITY_REVISION_TRIGGER_SCORE = 65;

/**
 * Number of AI models launched in the first provider-diverse wave.
 *
 * Keeping the first wave at two prevents transient failures from consuming the
 * complete model-attempt budget before late fallback models can be tried.
 */
export const IDEA_BENCHMARK_INITIAL_MODEL_COUNT = 2;

/**
 * Number of highest-ranked opportunities forwarded to the multi-model
 * idea-generation benchmark.
 */
export const IDEA_BENCHMARK_INITIAL_OPPORTUNITY_COUNT = 1;

/**
 * Maximum ranked opportunities available to the benchmark after the initial
 * fast path is exhausted. Opportunities four and five are fallback-only.
 */
export const IDEA_BENCHMARK_TOP_OPPORTUNITY_COUNT = 2;

/**
 * Number of AI models executed for each ranked opportunity.
 *
 * This alias keeps the per-opportunity generation policy explicit while
 * preserving backward compatibility with services that still use
 * IDEA_BENCHMARK_INITIAL_MODEL_COUNT.
 */
export const IDEA_BENCHMARK_MODELS_PER_OPPORTUNITY =
  IDEA_BENCHMARK_INITIAL_MODEL_COUNT;

/**
 * Maximum number of startup candidates that one benchmark run may produce.
 *
 * Worst-case fallback configuration:
 * - One opportunity is attempted on the fast path.
 * - One additional opportunity is attempted only when the first opportunity
 *   does not produce enough accepted candidates.
 * - Two AI models are targeted per opportunity.
 * - Additional models may be attempted only to replace failed candidate slots.
 * - The global attempt budget remains independently bounded.
 */
export const IDEA_BENCHMARK_MAX_CANDIDATES =
  IDEA_BENCHMARK_TOP_OPPORTUNITY_COUNT * IDEA_BENCHMARK_MODELS_PER_OPPORTUNITY;

/**
 * Maximum total candidate-generation attempts allowed for one benchmark run.
 *
 * Failed provider attempts do not produce candidates, so the attempt budget is
 * intentionally larger than the target candidate count. This leaves room for
 * provider fallback without making the benchmark unbounded.
 */
export const IDEA_BENCHMARK_MAX_MODEL_ATTEMPTS = 5;

/**
 * Maximum number of bounded regeneration attempts for a quality-approved
 * candidate rejected by persisted semantic duplicate detection.
 *
 * The original candidate is checked first, then the same model receives this
 * many redesign attempts before the benchmark advances to the next model or
 * ranked opportunity.
 */
export const IDEA_DUPLICATE_REGENERATION_MAX_ATTEMPTS = 1;

/**
 * Preferred minimum number of valid candidates before comparative judging.
 *
 * A single valid candidate may still be accepted after all configured model
 * attempts are exhausted so a temporary provider outage does not fail an
 * otherwise usable generation run.
 */
export const IDEA_BENCHMARK_MIN_SUCCESSFUL_CANDIDATES = 1;

/**
 * Number of same-model retries used for transient benchmark failures.
 *
 * The initial provider request is not included in this value. One retry protects
 * a generation run from a single transient timeout or network interruption.
 * After the retry is exhausted, IdeaGenerationBenchmarkService continues with
 * the next model from the ordered fallback rotation.
 */
export const IDEA_BENCHMARK_TRANSIENT_RETRIES_PER_MODEL = 1;

/**
 * Number of recent generation runs inspected when rotating AI model
 * selection.
 */
export const IDEA_BENCHMARK_RECENT_RUN_LOOKBACK = 6;

/** Number of recent runs used for temporary model-failure cooldown. */
export const IDEA_BENCHMARK_FAILURE_COOLDOWN_RUNS = 4;

/** Repeated recent failures required before a model is cooled down. */
export const IDEA_BENCHMARK_FAILURE_COOLDOWN_THRESHOLD = 2;

/**
 * Model API identifiers excluded from the normal core-generation rotation.
 *
 * Small fallback models may remain active for other AI workloads, but they are
 * intentionally excluded here when repeated benchmark evidence shows poor
 * quality, unstable availability, or excessive latency.
 */
export const IDEA_BENCHMARK_EXCLUDED_CORE_MODEL_API_IDS = new Set<string>([
  'nvidia/nemotron-nano-9b-v2:free',
  'cohere/north-mini-code:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'mistralai/mistral-small-2603',
  'stepfun/step-3.5-flash',
]);