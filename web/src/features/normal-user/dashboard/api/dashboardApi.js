/**
 * Normal-user dashboard API helpers with session-scoped caching.
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

const DASHBOARD_TTL_MS = 2 * 60 * 1000;

/** Loads the dashboard summary and reuses it during normal navigation. */
export const getNormalUserSummary = async ({ force = false } = {}) => {
  const cacheKey = createRequestCacheKey('dashboard-summary');

  return cachedRequest(
    cacheKey,
    async () => {
      const response = await normalUserApi.get('/users/summary');
      return extractApiData(response);
    },
    {
      ttlMs: DASHBOARD_TTL_MS,
      force,
    },
  );
};

/**
 * Reads the published count from the same cached summary.
 * This avoids the previous duplicate /users/summary request.
 */
export const getPublishedIdeasCount = async (options = {}) => {
  const summary = await getNormalUserSummary(options);
  return Number(summary?.publishedIdeasCount ?? 0);
};

export const createContactMessage = async (payload) => {
  const response = await normalUserApi.post('/users/contact-messages', payload);
  return extractApiData(response);
};

/** Call after idea, publication, payment, or profile mutations. */
export const invalidateDashboardCache = () => {
  invalidateRequestCache('dashboard-summary:');
};
