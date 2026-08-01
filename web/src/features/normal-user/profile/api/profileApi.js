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

export async function getMyProfile() {
  try {
    const response = await normalUserApi.get('/users/profile');
    return extractApiData(response);
  } catch (error) {
    throw new Error(getApiErrorMessage(error, 'Your profile could not be loaded.'));
  }
}

export async function updateMyProfile(payload) {
  try {
    const response = await normalUserApi.patch('/users/profile', payload);
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
    return extractApiData(response);
  } catch (error) {
    throw new Error(getApiErrorMessage(error, 'The profile image could not be uploaded.'));
  }
}

export async function removeProfileAvatar() {
  try {
    const response = await normalUserApi.delete('/users/profile/avatar');
    return extractApiData(response);
  } catch (error) {
    throw new Error(getApiErrorMessage(error, 'The profile image could not be removed.'));
  }
}
