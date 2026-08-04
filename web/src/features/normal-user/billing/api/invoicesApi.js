/**
 * Authenticated billing-history and invoice API.
 *
 * Requests use the normal-user Axios client so the current JWT access token is
 * attached automatically and an expired access token can be refreshed once.
 *
 * @author Malak
 */
import {
  extractApiData,
  normalUserApi,
} from '../../shared/api/normalUserApi';

/**
 * Creates missing invoices for historical successful payments.
 *
 * The backend operation is idempotent because one payment can own only one
 * invoice.
 *
 * @returns {Promise<{scanned:number, created:number, failed:Array}>}
 */
export async function synchronizeMyInvoices() {
  const response = await normalUserApi.post(
    '/users/invoices/synchronize',
    {},
  );

  const payload = extractApiData(response);

  return {
    scanned: Number(payload?.scanned ?? 0),
    created: Number(payload?.created ?? 0),
    failed: Array.isArray(payload?.failed) ? payload.failed : [],
  };
}

/**
 * Loads the authenticated user's invoices.
 *
 * Synchronization is attempted first. Failure to synchronize historical
 * payments does not hide invoices that already exist in the database.
 *
 * @param {{page?: number, limit?: number}} options Pagination options.
 * @returns {Promise<object>} Billing history and synchronization information.
 */
export async function getMyInvoices({
  page = 1,
  limit = 10,
} = {}) {
  let synchronization;

  try {
    synchronization = await synchronizeMyInvoices();
  } catch (error) {
    synchronization = {
      scanned: 0,
      created: 0,
      failed: [
        {
          paymentId: null,
          reason:
            error?.response?.data?.message ||
            error?.message ||
            'Invoice synchronization failed.',
        },
      ],
    };
  }

  const response = await normalUserApi.get('/users/invoices', {
    params: {
      page,
      limit,
      cacheBust: Date.now(),
    },
  });

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
    synchronization: payload?.synchronization ?? synchronization,
  };
}

/**
 * Loads one invoice after backend ownership validation.
 *
 * @param {string} invoiceId Invoice identifier.
 * @returns {Promise<object>} Invoice details.
 */
export async function getMyInvoice(invoiceId) {
  if (!invoiceId) {
    throw new Error('An invoice identifier is required.');
  }

  const response = await normalUserApi.get(
    `/users/invoices/${encodeURIComponent(invoiceId)}`,
    {
      params: {
        cacheBust: Date.now(),
      },
    },
  );

  return extractApiData(response);
}

/**
 * Downloads the internal Voxidence invoice as a PDF document.
 *
 * @param {string} invoiceId Invoice identifier.
 * @param {string} invoiceNumber Download filename.
 * @returns {Promise<void>}
 */
export async function downloadMyInvoice(
  invoiceId,
  invoiceNumber = 'voxidence-invoice',
) {
  if (!invoiceId) {
    throw new Error('An invoice identifier is required.');
  }

  const response = await normalUserApi.get(
    `/users/invoices/${encodeURIComponent(invoiceId)}/download`,
    {
      responseType: 'blob',
      params: {
        cacheBust: Date.now(),
      },
      headers: {
        Accept: 'application/pdf',
      },
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
