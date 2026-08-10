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


const adminGetCache = new Map();
const ADMIN_SESSION_CACHE_PREFIX = 'voxidence:admin-cache:';

const readSessionCache = (key) => {
  try {
    const raw = window.sessionStorage.getItem(`${ADMIN_SESSION_CACHE_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.expiresAt <= Date.now()) {
      return null;
    }
    return parsed.value;
  } catch {
    return null;
  }
};

const readStaleSessionCache = (key, maxStaleMs = 1_800_000) => {
  try {
    const raw = window.sessionStorage.getItem(`${ADMIN_SESSION_CACHE_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.value === undefined) return null;
    if (parsed.expiresAt + maxStaleMs <= Date.now()) {
      window.sessionStorage.removeItem(`${ADMIN_SESSION_CACHE_PREFIX}${key}`);
      return null;
    }
    return parsed.value;
  } catch {
    return null;
  }
};

const writeSessionCache = (key, value, ttlMs) => {
  try {
    window.sessionStorage.setItem(
      `${ADMIN_SESSION_CACHE_PREFIX}${key}`,
      JSON.stringify({ value, expiresAt: Date.now() + ttlMs }),
    );
  } catch {
    // Storage can be unavailable in privacy mode. Memory cache still works.
  }
};

const removeSessionCacheByNamespace = (namespace) => {
  try {
    const prefix = `${ADMIN_SESSION_CACHE_PREFIX}${namespace}:`;
    for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = window.sessionStorage.key(index);
      if (key?.startsWith(prefix)) window.sessionStorage.removeItem(key);
    }
  } catch {
    // Ignore storage failures.
  }
};

const stableParamsKey = (params = {}) => JSON.stringify(Object.keys(cleanParams(params)).sort().reduce((acc, key) => {
  acc[key] = cleanParams(params)[key];
  return acc;
}, {}));

const cachedGet = async (cacheNamespace, url, params, ttlMs = 15000, config = {}) => {
  const key = `${cacheNamespace}:${url}:${stableParamsKey(params)}`;
  const now = Date.now();
  const cached = adminGetCache.get(key);

  if (cached?.value && cached.expiresAt > now) return cached.value;
  if (cached?.promise) return cached.promise;

  const sessionValue = readSessionCache(key);
  if (sessionValue !== null) {
    adminGetCache.set(key, { value: sessionValue, expiresAt: now + ttlMs });
    return sessionValue;
  }

  // Stale-while-revalidate: admin navigation should feel instant after the
  // first successful visit. Return a recent snapshot immediately and refresh
  // it in the background. Mutations explicitly invalidate these snapshots.
  const staleValue = readStaleSessionCache(key);
  if (staleValue !== null) {
    const refreshPromise = get(url, params, config)
      .then((value) => {
        adminGetCache.set(key, { value, expiresAt: Date.now() + ttlMs });
        writeSessionCache(key, value, ttlMs);
        return value;
      })
      .catch(() => staleValue);

    adminGetCache.set(key, {
      value: staleValue,
      promise: refreshPromise,
      expiresAt: now + 1000,
    });
    return staleValue;
  }

  const promise = get(url, params, config)
    .then((value) => {
      adminGetCache.set(key, { value, expiresAt: Date.now() + ttlMs });
      writeSessionCache(key, value, ttlMs);
      return value;
    })
    .catch((error) => {
      adminGetCache.delete(key);
      throw error;
    });

  adminGetCache.set(key, { promise, expiresAt: now + ttlMs });
  return promise;
};

const freshGet = async (cacheNamespace, url, params, ttlMs = 15000, config = {}) => {
  const key = `${cacheNamespace}:${url}:${stableParamsKey(params)}`;
  const value = await get(url, params, config);
  adminGetCache.set(key, { value, expiresAt: Date.now() + ttlMs });
  writeSessionCache(key, value, ttlMs);
  return value;
};


const adminRead = (
  namespace,
  url,
  params,
  ttlMs = 60000,
  config = {},
) => cachedGet(namespace, url, params, ttlMs, {
  timeout: 12000,
  ...config,
});

const invalidateAdminCache = (namespace) => {
  for (const key of adminGetCache.keys()) {
    if (key.startsWith(`${namespace}:`)) adminGetCache.delete(key);
  }
  removeSessionCacheByNamespace(namespace);
};

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
  getDashboard: () => adminRead('dashboard', '/admin/dashboard', undefined, 60000, { timeout: 15000 }),

  users: {
    list: (params) => adminRead('users-list', '/admin/users', params, 30000),
    summary: (params) => adminRead('users-summary', '/admin/users/summary', params, 60000),
    charts: (params) => adminRead('users-charts', '/admin/users/charts', params, 120000),
    detail: (id) => adminRead('user-detail', `/admin/users/${id}`, undefined, 120000, { timeout: 8000 }),
    update: async (id, body) => { const value = await patch(`/admin/users/${id}`, body); invalidateAdminCache('users-list'); invalidateAdminCache('users-summary'); invalidateAdminCache('dashboard'); return value; },
    status: async (id, isActive) => { const value = await patch(`/admin/users/${id}/status`, { isActive }); invalidateAdminCache('users-list'); invalidateAdminCache('users-summary'); invalidateAdminCache('dashboard'); return value; },
    resetPassword: (id) => post(`/admin/users/${id}/send-password-reset-email`),
    remove: async (id) => { const value = await del(`/admin/users/${id}`); invalidateAdminCache('users-list'); invalidateAdminCache('users-summary'); invalidateAdminCache('dashboard'); return value; },
    exportCsv: (params) => downloadCsv('/admin/users/export/csv', params, 'admin-users.csv'),
  },
  ideas: {
    list: (params) => adminRead('ideas-list', '/admin/ideas', params, 30000),
    listFresh: (params) => freshGet('ideas-list', '/admin/ideas', params, 20000, { timeout: 15000 }),
    publishedList: (params) => adminRead('ideas-published-list', '/admin/ideas/published', params, 30000),
    publishedListFresh: (params) => freshGet('ideas-published-list', '/admin/ideas/published', params, 20000, { timeout: 15000 }),
    summary: (params) => adminRead('ideas-summary', '/admin/ideas/summary', params, 60000),
    summaryFresh: (params) => freshGet('ideas-summary', '/admin/ideas/summary', params, 45000, { timeout: 20000 }),
    charts: (params) => adminRead('ideas-charts', '/admin/ideas/charts', params, 120000),
    detail: (id) => adminRead('idea-detail', `/admin/ideas/${id}`, undefined, 120000, { timeout: 20000 }),
    quickDetail: (id) => adminRead('idea-quick-detail', `/admin/ideas/${id}/quick-detail`, undefined, 120000, { timeout: 7000 }),
    publicationInsights: (id) => adminRead('idea-publication-insights', `/admin/ideas/${id}/publication-insights`, undefined, 30000, { timeout: 10000 }),
    exportCsv: (params) => downloadCsv('/admin/ideas/export/csv', params, 'admin-ideas.csv'),
    exportPublishedCsv: (params) => downloadCsv('/admin/ideas/published/export/csv', params, 'admin-published-ideas.csv'),
  },
  payments: {
    list: (params) => adminRead('payments-list', '/admin/payments', params),
    summary: (params) => adminRead('payments-summary', '/admin/payments/summary', params, 60000),
    charts: (params) => adminRead('payments-charts', '/admin/payments/charts', params, 120000),
    exportCsv: (params) => downloadCsv('/admin/payments/export/csv', params, 'admin-payments.csv'),
  },
  credits: {
    list: (params) => adminRead('credits-list', '/admin/credits/history', params),
    summary: (params) => adminRead('credits-summary', '/admin/credits/summary', params, 60000),
    charts: (params) => adminRead('credits-charts', '/admin/credits/charts', params, 120000),
    adjust: (body) => post('/admin/credits/adjust', body),
    exportCsv: (params) => downloadCsv('/admin/credits/export/csv', params, 'admin-credits.csv'),
  },
  domains: {
    list: (params) => adminRead('domains-list', '/admin/domains', params),
    summary: (params) => adminRead('domains-summary', '/admin/domains/summary', params, 60000),
    charts: (params) => adminRead('domains-charts', '/admin/domains/charts', params, 120000),
    create: (body) => post('/admin/domains', body),
    update: (id, body) => patch(`/admin/domains/${id}`, body),
    remove: (id) => del(`/admin/domains/${id}`),
  },
  evidence: {
    list: (params) => adminRead('evidence-list', '/admin/comments', params),
    summary: (params) => adminRead('evidence-summary', '/admin/comments/summary', params, 60000),
    charts: (params) => adminRead('evidence-charts', '/admin/comments/charts', params, 120000),
  },
  complaints: {
    list: (params) => adminRead('complaints-list', '/admin/complaints', params),
    summary: (params) => adminRead('complaints-summary', '/admin/complaints/summary', params, 60000),
    charts: (params) => adminRead('complaints-charts', '/admin/complaints/charts', params, 120000),
    update: async (id, body) => { const value = await patch(`/admin/complaints/${id}`, body); invalidateAdminCache('complaints-list'); invalidateAdminCache('complaints-summary'); invalidateAdminCache('complaints-charts'); invalidateAdminCache('dashboard'); return value; },
    exportCsv: (params) => downloadCsv('/admin/complaints/export/csv', params, 'admin-complaints.csv'),
  },
  contactMessages: {
    list: (params) => adminRead('contact-list', '/admin/contact-messages', params),
    summary: (params) => adminRead('contact-summary', '/admin/contact-messages/summary', params, 60000),
    charts: (params) => adminRead('contact-charts', '/admin/contact-messages/charts', params, 120000),
    update: async (id, body) => { const value = await patch(`/admin/contact-messages/${id}`, body); invalidateAdminCache('contact-list'); invalidateAdminCache('contact-summary'); invalidateAdminCache('contact-charts'); invalidateAdminCache('dashboard'); return value; },
    exportCsv: (params) => downloadCsv('/admin/contact-messages/export/csv', params, 'admin-contact-messages.csv'),
  },
  publicationReports: {
    list: (params) => adminRead('publication-reports-list', '/admin/publication-reports', params, 20000),
    listForPublication: (publicationId, params = {}) =>
      adminRead(
        'publication-reports-by-publication',
        `/admin/publication-reports/publication/${publicationId}`,
        params,
        15000,
        { timeout: 8000 },
      ),
    summary: () => adminRead('publication-reports-summary', '/admin/publication-reports/summary', undefined, 60000),
    review: async (id, body) => {
      const value = await patch(`/admin/publication-reports/${id}/review`, body);
      invalidateAdminCache('publication-reports-list');
      invalidateAdminCache('publication-reports-by-publication');
      invalidateAdminCache('publication-reports-summary');
      invalidateAdminCache('idea-publication-insights');
      return value;
    },
  },
  publications: {
    hide: async (id, reason) => {
      const value = await patch(`/admin/publications/${id}/hide`, { reason });
      invalidateAdminCache('ideas-list');
      invalidateAdminCache('ideas-published-list');
      invalidateAdminCache('ideas-summary');
      invalidateAdminCache('idea-detail');
      invalidateAdminCache('dashboard');
      return value;
    },
    restore: async (id) => {
      const value = await patch(`/admin/publications/${id}/restore`, {});
      invalidateAdminCache('ideas-list');
      invalidateAdminCache('ideas-published-list');
      invalidateAdminCache('ideas-summary');
      invalidateAdminCache('idea-detail');
      invalidateAdminCache('dashboard');
      return value;
    },
    archive: async (id, reason) => {
      const value = await patch(`/admin/publications/${id}/archive`, { reason });
      invalidateAdminCache('ideas-list');
      invalidateAdminCache('ideas-published-list');
      invalidateAdminCache('ideas-summary');
      invalidateAdminCache('idea-detail');
      invalidateAdminCache('dashboard');
      return value;
    },
    unpublish: async (id, reason) => {
      const value = await patch(`/admin/publications/${id}/unpublish`, { reason });
      invalidateAdminCache('ideas-list');
      invalidateAdminCache('ideas-published-list');
      invalidateAdminCache('ideas-summary');
      invalidateAdminCache('idea-detail');
      invalidateAdminCache('dashboard');
      return value;
    },
  },
  alerts: {
    list: (params) => adminRead('alerts-list', '/admin/alerts', params),
    create: (body) => post('/admin/alerts', body),
    email: (body) => post('/admin/alerts/email', body),
  },
  dataSources: {
    list: (params) => adminRead('data-sources-list', '/admin/data-sources', params),
    create: (body) => post('/admin/data-sources', body),
    synchronize: () => post('/admin/data-sources/synchronize'),
    detail: (id) => adminRead('data-source-detail', `/admin/data-sources/${id}`, undefined, 120000),
    update: (id, body) => patch(`/admin/data-sources/${id}`, body),
    status: (id, isActive) => patch(`/admin/data-sources/${id}/status`, { isActive }),
  },
  aiModels: {
    list: (params) => adminRead('ai-models-list', '/ai-models', params, 120000),
    providers: () => adminRead('ai-model-providers', '/ai-models/providers', undefined, 300000),
    detail: (id) => adminRead('ai-model-detail', `/ai-models/${id}`, undefined, 120000),
    create: (body) => post('/ai-models', body),
    update: (id, body) => patch(`/ai-models/${id}`, body),
    setDefault: (id) => patch(`/ai-models/${id}/default`, {}),
    activate: (id) => patch(`/ai-models/${id}/activate`, {}),
    deactivate: (id) => patch(`/ai-models/${id}/deactivate`, {}),
  },
  aiMonitoring: {
    list: (params) => adminRead('ai-monitoring-list', '/admin/ai-monitoring/logs', params),
    summary: (params) => adminRead('ai-monitoring-summary', '/admin/ai-monitoring/summary', params, 30000),
    charts: (params) => adminRead('ai-monitoring-charts', '/admin/ai-monitoring/charts', params, 120000),
    detail: (id) => adminRead('ai-monitoring-detail', `/admin/ai-monitoring/logs/${id}`, undefined, 120000),
    operation: (id) => adminRead('ai-monitoring-operation', `/admin/ai-monitoring/operations/${id}`, undefined, 120000),
    exportCsv: (params) => downloadCsv('/admin/ai-monitoring/logs/export/csv', params, 'admin-ai-monitoring.csv'),
  },
  aiAnalytics: { summary: (params) => adminRead('ai-analytics-summary', '/admin/ai/analytics/summary', params, 120000, { timeout: 12000 }) },
  auditLogs: {
    list: (params) => adminRead('audit-list', '/audit-logs', params, 60000),
    summary: (params) => adminRead('audit-summary', '/audit-logs/summary', params, 120000),
    charts: (params) => adminRead('audit-charts', '/audit-logs/charts', params, 120000),
    exportCsv: (params) => downloadCsv('/audit-logs/export/csv', params, 'admin-audit-logs.csv'),
  },
  authAudit: { list: (params) => adminRead('auth-audit-list', '/admin/auth-audit-logs', params, 60000) },
  collection: {
    list: (params, tab = 'jobs') => {
      if (tab === 'posts') return adminRead('collection-posts', '/data-collection/posts', params, 60000);
      if (tab === 'comments') return adminRead('collection-comments', '/data-collection/comments', params, 60000);
      return adminRead('collection-jobs', '/data-collection/jobs', params, 60000);
    },
    status: () => adminRead('collection-status', '/data-collection/status', undefined, 15000),
    detail: (id) => adminRead('collection-detail', `/data-collection/jobs/${id}`, undefined, 60000),
    run: (body) => post('/data-collection/run', body),
    stop: (id) => post(`/data-collection/${id}/stop`, {}),
  },
  prompts: {
    template: () => adminRead('prompts-template', '/prompts/template', undefined, 300000),
    history: (params) => adminRead('prompts-history', '/prompts/history', params, 60000),
    update: (body) => patch('/prompts/template', body),
  },
  settings: {
    get: () => adminRead('settings', '/admin/settings', undefined, 300000),
    update: (body) => patch('/admin/settings', body),
  },
};


/**
 * Prefetches only the first-screen request for a route. It is intentionally
 * fire-and-forget and uses the exact same cache as the page itself, so hovering
 * a sidebar item can make the next navigation render from memory immediately.
 */
const prefetchAdminRoute = (pathname) => {
  const firstPage = { page: 1, limit: 20 };

  const loaders = {
    '/admin/dashboard': () => adminApi.getDashboard(),
    '/admin/users': () => adminApi.users.list(firstPage),
    '/admin/ideas': () => adminApi.ideas.list(firstPage),
    '/admin/publication-reports': () => adminApi.publicationReports.list(firstPage),
    '/admin/evidence': () => adminApi.evidence.list({ ...firstPage, sortBy: 'collectedAt', sortOrder: 'desc' }),
    '/admin/payments': () => adminApi.payments.list(firstPage),
    '/admin/credits': () => adminApi.credits.list(firstPage),
    '/admin/complaints': () => adminApi.complaints.list(firstPage),
    '/admin/contact-messages': () => adminApi.contactMessages.list(firstPage),
    '/admin/ai-monitoring': () => adminApi.aiMonitoring.list(firstPage),
    '/admin/ai-analytics': () => adminApi.aiAnalytics.summary({}),
    '/admin/ai-models': () => adminApi.aiModels.list(firstPage),
    '/admin/data-sources': () => adminApi.dataSources.list(firstPage),
    '/admin/domains': () => adminApi.domains.list(firstPage),
    '/admin/audit-logs': () => adminApi.auditLogs.list(firstPage),
    '/admin/auth-audit': () => adminApi.authAudit.list(firstPage),
    '/admin/settings': () => adminApi.settings.get(),
    '/admin/prompts': () => adminApi.prompts.template(),
  };

  const loader = loaders[pathname];
  if (!loader) return;
  Promise.resolve().then(loader).catch(() => undefined);
};

adminApi.prefetchRoute = prefetchAdminRoute;

export { getApiErrorMessage };
