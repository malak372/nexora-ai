import { extractApiData, getApiErrorMessage, normalUserApi } from '../../shared/api/normalUserApi';
import {
  cachedRequest,
  createRequestCacheKey,
  invalidateRequestCache,
} from '../../shared/cache/requestCache';

const OPTIONS_NAMESPACE = 'preference-options';
const USER_PREFERENCES_NAMESPACE = 'user-preferences';

export async function getPreferenceCatalog({ force = false } = {}) {
  const key = createRequestCacheKey(OPTIONS_NAMESPACE);
  try {
    return await cachedRequest(
      key,
      async () => extractApiData(await normalUserApi.get('/preferences/options')) ?? [],
      { ttlMs: 30 * 60 * 1000, force, persist: true },
    );
  } catch (e) {
    throw new Error(getApiErrorMessage(e, 'Preference options could not be loaded.'));
  }
}

export async function getMyPreferences({ force = false } = {}) {
  const key = createRequestCacheKey(USER_PREFERENCES_NAMESPACE);
  try {
    return await cachedRequest(
      key,
      async () => extractApiData(await normalUserApi.get('/users/preferences')),
      { ttlMs: 5 * 60 * 1000, force, persist: true },
    );
  } catch (e) {
    throw new Error(getApiErrorMessage(e, 'Preferences could not be loaded.'));
  }
}

export async function savePreferences(payload) {
  try {
    const result = extractApiData(await normalUserApi.put('/users/preferences', payload));
    invalidateRequestCache(`${USER_PREFERENCES_NAMESPACE}:`);
    invalidateRequestCache('dashboard-summary:');
    return result;
  } catch (e) {
    throw new Error(getApiErrorMessage(e, 'Preferences could not be saved.'));
  }
}
