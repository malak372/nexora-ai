/** Cached authenticated complaint API helpers. */
import {
  extractApiData,
  getApiErrorMessage,
  normalUserApi,
} from '../../shared/api/normalUserApi';
import {
  cachedRequest,
  createRequestCacheKey,
  invalidateRequestCache,
} from '../../shared/cache/requestCache';

const COMPLAINTS_NAMESPACE = 'complaints';
const COMPLAINT_DETAIL_NAMESPACE = 'complaint-detail';
const COMPLAINTS_TTL_MS = 60 * 1000;

function unwrapEnvelope(response) {
  const first = response?.data ?? response ?? {};
  return first?.data && !Array.isArray(first.data) && first.data.data
    ? first.data
    : first;
}

function normalizeComplaintList(response, params = {}) {
  const envelope = unwrapEnvelope(response);
  const items = Array.isArray(envelope)
    ? envelope
    : envelope?.data ?? envelope?.items ?? envelope?.complaints ?? [];
  const pagination = envelope?.meta ?? envelope?.pagination ?? {};

  return {
    items: Array.isArray(items) ? items : [],
    pagination: {
      page: pagination.page ?? params.page ?? 1,
      limit: pagination.limit ?? params.limit ?? 20,
      total: pagination.total ?? (Array.isArray(items) ? items.length : 0),
      totalPages: pagination.totalPages ?? 1,
    },
  };
}

export async function createComplaint(payload) {
  try {
    const response = await normalUserApi.post('/users/complaints', payload);
    invalidateRequestCache(`${COMPLAINTS_NAMESPACE}:`);
    invalidateRequestCache(`${COMPLAINT_DETAIL_NAMESPACE}:`);
    return extractApiData(response);
  } catch (error) {
    throw new Error(getApiErrorMessage(error, 'Your case could not be submitted.'));
  }
}

export async function getMyComplaints(params = {}, options = {}) {
  const key = createRequestCacheKey(COMPLAINTS_NAMESPACE, params);
  try {
    return await cachedRequest(
      key,
      async () => {
        const response = await normalUserApi.get('/users/complaints', { params });
        return normalizeComplaintList(response, params);
      },
      {
        ttlMs: COMPLAINTS_TTL_MS,
        force: Boolean(options.forceRefresh),
        persist: true,
      },
    );
  } catch (error) {
    throw new Error(getApiErrorMessage(error, 'Your compliance cases could not be loaded.'));
  }
}

export async function getComplaintById(complaintId, options = {}) {
  const key = createRequestCacheKey(COMPLAINT_DETAIL_NAMESPACE, { complaintId });
  try {
    return await cachedRequest(
      key,
      async () => {
        const response = await normalUserApi.get(`/users/complaints/${complaintId}`);
        return extractApiData(response);
      },
      { ttlMs: COMPLAINTS_TTL_MS, force: Boolean(options.forceRefresh), persist: true },
    );
  } catch (error) {
    throw new Error(getApiErrorMessage(error, 'The selected case could not be opened.'));
  }
}
