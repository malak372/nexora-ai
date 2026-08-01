/**
 * Notification API helpers for the authenticated normal user.
 *
 * @author Malak
 */
import {
  getApiErrorMessage,
  normalUserApi,
} from '../../shared/api/normalUserApi';

function normalizeNotificationsResponse(response) {
  const body = response?.data;
  const payload = body?.data ?? body;
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.items)
        ? payload.items
        : [];

  const meta = payload?.meta ?? body?.meta ?? payload?.pagination ?? {};

  return {
    items,
    pagination: {
      page: Number(meta.page ?? 1),
      limit: Number(meta.limit ?? items.length),
      total: Number(meta.total ?? items.length),
      totalPages: Number(meta.totalPages ?? 1),
    },
  };
}

export async function getNotifications(params = {}) {
  try {
    const response = await normalUserApi.get('/users/notifications', { params });
    return normalizeNotificationsResponse(response);
  } catch (error) {
    throw new Error(
      getApiErrorMessage(error, 'Notifications could not be loaded.'),
    );
  }
}

export async function markNotificationRead(notificationId) {
  try {
    const response = await normalUserApi.patch(
      `/users/notifications/${notificationId}/read`,
    );
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
    return response?.data?.data ?? response?.data;
  } catch (error) {
    throw new Error(
      getApiErrorMessage(error, 'Notifications could not be marked as read.'),
    );
  }
}
