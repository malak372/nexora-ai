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
 * Determines whether the backend rejected a new request because another
 * generation run is already active for the current guest.
 *
 * @param {unknown} error - Error returned by the API client.
 * @returns {boolean} True when an active generation run already exists.
 */
export function isGuestGenerationAlreadyRunningError(error) {
    const responseData = error?.response?.data;
    const code = String(responseData?.code ?? '').toUpperCase();
    const rawMessage = responseData?.message;

    const message = Array.isArray(rawMessage)
        ? rawMessage.join(' ')
        : String(rawMessage ?? '');

    return (
        code === 'GENERATION_ALREADY_RUNNING' ||
        message
            .toLowerCase()
            .includes(
                'an idea-generation run is already active for this owner',
            )
    );
}

/**
 * Extracts the active generation run identifier from a backend conflict.
 *
 * @param {unknown} error - Error returned by the API client.
 * @returns {string|null} Active run ID when supplied by the backend.
 */
export function getGuestActiveRunId(error) {
    const activeRunId = error?.response?.data?.activeRunId;

    if (typeof activeRunId !== 'string' || !activeRunId.trim()) {
        return null;
    }

    return activeRunId.trim();
}

/**
 * Determines whether the backend rejected generation because the current
 * guest has already consumed the one-time free attempt.
 *
 * @param {unknown} error - Error returned by the API client.
 * @returns {boolean} True when the guest generation limit was reached.
 */
export function isGuestGenerationLimitError(error) {
    if (isGuestGenerationAlreadyRunningError(error)) {
        return false;
    }

    const status = error?.response?.status;
    const responseData = error?.response?.data;
    const code = String(responseData?.code ?? '').toUpperCase();
    const rawMessage = responseData?.message;

    const message = Array.isArray(rawMessage)
        ? rawMessage.join(' ')
        : String(rawMessage ?? '');

    const normalizedMessage = message.toLowerCase();

    const hasExplicitLimitCode = [
        'GUEST_GENERATION_LIMIT_REACHED',
        'GUEST_FREE_GENERATION_USED',
        'GUEST_GENERATION_ALREADY_USED',
    ].includes(code);

    const hasLimitMessage =
        normalizedMessage.includes('guest') &&
        (
            normalizedMessage.includes('limit') ||
            normalizedMessage.includes('free attempt') ||
            normalizedMessage.includes('already used') ||
            normalizedMessage.includes('one-time') ||
            normalizedMessage.includes('one idea')
        );

    return (
        [403, 409, 429].includes(status) &&
        (hasExplicitLimitCode || hasLimitMessage)
    );
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