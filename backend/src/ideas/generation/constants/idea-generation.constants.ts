/**
 * Shared constants used by the idea-generation workflow.
 *
 * These values control:
 * - Generation locking.
 * - Pipeline heartbeat behavior.
 * - Collection-job reuse.
 * - Retry limits.
 * - Duplicate detection.
 * - Progress boundaries.
 *
 * @author malak
 */

/**
 * Number of credits required to generate one premium idea.
 */
export const PREMIUM_IDEA_CREDIT_COST = 1;

/**
 * Maximum number of free generations available to a
 * registered user.
 *
 * The actual user-specific limit may still be stored in
 * User.freeGenerationLimit.
 */
export const DEFAULT_FREE_GENERATION_LIMIT = 3;

/**
 * Maximum number of ideas that a guest session may generate.
 */
export const GUEST_GENERATION_LIMIT = 1;

/**
 * Maximum number of active generation runs permitted for
 * the same owner at one time.
 */
export const MAX_ACTIVE_GENERATION_RUNS_PER_OWNER = 1;

/**
 * Duration of an application-level generation lock.
 *
 * The lock prevents duplicate generation requests caused by:
 * - Repeated button clicks.
 * - Network retries.
 * - Concurrent frontend requests.
 */
export const IDEA_GENERATION_LOCK_TTL_MS =
    5 * 60 * 1000;

/**
 * Interval used to update the generation-run heartbeat.
 */
export const GENERATION_HEARTBEAT_INTERVAL_MS =
    15 * 1000;

/**
 * Maximum time a generation run may remain without a
 * heartbeat before it is considered stale.
 */
export const GENERATION_STALE_AFTER_MS =
    2 * 60 * 1000;

/**
 * Maximum number of retry attempts for one pipeline stage.
 *
 * Stage-specific values may override this default.
 */
export const DEFAULT_STAGE_MAX_ATTEMPTS = 2;

/**
 * Number of milliseconds to wait before retrying
 * a failed pipeline stage.
 */
export const DEFAULT_STAGE_RETRY_DELAY_MS = 1_000;

/**
 * Minimum progress value allowed for a generation run.
 */
export const MIN_GENERATION_PROGRESS_PERCENT = 0;

/**
 * Maximum progress value allowed for a generation run.
 */
export const MAX_GENERATION_PROGRESS_PERCENT = 100;

/**
 * Maximum length stored in stage result previews.
 *
 * Complete stage output should be stored in its dedicated
 * model rather than inside IdeaGenerationStage.
 */
export const MAX_STAGE_RESULT_PREVIEW_LENGTH = 1_000;

/**
 * Maximum length stored for a generation error message.
 */
export const MAX_GENERATION_ERROR_MESSAGE_LENGTH = 2_000;

/**
 * Maximum number of recent generation runs returned when
 * no explicit pagination limit is provided.
 */
export const DEFAULT_GENERATION_RUNS_LIMIT = 20;

/**
 * Maximum number of generation runs returned per page.
 */
export const MAX_GENERATION_RUNS_LIMIT = 100;

/**
 * Maximum age of a completed CollectionJob that may be
 * reused by idea generation.
 *
 * Current value: seven days.
 */
export const COLLECTION_JOB_REUSE_MAX_AGE_MS =
    7 * 24 * 60 * 60 * 1000;

/**
 * Minimum number of collected posts required for a
 * CollectionJob to be considered reusable.
 */
export const MIN_REUSABLE_COLLECTION_POSTS = 1;

/**
 * Minimum total number of collected texts required before
 * NLP analysis and idea generation may continue.
 *
 * Total texts include posts and comments.
 */
export const MIN_COLLECTED_TEXTS_FOR_GENERATION = 1;

/**
 * Maximum number of normalized title candidates inspected
 * during per-user duplicate detection.
 */
export const DUPLICATE_DETECTION_CANDIDATE_LIMIT = 100;

/**
 * Similarity threshold used when comparing normalized idea
 * titles at application level.
 *
 * The value is expressed between zero and one.
 */
export const IDEA_TITLE_SIMILARITY_THRESHOLD = 0.9;

/**
 * Maximum length of a normalized duplicate-detection title.
 */
export const MAX_DUPLICATE_TITLE_LENGTH = 200;

/**
 * Maximum number of characters stored as an AI raw-response
 * preview in logs or pipeline stages.
 */
export const MAX_AI_RESPONSE_PREVIEW_LENGTH = 2_000;

/**
 * Maximum number of AI-output repair attempts.
 */
export const MAX_AI_OUTPUT_REPAIR_ATTEMPTS = 1;

/**
 * Default fallback region value used internally when no
 * geographical region was selected.
 *
 * This value should not be persisted as a real region.
 */
export const UNSPECIFIED_REGION_KEY = 'unspecified';

/**
 * Prefix used for idea-generation lock identifiers.
 */
export const IDEA_GENERATION_LOCK_PREFIX =
    'idea-generation';

/**
 * Prefix used for owner-specific generation keys.
 */
export const IDEA_GENERATION_OWNER_KEY_PREFIX =
    'idea-owner';

/**
 * Maximum age (in days) of a completed collection job that may
 * be reused for idea generation.
 *
 * Older jobs are ignored to ensure generated ideas rely on
 * reasonably recent community data.
 *
 * @author Malak
 */
export const REUSABLE_COLLECTION_JOB_MAX_AGE_DAYS = 7;

/**
 * Error codes exposed by the generation workflow.
 *
 * These values are stable machine-readable identifiers.
 * Human-readable details should be stored separately in
 * errorMessage.
 */
export const IDEA_GENERATION_ERROR_CODES = {
    INVALID_REQUEST: 'INVALID_REQUEST',
    OWNER_NOT_FOUND: 'OWNER_NOT_FOUND',
    ACCOUNT_INACTIVE: 'ACCOUNT_INACTIVE',
    ACCOUNT_NOT_VERIFIED: 'ACCOUNT_NOT_VERIFIED',
    GUEST_LIMIT_REACHED: 'GUEST_LIMIT_REACHED',
    FREE_LIMIT_REACHED: 'FREE_LIMIT_REACHED',
    INSUFFICIENT_CREDITS: 'INSUFFICIENT_CREDITS',
    GENERATION_ALREADY_RUNNING:
        'GENERATION_ALREADY_RUNNING',
    GENERATION_RUN_NOT_FOUND:
        'GENERATION_RUN_NOT_FOUND',
    GENERATION_CANCELLED: 'GENERATION_CANCELLED',
    DOMAIN_NOT_FOUND: 'DOMAIN_NOT_FOUND',
    DOMAIN_INACTIVE: 'DOMAIN_INACTIVE',
    NO_DATA_SOURCES_AVAILABLE:
        'NO_DATA_SOURCES_AVAILABLE',
    COLLECTION_FAILED: 'COLLECTION_FAILED',
    INSUFFICIENT_COLLECTED_DATA:
        'INSUFFICIENT_COLLECTED_DATA',
    NLP_ANALYSIS_FAILED: 'NLP_ANALYSIS_FAILED',
    PROMPT_BUILD_FAILED: 'PROMPT_BUILD_FAILED',
    AI_GENERATION_FAILED: 'AI_GENERATION_FAILED',
    INVALID_AI_OUTPUT: 'INVALID_AI_OUTPUT',
    DUPLICATE_IDEA: 'DUPLICATE_IDEA',
    PERSISTENCE_FAILED: 'PERSISTENCE_FAILED',
    OUTPUT_GENERATION_FAILED:
        'OUTPUT_GENERATION_FAILED',
    PIPELINE_FAILED: 'PIPELINE_FAILED',
} as const;

/**
 * Supported generation-owner categories.
 */
export const GENERATION_OWNER_TYPES = {
    USER: 'USER',
    GUEST: 'GUEST',
} as const;

/**
 * Internal result returned when checking whether a
 * CollectionJob may be reused.
 */
export const COLLECTION_JOB_RESOLUTION_TYPES = {
    REUSED: 'REUSED',
    CREATED: 'CREATED',
} as const;