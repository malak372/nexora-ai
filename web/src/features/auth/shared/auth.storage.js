/**
 * Browser storage utilities for authenticated Nexora AI sessions.
 *
 * Authentication data and every user-scoped client cache are cleared together.
 * This prevents cached dashboard, idea, publication, and generation data from one
 * account from appearing after another account signs in in the same browser tab.
 *
 * @author Malak
 */
import { queryClient } from '../../../config/queryClient';
import { clearRequestCache } from '../../normal-user/shared/cache/requestCache';

const STORAGE_KEYS = Object.freeze({
  ACCESS_TOKEN: 'nexora_access_token',
  REFRESH_TOKEN: 'nexora_refresh_token',
  USER: 'nexora_user',
});

/**
 * Additional browser values that belong to the authenticated account.
 * They must not survive sign-out or account switching.
 */
const USER_SCOPED_STORAGE_KEYS = Object.freeze([
  'nexora_active_generation_run_id',
  'nexora_generation_draft',
]);

function clearStorage(storage) {
  Object.values(STORAGE_KEYS).forEach((key) => storage.removeItem(key));
}

function clearUserScopedStorage(storage) {
  USER_SCOPED_STORAGE_KEYS.forEach((key) => storage.removeItem(key));
}

/**
 * Clears every in-memory and browser-persisted cache containing private data.
 *
 * Request cache:
 * - Clears the module-level memory Map.
 * - Clears all `nexora:request-cache:*` sessionStorage entries.
 *
 * React Query:
 * - Removes cached queries and mutations from the shared QueryClient.
 *
 * User-scoped browser state:
 * - Removes the last active generation run.
 * - Removes the persisted generation form draft.
 */
function clearPrivateClientState() {
  clearRequestCache();
  queryClient.clear();

  clearUserScopedStorage(localStorage);
  clearUserScopedStorage(sessionStorage);
}

function getActiveStorage() {
  if (localStorage.getItem(STORAGE_KEYS.USER)) return localStorage;
  if (sessionStorage.getItem(STORAGE_KEYS.USER)) return sessionStorage;
  return null;
}

/**
 * Saves a newly authenticated session.
 *
 * Private client state is always cleared first. This also protects account
 * switching when a previous session ended unexpectedly or stale cache entries
 * were left by an older frontend version.
 */
export function saveAuthSession(session, rememberMe = false) {
  if (!session?.accessToken || !session?.user) {
    throw new Error('Cannot save an incomplete authentication session.');
  }

  clearPrivateClientState();

  const selectedStorage = rememberMe ? localStorage : sessionStorage;
  const unusedStorage = rememberMe ? sessionStorage : localStorage;

  clearStorage(unusedStorage);
  selectedStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, session.accessToken);
  selectedStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, session.refreshToken || '');
  selectedStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(session.user));

  window.dispatchEvent(
    new CustomEvent('nexora:auth-session-changed', {
      detail: { user: session.user },
    }),
  );
}

/**
 * Ends the current session and removes all private data cached by the frontend.
 */
export function clearAuthSession() {
  clearPrivateClientState();
  clearStorage(localStorage);
  clearStorage(sessionStorage);

  window.dispatchEvent(
    new CustomEvent('nexora:auth-session-changed', {
      detail: { user: null },
    }),
  );
}

export function getAccessToken() {
  return (
    localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN) ||
    sessionStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN)
  );
}

export function getRefreshToken() {
  return (
    localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN) ||
    sessionStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN)
  );
}

export function saveAuthTokens(tokens) {
  const storage = getActiveStorage() || sessionStorage;

  if (tokens.accessToken) {
    storage.setItem(STORAGE_KEYS.ACCESS_TOKEN, tokens.accessToken);
  }

  if (tokens.refreshToken) {
    storage.setItem(STORAGE_KEYS.REFRESH_TOKEN, tokens.refreshToken);
  }
}

export function getStoredUser() {
  const serializedUser =
    localStorage.getItem(STORAGE_KEYS.USER) ||
    sessionStorage.getItem(STORAGE_KEYS.USER);

  if (!serializedUser) return null;

  try {
    return JSON.parse(serializedUser);
  } catch {
    clearAuthSession();
    return null;
  }
}

/** Merges fresh profile fields into the currently stored user. */
export function updateStoredUser(profileFields) {
  const storage = getActiveStorage();
  if (!storage || !profileFields) return null;

  const currentUser = getStoredUser() || {};
  const updatedUser = { ...currentUser, ...profileFields };

  storage.setItem(STORAGE_KEYS.USER, JSON.stringify(updatedUser));
  window.dispatchEvent(
    new CustomEvent('nexora:user-updated', {
      detail: updatedUser,
    }),
  );

  return updatedUser;
}

export { STORAGE_KEYS };
