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
 * Number of credits consumed after one successful
 * premium idea generation.
 *
 * Credits must not be deducted before the idea and all
 * required premium outputs have been persisted successfully.
 */
export const PREMIUM_IDEA_CREDIT_COST = 1;

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
export const IDEA_GENERATION_LOCK_TTL_MS =
    5 * 60 * 1000;

/**
 * Interval used to update the heartbeat of a running
 * idea-generation workflow.
 *
 * Current value: fifteen seconds.
 */
export const GENERATION_HEARTBEAT_INTERVAL_MS =
    15 * 1000;

/**
 * Maximum duration a running generation may remain without
 * receiving a heartbeat before it is considered stale.
 *
 * Current value: two minutes.
 */
export const GENERATION_STALE_AFTER_MS =
    2 * 60 * 1000;

/**
 * Default maximum number of execution attempts for one
 * pipeline stage.
 *
 * This value includes the initial execution attempt.
 * Individual stages may override it when required.
 */
export const DEFAULT_STAGE_MAX_ATTEMPTS = 2;

/**
 * Default delay between pipeline-stage execution attempts.
 *
 * Current value: one second.
 */
export const DEFAULT_STAGE_RETRY_DELAY_MS = 1_000;

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
export const COLLECTION_JOB_REUSE_MAX_AGE_MS =
    7 * 24 * 60 * 60 * 1000;

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
    COLLECTION_JOB_REUSE_MAX_AGE_MS /
    (24 * 60 * 60 * 1000);

/**
 * Minimum number of collected posts required for a completed
 * CollectionJob to be considered reusable.
 */
export const MIN_REUSABLE_COLLECTION_POSTS = 1;

/**
 * Minimum total number of collected texts required before
 * NLP analysis and idea generation may continue.
 *
 * Total collected texts include:
 * - Social posts.
 * - Social comments.
 */
export const MIN_COLLECTED_TEXTS_FOR_GENERATION = 1;

/**
 * Maximum number of previously generated idea titles loaded
 * when performing duplicate detection for one user.
 *
 * Limiting the candidate set prevents duplicate comparison
 * from becoming increasingly expensive as user history grows.
 */
export const DUPLICATE_DETECTION_CANDIDATE_LIMIT = 100;

/**
 * Similarity threshold used when comparing normalized idea
 * titles.
 *
 * The value must remain between zero and one:
 * - 0 means completely different.
 * - 1 means identical.
 */
export const IDEA_TITLE_SIMILARITY_THRESHOLD = 0.9;

/**
 * Maximum length of a normalized idea title used during
 * duplicate detection.
 */
export const MAX_DUPLICATE_TITLE_LENGTH = 200;

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
export const IDEA_GENERATION_LOCK_PREFIX =
    'idea-generation';

/**
 * Prefix used to build generation-owner identifiers.
 *
 * Example:
 * idea-owner:user:<userId>
 */
export const IDEA_GENERATION_OWNER_KEY_PREFIX =
    'idea-owner';

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
     * Another generation is already running for the same
     * owner.
     */
    GENERATION_ALREADY_RUNNING:
        'GENERATION_ALREADY_RUNNING',

    /**
     * The requested generation-run record does not exist.
     */
    GENERATION_RUN_NOT_FOUND:
        'GENERATION_RUN_NOT_FOUND',

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
    NO_DATA_SOURCES_AVAILABLE:
        'NO_DATA_SOURCES_AVAILABLE',

    /**
     * Community-data collection failed.
     */
    COLLECTION_FAILED: 'COLLECTION_FAILED',

    /**
     * The collection job did not provide enough usable text.
     */
    INSUFFICIENT_COLLECTED_DATA:
        'INSUFFICIENT_COLLECTED_DATA',

    /**
     * NLP analysis failed or did not produce valid output.
     */
    NLP_ANALYSIS_FAILED: 'NLP_ANALYSIS_FAILED',

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
    OUTPUT_GENERATION_FAILED:
        'OUTPUT_GENERATION_FAILED',

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