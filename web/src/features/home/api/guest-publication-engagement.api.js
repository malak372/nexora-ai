import { apiClient } from '../../../api/client';

/**
 * Ensures that the browser owns a valid secure guest session.
 *
 * The backend stores the guest session identifier inside an HTTP-only cookie.
 *
 * @author Eman
 */
export async function ensureGuestSession() {
    const response = await apiClient.post('/auth/guest-session');

    return response.data;
}

/**
 * Returns the current guest's rating for a publication.
 *
 * @param {string} publicationId - Publication identifier.
 */
export async function getGuestRating(publicationId) {
    const response = await apiClient.get(
        `/publications/${publicationId}/guest-rating`,
    );

    return response.data;
}

/**
 * Creates or updates the current guest's publication rating.
 *
 * @param {string} publicationId - Publication identifier.
 * @param {number} value - Rating value.
 */
export async function setGuestRating(publicationId, value) {
    const response = await apiClient.put(
        `/publications/${publicationId}/guest-rating`,
        { value },
    );

    return response.data;
}

/**
 * Returns the current guest's vote for a publication.
 *
 * @param {string} publicationId - Publication identifier.
 */
export async function getGuestVote(publicationId) {
    const response = await apiClient.get(
        `/publications/${publicationId}/guest-vote`,
    );

    return response.data;
}

/**
 * Creates or updates the current guest's vote.
 *
 * @param {string} publicationId - Publication identifier.
 * @param {string} value - Vote value.
 */
export async function setGuestVote(publicationId, value) {
    const response = await apiClient.put(
        `/publications/${publicationId}/guest-vote`,
        { value },
    );

    return response.data;
}

/**
 * Returns the current guest's feedback for a publication.
 *
 * @param {string} publicationId - Publication identifier.
 */
export async function getGuestFeedback(publicationId) {
    const response = await apiClient.get(
        `/publications/${publicationId}/guest-feedback`,
    );

    return response.data;
}

/**
 * Creates or updates the current guest's feedback.
 *
 * @param {string} publicationId - Publication identifier.
 * @param {string} comment - Guest feedback comment.
 */
export async function setGuestFeedback(publicationId, comment) {
    const response = await apiClient.put(
        `/publications/${publicationId}/guest-feedback`,
        { comment },
    );

    return response.data;
}
/**
 * Deletes the current guest's rating.
 *
 * @param {string} publicationId - Publication identifier.
 * @returns {Promise<Object>} Backend response.
 *
 */
export async function deleteGuestRating(publicationId) {
    const response = await apiClient.delete(
        `/publications/${publicationId}/guest-rating`,
    );

    return response.data;
}

/**
 * Deletes the current guest's vote.
 *
 * @param {string} publicationId - Publication identifier.
 * @returns {Promise<Object>} Backend response.
 *
 */
export async function deleteGuestVote(publicationId) {
    const response = await apiClient.delete(
        `/publications/${publicationId}/guest-vote`,
    );

    return response.data;
}

/**
 * Deletes the current guest's feedback.
 *
 * @param {string} publicationId - Publication identifier.
 * @returns {Promise<Object>} Backend response.
 *
 */
export async function deleteGuestFeedback(publicationId) {
    const response = await apiClient.delete(
        `/publications/${publicationId}/guest-feedback`,
    );

    return response.data;
}