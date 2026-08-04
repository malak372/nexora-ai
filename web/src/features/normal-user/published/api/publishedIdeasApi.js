/**
 * Cached publication-owner API helpers.
 *
 * Published lists change relatively infrequently, while feedback can change
 * more often. Separate TTL values keep navigation fast without hiding new
 * audience activity for too long.
 *
 * @author Malak
 */

import { getApiErrorMessage, normalUserApi } from '../../shared/api/normalUserApi';
import {
  cachedRequest,
  createRequestCacheKey,
  invalidateRequestCache,
} from '../../shared/cache/requestCache';

const PUBLISHED_CACHE_NAMESPACE = 'published-ideas';
const FEEDBACK_CACHE_NAMESPACE = 'publication-feedback';

const PUBLISHED_CACHE_TTL_MS = 2 * 60 * 1000;
const FEEDBACK_CACHE_TTL_MS = 30 * 1000;

function unwrapEnvelope(response) {
  let value = response?.data;

  for (let index = 0; index < 3; index += 1) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      value.data &&
      !value.publication &&
      !value.meta &&
      !value.items
    ) {
      value = value.data;
    }
  }

  return value ?? {};
}

function normalizePublishedResponse(envelope, params) {
  const items = Array.isArray(envelope)
    ? envelope
    : envelope.data ?? envelope.items ?? [];

  return {
    items,
    pagination:
      envelope.meta ??
      envelope.pagination ?? {
        page: params.page ?? 1,
        limit: params.limit ?? 8,
        total: items.length,
        totalPages: 1,
      },
  };
}

function normalizeFeedbackResponse(envelope, params) {
  const responses =
    envelope.data ?? envelope.responses ?? envelope.items ?? [];

  return {
    publication: envelope.publication ?? null,
    responses,
    pagination:
      envelope.meta ??
      envelope.pagination ?? {
        page: params.page ?? 1,
        limit: params.limit ?? 8,
        total: responses.length,
        totalPages: 1,
      },
  };
}

export async function getMyPublishedIdeas(params = {}, options = {}) {
  const requestParams = {
    ...params,
  };

  const key = createRequestCacheKey(
    PUBLISHED_CACHE_NAMESPACE,
    requestParams,
  );

  try {
    return await cachedRequest(
      key,
      async () => {
        const response = await normalUserApi.get('/users/publications/mine', {
          params: requestParams,
        });

        return normalizePublishedResponse(
          unwrapEnvelope(response),
          requestParams,
        );
      },
      {
        ttlMs: PUBLISHED_CACHE_TTL_MS,
        force: Boolean(options.forceRefresh),
        persist: true,
        allowStaleOnError: true,
      },
    );
  } catch (error) {
    throw new Error(
      getApiErrorMessage(error, 'Published ideas could not be loaded.'),
    );
  }
}

export async function getReceivedFeedback(
  publicationId,
  params = {},
  options = {},
) {
  if (!publicationId) {
    throw new Error('A publication identifier is required.');
  }

  const key = createRequestCacheKey(FEEDBACK_CACHE_NAMESPACE, {
    publicationId,
    ...params,
  });

  try {
    return await cachedRequest(
      key,
      async () => {
        const response = await normalUserApi.get(
          `/users/publications/${publicationId}/received-feedback`,
          { params },
        );

        return normalizeFeedbackResponse(unwrapEnvelope(response), params);
      },
      {
        ttlMs: FEEDBACK_CACHE_TTL_MS,
        force: Boolean(options.forceRefresh),
        persist: false,
        allowStaleOnError: true,
      },
    );
  } catch (error) {
    throw new Error(
      getApiErrorMessage(error, 'Audience responses could not be loaded.'),
    );
  }
}

export async function stopPublication(ideaId) {
  if (!ideaId) {
    throw new Error('The publication is missing its idea identifier.');
  }

  try {
    const response = await normalUserApi.post(
      `/users/ideas/${ideaId}/publication/archive`,
    );

    invalidatePublishedIdeasCache();
    invalidateRequestCache('dashboard-summary:');
    invalidateRequestCache('idea-workspace:');

    return unwrapEnvelope(response);
  } catch (error) {
    throw new Error(
      getApiErrorMessage(error, 'The publication could not be stopped.'),
    );
  }
}


export async function repostPublication(ideaId) {
  if (!ideaId) {
    throw new Error('The publication is missing its idea identifier.');
  }

  try {
    const response = await normalUserApi.post(
      `/users/ideas/${ideaId}/publication/repost`,
    );

    invalidatePublishedIdeasCache();
    invalidateRequestCache('dashboard-summary:');
    invalidateRequestCache('idea-workspace:');
    invalidateRequestCache('discoveries:');

    return unwrapEnvelope(response);
  } catch (error) {
    throw new Error(
      getApiErrorMessage(error, 'The publication could not be re-published.'),
    );
  }
}

/** Clears published lists after publish, archive, or visibility changes. */
export function invalidatePublishedIdeasCache() {
  invalidateRequestCache(`${PUBLISHED_CACHE_NAMESPACE}:`);
}

/** Clears feedback for one publication, or every feedback cache entry. */
export function invalidatePublicationFeedbackCache(publicationId) {
  if (!publicationId) {
    invalidateRequestCache(`${FEEDBACK_CACHE_NAMESPACE}:`);
    return;
  }

  invalidateRequestCache(
    createRequestCacheKey(FEEDBACK_CACHE_NAMESPACE, { publicationId }),
  );
}
