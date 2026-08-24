/**
 * API layer for the authenticated normal-user idea-generation flow.
 *
 * This module uses the named `normalUserApi` export that already exists in
 * the project shared API client.
 *
 * @author Malak
 */

import {
    extractApiData,
    normalUserApi,
} from '../../shared/api/normalUserApi';
import {
    cachedRequest,
    createRequestCacheKey,
    invalidateRequestCache,
} from '../../shared/cache/requestCache';

/**
 * Returns the active software domains available for idea generation.
 *
 * @returns {Promise<Array|Object>} Backend domain response.
 */
export async function getAvailableDomains({ force = false } = {}) {
    const cacheKey = createRequestCacheKey('available-domains');

    return cachedRequest(
        cacheKey,
        async () => {
            const response = await normalUserApi.get('/domains/available');
            return extractApiData(response);
        },
        { ttlMs: 30 * 60 * 1000, force },
    );
}

/**
 * Requests a reusable/new collection preview before idea generation.
 *
 * @param {Object} payload Collection-preview filters.
 * @returns {Promise<Object>} Collection preview.
 */
export async function previewCollection(payload) {
    const response = await normalUserApi.post(
        '/users/ideas/generate/collection-preview',
        payload,
    );

    return extractApiData(response);
}

/**
 * Starts an authenticated idea-generation run.
 *
 * @param {Object} payload GenerateIdeaDto-compatible request.
 * @returns {Promise<Object>} Generation-run start response.
 */
export async function startIdeaGeneration(payload) {
    const response = await normalUserApi.post(
        '/users/ideas/generate',
        payload,
        {
            // The backend accepts the run asynchronously, but request
            // preparation can legitimately outlive the shared 20s Axios
            // timeout. Never abort this start request while the server is
            // still creating the durable run. Generation progress itself is
            // delivered through Socket.IO after the run ID is returned.
            timeout: 0,
        },
    );

    invalidateRequestCache('active-generation-run:');
    invalidateRequestCache('dashboard-summary:');
    invalidateRequestCache('my-ideas:');

    return extractApiData(response);
}

/**
 * Loads one persisted generation run with its stages.
 *
 * @param {string} runId Generation-run identifier.
 * @returns {Promise<Object>} Generation run.
 */
export async function getGenerationRun(runId) {
    const response = await normalUserApi.get(
        `/users/idea-generation-runs/${runId}`,
    );

    return extractApiData(response);
}

/**
 * Cancels an active generation run.
 *
 * @param {string} runId Generation-run identifier.
 * @param {string} [reason] Optional cancellation reason.
 * @returns {Promise<Object>} Updated run.
 */
export async function cancelGenerationRun(runId, reason) {
    const response = await normalUserApi.post(
        `/users/idea-generation-runs/${runId}/cancel`,
        reason ? { reason } : {},
    );

    invalidateRequestCache('active-generation-run:');
    invalidateRequestCache('dashboard-summary:');

    return extractApiData(response);
}


/**
 * Loads the newest non-terminal generation run owned by the user.
 *
 * @returns {Promise<Object|null>} Active generation run or null.
 */
export async function getActiveGenerationRun({ force = false } = {}) {
    const cacheKey = createRequestCacheKey('active-generation-run');

    return cachedRequest(
        cacheKey,
        async () => {
            const response = await normalUserApi.get(
                '/users/idea-generation-runs/active',
            );

            return extractApiData(response);
        },
        {
            ttlMs: 15 * 1000,
            force,
            persist: false,
        },
    );
}
