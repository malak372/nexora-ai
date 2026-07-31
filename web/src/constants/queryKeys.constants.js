/**
 * Centralized React Query cache keys used across the Nexora web application.
 *
 * Keeping query keys in one shared location prevents duplicated string
 * literals and makes cache invalidation and refetching easier to maintain.
 *
 * @author Eman
 */

export const QUERY_KEYS = {
    DOMAINS: {
        ALL: ['domains'],
        AVAILABLE: ['domains', 'available'],
    },
};