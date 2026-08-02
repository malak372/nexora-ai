/** Accepted-publication library API helpers. @author Malak */
import {
  extractApiData,
  getApiErrorMessage,
  normalUserApi,
} from '../../shared/api/normalUserApi';
import {
  cachedRequest,
  createRequestCacheKey,
} from '../../shared/cache/requestCache';

/**
 * Retrieves accepted publications with optional cache bypass.
 *
 * @param {object} params Request query parameters.
 * @param {{ force?: boolean }} options Cache controls.
 */
export async function getAcceptedPublications(params = {}, options = {}) {
  try {
    const cacheKey = createRequestCacheKey('accepted-publications', params);

    return await cachedRequest(
      cacheKey,
      async () => {
        const response = await normalUserApi.get('/users/publications/accepted', {
          params,
        });
        const payload = extractApiData(response) ?? {};

        return {
          items: payload.items ?? payload.data ?? [],
          pagination: payload.pagination ?? payload.meta ?? null,
        };
      },
      {
        ttlMs: 3 * 60 * 1000,
        force: Boolean(options.force),
      },
    );
  } catch (error) {
    throw new Error(
      getApiErrorMessage(error, 'Accepted ideas could not be loaded.'),
    );
  }
}
