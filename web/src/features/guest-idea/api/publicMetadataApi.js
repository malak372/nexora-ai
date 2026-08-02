/**
 * Public metadata API used by the guest idea generation flow.
 *
 * Language options are returned by the backend from the PostgreSQL
 * LanguageCode enum, so this file intentionally contains no language list.
 */

import { apiClient } from '../../../api/client';

/**
 * Retrieves the language options supported by the database.
 *
 * @returns {Promise<Array<{code: string, name: string}>>}
 * 
 * @author Eman
 */
export async function getAvailableLanguages() {
    const response = await apiClient.get('/public-metadata/languages');

    const payload = response.data;

    if (Array.isArray(payload)) {
        return payload;
    }

    if (Array.isArray(payload?.data)) {
        return payload.data;
    }

    return [];
}