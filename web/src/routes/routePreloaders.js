/**
 * Route + first-page data preloaders for the normal-user workspace.
 *
 * Important performance rule:
 * - Hover/focus preloads BOTH the lazy React chunk and the first API request.
 * - Idle warm-up is intentionally limited to My Ideas and Discover because
 *   they are the two most frequently opened, data-heavy library pages.
 * - Existing requestCache deduplicates the request if navigation happens while
 *   a prefetch is still in flight, so this never creates a second GET.
 */

const routeChunkPreloaders = {
  '/normal/dashboard': () => import('../features/normal-user/dashboard/pages/NormalDashboardPage'),
  '/normal/generate': () => import('../features/normal-user/idea-generation/pages/GenerateIdeaPage'),
  '/normal/ideas': () => import('../features/normal-user/ideas/pages/MyIdeasPage'),
  '/normal/discover': () => import('../features/normal-user/discoveries/pages/DiscoveriesPage'),
  '/normal/published': () => import('../features/normal-user/published/pages/PublishedIdeasPage'),
  '/normal/compliance': () => import('../features/normal-user/compliance/pages/CompliancePage'),
  '/normal/notifications': () => import('../features/normal-user/notifications/pages/NotificationsPage'),
  '/normal/billing': () => import('../features/normal-user/billing/pages/BillingHistoryPage'),
  '/normal/preferences': () => import('../features/normal-user/preferences/pages/PreferencesPage'),
  '/normal/settings/profile': () => import('../features/normal-user/profile/pages/ProfileSettingsPage'),
  '/normal/credits': () => import('../features/normal-user/upgrade/pages/UpgradePage'),
};

const routeDataPreloaders = {
  '/normal/dashboard': async () => {
    const { getNormalUserSummary } = await import('../features/normal-user/dashboard/api/dashboardApi');
    return getNormalUserSummary();
  },
  '/normal/ideas': async () => {
    const { getMyIdeas } = await import('../features/normal-user/ideas/api/userIdeasApi');
    return getMyIdeas({ page: 1, limit: 9, sortBy: 'createdAt', sortOrder: 'desc' });
  },
  '/normal/discover': async () => {
    const { getDiscoveries } = await import('../features/normal-user/discoveries/api/discoveriesApi');
    return getDiscoveries({ page: 1, limit: 12 });
  },
  '/normal/published': async () => {
    const { getMyPublishedIdeas } = await import('../features/normal-user/published/api/publishedIdeasApi');
    return getMyPublishedIdeas({ page: 1, limit: 8, sortBy: 'publishedAt', sortOrder: 'desc' });
  },
  '/normal/notifications': async () => {
    const { getNotifications } = await import('../features/normal-user/notifications/api/notificationsApi');
    return getNotifications({ page: 1, limit: 50, sortBy: 'createdAt', sortOrder: 'desc' });
  },
  '/normal/billing': async () => {
    const { getMyInvoices } = await import('../features/normal-user/billing/api/invoicesApi');
    return getMyInvoices({ page: 1, limit: 8 });
  },
  '/normal/preferences': async () => {
    const { getPreferenceCatalog, getMyPreferences } = await import('../features/normal-user/preferences/api/preferencesApi');
    return Promise.allSettled([getPreferenceCatalog(), getMyPreferences()]);
  },
  '/normal/compliance': async () => {
    const [{ getMyComplaints }, { getMyIdeas }] = await Promise.all([
      import('../features/normal-user/compliance/api/complaintsApi'),
      import('../features/normal-user/ideas/api/userIdeasApi'),
    ]);
    return Promise.allSettled([
      getMyComplaints({ page: 1, limit: 100, sortBy: 'updatedAt', sortOrder: 'desc' }),
      getMyIdeas({ page: 1, limit: 100, sortBy: 'createdAt', sortOrder: 'desc' }),
    ]);
  },
};

function normalizePath(path = '') {
  return String(path).split('?')[0].replace(/\/$/, '') || '/';
}

function canWarmInBackground() {
  const connection = navigator.connection ||
    navigator.mozConnection ||
    navigator.webkitConnection;

  if (!connection) return true;
  if (connection.saveData) return false;

  const effectiveType = String(connection.effectiveType || '').toLowerCase();
  return effectiveType !== 'slow-2g' && effectiveType !== '2g';
}

/**
 * Preloads a route's JS chunk and, where useful, its first page of data.
 * Safe to call repeatedly: dynamic import is cached by the browser and the
 * request cache deduplicates matching API calls.
 */
export function preloadRoute(path) {
  const normalized = normalizePath(path);
  const chunkPreloader = routeChunkPreloaders[normalized];
  const dataPreloader = routeDataPreloaders[normalized];

  if (chunkPreloader) {
    void chunkPreloader().catch(() => undefined);
  }

  if (dataPreloader) {
    void dataPreloader().catch(() => undefined);
  }
}


/**
 * Preloads the public discovery detail route and the two API calls required for
 * its first paint. Call this from a discovery card hover/focus.
 */
export function preloadDiscoveryDetail(publicationId) {
  if (!publicationId) return;

  void import('../features/normal-user/discoveries/pages/PublicationDetailPage')
    .catch(() => undefined);

  void import('../features/normal-user/discoveries/api/discoveriesApi')
    .then(({ getDiscoveryById, getMyAcceptance }) =>
      Promise.allSettled([
        getDiscoveryById(publicationId),
        getMyAcceptance(publicationId),
      ]),
    )
    .catch(() => undefined);
}

/**
 * Warms route CHUNKS only after the browser becomes idle.
 *
 * Important: this deliberately does NOT fire all page API requests in the
 * background. The previous version warmed eight data-heavy routes immediately
 * after sign-in, which could saturate the backend/Prisma connection pool and
 * make the dashboard and authentication transition feel slower.
 *
 * Data prefetching still happens on hover/focus through preloadRoute(), where
 * it is strongly correlated with the user's next action.
 */
export function preloadPrimaryRoutes() {
  if (!canWarmInBackground()) return () => {};

  let cancelled = false;
  const timers = [];
  const routesToWarm = [
    '/normal/ideas',
    '/normal/discover',
    '/normal/published',
    '/normal/notifications',
    '/normal/billing',
    '/normal/preferences',
    '/normal/compliance',
    '/normal/generate',
  ];

  const warmChunks = () => {
    if (cancelled) return;

    routesToWarm.forEach((route, index) => {
      const timer = window.setTimeout(() => {
        if (cancelled) return;
        const chunkPreloader = routeChunkPreloaders[route];
        if (chunkPreloader) void chunkPreloader().catch(() => undefined);
      }, index * 350);
      timers.push(timer);
    });
  };

  if ('requestIdleCallback' in window) {
    const idleId = window.requestIdleCallback(warmChunks, { timeout: 3000 });
    return () => {
      cancelled = true;
      window.cancelIdleCallback?.(idleId);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }

  const timer = window.setTimeout(warmChunks, 1800);
  return () => {
    cancelled = true;
    window.clearTimeout(timer);
    timers.forEach((entry) => window.clearTimeout(entry));
  };
}
