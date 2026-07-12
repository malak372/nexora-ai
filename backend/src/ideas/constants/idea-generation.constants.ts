/**
 * Maximum time permitted for one complete generation workflow.
 *
 * This includes data collection, NLP, prompt building,
 * AI execution, and persistence.
 */
export const IDEA_GENERATION_LOCK_TTL_MS = 15 * 60 * 1_000;

/**
 * Credit level at which a low-credit alert is created.
 */
export const LOW_CREDIT_BALANCE_THRESHOLD = 1;

/**
 * Maximum age of a completed CollectionJob that may be reused.
 */
export const REUSABLE_COLLECTION_JOB_MAX_AGE_DAYS = 7;
