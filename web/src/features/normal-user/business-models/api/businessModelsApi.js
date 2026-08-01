/**
 * Cached API helpers for generated business-model versions.
 *
 * Templates are mostly static and use a long cache. The current model uses a
 * shorter cache. Preview HTML stays memory-only to avoid filling
 * sessionStorage with large markup.
 *
 * @author Malak
 */

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

const TEMPLATES_CACHE_NAMESPACE = 'business-model-templates';
const CURRENT_MODEL_CACHE_NAMESPACE = 'business-model-current';
const PREVIEW_CACHE_NAMESPACE = 'business-model-preview';

const TEMPLATES_CACHE_TTL_MS = 30 * 60 * 1000;
const CURRENT_MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
const PREVIEW_CACHE_TTL_MS = 5 * 60 * 1000;

export async function getBusinessModelTemplates(options = {}) {
  const key = createRequestCacheKey(TEMPLATES_CACHE_NAMESPACE);

  try {
    return await cachedRequest(
      key,
      async () => {
        const payload = extractApiData(
          await normalUserApi.get('/business-model-templates'),
        );

        return Array.isArray(payload) ? payload : payload?.data ?? [];
      },
      {
        ttlMs: TEMPLATES_CACHE_TTL_MS,
        force: Boolean(options.forceRefresh),
        persist: true,
        allowStaleOnError: true,
      },
    );
  } catch (error) {
    throw new Error(
      getApiErrorMessage(
        error,
        'Business-model templates could not be loaded.',
      ),
    );
  }
}

export async function getCurrentBusinessModel(ideaId, options = {}) {
  if (!ideaId) {
    throw new Error('An idea identifier is required.');
  }

  const key = createRequestCacheKey(CURRENT_MODEL_CACHE_NAMESPACE, {
    ideaId,
  });

  try {
    return await cachedRequest(
      key,
      async () => {
        try {
          return extractApiData(
            await normalUserApi.get(
              `/users/ideas/${ideaId}/business-models/current`,
            ),
          );
        } catch (error) {
          if (error?.response?.status === 404) return null;
          throw error;
        }
      },
      {
        ttlMs: CURRENT_MODEL_CACHE_TTL_MS,
        force: Boolean(options.forceRefresh),
        persist: true,
        allowStaleOnError: true,
      },
    );
  } catch (error) {
    throw new Error(
      getApiErrorMessage(error, 'The business model could not be loaded.'),
    );
  }
}

export async function generateBusinessModel(
  ideaId,
  businessModelTemplateId,
) {
  if (!ideaId) {
    throw new Error('An idea identifier is required.');
  }

  try {
    const result = extractApiData(
      await normalUserApi.post(
        `/users/ideas/${ideaId}/business-models`,
        { businessModelTemplateId },
      ),
    );

    invalidateBusinessModelCache(ideaId);
    invalidateRequestCache('idea-workspace:');

    return result;
  } catch (error) {
    throw new Error(
      getApiErrorMessage(
        error,
        'The business model could not be generated.',
      ),
    );
  }
}

export async function getBusinessModelPreviewHtml(
  ideaId,
  options = {},
) {
  if (!ideaId) {
    throw new Error('An idea identifier is required.');
  }

  const key = createRequestCacheKey(PREVIEW_CACHE_NAMESPACE, { ideaId });

  try {
    return await cachedRequest(
      key,
      async () => {
        const response = await normalUserApi.get(
          `/users/ideas/${ideaId}/business-models/current/preview`,
          {
            responseType: 'text',
            transformResponse: [(value) => value],
          },
        );

        return response.data;
      },
      {
        ttlMs: PREVIEW_CACHE_TTL_MS,
        force: Boolean(options.forceRefresh),
        persist: false,
        allowStaleOnError: true,
      },
    );
  } catch (error) {
    throw new Error(
      getApiErrorMessage(error, 'The preview could not be loaded.'),
    );
  }
}

/** Clears current-model and preview data after generating a new version. */
export function invalidateBusinessModelCache(ideaId) {
  if (!ideaId) {
    invalidateRequestCache(`${CURRENT_MODEL_CACHE_NAMESPACE}:`);
    invalidateRequestCache(`${PREVIEW_CACHE_NAMESPACE}:`);
    return;
  }

  invalidateRequestCache(
    createRequestCacheKey(CURRENT_MODEL_CACHE_NAMESPACE, { ideaId }),
  );
  invalidateRequestCache(
    createRequestCacheKey(PREVIEW_CACHE_NAMESPACE, { ideaId }),
  );
}
