/**
 * Fast authenticated billing-history and invoice API.
 *
 * Performance change:
 * - invoice history no longer blocks on /synchronize before every GET;
 * - history/detail GETs are cached and deduplicated;
 * - historical synchronization runs once in the background per browser session.
 */
import {
  extractApiData,
  normalUserApi,
} from '../../shared/api/normalUserApi';
import {
  cachedRequest,
  createRequestCacheKey,
  invalidateRequestCache,
} from '../../shared/cache/requestCache';

const INVOICE_LIST_NAMESPACE = 'billing-invoices';
const INVOICE_DETAIL_NAMESPACE = 'billing-invoice-detail';
const INVOICE_LIST_TTL_MS = 2 * 60 * 1000;
const INVOICE_DETAIL_TTL_MS = 10 * 60 * 1000;
const SYNC_SESSION_KEY = 'voxidence:invoice-sync-started';

function markSyncStarted() {
  try {
    if (window.sessionStorage.getItem(SYNC_SESSION_KEY)) return false;
    window.sessionStorage.setItem(SYNC_SESSION_KEY, '1');
    return true;
  } catch {
    return true;
  }
}

export async function synchronizeMyInvoices() {
  const response = await normalUserApi.post('/users/invoices/synchronize', {});
  const payload = extractApiData(response);

  return {
    scanned: Number(payload?.scanned ?? 0),
    created: Number(payload?.created ?? 0),
    failed: Array.isArray(payload?.failed) ? payload.failed : [],
  };
}

/**
 * Starts historical invoice synchronization in the background once per session.
 * It never blocks initial billing-history paint.
 */
export function warmInvoiceSynchronization() {
  if (!markSyncStarted()) return;

  void synchronizeMyInvoices()
    .then((result) => {
      if (Number(result?.created ?? 0) > 0) {
        invalidateRequestCache(`${INVOICE_LIST_NAMESPACE}:`);
      }
    })
    .catch(() => undefined);
}

export async function getMyInvoices(
  { page = 1, limit = 10 } = {},
  { forceRefresh = false } = {},
) {
  const params = { page, limit };
  const key = createRequestCacheKey(INVOICE_LIST_NAMESPACE, params);

  const result = await cachedRequest(
    key,
    async () => {
      const response = await normalUserApi.get('/users/invoices', { params });
      const payload = extractApiData(response);
      const items = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.items)
          ? payload.items
          : [];

      return {
        items,
        pagination: payload?.pagination ?? {
          page,
          limit,
          total: items.length,
          totalPages: items.length > 0 ? 1 : 0,
        },
        synchronization: payload?.synchronization ?? null,
      };
    },
    {
      ttlMs: INVOICE_LIST_TTL_MS,
      force: Boolean(forceRefresh),
      persist: true,
    },
  );

  warmInvoiceSynchronization();
  return result;
}

export async function getMyInvoice(invoiceId, { forceRefresh = false } = {}) {
  if (!invoiceId) throw new Error('An invoice identifier is required.');

  const key = createRequestCacheKey(INVOICE_DETAIL_NAMESPACE, { invoiceId });

  return cachedRequest(
    key,
    async () => {
      const response = await normalUserApi.get(
        `/users/invoices/${encodeURIComponent(invoiceId)}`,
      );
      return extractApiData(response);
    },
    {
      ttlMs: INVOICE_DETAIL_TTL_MS,
      force: Boolean(forceRefresh),
      persist: true,
    },
  );
}

/**
 * Starts loading one invoice detail before the user clicks View.
 * cachedRequest deduplicates the call if openInvoice runs while this is still
 * in flight, so hover/focus never creates a duplicate network request.
 */
export function prefetchMyInvoice(invoiceId) {
  if (!invoiceId) return Promise.resolve(null);
  return getMyInvoice(invoiceId).catch(() => null);
}

export function invalidateInvoicesCache() {
  invalidateRequestCache(`${INVOICE_LIST_NAMESPACE}:`);
  invalidateRequestCache(`${INVOICE_DETAIL_NAMESPACE}:`);
}

export async function downloadMyInvoice(
  invoiceId,
  invoiceNumber = 'voxidence-invoice',
) {
  if (!invoiceId) throw new Error('An invoice identifier is required.');

  const response = await normalUserApi.get(
    `/users/invoices/${encodeURIComponent(invoiceId)}/download`,
    {
      responseType: 'blob',
      headers: { Accept: 'application/pdf' },
    },
  );

  const objectUrl = URL.createObjectURL(response.data);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = `${invoiceNumber || 'voxidence-invoice'}.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}
