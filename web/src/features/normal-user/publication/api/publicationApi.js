/**
 * Publication studio API helpers.
 *
 * This module contains only the operations used while preparing and publishing
 * one of the authenticated user's ideas. Audience-facing publication queries
 * remain in the dedicated publishedIdeasApi module.
 */
import {
  extractApiData,
  getApiErrorMessage,
  normalUserApi,
} from '../../shared/api/normalUserApi';
import { invalidateIdeaWorkspace } from '../../idea-workspace/api/ideaWorkspaceApi';

/**
 * Loads an idea together with its current publication snapshot, when present.
 *
 * @param {string} ideaId Authenticated user's idea identifier.
 * @returns {Promise<object>} Idea details returned by the backend.
 */
export async function getIdeaForPublication(ideaId) {
  if (!ideaId) {
    throw new Error('An idea identifier is required.');
  }

  try {
    const response = await normalUserApi.get(`/users/ideas/${ideaId}`);
    return extractApiData(response);
  } catch (error) {
    throw new Error(
      getApiErrorMessage(
        error,
        'The idea could not be loaded for publication.',
      ),
    );
  }
}

/**
 * Creates or updates the publication draft for an idea.
 *
 * The backend validates which public fields may be exposed. Premium outputs
 * and private implementation details are intentionally never sent here.
 *
 * @param {string} ideaId Authenticated user's idea identifier.
 * @param {object} payload Public publication fields and community settings.
 * @returns {Promise<object>} Saved publication draft.
 */
export async function savePublicationDraft(ideaId, payload) {
  if (!ideaId) {
    throw new Error('An idea identifier is required.');
  }

  try {
    const response = await normalUserApi.put(
      `/users/ideas/${ideaId}/publication`,
      payload,
    );

    invalidateIdeaWorkspace(ideaId);
    return extractApiData(response);
  } catch (error) {
    throw new Error(
      getApiErrorMessage(
        error,
        'The publication draft could not be saved.',
      ),
    );
  }
}

/**
 * Asks the backend AI workflow to propose safe public publication copy.
 *
 * @param {string} ideaId Authenticated user's idea identifier.
 * @param {object} payload Optional generation preferences.
 * @returns {Promise<object>} Generated public description payload.
 */
export async function generatePublicationDescription(
  ideaId,
  payload = {},
) {
  if (!ideaId) {
    throw new Error('An idea identifier is required.');
  }

  try {
    const response = await normalUserApi.post(
      `/users/ideas/${ideaId}/publication/generate-description`,
      payload,
    );

    return extractApiData(response);
  } catch (error) {
    throw new Error(
      getApiErrorMessage(
        error,
        'A public description could not be generated.',
      ),
    );
  }
}

/**
 * Publishes a previously saved and valid publication draft.
 *
 * The draft must be saved first because the publish endpoint changes status;
 * it does not receive or rebuild all publication fields by itself.
 *
 * @param {string} ideaId Authenticated user's idea identifier.
 * @returns {Promise<object>} Published publication record.
 */
export async function publishIdea(ideaId) {
  if (!ideaId) {
    throw new Error('An idea identifier is required.');
  }

  try {
    const response = await normalUserApi.post(
      `/users/ideas/${ideaId}/publication/publish`,
    );

    invalidateIdeaWorkspace(ideaId);
    return extractApiData(response);
  } catch (error) {
    throw new Error(
      getApiErrorMessage(error, 'The idea could not be published.'),
    );
  }
}
