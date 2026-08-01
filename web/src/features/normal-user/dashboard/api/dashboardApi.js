import {
  extractApiData,
  normalUserApi,
} from '../../shared/api/normalUserApi';

export const getNormalUserSummary = async () => {
  const response = await normalUserApi.get('/users/summary', {
    params: { _fresh: Date.now() },
  });
  return extractApiData(response);
};

export const getPublishedIdeasCount = async () => {
  const response = await normalUserApi.get('/users/publications/mine', {
    params: {
      page: 1,
      limit: 1,
      status: 'PUBLISHED',
      _fresh: Date.now(),
    },
  });

  const payload = extractApiData(response) ?? {};
  return Number(
    payload?.pagination?.total ??
    payload?.meta?.total ??
    payload?.total ??
    0,
  );
};

export const createContactMessage = async (payload) => {
  const response = await normalUserApi.post('/contact-messages', payload);
  return extractApiData(response);
};
