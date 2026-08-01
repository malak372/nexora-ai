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

export async function uploadProfileAvatar(file) {
  if (!(file instanceof File)) throw new TypeError('A valid image file is required.');

  const formData = new FormData();
  formData.append('avatar', file, file.name || 'avatar.webp');

  try {
    const response = await normalUserApi.patch('/users/profile/avatar', formData, {
      headers: { 'Content-Type': undefined },
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
