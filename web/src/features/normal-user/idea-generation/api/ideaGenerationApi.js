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

/**
 * Returns the active software domains available for idea generation.
 *
 * @returns {Promise<Array|Object>} Backend domain response.
 */
export async function getAvailableDomains() {
    const response = await normalUserApi.get('/domains/available');

    return extractApiData(response);
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
    );

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

    return extractApiData(response);
}


/**
 * Loads the newest non-terminal generation run owned by the user.
 *
 * @returns {Promise<Object|null>} Active generation run or null.
 */
export async function getActiveGenerationRun() {
    const response = await normalUserApi.get(
        '/users/idea-generation-runs/active',
    );

    return extractApiData(response);
}
