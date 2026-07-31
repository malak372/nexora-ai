/**
 * Provides the available-domains query for public pages.
 *
 * This hook centralizes the React Query configuration used to retrieve,
 * cache, and expose domains that are currently available for idea
 * discovery and generation.
 *
 * @author Eman
 */

import { useQuery } from '@tanstack/react-query';

import { QUERY_KEYS } from '../../../constants/queryKeys.constants';
import { getAvailableDomains } from '../api/domains.api';

/**
 * Defines how long available-domain data remains fresh.
 *
 * Public domain records are considered slow-changing data, so keeping
 * them fresh for several minutes avoids unnecessary network requests.
 *
 * @type {number}
 */
const DOMAINS_STALE_TIME_MS = 5 * 60 * 1000;

/**
 * Loads the domains available for public idea generation.
 *
 * React Query handles:
 * - Request deduplication.
 * - Client-side caching.
 * - Loading and error states.
 * - Automatic background synchronization.
 *
 * @returns {import('@tanstack/react-query').UseQueryResult<
 *     Array<Object>,
 *     Error
 * >}
 */
export function useDomains() {
    return useQuery({
        queryKey: QUERY_KEYS.DOMAINS.AVAILABLE,
        queryFn: getAvailableDomains,
        staleTime: DOMAINS_STALE_TIME_MS,
        refetchOnWindowFocus: false,
        retry: 1,
    });
}