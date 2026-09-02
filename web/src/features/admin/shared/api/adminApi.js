/**
 * Shared administrator API client for the web application.
 *
 * Centralizes administrator requests, cache handling, and cache invalidation.
 * Data-source operations include permanent deletion through the admin endpoint.
 *
 * @author Eman
 */
import { normalUserApi, extractApiData, getApiErrorMessage } from '../../../normal-user/shared/api/normalUserApi';

const cleanParams = (params = {}) => Object.fromEntries(
  Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''),
);

const extractAdminApiData = (response) => {
  const body = response?.data;
  const extracted = extractApiData(response);

  if (!body || typeof body !== 'object' || Array.isArray(body) || body.data === undefined) {
    return extracted;
  }

  const paginationKeys = [
    'total',
    'totalItems',
    'totalPages',
    'pages',
    'page',
    'currentPage',
    'limit',
    'pageSize',
  ];

  const inlinePagination = paginationKeys.reduce((meta, key) => {
    if (body[key] !== undefined) meta[key] = body[key];
    return meta;
  }, {});

  const pagination = body.meta
    || body.pagination
    || (Object.keys(inlinePagination).length ? inlinePagination : null);

  if (!pagination) return extracted;

  if (Array.isArray(body.data)) {
    return {
      data: body.data,
      meta: pagination,
    };
  }

  if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) {
    return {
      ...body.data,
      meta: body.data.meta || body.data.pagination || pagination,
    };
  }

  return extracted;
};

const get = async (url, params, config = {}) => extractAdminApiData(await normalUserApi.get(url, {
  ...config,
  params: cleanParams(params),
}));

const post = async (url, body, config = {}) => extractApiData(
  await normalUserApi.post(url, body, config),
);

const patch = async (url, body, config = {}) => extractApiData(
  await normalUserApi.patch(url, body, config),
);

const del = async (url, config = {}) => extractApiData(
  await normalUserApi.delete(url, config),
);

const sensitiveConfig = (accessToken, extraConfig = {}) => ({
  ...extraConfig,
  headers: {
    ...(extraConfig.headers || {}),
    'X-Admin-Sensitive-Token': accessToken,
  },
});

const adminGetCache = new Map();
const pendingAdminStorageWrites = new Map();

const ADMIN_SESSION_CACHE_PREFIX = 'voxidence:admin-cache:';
const MAX_ADMIN_PERSISTED_ENTRY_CHARS = 1_500_000;

const readSessionCache = (key) => {
  try {
    const raw = window.sessionStorage.getItem(
      `${ADMIN_SESSION_CACHE_PREFIX}${key}`,
    );

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
    const raw = window.sessionStorage.getItem(
      `${ADMIN_SESSION_CACHE_PREFIX}${key}`,
    );

    if (!raw) return null;

    const parsed = JSON.parse(raw);

    if (!parsed || parsed.value === undefined) {
      return null;
    }

    if (parsed.expiresAt + maxStaleMs <= Date.now()) {
      window.sessionStorage.removeItem(
        `${ADMIN_SESSION_CACHE_PREFIX}${key}`,
      );

      return null;
    }

    return parsed.value;
  } catch {
    return null;
  }
};

const scheduleAdminStorageWrite = (callback) => {
  if (typeof window === 'undefined') return;

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(callback, {
      timeout: 1200,
    });

    return;
  }

  window.setTimeout(callback, 0);
};

const writeSessionCache = (key, value, ttlMs) => {
  const entry = {
    value,
    expiresAt: Date.now() + ttlMs,
  };

  pendingAdminStorageWrites.set(key, entry);

  scheduleAdminStorageWrite(() => {
    const newestEntry = pendingAdminStorageWrites.get(key);

    if (!newestEntry) return;

    pendingAdminStorageWrites.delete(key);

    try {
      const serialized = JSON.stringify(newestEntry);
      const storageKey = `${ADMIN_SESSION_CACHE_PREFIX}${key}`;

      if (serialized.length > MAX_ADMIN_PERSISTED_ENTRY_CHARS) {
        window.sessionStorage.removeItem(storageKey);
        return;
      }

      window.sessionStorage.setItem(storageKey, serialized);
    } catch {
    }
  });
};

const removeSessionCacheByNamespace = (namespace) => {
  const pendingPrefix = `${namespace}:`;

  for (const key of pendingAdminStorageWrites.keys()) {
    if (key.startsWith(pendingPrefix)) {
      pendingAdminStorageWrites.delete(key);
    }
  }

  try {
    const prefix = `${ADMIN_SESSION_CACHE_PREFIX}${namespace}:`;

    for (
      let index = window.sessionStorage.length - 1;
      index >= 0;
      index -= 1
    ) {
      const key = window.sessionStorage.key(index);

      if (key?.startsWith(prefix)) {
        window.sessionStorage.removeItem(key);
      }
    }
  } catch {
  }
};

const stableParamsKey = (params = {}) => JSON.stringify(
  Object.keys(cleanParams(params))
    .sort()
    .reduce((acc, key) => {
      acc[key] = cleanParams(params)[key];
      return acc;
    }, {}),
);

const cachedGet = async (
  cacheNamespace,
  url,
  params,
  ttlMs = 15000,
  config = {},
) => {
  const key = `${cacheNamespace}:${url}:${stableParamsKey(params)}`;
  const now = Date.now();
  const cached = adminGetCache.get(key);

  if (cached?.value && cached.expiresAt > now) {
    return cached.value;
  }

  if (cached?.promise) {
    return cached.promise;
  }

  const sessionValue = readSessionCache(key);

  if (sessionValue !== null) {
    adminGetCache.set(key, {
      value: sessionValue,
      expiresAt: now + ttlMs,
    });

    return sessionValue;
  }

  const staleValue = readStaleSessionCache(key);

  if (staleValue !== null) {
    const refreshPromise = get(url, params, config)
      .then((value) => {
        adminGetCache.set(key, {
          value,
          expiresAt: Date.now() + ttlMs,
        });

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
      adminGetCache.set(key, {
        value,
        expiresAt: Date.now() + ttlMs,
      });

      writeSessionCache(key, value, ttlMs);

      return value;
    })
    .catch((error) => {
      adminGetCache.delete(key);
      throw error;
    });

  adminGetCache.set(key, {
    promise,
    expiresAt: now + ttlMs,
  });

  return promise;
};

const freshGet = async (
  cacheNamespace,
  url,
  params,
  ttlMs = 15000,
  config = {},
) => {
  const key = `${cacheNamespace}:${url}:${stableParamsKey(params)}`;

  const value = await get(url, params, config);

  adminGetCache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });

  writeSessionCache(key, value, ttlMs);

  return value;
};

const adminRead = (
  namespace,
  url,
  params,
  ttlMs = 60000,
  config = {},
) => cachedGet(
  namespace,
  url,
  params,
  ttlMs,
  {
    timeout: 12000,
    ...config,
  },
);

const invalidateAdminCache = (namespace) => {
  for (const key of adminGetCache.keys()) {
    if (key.startsWith(`${namespace}:`)) {
      adminGetCache.delete(key);
    }
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
    : new Blob(
      [response.data],
      {
        type: 'text/csv;charset=utf-8',
      },
    );

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
  sensitiveAccess: {
    verify: (scope, password) => post(
      '/admin/sensitive-access/verify',
      {
        scope,
        password,
      },
    ),
  },

  administrators: {
    workspace: (accessToken) => get(
      '/admin/administrators/workspace',
      undefined,
      sensitiveConfig(
        accessToken,
        {
          timeout: 20000,
        },
      ),
    ),

    invite: (body, accessToken) => post(
      '/admin/administrators/invitations',
      body,
      sensitiveConfig(
        accessToken,
        {
          timeout: 60000,
        },
      ),
    ),

    resend: (id, accessToken) => post(
      `/admin/administrators/invitations/${id}/resend`,
      {},
      sensitiveConfig(
        accessToken,
        {
          timeout: 60000,
        },
      ),
    ),

    cancel: (id, accessToken) => del(
      `/admin/administrators/invitations/${id}`,
      sensitiveConfig(
        accessToken,
        {
          timeout: 20000,
        },
      ),
    ),
  },

  getDashboard: (period = 'week') => adminRead(
    'dashboard',
    '/admin/dashboard',
    {
      period,
    },
    60000,
    {
      timeout: 15000,
    },
  ),

  getDashboardFresh: (period = 'week') => freshGet(
    'dashboard',
    '/admin/dashboard',
    {
      period,
    },
    60000,
    {
      timeout: 15000,
    },
  ),

  users: {
    list: (params) => adminRead(
      'users-list',
      '/admin/users',
      params,
      30000,
    ),

    listFresh: (params) => freshGet(
      'users-list',
      '/admin/users',
      params,
      30000,
    ),

    summary: (params) => adminRead(
      'users-summary',
      '/admin/users/summary',
      params,
      60000,
    ),

    summaryFresh: (params) => freshGet(
      'users-summary',
      '/admin/users/summary',
      params,
      60000,
    ),

    charts: (params) => adminRead(
      'users-charts',
      '/admin/users/charts',
      params,
      120000,
    ),

    detail: (id) => adminRead(
      'user-detail',
      `/admin/users/${id}`,
      undefined,
      120000,
      {
        timeout: 8000,
      },
    ),

    update: async (id, body) => {
      const value = await patch(
        `/admin/users/${id}`,
        body,
      );

      invalidateAdminCache('users-list');
      invalidateAdminCache('users-summary');
      invalidateAdminCache('dashboard');

      return value;
    },

    status: async (id, isActive) => {
      const value = await patch(
        `/admin/users/${id}/status`,
        {
          isActive,
        },
      );

      invalidateAdminCache('users-list');
      invalidateAdminCache('users-summary');
      invalidateAdminCache('dashboard');

      return value;
    },

    resetPassword: (id) => post(
      `/admin/users/${id}/send-password-reset-email`,
    ),

    remove: async (id) => {
      const value = await del(
        `/admin/users/${id}`,
      );

      invalidateAdminCache('users-list');
      invalidateAdminCache('users-summary');
      invalidateAdminCache('dashboard');

      return value;
    },

    exportCsv: (params) => downloadCsv(
      '/admin/users/export/csv',
      params,
      'admin-users.csv',
    ),
  },

  ideas: {
    list: (params) => adminRead(
      'ideas-list',
      '/admin/ideas',
      params,
      30000,
    ),

    listFresh: (params) => freshGet(
      'ideas-list',
      '/admin/ideas',
      params,
      20000,
      {
        timeout: 15000,
      },
    ),

    publishedList: (params) => adminRead(
      'ideas-published-list',
      '/admin/ideas/published',
      params,
      30000,
    ),

    publishedListFresh: (params) => freshGet(
      'ideas-published-list',
      '/admin/ideas/published',
      params,
      20000,
      {
        timeout: 15000,
      },
    ),

    summary: (params) => adminRead(
      'ideas-summary',
      '/admin/ideas/summary',
      params,
      60000,
    ),

    summaryFresh: (params) => freshGet(
      'ideas-summary',
      '/admin/ideas/summary',
      params,
      45000,
      {
        timeout: 20000,
      },
    ),

    charts: (params) => adminRead(
      'ideas-charts',
      '/admin/ideas/charts',
      params,
      120000,
    ),

    detail: (id) => adminRead(
      'idea-detail',
      `/admin/ideas/${id}`,
      undefined,
      120000,
      {
        timeout: 20000,
      },
    ),

    quickDetail: (id) => adminRead(
      'idea-quick-detail',
      `/admin/ideas/${id}/quick-detail`,
      undefined,
      120000,
      {
        timeout: 7000,
      },
    ),

    publicationInsights: (id) => adminRead(
      'idea-publication-insights',
      `/admin/ideas/${id}/publication-insights`,
      undefined,
      30000,
      {
        timeout: 10000,
      },
    ),

    exportCsv: (params) => downloadCsv(
      '/admin/ideas/export/csv',
      params,
      'admin-ideas.csv',
    ),

    exportPublishedCsv: (params) => downloadCsv(
      '/admin/ideas/published/export/csv',
      params,
      'admin-published-ideas.csv',
    ),
  },

  payments: {
    list: (params) => adminRead(
      'payments-list',
      '/admin/payments',
      params,
      30000,
    ),

    listFresh: (params) => freshGet(
      'payments-list',
      '/admin/payments',
      params,
      20000,
      {
        timeout: 12000,
      },
    ),

    summary: (params) => adminRead(
      'payments-summary',
      '/admin/payments/summary',
      params,
      60000,
    ),

    summaryFresh: (params) => freshGet(
      'payments-summary',
      '/admin/payments/summary',
      params,
      45000,
      {
        timeout: 12000,
      },
    ),

    charts: (params) => adminRead(
      'payments-charts',
      '/admin/payments/charts',
      params,
      120000,
    ),

    chartsFresh: (params) => freshGet(
      'payments-charts',
      '/admin/payments/charts',
      params,
      90000,
      {
        timeout: 12000,
      },
    ),

    exportCsv: (params) => downloadCsv(
      '/admin/payments/export/csv',
      params,
      'admin-payments.csv',
    ),
  },

  credits: {
    list: (params) => adminRead(
      'credits-list',
      '/admin/credits/history',
      params,
      30000,
    ),

    listFresh: (params) => freshGet(
      'credits-list',
      '/admin/credits/history',
      params,
      20000,
      {
        timeout: 12000,
      },
    ),

    summary: (params) => adminRead(
      'credits-summary',
      '/admin/credits/summary',
      params,
      60000,
    ),

    summaryFresh: (params) => freshGet(
      'credits-summary',
      '/admin/credits/summary',
      params,
      45000,
      {
        timeout: 12000,
      },
    ),

    charts: (params) => adminRead(
      'credits-charts',
      '/admin/credits/charts',
      params,
      120000,
    ),

    chartsFresh: (params) => freshGet(
      'credits-charts',
      '/admin/credits/charts',
      params,
      90000,
      {
        timeout: 12000,
      },
    ),

    adjust: async (body) => {
      const value = await post(
        '/admin/credits/adjust',
        body,
      );

      invalidateAdminCache('credits-list');
      invalidateAdminCache('credits-summary');
      invalidateAdminCache('credits-charts');
      invalidateAdminCache('users-list');
      invalidateAdminCache('users-summary');
      invalidateAdminCache('user-detail');
      invalidateAdminCache('dashboard');

      return value;
    },

    exportCsv: (params) => downloadCsv(
      '/admin/credits/export/csv',
      params,
      'admin-credits.csv',
    ),
  },

  domains: {
    list: (params) => adminRead(
      'domains-list',
      '/admin/domains',
      params,
      30000,
    ),

    listFresh: (params) => freshGet(
      'domains-list',
      '/admin/domains',
      params,
      30000,
    ),

    summary: (params) => adminRead(
      'domains-summary',
      '/admin/domains/summary',
      params,
      60000,
    ),

    summaryFresh: (params) => freshGet(
      'domains-summary',
      '/admin/domains/summary',
      params,
      60000,
    ),

    charts: (params) => adminRead(
      'domains-charts',
      '/admin/domains/charts',
      params,
      120000,
    ),

    create: async (body) => {
      const value = await post(
        '/admin/domains',
        body,
      );

      invalidateAdminCache('domains-list');
      invalidateAdminCache('domains-summary');
      invalidateAdminCache('domains-charts');
      invalidateAdminCache('dashboard');

      return value;
    },

    update: async (id, body) => {
      const value = await patch(
        `/admin/domains/${id}`,
        body,
      );

      invalidateAdminCache('domains-list');
      invalidateAdminCache('domains-summary');
      invalidateAdminCache('domains-charts');
      invalidateAdminCache('dashboard');

      return value;
    },

    remove: async (id) => {
      const value = await del(
        `/admin/domains/${id}`,
      );

      invalidateAdminCache('domains-list');
      invalidateAdminCache('domains-summary');
      invalidateAdminCache('domains-charts');
      invalidateAdminCache('dashboard');

      return value;
    },
  },

  evidence: {
    list: (params) => adminRead(
      'evidence-list',
      '/admin/comments',
      params,
    ),

    listFresh: (params) => freshGet(
      'evidence-list',
      '/admin/comments',
      params,
    ),

    summary: (params) => adminRead(
      'evidence-summary',
      '/admin/comments/summary',
      params,
      60000,
    ),

    summaryFresh: (params) => freshGet(
      'evidence-summary',
      '/admin/comments/summary',
      params,
      60000,
    ),

    charts: (params) => adminRead(
      'evidence-charts',
      '/admin/comments/charts',
      params,
      120000,
    ),
  },

  complaints: {
    list: (params) => adminRead(
      'complaints-list',
      '/admin/complaints',
      params,
    ),

    listFresh: (params) => freshGet(
      'complaints-list',
      '/admin/complaints',
      params,
    ),

    summary: (params) => adminRead(
      'complaints-summary',
      '/admin/complaints/summary',
      params,
      60000,
    ),

    summaryFresh: (params) => freshGet(
      'complaints-summary',
      '/admin/complaints/summary',
      params,
      60000,
    ),

    charts: (params) => adminRead(
      'complaints-charts',
      '/admin/complaints/charts',
      params,
      120000,
    ),

    update: async (id, body) => {
      const value = await patch(
        `/admin/complaints/${id}`,
        body,
      );

      invalidateAdminCache('complaints-list');
      invalidateAdminCache('complaints-summary');
      invalidateAdminCache('complaints-charts');
      invalidateAdminCache('dashboard');

      return value;
    },

    exportCsv: (params) => downloadCsv(
      '/admin/complaints/export/csv',
      params,
      'admin-complaints.csv',
    ),
  },

  contactMessages: {
    list: (params) => adminRead(
      'contact-list',
      '/admin/contact-messages',
      params,
    ),

    listFresh: (params) => freshGet(
      'contact-list',
      '/admin/contact-messages',
      params,
    ),

    summary: (params) => adminRead(
      'contact-summary',
      '/admin/contact-messages/summary',
      params,
      60000,
    ),

    summaryFresh: (params) => freshGet(
      'contact-summary',
      '/admin/contact-messages/summary',
      params,
      60000,
    ),

    charts: (params) => adminRead(
      'contact-charts',
      '/admin/contact-messages/charts',
      params,
      120000,
    ),

    update: async (id, body) => {
      const value = await patch(
        `/admin/contact-messages/${id}`,
        body,
      );

      invalidateAdminCache('contact-list');
      invalidateAdminCache('contact-summary');
      invalidateAdminCache('contact-charts');
      invalidateAdminCache('dashboard');

      return value;
    },

    exportCsv: (params) => downloadCsv(
      '/admin/contact-messages/export/csv',
      params,
      'admin-contact-messages.csv',
    ),
  },

  publicationReports: {
    list: (params) => adminRead(
      'publication-reports-list',
      '/admin/publication-reports',
      params,
      20000,
    ),

    listFresh: (params) => freshGet(
      'publication-reports-list',
      '/admin/publication-reports',
      params,
      20000,
    ),

    listForPublication: (
      publicationId,
      params = {},
    ) => adminRead(
      'publication-reports-by-publication',
      `/admin/publication-reports/publication/${publicationId}`,
      params,
      15000,
      {
        timeout: 8000,
      },
    ),

    summary: () => adminRead(
      'publication-reports-summary',
      '/admin/publication-reports/summary',
      undefined,
      60000,
    ),

    summaryFresh: () => freshGet(
      'publication-reports-summary',
      '/admin/publication-reports/summary',
      undefined,
      60000,
    ),

    review: async (id, body) => {
      const value = await patch(
        `/admin/publication-reports/${id}/review`,
        body,
      );

      invalidateAdminCache('publication-reports-list');
      invalidateAdminCache('publication-reports-by-publication');
      invalidateAdminCache('publication-reports-summary');
      invalidateAdminCache('idea-publication-insights');

      return value;
    },
  },

  publications: {
    hide: async (id, reason) => {
      const value = await patch(
        `/admin/publications/${id}/hide`,
        {
          reason,
        },
      );

      invalidateAdminCache('ideas-list');
      invalidateAdminCache('ideas-published-list');
      invalidateAdminCache('ideas-summary');
      invalidateAdminCache('idea-detail');
      invalidateAdminCache('dashboard');

      return value;
    },

    restore: async (id) => {
      const value = await patch(
        `/admin/publications/${id}/restore`,
        {},
      );

      invalidateAdminCache('ideas-list');
      invalidateAdminCache('ideas-published-list');
      invalidateAdminCache('ideas-summary');
      invalidateAdminCache('idea-detail');
      invalidateAdminCache('dashboard');

      return value;
    },

    archive: async (id, reason) => {
      const value = await patch(
        `/admin/publications/${id}/archive`,
        {
          reason,
        },
      );

      invalidateAdminCache('ideas-list');
      invalidateAdminCache('ideas-published-list');
      invalidateAdminCache('ideas-summary');
      invalidateAdminCache('idea-detail');
      invalidateAdminCache('dashboard');

      return value;
    },

    unpublish: async (id, reason) => {
      const value = await patch(
        `/admin/publications/${id}/unpublish`,
        {
          reason,
        },
      );

      invalidateAdminCache('ideas-list');
      invalidateAdminCache('ideas-published-list');
      invalidateAdminCache('ideas-summary');
      invalidateAdminCache('idea-detail');
      invalidateAdminCache('dashboard');

      return value;
    },
  },

  alerts: {
    list: (params) => adminRead(
      'alerts-list',
      '/admin/alerts',
      params,
      30000,
    ),

    listFresh: (params) => freshGet(
      'alerts-list',
      '/admin/alerts',
      params,
      20000,
      {
        timeout: 12000,
      },
    ),

    summary: (params) => adminRead(
      'alerts-summary',
      '/admin/alerts/summary',
      params,
      60000,
    ),

    summaryFresh: (params) => freshGet(
      'alerts-summary',
      '/admin/alerts/summary',
      params,
      45000,
      {
        timeout: 12000,
      },
    ),

    sent: (params) => freshGet(
      'alerts-sent',
      '/admin/alerts/sent',
      params,
      15000,
      {
        timeout: 12000,
      },
    ),

    sentFresh: (params) => freshGet(
      'alerts-sent',
      '/admin/alerts/sent',
      params,
      15000,
      {
        timeout: 12000,
      },
    ),

    send: async (body) => {
      const value = await post(
        '/admin/alerts/send',
        body,
      );

      invalidateAdminCache('alerts-list');
      invalidateAdminCache('alerts-summary');
      invalidateAdminCache('alerts-sent');
      invalidateAdminCache('audit-list');
      invalidateAdminCache('audit-summary');
      invalidateAdminCache('dashboard');

      return value;
    },

    create: async (body) => {
      const value = await post(
        '/admin/alerts',
        body,
      );

      invalidateAdminCache('alerts-list');
      invalidateAdminCache('alerts-summary');
      invalidateAdminCache('alerts-sent');
      invalidateAdminCache('audit-list');
      invalidateAdminCache('audit-summary');
      invalidateAdminCache('dashboard');

      return value;
    },

    email: async (body) => {
      const value = await post(
        '/admin/alerts/email',
        body,
      );

      invalidateAdminCache('alerts-sent');
      invalidateAdminCache('audit-list');
      invalidateAdminCache('audit-summary');
      invalidateAdminCache('dashboard');

      return value;
    },
  },

  dataSources: {
    list: (params) => adminRead(
      'data-sources-list',
      '/admin/data-sources',
      params,
      30000,
    ),

    listFresh: (params) => freshGet(
      'data-sources-list',
      '/admin/data-sources',
      params,
      30000,
    ),

    summary: () => adminRead(
      'data-sources-summary',
      '/admin/data-sources/summary',
      undefined,
      60000,
    ),

    summaryFresh: () => freshGet(
      'data-sources-summary',
      '/admin/data-sources/summary',
      undefined,
      60000,
    ),

    create: async (body) => {
      const value = await post(
        '/admin/data-sources',
        body,
      );

      invalidateAdminCache('data-sources-list');
      invalidateAdminCache('data-sources-summary');
      invalidateAdminCache('dashboard');

      return value;
    },

    synchronize: async () => {
      const value = await post(
        '/admin/data-sources/synchronize',
      );

      invalidateAdminCache('data-sources-list');
      invalidateAdminCache('data-sources-summary');
      invalidateAdminCache('data-source-detail');
      invalidateAdminCache('dashboard');

      return value;
    },

    detail: (id) => adminRead(
      'data-source-detail',
      `/admin/data-sources/${id}`,
      undefined,
      120000,
    ),

    update: async (id, body) => {
      const value = await patch(
        `/admin/data-sources/${id}`,
        body,
      );

      invalidateAdminCache('data-sources-list');
      invalidateAdminCache('data-sources-summary');
      invalidateAdminCache('data-source-detail');
      invalidateAdminCache('dashboard');

      return value;
    },

    status: async (id, isActive) => {
      const value = await patch(
        `/admin/data-sources/${id}/status`,
        {
          isActive,
        },
      );

      invalidateAdminCache('data-sources-list');
      invalidateAdminCache('data-sources-summary');
      invalidateAdminCache('data-source-detail');
      invalidateAdminCache('dashboard');

      return value;
    },

    /**
     * Deletes a data source and invalidates cached data-source/dashboard reads.
     */
    remove: async (id) => {
      const value = await del(
        `/admin/data-sources/${id}`,
      );

      invalidateAdminCache('data-sources-list');
      invalidateAdminCache('data-sources-summary');
      invalidateAdminCache('data-source-detail');
      invalidateAdminCache('dashboard');

      return value;
    },
  },

  aiModels: {
    list: (params) => adminRead(
      'ai-models-list',
      '/ai-models',
      params,
      30000,
    ),

    listFresh: (params) => freshGet(
      'ai-models-list',
      '/ai-models',
      params,
      20000,
      {
        timeout: 12000,
      },
    ),

    summary: () => adminRead(
      'ai-models-summary',
      '/ai-models/summary',
      undefined,
      60000,
    ),

    summaryFresh: () => freshGet(
      'ai-models-summary',
      '/ai-models/summary',
      undefined,
      45000,
      {
        timeout: 12000,
      },
    ),

    providers: () => adminRead(
      'ai-model-providers',
      '/ai-models/providers',
      undefined,
      300000,
    ),

    detail: (id) => adminRead(
      'ai-model-detail',
      `/ai-models/${id}`,
      undefined,
      120000,
    ),

    create: async (body) => {
      const value = await post(
        '/ai-models',
        body,
      );

      invalidateAdminCache('ai-models-list');
      invalidateAdminCache('ai-models-summary');
      invalidateAdminCache('ai-model-detail');
      invalidateAdminCache('dashboard');

      return value;
    },

    update: async (id, body) => {
      const value = await patch(
        `/ai-models/${id}`,
        body,
      );

      invalidateAdminCache('ai-models-list');
      invalidateAdminCache('ai-models-summary');
      invalidateAdminCache('ai-model-detail');
      invalidateAdminCache('dashboard');

      return value;
    },

    setDefault: async (id) => {
      const value = await patch(
        `/ai-models/${id}/default`,
        {},
      );

      invalidateAdminCache('ai-models-list');
      invalidateAdminCache('ai-models-summary');
      invalidateAdminCache('ai-model-detail');
      invalidateAdminCache('dashboard');

      return value;
    },

    activate: async (id) => {
      const value = await patch(
        `/ai-models/${id}/activate`,
        {},
      );

      invalidateAdminCache('ai-models-list');
      invalidateAdminCache('ai-models-summary');
      invalidateAdminCache('ai-model-detail');
      invalidateAdminCache('dashboard');

      return value;
    },

    deactivate: async (id) => {
      const value = await patch(
        `/ai-models/${id}/deactivate`,
        {},
      );

      invalidateAdminCache('ai-models-list');
      invalidateAdminCache('ai-models-summary');
      invalidateAdminCache('ai-model-detail');
      invalidateAdminCache('dashboard');

      return value;
    },

    remove: async (id) => {
      const value = await del(
        `/ai-models/${id}`,
      );

      invalidateAdminCache('ai-models-list');
      invalidateAdminCache('ai-models-summary');
      invalidateAdminCache('ai-model-detail');
      invalidateAdminCache('ai-monitoring-list');
      invalidateAdminCache('ai-analytics-summary');
      invalidateAdminCache('dashboard');

      return value;
    },
  },

  aiMonitoring: {
    list: (params) => adminRead(
      'ai-monitoring-list',
      '/admin/ai-monitoring/logs',
      params,
      15000,
    ),

    listFresh: (params) => freshGet(
      'ai-monitoring-list',
      '/admin/ai-monitoring/logs',
      params,
      15000,
      {
        timeout: 12000,
      },
    ),

    summary: (params) => adminRead(
      'ai-monitoring-summary',
      '/admin/ai-monitoring/summary',
      params,
      30000,
    ),

    summaryFresh: (params) => freshGet(
      'ai-monitoring-summary',
      '/admin/ai-monitoring/summary',
      params,
      30000,
      {
        timeout: 12000,
      },
    ),

    charts: (params) => adminRead(
      'ai-monitoring-charts',
      '/admin/ai-monitoring/charts',
      params,
      120000,
    ),

    chartsFresh: (params) => freshGet(
      'ai-monitoring-charts',
      '/admin/ai-monitoring/charts',
      params,
      120000,
      {
        timeout: 12000,
      },
    ),

    detail: (id) => adminRead(
      'ai-monitoring-detail',
      `/admin/ai-monitoring/logs/${id}`,
      undefined,
      120000,
    ),

    operation: (id) => adminRead(
      'ai-monitoring-operation',
      `/admin/ai-monitoring/operations/${id}`,
      undefined,
      120000,
    ),

    exportCsv: (params) => downloadCsv(
      '/admin/ai-monitoring/logs/export/csv',
      params,
      'admin-ai-monitoring.csv',
    ),
  },

  aiAnalytics: {
    summary: (params) => adminRead(
      'ai-analytics-summary',
      '/admin/ai/analytics/summary',
      params,
      120000,
      {
        timeout: 12000,
      },
    ),

    summaryFresh: (params) => freshGet(
      'ai-analytics-summary',
      '/admin/ai/analytics/summary',
      params,
      120000,
      {
        timeout: 12000,
      },
    ),
  },

  auditLogs: {
    list: (params) => adminRead(
      'audit-list',
      '/audit-logs',
      params,
      30000,
    ),

    listFresh: (params) => freshGet(
      'audit-list',
      '/audit-logs',
      params,
      20000,
      {
        timeout: 12000,
      },
    ),

    summary: (params) => adminRead(
      'audit-summary',
      '/audit-logs/summary',
      params,
      60000,
    ),

    summaryFresh: (params) => freshGet(
      'audit-summary',
      '/audit-logs/summary',
      params,
      45000,
      {
        timeout: 12000,
      },
    ),

    charts: (params) => adminRead(
      'audit-charts',
      '/audit-logs/charts',
      params,
      120000,
    ),

    chartsFresh: (params) => freshGet(
      'audit-charts',
      '/audit-logs/charts',
      params,
      60000,
      {
        timeout: 12000,
      },
    ),

    exportCsv: (params) => downloadCsv(
      '/audit-logs/export/csv',
      params,
      'admin-audit-logs.csv',
    ),
  },

  authAudit: {
    list: (params) => adminRead(
      'auth-audit-list',
      '/admin/auth-audit-logs',
      params,
      30000,
    ),

    listFresh: (params) => freshGet(
      'auth-audit-list',
      '/admin/auth-audit-logs',
      params,
      20000,
      {
        timeout: 12000,
      },
    ),

    summary: (params) => adminRead(
      'auth-audit-summary',
      '/admin/auth-audit-logs/summary',
      params,
      60000,
    ),

    summaryFresh: (params) => freshGet(
      'auth-audit-summary',
      '/admin/auth-audit-logs/summary',
      params,
      45000,
      {
        timeout: 12000,
      },
    ),
  },

  collection: {
    list: (params, tab = 'jobs') => {
      if (tab === 'posts') {
        return adminRead(
          'collection-posts',
          '/data-collection/posts',
          params,
          60000,
        );
      }

      if (tab === 'comments') {
        return adminRead(
          'collection-comments',
          '/data-collection/comments',
          params,
          60000,
        );
      }

      return adminRead(
        'collection-jobs',
        '/data-collection/jobs',
        params,
        60000,
      );
    },

    listFresh: (params, tab = 'jobs') => {
      if (tab === 'posts') {
        return freshGet(
          'collection-posts',
          '/data-collection/posts',
          params,
          60000,
        );
      }

      if (tab === 'comments') {
        return freshGet(
          'collection-comments',
          '/data-collection/comments',
          params,
          60000,
        );
      }

      return freshGet(
        'collection-jobs',
        '/data-collection/jobs',
        params,
        60000,
      );
    },

    status: () => adminRead(
      'collection-status',
      '/data-collection/status',
      undefined,
      15000,
    ),

    statusFresh: () => freshGet(
      'collection-status',
      '/data-collection/status',
      undefined,
      15000,
    ),

    detail: (id) => adminRead(
      'collection-detail',
      `/data-collection/jobs/${id}`,
      undefined,
      60000,
    ),

    run: async (body) => {
      const value = await post(
        '/data-collection/run',
        body,
      );

      invalidateAdminCache('collection-jobs');
      invalidateAdminCache('collection-status');
      invalidateAdminCache('collection-detail');
      invalidateAdminCache('dashboard');

      return value;
    },

    stop: async (id) => {
      const value = await post(
        `/data-collection/${id}/stop`,
        {},
      );

      invalidateAdminCache('collection-jobs');
      invalidateAdminCache('collection-status');
      invalidateAdminCache('collection-detail');
      invalidateAdminCache('dashboard');

      return value;
    },
  },

  prompts: {
    template: () => adminRead(
      'prompts-template',
      '/prompts/template',
      undefined,
      60000,
    ),

    templateFresh: () => freshGet(
      'prompts-template',
      '/prompts/template',
      undefined,
      45000,
      {
        timeout: 12000,
      },
    ),

    history: (params) => adminRead(
      'prompts-history',
      '/prompts/history',
      params,
      30000,
    ),

    historyFresh: (params) => freshGet(
      'prompts-history',
      '/prompts/history',
      params,
      20000,
      {
        timeout: 12000,
      },
    ),

    update: async (body) => {
      const value = await patch(
        '/prompts/template',
        body,
      );

      invalidateAdminCache('prompts-template');
      invalidateAdminCache('prompts-history');
      invalidateAdminCache('dashboard');

      return value;
    },
  },

  settings: {
    get: (accessToken) => get(
      '/admin/settings',
      undefined,
      sensitiveConfig(accessToken),
    ),

    getFresh: (accessToken) => get(
      '/admin/settings',
      undefined,
      {
        ...sensitiveConfig(accessToken),
        timeout: 12000,
      },
    ),

    update: async (body, accessToken) => {
      const value = await patch(
        '/admin/settings',
        body,
        sensitiveConfig(accessToken),
      );

      invalidateAdminCache('audit-list');
      invalidateAdminCache('audit-summary');
      invalidateAdminCache('dashboard');

      return value;
    },
  },
};

const prefetchAdminRoute = (pathname) => {
  const createdDesc = {
    page: 1,
    limit: 20,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  };

  const loaders = {
    '/admin/dashboard': () => adminApi.getDashboard(),

    '/admin/users': () => adminApi.users.list(
      createdDesc,
    ),

    '/admin/ideas': () => adminApi.ideas.list(
      createdDesc,
    ),

    '/admin/publication-reports': () => adminApi.publicationReports.list(
      createdDesc,
    ),

    '/admin/evidence': () => adminApi.evidence.list({
      page: 1,
      limit: 20,
      sortBy: 'collectedAt',
      sortOrder: 'desc',
    }),

    '/admin/payments': () => adminApi.payments.list(
      createdDesc,
    ),

    '/admin/credits': () => adminApi.credits.list(
      createdDesc,
    ),

    '/admin/complaints': () => adminApi.complaints.list(
      createdDesc,
    ),

    '/admin/contact-messages': () => adminApi.contactMessages.list(
      createdDesc,
    ),

    '/admin/ai-monitoring': () => adminApi.aiMonitoring.list(
      createdDesc,
    ),

    '/admin/ai-analytics': () => adminApi.aiAnalytics.summary({}),

    '/admin/ai-models': () => adminApi.aiModels.list({
      page: 1,
      limit: 20,
      sortBy: 'priority',
      sortOrder: 'desc',
    }),

    '/admin/data-sources': () => Promise.allSettled([
      adminApi.dataSources.list({
        page: 1,
        limit: 20,
      }),
      adminApi.dataSources.summary(),
    ]),

    '/admin/collection': () => Promise.allSettled([
      adminApi.collection.list(createdDesc),
      adminApi.collection.status(),
    ]),

    '/admin/domains': () => adminApi.domains.list({
      page: 1,
      limit: 20,
      sortBy: 'name',
      sortOrder: 'asc',
    }),

    '/admin/audit-logs': () => adminApi.auditLogs.list(
      createdDesc,
    ),

    '/admin/auth-audit': () => adminApi.authAudit.list(
      createdDesc,
    ),

    '/admin/prompts': () => adminApi.prompts.template(),
  };

  const loader = loaders[pathname];

  if (!loader) return;

  Promise.resolve()
    .then(loader)
    .catch(() => undefined);
};

adminApi.prefetchRoute = prefetchAdminRoute;

export { getApiErrorMessage };