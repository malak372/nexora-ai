/**
 * Session-scoped cache for slow authenticated GET requests.
 *
 * The cache uses both memory and sessionStorage. Each key also owns a version
 * number so an HTTP request started before invalidation cannot write stale data
 * back into the cache after a payment, unlock, publication, or profile change.
 *
 * @author Nexora Team
 */

const memoryCache = new Map();
const pendingRequests = new Map();
const cacheVersions = new Map();
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

function getCacheVersion(key) {
  return cacheVersions.get(key) ?? 0;
}

function bumpCacheVersion(key) {
  cacheVersions.set(key, getCacheVersion(key) + 1);
}

function matchesPrefix(key, prefix) {
  return key === prefix || key.startsWith(prefix);
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
 *
 * A request captures the current cache version. When the key is invalidated
 * while that request is still running, its response is returned to the caller
 * but is deliberately not stored, preventing stale data from reappearing.
 */
export async function cachedRequest(
  key,
  loader,
  {
    ttlMs = 2 * 60 * 1000,
    force = false,
    persist = true,
    allowStaleOnError = false,
  } = {},
) {
  const existing = getEntry(key);

  if (!force && isFresh(existing)) return existing.value;
  if (!force && pendingRequests.has(key)) return pendingRequests.get(key);

  const requestVersion = getCacheVersion(key);

  const request = Promise.resolve()
    .then(loader)
    .then((value) => {
      if (getCacheVersion(key) !== requestVersion) {
        return value;
      }

      const entry = {
        value,
        expiresAt: Date.now() + ttlMs,
      };

      memoryCache.set(key, entry);
      if (persist) writeStoredEntry(key, entry);
      return value;
    })
    .catch((error) => {
      if (
        allowStaleOnError &&
        getCacheVersion(key) === requestVersion &&
        existing?.value !== undefined
      ) {
        return existing.value;
      }

      throw error;
    })
    .finally(() => {
      if (pendingRequests.get(key) === request) {
        pendingRequests.delete(key);
      }
    });

  pendingRequests.set(key, request);
  return request;
}

/**
 * Invalidates one key or all keys under a namespace prefix.
 * Pending loaders are versioned out so they cannot restore stale values.
 */
export function invalidateRequestCache(prefix) {
  const knownKeys = new Set([
    ...memoryCache.keys(),
    ...pendingRequests.keys(),
    ...cacheVersions.keys(),
  ]);

  const storage = safeSessionStorage();

  if (storage) {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const storageKey = storage.key(index);
      if (!storageKey?.startsWith(STORAGE_PREFIX)) continue;
      knownKeys.add(storageKey.slice(STORAGE_PREFIX.length));
    }
  }

  for (const key of knownKeys) {
    if (!matchesPrefix(key, prefix)) continue;

    bumpCacheVersion(key);
    memoryCache.delete(key);
    pendingRequests.delete(key);
    removeStoredEntry(key);
  }
}

/** Clears all Nexora request-cache entries, normally during sign out. */
export function clearRequestCache() {
  const knownKeys = new Set([
    ...memoryCache.keys(),
    ...pendingRequests.keys(),
    ...cacheVersions.keys(),
  ]);

  const storage = safeSessionStorage();

  if (storage) {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const storageKey = storage.key(index);
      if (!storageKey?.startsWith(STORAGE_PREFIX)) continue;
      knownKeys.add(storageKey.slice(STORAGE_PREFIX.length));
      storage.removeItem(storageKey);
    }
  }

  for (const key of knownKeys) bumpCacheVersion(key);

  memoryCache.clear();
  pendingRequests.clear();
}
