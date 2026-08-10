/**
 * Authenticated discovery, acceptance, rating, voting, and feedback helpers.
 *
 * Engagement operations are available before acceptance when the publication
 * owner enabled the corresponding community option. Acceptance is a separate
 * paid/free workflow that unlocks the protected publication brief.
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

const DISCOVERIES_CACHE_TTL_MS = 2 * 60 * 1000;
const DISCOVERY_DETAIL_CACHE_TTL_MS = 2 * 60 * 1000;
const ACCEPTANCE_CACHE_TTL_MS = 60 * 1000;

function unwrap(response) {
  return extractApiData(response) ?? null;
}

function throwApiError(error, fallback) {
  throw new Error(getApiErrorMessage(error, fallback));
}

function createUuidV4() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  window.crypto?.getRandomValues?.(bytes);

  if (!bytes.some(Boolean)) {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

export async function getDiscoveries(params = {}, options = {}) {
  const cacheKey = createRequestCacheKey('discoveries', params);

  try {
    return await cachedRequest(
      cacheKey,
      async () => {
        const payload = unwrap(
          await normalUserApi.get('/users/publications/discover', { params }),
        ) ?? {};

        return {
          items: payload.items ?? payload.data ?? [],
          pagination: payload.pagination ?? payload.meta ?? null,
        };
      },
      {
        ttlMs: DISCOVERIES_CACHE_TTL_MS,
        force: Boolean(options.forceRefresh),
        persist: true,
        allowStaleOnError: true,
      },
    );
  } catch (error) {
    throwApiError(error, 'Discoveries could not be loaded.');
  }
}

export async function getDiscoveryById(publicationId, options = {}) {
  const cacheKey = createRequestCacheKey('discovery', { publicationId });

  try {
    return await cachedRequest(
      cacheKey,
      async () =>
        unwrap(
          await normalUserApi.get(`/users/publications/${publicationId}`),
        ),
      {
        ttlMs: DISCOVERY_DETAIL_CACHE_TTL_MS,
        force: Boolean(options.forceRefresh),
        persist: true,
        allowStaleOnError: !options.forceRefresh,
      },
    );
  } catch (error) {
    throwApiError(error, 'This discovery could not be opened.');
  }
}

export async function getMyAcceptance(publicationId, options = {}) {
  const cacheKey = createRequestCacheKey('discovery-acceptance', {
    publicationId,
  });

  try {
    return await cachedRequest(
      cacheKey,
      async () =>
        unwrap(
          await normalUserApi.get(
            `/users/publications/${publicationId}/my-acceptance`,
          ),
        ),
      {
        ttlMs: ACCEPTANCE_CACHE_TTL_MS,
        force: Boolean(options.forceRefresh),
        persist: false,
        allowStaleOnError: true,
      },
    );
  } catch (error) {
    if (error?.response?.status === 404) return null;
    throwApiError(error, 'Acceptance state could not be loaded.');
  }
}

export async function acceptPublication(
  publicationId,
  paymentMethodKey = 'card',
) {
  const origin = window.location.origin;

  try {
    const result = unwrap(
      await normalUserApi.post(
        `/users/publications/${publicationId}/accept`,
        {
          clientRequestId: createUuidV4(),
          paymentMethodKey,
          successUrl: `${origin}/normal/payments/success`,
          cancelUrl: `${origin}/normal/discover/${publicationId}?cancelled=1`,
        },
      ),
    );

    invalidateRequestCache('discoveries:');
    invalidateRequestCache(
      createRequestCacheKey('discovery', { publicationId }),
    );
    invalidateRequestCache(
      createRequestCacheKey('discovery-acceptance', { publicationId }),
    );

    return result;
  } catch (error) {
    throwApiError(error, 'The publication could not be accepted.');
  }
}


export async function createPublicationAdvancedUnlockCheckout(
  publicationId,
  paymentMethodKey = 'card',
) {
  const origin = window.location.origin;

  try {
    return unwrap(
      await normalUserApi.post(
        `/users/publications/${publicationId}/unlock-advanced/checkout`,
        {
          clientRequestId: createUuidV4(),
          paymentMethodKey,
          successUrl: `${origin}/normal/payments/success`,
          cancelUrl: `${origin}/normal/discover/${publicationId}?advancedCancelled=1`,
        },
      ),
    );
  } catch (error) {
    throwApiError(
      error,
      'The advanced-output checkout could not be created.',
    );
  }
}

export async function unlockPublicationAdvancedWithCredits(publicationId) {
  try {
    const result = unwrap(
      await normalUserApi.post(
        `/users/publications/${publicationId}/unlock-advanced`,
      ),
    );

    invalidateRequestCache(
      createRequestCacheKey('discovery', { publicationId }),
    );
    invalidateRequestCache(
      createRequestCacheKey('discovery-acceptance', { publicationId }),
    );

    return result;
  } catch (error) {
    throwApiError(
      error,
      'The advanced outputs could not be unlocked with credits.',
    );
  }
}

export async function getMyRating(publicationId) {
  try {
    return unwrap(
      await normalUserApi.get(`/users/publications/${publicationId}/rating`),
    );
  } catch (error) {
    if (error?.response?.status === 404) return null;
    throwApiError(error, 'Your rating could not be loaded.');
  }
}

export async function setRating(publicationId, value) {
  try {
    return unwrap(
      await normalUserApi.put(
        `/users/publications/${publicationId}/rating`,
        { value },
      ),
    );
  } catch (error) {
    throwApiError(error, 'Rating could not be saved.');
  }
}

export async function deleteRating(publicationId) {
  try {
    return unwrap(
      await normalUserApi.delete(`/users/publications/${publicationId}/rating`),
    );
  } catch (error) {
    throwApiError(error, 'Rating could not be removed.');
  }
}

export async function getMyVote(publicationId) {
  try {
    return unwrap(
      await normalUserApi.get(`/users/publications/${publicationId}/vote`),
    );
  } catch (error) {
    if (error?.response?.status === 404) return null;
    throwApiError(error, 'Your vote could not be loaded.');
  }
}

export async function setVote(publicationId, value) {
  try {
    return unwrap(
      await normalUserApi.put(
        `/users/publications/${publicationId}/vote`,
        { value },
      ),
    );
  } catch (error) {
    throwApiError(error, 'Vote could not be saved.');
  }
}

export async function deleteVote(publicationId) {
  try {
    return unwrap(
      await normalUserApi.delete(`/users/publications/${publicationId}/vote`),
    );
  } catch (error) {
    throwApiError(error, 'Vote could not be removed.');
  }
}

export async function getMyFeedback(publicationId) {
  try {
    return unwrap(
      await normalUserApi.get(`/users/publications/${publicationId}/feedback`),
    );
  } catch (error) {
    if (error?.response?.status === 404) return null;
    throwApiError(error, 'Your feedback could not be loaded.');
  }
}

export async function setFeedback(publicationId, comment) {
  try {
    return unwrap(
      await normalUserApi.put(
        `/users/publications/${publicationId}/feedback`,
        { comment },
      ),
    );
  } catch (error) {
    throwApiError(error, 'Feedback could not be saved.');
  }
}

export async function deleteFeedback(publicationId) {
  try {
    return unwrap(
      await normalUserApi.delete(`/users/publications/${publicationId}/feedback`),
    );
  } catch (error) {
    throwApiError(error, 'Feedback could not be deleted.');
  }
}

/** Reports a publication for administration review. */
export async function reportPublication(publicationId, payload) {
  try {
    return unwrap(
      await normalUserApi.post(
        `/users/publications/${publicationId}/reports`,
        payload,
      ),
    );
  } catch (error) {
    throwApiError(error, 'The publication report could not be submitted.');
  }
}
