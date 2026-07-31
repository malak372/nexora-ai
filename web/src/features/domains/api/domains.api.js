/**
 * Provides API operations related to publicly available domains.
 *
 * This module is responsible only for communicating with the domains
 * endpoints. UI-specific logic, loading states, and caching behavior
 * should remain inside hooks and presentation components.
 *
 * @author Eman
 */

import { apiClient } from '../../../api/client';
/**
 * Normalizes the domains response returned by the API.
 *
 * The backend may return domains directly as an array or wrap them inside
 * a common response property such as `data` or `items`. This function keeps
 * the rest of the frontend independent from those response variations.
 *
 * @param {unknown} payload - Raw response payload returned by the API.
 * @returns {Array<Object>} A normalized array of domain records.
 */
function normalizeDomainsResponse(payload) {
    if (Array.isArray(payload)) {
        return payload;
    }

    if (Array.isArray(payload?.data)) {
        return payload.data;
    }

    if (Array.isArray(payload?.items)) {
        return payload.items;
    }

    return [];
}

/**
 * Retrieves the domains available for idea discovery and generation.
 *
 * @async
 * @returns {Promise<Array<Object>>} A normalized array of available domains.
 *
 * @throws {import('axios').AxiosError}
 * Throws when the API request fails.
 */
export async function getAvailableDomains() {
    const response = await apiClient.get('/domains/available');

    return normalizeDomainsResponse(response.data);
}