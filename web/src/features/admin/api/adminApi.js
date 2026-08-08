import { normalUserApi, extractApiData, getApiErrorMessage } from '../../normal-user/shared/api/normalUserApi';

const cleanParams = (params = {}) => Object.fromEntries(
  Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''),
);

const get = async (url, params, config = {}) => extractApiData(await normalUserApi.get(url, {
  ...config,
  params: cleanParams(params),
}));
const post = async (url, body) => extractApiData(await normalUserApi.post(url, body));
const patch = async (url, body) => extractApiData(await normalUserApi.patch(url, body));
const del = async (url) => extractApiData(await normalUserApi.delete(url));

const downloadCsv = async (url, params, filename) => {
  const response = await normalUserApi.get(url, {
    params: cleanParams(params),
    responseType: 'blob',
  });

  const blob = response.data instanceof Blob
    ? response.data
    : new Blob([response.data], { type: 'text/csv;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
};

export const adminApi = {
  // Dashboard has a slightly larger safety timeout for cold backend/database starts.
  // The backend dashboard service itself is optimized and cached, so normal loads
  // should finish much earlier than this value.
  getDashboard: () => get('/admin/dashboard', undefined, { timeout: 45000 }),

  users: {
    list: (params) => get('/admin/users', params),
    summary: (params) => get('/admin/users/summary', params),
    charts: (params) => get('/admin/users/charts', params),
    detail: (id) => get(`/admin/users/${id}`),
    update: (id, body) => patch(`/admin/users/${id}`, body),
    status: (id, isActive) => patch(`/admin/users/${id}/status`, { isActive }),
    resetPassword: (id) => post(`/admin/users/${id}/send-password-reset-email`),
    remove: (id) => del(`/admin/users/${id}`),
    exportCsv: (params) => downloadCsv('/admin/users/export/csv', params, 'admin-users.csv'),
  },
  ideas: {
    list: (params) => get('/admin/ideas', params),
    summary: (params) => get('/admin/ideas/summary', params),
    charts: (params) => get('/admin/ideas/charts', params),
    detail: (id) => get(`/admin/ideas/${id}`),
    exportCsv: (params) => downloadCsv('/admin/ideas/export/csv', params, 'admin-ideas.csv'),
  },
  payments: {
    list: (params) => get('/admin/payments', params),
    summary: (params) => get('/admin/payments/summary', params),
    charts: (params) => get('/admin/payments/charts', params),
    exportCsv: (params) => downloadCsv('/admin/payments/export/csv', params, 'admin-payments.csv'),
  },
  credits: {
    list: (params) => get('/admin/credits/history', params),
    summary: (params) => get('/admin/credits/summary', params),
    charts: (params) => get('/admin/credits/charts', params),
    adjust: (body) => post('/admin/credits/adjust', body),
    exportCsv: (params) => downloadCsv('/admin/credits/export/csv', params, 'admin-credits.csv'),
  },
  domains: {
    list: (params) => get('/admin/domains', params),
    summary: (params) => get('/admin/domains/summary', params),
    charts: (params) => get('/admin/domains/charts', params),
    create: (body) => post('/admin/domains', body),
    update: (id, body) => patch(`/admin/domains/${id}`, body),
    remove: (id) => del(`/admin/domains/${id}`),
  },
  comments: {
    list: (params) => get('/admin/comments', params),
    summary: (params) => get('/admin/comments/summary', params),
    charts: (params) => get('/admin/comments/charts', params),
  },
  feedback: {
    list: (params, tab = 'comments') => get(`/admin/feedback/${tab}`, params),
    summary: (params) => get('/admin/feedback/summary', params),
    charts: (params) => get('/admin/feedback/charts', params),
    exportCsv: (tab = 'comments', params) => downloadCsv(`/admin/feedback/${tab}/export/csv`, params, `admin-feedback-${tab}.csv`),
  },
  complaints: {
    list: (params) => get('/admin/complaints', params),
    summary: (params) => get('/admin/complaints/summary', params),
    charts: (params) => get('/admin/complaints/charts', params),
    update: (id, body) => patch(`/admin/complaints/${id}`, body),
    exportCsv: (params) => downloadCsv('/admin/complaints/export/csv', params, 'admin-complaints.csv'),
  },
  contactMessages: {
    list: (params) => get('/admin/contact-messages', params),
    summary: (params) => get('/admin/contact-messages/summary', params),
    charts: (params) => get('/admin/contact-messages/charts', params),
    update: (id, body) => patch(`/admin/contact-messages/${id}`, body),
    exportCsv: (params) => downloadCsv('/admin/contact-messages/export/csv', params, 'admin-contact-messages.csv'),
  },
  publicationReports: {
    list: (params) => get('/admin/publication-reports', params),
    summary: () => get('/admin/publication-reports/summary'),
    review: (id, body) => patch(`/admin/publication-reports/${id}/review`, body),
  },
  publications: {
    hide: (id, reason) => patch(`/admin/publications/${id}/hide`, { reason }),
    restore: (id) => patch(`/admin/publications/${id}/restore`, {}),
    archive: (id, reason) => patch(`/admin/publications/${id}/archive`, { reason }),
  },
  alerts: {
    list: (params) => get('/admin/alerts', params),
    create: (body) => post('/admin/alerts', body),
    email: (body) => post('/admin/alerts/email', body),
  },
  dataSources: {
    list: (params) => get('/admin/data-sources', params),
    create: (body) => post('/admin/data-sources', body),
    synchronize: () => post('/admin/data-sources/synchronize'),
    detail: (id) => get(`/admin/data-sources/${id}`),
    update: (id, body) => patch(`/admin/data-sources/${id}`, body),
    status: (id, isActive) => patch(`/admin/data-sources/${id}/status`, { isActive }),
  },
  aiModels: {
    list: (params) => get('/ai-models', params),
    providers: () => get('/ai-models/providers'),
    detail: (id) => get(`/ai-models/${id}`),
    create: (body) => post('/ai-models', body),
    update: (id, body) => patch(`/ai-models/${id}`, body),
    setDefault: (id) => patch(`/ai-models/${id}/default`, {}),
    activate: (id) => patch(`/ai-models/${id}/activate`, {}),
    deactivate: (id) => patch(`/ai-models/${id}/deactivate`, {}),
  },
  aiMonitoring: {
    list: (params) => get('/admin/ai-monitoring/logs', params),
    summary: (params) => get('/admin/ai-monitoring/summary', params),
    charts: (params) => get('/admin/ai-monitoring/charts', params),
    detail: (id) => get(`/admin/ai-monitoring/logs/${id}`),
    operation: (id) => get(`/admin/ai-monitoring/operations/${id}`),
    exportCsv: (params) => downloadCsv('/admin/ai-monitoring/logs/export/csv', params, 'admin-ai-monitoring.csv'),
  },
  aiAnalytics: { summary: (params) => get('/admin/ai/analytics/summary', params) },
  auditLogs: {
    list: (params) => get('/audit-logs', params),
    summary: (params) => get('/audit-logs/summary', params),
    charts: (params) => get('/audit-logs/charts', params),
    exportCsv: (params) => downloadCsv('/audit-logs/export/csv', params, 'admin-audit-logs.csv'),
  },
  authAudit: { list: (params) => get('/admin/auth-audit-logs', params) },
  collection: {
    list: (params, tab = 'jobs') => {
      if (tab === 'posts') return get('/data-collection/posts', params);
      if (tab === 'comments') return get('/data-collection/comments', params);
      return get('/data-collection/jobs', params);
    },
    status: () => get('/data-collection/status'),
    detail: (id) => get(`/data-collection/jobs/${id}`),
    run: (body) => post('/data-collection/run', body),
    stop: (id) => post(`/data-collection/${id}/stop`, {}),
  },
  prompts: {
    template: () => get('/prompts/template'),
    history: (params) => get('/prompts/history', params),
    update: (body) => patch('/prompts/template', body),
  },
  settings: {
    get: () => get('/admin/settings'),
    update: (body) => patch('/admin/settings', body),
  },
};

export { getApiErrorMessage };
