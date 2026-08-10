import {
  getApiErrorMessage,
  normalUserApi,
} from '../../shared/api/normalUserApi';
import { invalidateRequestCache } from '../../shared/cache/requestCache';

const NOTIFICATIONS_CACHE_NAMESPACE = 'notifications';

function normalizeNotificationItem(item) {
  if (!item || typeof item !== 'object') return null;

  const message =
    item.message ??
    item.adminMessage ??
    item.body ??
    item.content ??
    item.text ??
    item.notification?.message ??
    item.notification?.body ??
    item.alert?.message ??
    item.data?.message ??
    '';

  const title =
    item.title ??
    item.subject ??
    item.notification?.title ??
    item.alert?.title ??
    item.data?.title ??
    '';

  return {
    ...item,
    title: String(title || '').trim(),
    message: String(message || '').trim(),
  };
}

function unwrapResponse(response) {
  let value = response?.data;

  for (let index = 0; index < 3; index += 1) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      value.data !== undefined
    ) {
      value = value.data;
    } else {
      break;
    }
  }

  return value;
}

function normalizeNotificationsResponse(response) {
  const rawBody = response?.data;
  const payload = unwrapResponse(response);

  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(rawBody?.data)
        ? rawBody.data
        : Array.isArray(rawBody?.items)
          ? rawBody.items
          : [];

  const meta =
    rawBody?.meta ??
    rawBody?.pagination ??
    payload?.meta ??
    payload?.pagination ??
    {};

  const normalizedItems = items
    .map(normalizeNotificationItem)
    .filter(Boolean);

  return {
    items: normalizedItems,
    pagination: {
      page: Number(meta.page ?? 1),
      limit: Number(meta.limit ?? normalizedItems.length),
      total: Number(meta.total ?? normalizedItems.length),
      totalPages: Number(meta.totalPages ?? 1),
    },
  };
}

export async function getNotifications(params = {}, options = {}) {
  try {
    if (options.forceRefresh) {
      invalidateRequestCache(`${NOTIFICATIONS_CACHE_NAMESPACE}:`);
    }

    const response = await normalUserApi.get('/users/notifications', {
      params,
    });

    return normalizeNotificationsResponse(response);
  } catch (error) {
    const message = getApiErrorMessage(
      error,
      'Notifications could not be loaded.',
    );

    const wrappedError = new Error(message);
    wrappedError.status = error?.response?.status;
    wrappedError.code = error?.code;
    wrappedError.isNetworkError = !error?.response;
    wrappedError.originalError = error;
    throw wrappedError;
  }
}

export async function markNotificationRead(notificationId) {
  try {
    const response = await normalUserApi.patch(
      `/users/notifications/${notificationId}/read`,
    );

    invalidateRequestCache(`${NOTIFICATIONS_CACHE_NAMESPACE}:`);
    return response?.data?.data ?? response?.data;
  } catch (error) {
    throw new Error(
      getApiErrorMessage(error, 'The notification could not be updated.'),
    );
  }
}

export async function markAllNotificationsRead() {
  try {
    const response = await normalUserApi.patch('/users/notifications/read-all');

    invalidateRequestCache(`${NOTIFICATIONS_CACHE_NAMESPACE}:`);
    return response?.data?.data ?? response?.data;
  } catch (error) {
    throw new Error(
      getApiErrorMessage(error, 'Notifications could not be marked as read.'),
    );
  }
}
