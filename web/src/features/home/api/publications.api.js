/**
 * Public publication requests used by the Nexora landing page.
 *
 * These endpoints do not require authentication and return only publications
 * that are published, publicly visible, and not hidden.
 *
 * @module publicPublicationsApi
 * @author Eman
 */

import { apiClient } from '../../../api/client';

/**
 * Retrieves the latest public idea publications for the Featured Ideas section.
 *
 * @param {Object} [options] Request options.
 * @param {number} [options.limit=6] Maximum number of publications to retrieve.
 * @returns {Promise<{items: Array<Object>, pagination: Object}>}
 */
export async function getFeaturedPublications({ limit = 6 } = {}) {
    const response = await apiClient.get('/publications', {
        params: {
            page: 1,
            limit,
            sortBy: 'publishedAt',
            sortOrder: 'desc',
        },
    });

    return {
        items: Array.isArray(response.data?.items)
            ? response.data.items
            : [],
        pagination: response.data?.pagination ?? {
            page: 1,
            limit,
            total: 0,
            totalPages: 0,
        },
    };
}