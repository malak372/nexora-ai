import { getApiErrorMessage, normalUserApi } from '../../shared/api/normalUserApi';

const unwrap = (response) => response?.data?.data ?? response?.data;

export async function getIdeaWorkspace(ideaId) {
  try {
    const response = await normalUserApi.get(`/users/ideas/${ideaId}`);
    return unwrap(response);
  } catch (error) {
    throw new Error(getApiErrorMessage(error, 'The idea workspace could not be loaded.'));
  }
}

export async function getIdeaOutputs(ideaId) {
  try {
    const response = await normalUserApi.get(`/users/ideas/${ideaId}/outputs`);
    const payload = unwrap(response);
    return Array.isArray(payload) ? payload : payload?.data ?? [];
  } catch (error) {
    if (error?.response?.status === 403) return [];
    throw new Error(getApiErrorMessage(error, 'Advanced outputs could not be loaded.'));
  }
}
