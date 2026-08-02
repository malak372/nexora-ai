/**
 * Invalidates and refreshes every frontend cache affected by a completed
 * payment. This keeps paid access, account status, balances, accepted ideas,
 * and advanced outputs synchronized with the backend immediately.
 */

import { queryClient } from '../../../../config/queryClient';
import { getDiscoveryById, getMyAcceptance } from '../../discoveries/api/discoveriesApi';
import { getIdeaWorkspaceBundle, invalidateIdeaWorkspace } from '../../idea-workspace/api/ideaWorkspaceApi';
import { invalidateRequestCache } from '../../shared/cache/requestCache';

const PAYMENT_AFFECTED_NAMESPACES = [
  'my-ideas:',
  'dashboard-summary:',
  'accepted-publications:',
  'published-ideas:',
  'business-model:',
  'business-models:',
  'idea-generation:',
  'discoveries:',
  'discovery:',
];

/**
 * Removes all cached data that may contain the pre-payment state.
 */
export async function invalidatePaymentAffectedCaches({ ideaId, publicationId } = {}) {
  if (ideaId) invalidateIdeaWorkspace(ideaId);
  else invalidateIdeaWorkspace();

  PAYMENT_AFFECTED_NAMESPACES.forEach((namespace) => {
    invalidateRequestCache(namespace);
  });

  await queryClient.cancelQueries();
  queryClient.removeQueries();

  // Clear browser-level HTTP cache entries created by a service worker or the
  // Cache API. Session/local storage used for authentication is untouched.
  if ('caches' in window) {
    try {
      const cacheNames = await window.caches.keys();
      await Promise.all(
        cacheNames
          .filter((name) => name.toLowerCase().includes('nexora'))
          .map((name) => window.caches.delete(name)),
      );
    } catch {
      // Cache API can be unavailable in private mode. Request-cache cleanup
      // above is still sufficient for the application data.
    }
  }

  return { ideaId, publicationId };
}

/**
 * Loads the newest backend state after invalidation so the destination page
 * receives fresh data instead of waiting for another cached navigation cycle.
 */
export async function refreshPaymentDestination({ ideaId, publicationId } = {}) {
  await invalidatePaymentAffectedCaches({ ideaId, publicationId });

  if (ideaId) {
    await getIdeaWorkspaceBundle(ideaId, { forceRefresh: true });
  }

  if (publicationId) {
    await Promise.allSettled([
      getDiscoveryById(publicationId),
      getMyAcceptance(publicationId),
    ]);
  }
}
