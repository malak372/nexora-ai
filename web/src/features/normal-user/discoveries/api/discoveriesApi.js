/**
 * API helpers for discoverable community publications.
 */
import {
  extractApiData,
  getApiErrorMessage,
  normalUserApi,
} from '../../shared/api/normalUserApi';

export async function getDiscoveries(params = {}) {
  try {
    const response = await normalUserApi.get('/users/publications/discover', {
      params,
    });
    const payload = extractApiData(response) ?? {};

    return {
      items: payload.items ?? payload.data ?? [],
      pagination: payload.pagination ?? payload.meta ?? {
        page: params.page ?? 1,
        limit: params.limit ?? 9,
        total: 0,
        totalPages: 1,
      },
    };
  } catch (error) {
    throw new Error(getApiErrorMessage(error, 'Discoveries could not be loaded.'));
  }
}
