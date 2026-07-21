/**
 * Output key used as the durable direct-unlock generation claim.
 *
 * The same key is registered in the shared advanced-output registry.
 *
 * @author Malak
 */
export const DIRECT_UNLOCK_CLAIM_OUTPUT_KEY = 'full-abstract' as const;

/**
 * Maximum age of an unfinished direct-unlock claim before it may be retried.
 */
export const DIRECT_UNLOCK_CLAIM_TTL_MS = 10 * 60 * 1000;
