/**
 * Authenticated session-management API.
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

const SESSIONS_CACHE_NAMESPACE = 'my-active-sessions';
const SESSIONS_CACHE_TTL_MS = 30 * 1000;

export async function getMySessions({ forceRefresh = false } = {}) {
  const cacheKey = createRequestCacheKey(SESSIONS_CACHE_NAMESPACE);

  return cachedRequest(
    cacheKey,
    async () => {
      const response = await normalUserApi.get('/auth/sessions');
      const payload = extractApiData(response);

      const items = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.sessions)
          ? payload.sessions
          : Array.isArray(payload?.items)
            ? payload.items
            : [];

      return {
        items,
        total: Number(payload?.total ?? items.length),
      };
    },
    {
      ttlMs: SESSIONS_CACHE_TTL_MS,
      force: Boolean(forceRefresh),
      persist: false,
    },
  );
}

export async function revokeMySession(sessionId) {
  if (!sessionId) {
    throw new Error('A session identifier is required.');
  }

  const response = await normalUserApi.delete(
    `/auth/sessions/${encodeURIComponent(sessionId)}`,
  );

  invalidateRequestCache(`${SESSIONS_CACHE_NAMESPACE}:`);
  return extractApiData(response);
}

export async function revokeAllMySessions() {
  const response = await normalUserApi.delete('/auth/sessions');
  invalidateRequestCache(`${SESSIONS_CACHE_NAMESPACE}:`);
  return extractApiData(response);
}
