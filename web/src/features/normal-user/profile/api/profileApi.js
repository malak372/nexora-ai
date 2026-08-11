/**
 * Authenticated profile API helpers.
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

const PROFILE_CACHE_NAMESPACE = 'my-profile';
const PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;

function invalidateProfileCache() {
  invalidateRequestCache(`${PROFILE_CACHE_NAMESPACE}:`);
  invalidateRequestCache('dashboard-summary:');
}

export async function getMyProfile({ forceRefresh = false } = {}) {
  const key = createRequestCacheKey(PROFILE_CACHE_NAMESPACE);

  try {
    return await cachedRequest(
      key,
      async () => {
        const response = await normalUserApi.get('/users/profile');
        return extractApiData(response);
      },
      {
        ttlMs: PROFILE_CACHE_TTL_MS,
        force: Boolean(forceRefresh),
        persist: true,
        allowStaleOnError: true,
      },
    );
  } catch (error) {
    throw new Error(getApiErrorMessage(error, 'Your profile could not be loaded.'));
  }
}

export async function updateMyProfile(payload) {
  try {
    const response = await normalUserApi.patch('/users/profile', payload);
    invalidateProfileCache();
    return extractApiData(response);
  } catch (error) {
    throw new Error(getApiErrorMessage(error, 'Your profile could not be updated.'));
  }
}

export async function requestEmailChange(payload) {
  try {
    const response = await normalUserApi.post(
      '/users/profile/email-change/request',
      payload,
    );
    invalidateProfileCache();
    return extractApiData(response);
  } catch (error) {
    throw new Error(
      getApiErrorMessage(error, 'The email-change request could not be started.'),
    );
  }
}

export async function verifyCurrentEmailChange(code) {
  try {
    const response = await normalUserApi.post(
      '/users/profile/email-change/verify-current',
      { code },
    );
    invalidateProfileCache();
    return extractApiData(response);
  } catch (error) {
    throw new Error(
      getApiErrorMessage(error, 'The current email could not be verified.'),
    );
  }
}

export async function verifyNewEmailChange(code) {
  try {
    const response = await normalUserApi.post(
      '/users/profile/email-change/verify-new',
      { code },
    );
    invalidateProfileCache();
    return extractApiData(response);
  } catch (error) {
    throw new Error(
      getApiErrorMessage(error, 'The new email could not be verified.'),
    );
  }
}

export async function cancelEmailChange() {
  try {
    const response = await normalUserApi.post(
      '/users/profile/email-change/cancel',
    );
    invalidateProfileCache();
    return extractApiData(response);
  } catch (error) {
    throw new Error(
      getApiErrorMessage(error, 'The email-change request could not be cancelled.'),
    );
  }
}

export async function changeMyPassword(payload) {
  try {
    const response = await normalUserApi.patch('/auth/password/change', payload);
    return extractApiData(response);
  } catch (error) {
    throw new Error(getApiErrorMessage(error, 'Your password could not be changed.'));
  }
}

export async function uploadProfileAvatar(file) {
  if (!(file instanceof File)) {
    throw new TypeError('A valid image file is required.');
  }

  const formData = new FormData();
  formData.append('avatar', file, file.name || 'avatar.webp');

  try {
    const response = await normalUserApi.patch('/users/profile/avatar', formData, {
      timeout: 45_000,
    });
    invalidateProfileCache();
    return extractApiData(response);
  } catch (error) {
    throw new Error(getApiErrorMessage(error, 'The profile image could not be uploaded.'));
  }
}

export async function removeProfileAvatar() {
  try {
    const response = await normalUserApi.delete('/users/profile/avatar');
    invalidateProfileCache();
    return extractApiData(response);
  } catch (error) {
    throw new Error(getApiErrorMessage(error, 'The profile image could not be removed.'));
  }
}

export async function deleteMyAccount(currentPassword) {
  try {
    const response = await normalUserApi.delete('/users/account', {
      data: { currentPassword },
    });
    invalidateProfileCache();
    return extractApiData(response);
  } catch (error) {
    throw new Error(getApiErrorMessage(error, 'Your account could not be deleted.'));
  }
}
