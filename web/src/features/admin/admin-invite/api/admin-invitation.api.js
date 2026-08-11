import { apiClient } from '../../../../api/client';

const ACCEPT_ADMIN_INVITATION_PATH =
  process.env.REACT_APP_ADMIN_INVITATION_ACCEPT_PATH?.trim() ||
  '/auth/admin-invitations/accept';

const extractData = (response) => response?.data?.data ?? response?.data;

export const adminInvitationApi = {
  accept: async ({ email, code, password }) =>
    extractData(
      await apiClient.post(ACCEPT_ADMIN_INVITATION_PATH, {
        email: String(email || '').trim().toLowerCase(),
        code: String(code || '').trim(),
        password,
      }),
    ),
};
