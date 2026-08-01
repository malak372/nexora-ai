import { getApiErrorMessage, normalUserApi } from '../../shared/api/normalUserApi';

const CACHE_TTL_MS = 2 * 60 * 1000;
const memoryCache = new Map();
const pendingRequests = new Map();

const unwrap = (response) => response?.data?.data ?? response?.data;
const cacheKey = (ideaId) => `nexora:idea-workspace:${ideaId}`;

function readCache(ideaId) {
  const memoryValue = memoryCache.get(ideaId);
  if (memoryValue && Date.now() - memoryValue.savedAt < CACHE_TTL_MS) {
    return memoryValue.value;
  }

  try {
    const stored = JSON.parse(sessionStorage.getItem(cacheKey(ideaId)) || 'null');
    if (stored && Date.now() - stored.savedAt < CACHE_TTL_MS) {
      memoryCache.set(ideaId, stored);
      return stored.value;
    }
  } catch {
    sessionStorage.removeItem(cacheKey(ideaId));
  }

  return null;
}

function writeCache(ideaId, value) {
  const entry = { savedAt: Date.now(), value };
  memoryCache.set(ideaId, entry);

  try {
    sessionStorage.setItem(cacheKey(ideaId), JSON.stringify(entry));
  } catch {
    // Memory cache remains available when browser storage is full or blocked.
  }
}

async function requestWorkspaceBundle(ideaId) {
  const [ideaResult, outputsResult] = await Promise.allSettled([
    normalUserApi.get(`/users/ideas/${ideaId}`),
    normalUserApi.get(`/users/ideas/${ideaId}/outputs`),
  ]);

  if (ideaResult.status === 'rejected') {
    throw ideaResult.reason;
  }

  const idea = unwrap(ideaResult.value);
  let outputs = [];

  if (outputsResult.status === 'fulfilled') {
    const payload = unwrap(outputsResult.value);
    outputs = Array.isArray(payload) ? payload : payload?.data ?? [];
  } else if (outputsResult.reason?.response?.status !== 403) {
    throw outputsResult.reason;
  }

  return { idea, outputs };
}

export async function getIdeaWorkspaceBundle(ideaId, options = {}) {
  if (!ideaId) throw new Error('An idea identifier is required.');

  if (!options.forceRefresh) {
    const cached = readCache(ideaId);
    if (cached) return cached;
  }

  if (pendingRequests.has(ideaId)) return pendingRequests.get(ideaId);

  const request = requestWorkspaceBundle(ideaId)
    .then((value) => {
      writeCache(ideaId, value);
      return value;
    })
    .catch((error) => {
      throw new Error(getApiErrorMessage(error, 'The idea workspace could not be loaded.'));
    })
    .finally(() => pendingRequests.delete(ideaId));

  pendingRequests.set(ideaId, request);
  return request;
}

export function warmIdeaWorkspace(ideaId) {
  if (!ideaId || readCache(ideaId) || pendingRequests.has(ideaId)) return;
  getIdeaWorkspaceBundle(ideaId).catch(() => undefined);
}

export function invalidateIdeaWorkspace(ideaId) {
  memoryCache.delete(ideaId);
  pendingRequests.delete(ideaId);
  sessionStorage.removeItem(cacheKey(ideaId));
}

export async function getIdeaWorkspace(ideaId) {
  const bundle = await getIdeaWorkspaceBundle(ideaId);
  return bundle.idea;
}

export async function getIdeaOutputs(ideaId) {
  const bundle = await getIdeaWorkspaceBundle(ideaId);
  return bundle.outputs;
}
