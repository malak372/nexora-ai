/** Browser storage utilities for authenticated Nexora AI sessions. */
const STORAGE_KEYS = Object.freeze({
  ACCESS_TOKEN: 'nexora_access_token',
  REFRESH_TOKEN: 'nexora_refresh_token',
  USER: 'nexora_user',
});

function clearStorage(storage) {
  Object.values(STORAGE_KEYS).forEach((key) => storage.removeItem(key));
}

function getActiveStorage() {
  if (localStorage.getItem(STORAGE_KEYS.USER)) return localStorage;
  if (sessionStorage.getItem(STORAGE_KEYS.USER)) return sessionStorage;
  return null;
}

export function saveAuthSession(session, rememberMe = false) {
  if (!session?.accessToken || !session?.user) {
    throw new Error('Cannot save an incomplete authentication session.');
  }

  const selectedStorage = rememberMe ? localStorage : sessionStorage;
  const unusedStorage = rememberMe ? sessionStorage : localStorage;
  clearStorage(unusedStorage);
  selectedStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, session.accessToken);
  selectedStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, session.refreshToken || '');
  selectedStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(session.user));
}

export function clearAuthSession() {
  clearStorage(localStorage);
  clearStorage(sessionStorage);
}

export function getAccessToken() {
  return localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN) || sessionStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
}

export function getRefreshToken() {
  return localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN) || sessionStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
}

export function saveAuthTokens(tokens) {
  const storage = getActiveStorage() || sessionStorage;
  if (tokens.accessToken) storage.setItem(STORAGE_KEYS.ACCESS_TOKEN, tokens.accessToken);
  if (tokens.refreshToken) storage.setItem(STORAGE_KEYS.REFRESH_TOKEN, tokens.refreshToken);
}

export function getStoredUser() {
  const serializedUser = localStorage.getItem(STORAGE_KEYS.USER) || sessionStorage.getItem(STORAGE_KEYS.USER);
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
  window.dispatchEvent(new CustomEvent('nexora:user-updated', { detail: updatedUser }));
  return updatedUser;
}

export { STORAGE_KEYS };
