/**
 * Provides API operations related to publicly available domains.
 *
 * @author Eman
 */

import { apiClient } from '../../../api/client';

/**
 * Retrieves the domains available for idea discovery and generation.
 *
 * @returns {Promise<Array>} Available domain records.
 */
export async function getAvailableDomains() {
    const response = await apiClient.get('/domains/available');

    return response.data;
}