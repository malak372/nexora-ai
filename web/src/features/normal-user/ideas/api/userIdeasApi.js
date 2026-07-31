/**
 * API helpers for the authenticated user's private idea library.
 *
 * The list endpoint returns an object shaped like:
 *
 * {
 *   data: IdeaSummary[],
 *   meta: PaginationMeta
 * }
 *
 * Some API interceptors may additionally wrap that object inside another
 * `data` property. The normalizer below deliberately supports both forms so
 * the UI never mistakes the idea array for the complete paginated payload.
 */
import {
  getApiErrorMessage,
  normalUserApi,
} from '../../shared/api/normalUserApi';

const DEFAULT_PAGE_SIZE = 9;

/**
 * Converts the supported backend response envelopes into one stable UI shape.
 *
 * Supported examples:
 * - { data: [...], meta: {...} }
 * - { data: { data: [...], meta: {...} } }
 * - { items: [...], pagination: {...} }
 * - [...] (defensive fallback)
 */
function normalizeIdeasListResponse(response, params = {}) {
  const responseBody = response?.data;

  const candidates = [
    responseBody,
    responseBody?.data,
    responseBody?.data?.data,
  ];

  let items = [];
  let paginationSource = null;

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      items = candidate;

      // When the top-level body owns the array, its sibling `meta` contains
      // the pagination information returned by UserIdeasService.
      if (candidate === responseBody?.data) {
        paginationSource = responseBody?.meta ?? null;
      } else if (candidate === responseBody?.data?.data) {
        paginationSource =
          responseBody?.data?.meta ??
          responseBody?.meta ??
          null;
      }

      break;
    }

    if (candidate && typeof candidate === 'object') {
      const candidateItems = candidate.items ?? candidate.data;

      if (Array.isArray(candidateItems)) {
        items = candidateItems;
        paginationSource = candidate.pagination ?? candidate.meta ?? null;
        break;
      }
    }
  }

  const page = Number(
    paginationSource?.page ?? params.page ?? 1,
  );
  const limit = Number(
    paginationSource?.limit ?? params.limit ?? DEFAULT_PAGE_SIZE,
  );
  const total = Number(
    paginationSource?.total ?? items.length,
  );
  const totalPages = Number(
    paginationSource?.totalPages ??
      Math.max(1, Math.ceil(total / Math.max(1, limit))),
  );

  return {
    items,
    pagination: {
      page: Number.isFinite(page) && page > 0 ? page : 1,
      limit:
        Number.isFinite(limit) && limit > 0
          ? limit
          : DEFAULT_PAGE_SIZE,
      total: Number.isFinite(total) && total >= 0 ? total : items.length,
      totalPages:
        Number.isFinite(totalPages) && totalPages > 0
          ? totalPages
          : 1,
    },
  };
}

/**
 * Retrieves ideas owned by the currently authenticated user.
 */
export async function getMyIdeas(params = {}) {
  try {
    const response = await normalUserApi.get('/users/ideas', { params });
    return normalizeIdeasListResponse(response, params);
  } catch (error) {
    throw new Error(
      getApiErrorMessage(error, 'Your ideas could not be loaded.'),
    );
  }
}

/**
 * Soft-deletes one user-owned idea.
 */
export async function deleteMyIdea(ideaId) {
  try {
    const response = await normalUserApi.delete(`/users/ideas/${ideaId}`);
    return response?.data?.data ?? response?.data;
  } catch (error) {
    throw new Error(
      getApiErrorMessage(error, 'The idea could not be deleted.'),
    );
  }
}

export { normalizeIdeasListResponse };
