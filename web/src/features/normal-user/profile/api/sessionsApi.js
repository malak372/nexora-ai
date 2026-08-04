/**
 * Authenticated session-management API.
 *
 * Requests use the normal-user Axios client so the current JWT access token is
 * attached automatically and an expired access token can be refreshed once.
 *
 * @author Malak
 */
import {
  extractApiData,
  normalUserApi,
} from '../../shared/api/normalUserApi';

/**
 * Loads active refresh-token sessions for the authenticated account.
 *
 * The backend currently returns `{ sessions, total }`. This adapter also
 * accepts `{ items, total }` and a direct array to keep the UI compatible with
 * either response envelope.
 *
 * @returns {Promise<{items: Array, total: number}>}
 */
export async function getMySessions() {
  const response = await normalUserApi.get('/auth/sessions', {
    params: {
      cacheBust: Date.now(),
    },
  });

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
}

/**
 * Revokes one active refresh-token session owned by the current user.
 *
 * @param {string} sessionId Session identifier.
 * @returns {Promise<object>} Revocation result.
 */
export async function revokeMySession(sessionId) {
  if (!sessionId) {
    throw new Error('A session identifier is required.');
  }

  const response = await normalUserApi.delete(
    `/auth/sessions/${encodeURIComponent(sessionId)}`,
  );

  return extractApiData(response);
}

/**
 * Revokes all active refresh-token sessions owned by the current user.
 *
 * @returns {Promise<object>} Revocation result.
 */
export async function revokeAllMySessions() {
  const response = await normalUserApi.delete('/auth/sessions');
  return extractApiData(response);
}
