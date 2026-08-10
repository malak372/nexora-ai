/**
 * Invalidates and refreshes every frontend cache affected by a completed
 * payment. This keeps paid access, account status, balances, accepted ideas,
 * and advanced outputs synchronized with the backend immediately.
 */

import { queryClient } from '../../../../config/queryClient';
import { invalidateIdeaWorkspace } from '../../idea-workspace/api/ideaWorkspaceApi';
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
  'billing-invoices:',
  'billing-invoice-detail:',
  'payment-pricing:',
];

/**
 * Removes all cached data that may contain the pre-payment state.
 */
export async function invalidatePaymentAffectedCaches({ ideaId, publicationId } = {}) {
  if (ideaId) invalidateIdeaWorkspace(ideaId);

  PAYMENT_AFFECTED_NAMESPACES.forEach((namespace) => {
    invalidateRequestCache(namespace);
  });

  // Mark active React Query data stale without cancelling every request or
  // deleting the whole client cache. Global removal was making payment return
  // noticeably slower and forced unrelated pages to reload.
  await queryClient.invalidateQueries({
    predicate: (query) => query.getObserversCount() > 0,
    refetchType: 'none',
  });

  return { ideaId, publicationId };
}

/**
 * Loads the newest backend state after invalidation so the destination page
 * receives fresh data instead of waiting for another cached navigation cycle.
 */
export async function refreshPaymentDestination({ ideaId, publicationId } = {}) {
  /*
   * Only invalidate here. The destination route will perform exactly one fresh
   * request when it opens. Prefetching with forceRefresh here and then
   * navigating with forceRefresh caused the same expensive workspace/detail
   * request to run twice after successful payment.
   */
  await invalidatePaymentAffectedCaches({ ideaId, publicationId });
  return { ideaId, publicationId };
}
