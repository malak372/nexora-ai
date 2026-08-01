/**
 * Session-scoped cache for slow authenticated GET requests.
 *
 * The cache uses both memory and sessionStorage:
 * - Memory keeps navigation between pages instant.
 * - sessionStorage keeps data available after a page refresh in the same tab.
 * - Private data is removed automatically when the browser tab is closed.
 *
 * @author Malak
 */

const memoryCache = new Map();
const pendingRequests = new Map();
const STORAGE_PREFIX = 'nexora:request-cache:';

function safeSessionStorage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readStoredEntry(key) {
  const storage = safeSessionStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(`${STORAGE_PREFIX}${key}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStoredEntry(key, entry) {
  const storage = safeSessionStorage();
  if (!storage) return;

  try {
    storage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(entry));
  } catch {
    // Storage can be unavailable or full. Memory caching still works.
  }
}

function removeStoredEntry(key) {
  const storage = safeSessionStorage();
  if (!storage) return;

  try {
    storage.removeItem(`${STORAGE_PREFIX}${key}`);
  } catch {
    // Ignore storage cleanup failures.
  }
}

function getEntry(key) {
  if (memoryCache.has(key)) return memoryCache.get(key);

  const stored = readStoredEntry(key);
  if (stored) memoryCache.set(key, stored);
  return stored;
}

function isFresh(entry) {
  return Boolean(entry) && Number(entry.expiresAt) > Date.now();
}

/**
 * Creates a deterministic key from a namespace and request parameters.
 */
export function createRequestCacheKey(namespace, params = {}) {
  const normalized = Object.keys(params)
    .sort()
    .reduce((result, key) => {
      const value = params[key];
      if (value !== undefined && value !== null && value !== '') {
        result[key] = value;
      }
      return result;
    }, {});

  return `${namespace}:${JSON.stringify(normalized)}`;
}

/**
 * Returns cached data when fresh and deduplicates concurrent requests.
 */
export async function cachedRequest(
  key,
  loader,
  {
    ttlMs = 2 * 60 * 1000,
    force = false,
    persist = true,
    allowStaleOnError = true,
  } = {},
) {
  const existing = getEntry(key);

  if (!force && isFresh(existing)) return existing.value;
  if (!force && pendingRequests.has(key)) return pendingRequests.get(key);

  const request = Promise.resolve()
    .then(loader)
    .then((value) => {
      const entry = {
        value,
        expiresAt: Date.now() + ttlMs,
      };

      memoryCache.set(key, entry);
      if (persist) writeStoredEntry(key, entry);
      return value;
    })
    .catch((error) => {
      if (allowStaleOnError && existing?.value !== undefined) {
        return existing.value;
      }
      throw error;
    })
    .finally(() => {
      pendingRequests.delete(key);
    });

  pendingRequests.set(key, request);
  return request;
}

/**
 * Invalidates one key or all keys under a namespace prefix.
 */
export function invalidateRequestCache(prefix) {
  for (const key of [...memoryCache.keys()]) {
    if (key === prefix || key.startsWith(prefix)) {
      memoryCache.delete(key);
      pendingRequests.delete(key);
      removeStoredEntry(key);
    }
  }

  const storage = safeSessionStorage();
  if (!storage) return;

  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const storageKey = storage.key(index);
    if (!storageKey?.startsWith(STORAGE_PREFIX)) continue;

    const cacheKey = storageKey.slice(STORAGE_PREFIX.length);
    if (cacheKey === prefix || cacheKey.startsWith(prefix)) {
      storage.removeItem(storageKey);
    }
  }
}

/** Clears all Nexora request-cache entries, normally during sign out. */
export function clearRequestCache() {
  memoryCache.clear();
  pendingRequests.clear();

  const storage = safeSessionStorage();
  if (!storage) return;

  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (key?.startsWith(STORAGE_PREFIX)) storage.removeItem(key);
  }
}
