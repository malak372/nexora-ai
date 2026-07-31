/**
 * API helpers for publications owned by the authenticated user.
 */
import {
  extractApiData,
  getApiErrorMessage,
  normalUserApi,
} from '../../shared/api/normalUserApi';

export async function getMyPublishedIdeas(params = {}) {
  try {
    const response = await normalUserApi.get('/users/publications/mine', {
      params: { ...params, status: 'PUBLISHED' },
    });
    const payload = extractApiData(response) ?? {};

    return {
      items: payload.items ?? payload.data ?? [],
      pagination: payload.pagination ?? payload.meta ?? {
        page: params.page ?? 1,
        limit: params.limit ?? 8,
        total: 0,
        totalPages: 1,
      },
    };
  } catch (error) {
    throw new Error(getApiErrorMessage(error, 'Published ideas could not be loaded.'));
  }
}

export async function getReceivedFeedback(publicationId, params = {}) {
  try {
    const response = await normalUserApi.get(
      `/users/publications/${publicationId}/received-feedback`,
      { params },
    );
    const payload = extractApiData(response) ?? {};

    return {
      publication: payload.publication ?? null,
      feedback: payload.data ?? payload.items ?? [],
      pagination: payload.meta ?? payload.pagination ?? {
        page: params.page ?? 1,
        limit: params.limit ?? 8,
        total: 0,
        totalPages: 1,
      },
    };
  } catch (error) {
    throw new Error(getApiErrorMessage(error, 'Audience feedback could not be loaded.'));
  }
}
