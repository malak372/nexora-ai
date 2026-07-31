/**
 * Browser storage utilities for authenticated Nexora AI sessions.
 *
 * Persistent sessions use localStorage. Temporary sessions use
 * sessionStorage and are cleared when the browser tab is closed.
 *
 * @author Eman
 */

const STORAGE_KEYS = Object.freeze({
    ACCESS_TOKEN: 'nexora_access_token',
    REFRESH_TOKEN: 'nexora_refresh_token',
    USER: 'nexora_user',
});

/**
 * Removes session values from the provided storage implementation.
 *
 * @param {Storage} storage localStorage or sessionStorage.
 */
function clearStorage(storage) {
    Object.values(STORAGE_KEYS).forEach((key) => storage.removeItem(key));
}

/**
 * Saves a successful authentication session.
 *
 * @param {{accessToken: string, refreshToken?: string, user: Object}} session
 * Authenticated session returned by the backend.
 * @param {boolean} rememberMe Whether the session should survive browser restarts.
 */
export function saveAuthSession(session, rememberMe = false) {
    if (!session?.accessToken || !session?.user) {
        throw new Error('Cannot save an incomplete authentication session.');
    }

    const selectedStorage = rememberMe ? localStorage : sessionStorage;
    const unusedStorage = rememberMe ? sessionStorage : localStorage;

    clearStorage(unusedStorage);

    selectedStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, session.accessToken);
    selectedStorage.setItem(
        STORAGE_KEYS.REFRESH_TOKEN,
        session.refreshToken || '',
    );
    selectedStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(session.user));
}

/**
 * Clears every persisted authentication value.
 */
export function clearAuthSession() {
    clearStorage(localStorage);
    clearStorage(sessionStorage);
}

/**
 * Returns the current access token when available.
 *
 * @returns {string|null}
 */
export function getAccessToken() {
    return (
        localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN) ||
        sessionStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN)
    );
}

/**
 * Returns the current refresh token when available.
 *
 * @returns {string|null}
 */
export function getRefreshToken() {
    return (
        localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN) ||
        sessionStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN)
    );
}

/**
 * Updates tokens in the storage currently holding the authenticated session.
 *
 * @param {{accessToken: string, refreshToken?: string}} tokens
 */
export function saveAuthTokens(tokens) {
    const storage = localStorage.getItem(STORAGE_KEYS.USER)
        ? localStorage
        : sessionStorage;

    if (tokens.accessToken) {
        storage.setItem(STORAGE_KEYS.ACCESS_TOKEN, tokens.accessToken);
    }

    if (tokens.refreshToken) {
        storage.setItem(STORAGE_KEYS.REFRESH_TOKEN, tokens.refreshToken);
    }
}

/**
 * Returns the saved user or null when no valid user exists.
 *
 * @returns {Object|null}
 */
export function getStoredUser() {
    const serializedUser =
        localStorage.getItem(STORAGE_KEYS.USER) ||
        sessionStorage.getItem(STORAGE_KEYS.USER);

    if (!serializedUser) {
        return null;
    }

    try {
        return JSON.parse(serializedUser);
    } catch {
        clearAuthSession();
        return null;
    }
}

export { STORAGE_KEYS };
