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

export async function getAcceptedPublications(params = {}) {
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
      { ttlMs: 3 * 60 * 1000 },
    );
  } catch (error) {
    throw new Error(
      getApiErrorMessage(error, 'Accepted ideas could not be loaded.'),
    );
  }
}
