/**
 * Provides the available domains query for public pages.
 *
 * @author Eman
 */

import { useQuery } from '@tanstack/react-query';

import { QUERY_KEYS } from '../../../constants/queryKeys.constants';
import { getAvailableDomains } from '../api/domains.api';

/**
 * Loads domains that are available for idea generation.
 *
 * @returns {import('@tanstack/react-query').UseQueryResult}
 */
export function useDomains() {
    return useQuery({
        queryKey: QUERY_KEYS.DOMAINS.AVAILABLE,
        queryFn: getAvailableDomains,
    });
}