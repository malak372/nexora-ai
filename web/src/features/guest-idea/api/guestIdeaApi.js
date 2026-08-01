/**
 * Guest idea generation API.
 *
 * Provides the frontend API functions required for the guest idea generation
 * flow. It creates the guest session, submits the idea generation request,
 * retrieves generation progress, and normalizes backend error messages.
 *
 * The guest session is stored by the backend inside an HTTP-only cookie.
 * Therefore, the configured API client must send credentials with requests.
 *
 * @module guestIdeaApi
 * @author Eman
 */

import { apiClient } from '../../../api/client';

/**
 * Creates or restores the current guest session.
 *
 * The backend is responsible for:
 * - Creating a new guest session when no valid session exists.
 * - Reusing the current valid guest session.
 * - Storing the guest session identifier in an HTTP-only cookie.
 *
 * @returns {Promise<Object>} The guest session response returned by the backend.
 * @throws {Error} When the guest session cannot be created or restored.
 */
export async function ensureGuestSession() {
    const response = await apiClient.post('/auth/guest-session');

    return response.data;
}

/**
 * Starts a new idea generation process for the current guest.
 *
 * A valid guest session must exist before calling this function.
 *
 * @param {Object} payload - Guest idea generation input.
 * @param {string} payload.domainId - Selected domain identifier.
 * @param {string} payload.country - Target country.
 * @param {string} [payload.city] - Optional target city.
 * @param {string} [payload.region] - Optional target region.
 * @param {string} [payload.language='ANY'] - Preferred generation language.
 * @param {number} [payload.radiusKm] - Optional collection radius.
 * @param {string[]} [payload.platforms] - Optional selected data platforms.
 * @param {string[]} [payload.keywords] - Optional collection keywords.
 *
 * @returns {Promise<Object>} The created generation run information.
 * @throws {Error} When the generation request is rejected or fails.
 */
export async function generateGuestIdea(payload) {
    const response = await apiClient.post('/guest/ideas/generate', payload);

    return response.data;
}

/**
 * Retrieves the latest status and result of a guest generation run.
 *
 * This function can be called repeatedly while the generation pipeline
 * is still running.
 *
 * @param {string} runId - Unique identifier of the generation run.
 * @returns {Promise<Object>} The current generation run state and result.
 * @throws {Error} When the run does not exist or cannot be retrieved.
 */
export async function getGuestGenerationRun(runId) {
    if (!runId) {
        throw new Error('Generation run ID is required.');
    }

    const response = await apiClient.get(
        `/guest/idea-generation-runs/${runId}`,
    );

    return response.data;
}

/**
 * Extracts a readable message from an API error.
 *
 * Supports both:
 * - A single backend validation message.
 * - An array of backend validation messages.
 *
 * @param {unknown} error - Error returned by the API client.
 * @returns {string} A user-friendly error message.
 */
export function getGuestIdeaError(error) {
    const message = error?.response?.data?.message;

    if (Array.isArray(message)) {
        return message.join(' ');
    }

    if (typeof message === 'string' && message.trim()) {
        return message;
    }

    return 'We could not complete this request. Please try again.';
}