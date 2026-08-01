/**
 * Cached API helpers for the private idea workspace.
 *
 * The idea and its generated outputs are loaded in parallel and cached as one
 * bundle. This prevents the workspace from repeating two expensive requests
 * whenever the user returns from Business Model, Publish, or Direct Unlock.
 *
 * @author Nexora Team
 */

import { getApiErrorMessage, normalUserApi } from '../../shared/api/normalUserApi';
import {
  cachedRequest,
  createRequestCacheKey,
  invalidateRequestCache,
} from '../../shared/cache/requestCache';

const WORKSPACE_CACHE_NAMESPACE = 'idea-workspace';
const WORKSPACE_CACHE_TTL_MS = 5 * 60 * 1000;

const unwrap = (response) => response?.data?.data ?? response?.data;

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

/**
 * Loads the full workspace bundle.
 *
 * options.forceRefresh bypasses the cache after a write operation or when the
 * caller explicitly needs the newest backend state.
 */
export async function getIdeaWorkspaceBundle(ideaId, options = {}) {
  if (!ideaId) {
    throw new Error('An idea identifier is required.');
  }

  const key = createRequestCacheKey(WORKSPACE_CACHE_NAMESPACE, { ideaId });

  try {
    return await cachedRequest(
      key,
      () => requestWorkspaceBundle(ideaId),
      {
        ttlMs: WORKSPACE_CACHE_TTL_MS,
        force: Boolean(options.forceRefresh),
        persist: true,
        allowStaleOnError: true,
      },
    );
  } catch (error) {
    throw new Error(
      getApiErrorMessage(error, 'The idea workspace could not be loaded.'),
    );
  }
}

/**
 * Starts loading the workspace before navigation completes.
 * This can be called from an Open Idea hover/focus handler.
 */
export function warmIdeaWorkspace(ideaId) {
  if (!ideaId) return;

  getIdeaWorkspaceBundle(ideaId).catch(() => undefined);
}

/** Invalidates one workspace after unlock, edit, generation, or publication. */
export function invalidateIdeaWorkspace(ideaId) {
  if (!ideaId) {
    invalidateRequestCache(`${WORKSPACE_CACHE_NAMESPACE}:`);
    return;
  }

  invalidateRequestCache(
    createRequestCacheKey(WORKSPACE_CACHE_NAMESPACE, { ideaId }),
  );
}

export async function getIdeaWorkspace(ideaId, options = {}) {
  const bundle = await getIdeaWorkspaceBundle(ideaId, options);
  return bundle.idea;
}

export async function getIdeaOutputs(ideaId, options = {}) {
  const bundle = await getIdeaWorkspaceBundle(ideaId, options);
  return bundle.outputs;
}
