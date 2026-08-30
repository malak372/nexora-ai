/**
 * Route + first-page data preloaders for the normal-user workspace.
 *
 * Important performance rule:
 * - Hover/focus preloads BOTH the lazy React chunk and the first API request.
 * - Idle warm-up prepares normal-user route chunks, while only Discover's
 *   first data page is fetched in the background to avoid an API burst.
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
  '/normal/generate': async () => {
    const [{ getAvailableDomains }, { getNormalUserSummary }, { getPaymentPricing }] = await Promise.all([
      import('../features/normal-user/idea-generation/api/ideaGenerationApi'),
      import('../features/normal-user/dashboard/api/dashboardApi'),
      import('../features/normal-user/payments/api/paymentFlowApi'),
    ]);
    return Promise.allSettled([
      getAvailableDomains(),
      getNormalUserSummary(),
      getPaymentPricing(),
    ]);
  },
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
    return getNotifications({ page: 1, limit: 100, sortBy: 'createdAt', sortOrder: 'desc' });
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
  const normalized = String(path).split('?')[0].replace(/\/$/, '') || '/';
  return normalized.replace(/^\/premium(?=\/|$)/, '/normal');
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
 * Warms one private idea workspace route and its first data request.
 */
export function preloadIdeaWorkspace(ideaId) {
  if (!ideaId) return;

  void import('../features/normal-user/idea-workspace/pages/IdeaWorkspacePage')
    .catch(() => undefined);

  void import('../features/normal-user/idea-workspace/api/ideaWorkspaceApi')
    .then(({ warmIdeaWorkspace }) => warmIdeaWorkspace(ideaId))
    .catch(() => undefined);
}

/**
 * Warms the Premium AI chat chunk, workspace context, and chat API module.
 */
export function preloadAiChatWorkspace(ideaId) {
  if (!ideaId) return;

  void Promise.allSettled([
    import('../features/normal-user/ai-chat/pages/AiChatPage'),
    import('../features/normal-user/ai-chat/api/aiChatApi')
      .then(({ warmAiChatSocket }) => warmAiChatSocket()),
    import('../features/normal-user/idea-workspace/api/ideaWorkspaceApi')
      .then(({ warmIdeaWorkspace }) => warmIdeaWorkspace(ideaId)),
  ]);
}

/**
 * Warms Publication Studio and the shared idea workspace request.
 */
export function preloadPublicationStudio(ideaId) {
  if (!ideaId) return;

  void Promise.allSettled([
    import('../features/normal-user/publication/pages/PublishIdeaPage'),
    import('../features/normal-user/publication/api/publicationApi')
      .then(({ getIdeaForPublication }) => getIdeaForPublication(ideaId)),
  ]);
}

/**
 * Warms the normal-user route chunks after the browser becomes idle.
 *
 * Discover receives one additional low-priority first-page data warm-up.
 * That page is commonly opened directly after sign-in and its first request
 * is the expensive cache-miss path. Warming only Discover avoids the previous
 * burst of unrelated API calls while making its first navigation feel instant.
 */
export function preloadPrimaryRoutes() {
  if (!canWarmInBackground()) return () => { };

  let cancelled = false;
  const timers = [];
  const routesToWarm = [
    '/normal/discover',
    '/normal/ideas',
    '/normal/published',
    '/normal/notifications',
    '/normal/billing',
    '/normal/preferences',
    '/normal/compliance',
    '/normal/generate',
  ];

  const warmDiscoverData = () => {
    if (cancelled) return;

    const dataPreloader = routeDataPreloaders['/normal/discover'];

    if (dataPreloader) {
      void dataPreloader().catch(() => undefined);
    }
  };

  /*
   * Discover is a top-level destination and its first uncached request is one
   * of the most visible waits in the app. Start only this chunk + first page
   * shortly after the authenticated shell mounts instead of waiting for the
   * browser idle callback. Request caching prevents duplicate GETs if the user
   * clicks Discover while the warm-up is still in flight.
   */
  const immediateDiscoverTimer = window.setTimeout(() => {
    if (cancelled) return;

    const chunkPreloader = routeChunkPreloaders['/normal/discover'];

    if (chunkPreloader) {
      void chunkPreloader().catch(() => undefined);
    }

    warmDiscoverData();
  }, 80);

  timers.push(immediateDiscoverTimer);

  const warmChunks = () => {
    if (cancelled) return;

    routesToWarm.forEach((route, index) => {
      const timer = window.setTimeout(() => {
        if (cancelled) return;

        const chunkPreloader = routeChunkPreloaders[route];

        if (chunkPreloader) {
          void chunkPreloader().catch(() => undefined);
        }
      }, index * 140);

      timers.push(timer);
    });

    /*
     * These detail pages are frequent follow-up destinations and contain no
     * user-specific data by themselves. Preload their JS chunks in the
     * background so opening a card does not pause on a lazy-import download.
     */
    const detailChunkTimer = window.setTimeout(() => {
      if (cancelled) return;

      void Promise.allSettled([
        import('../features/normal-user/idea-workspace/pages/IdeaWorkspacePage'),
        import('../features/normal-user/discoveries/pages/PublicationDetailPage'),
        import('../features/normal-user/publication/pages/PublishIdeaPage'),
        import('../features/normal-user/ai-chat/pages/AiChatPage'),
      ]);
    }, 320);

    timers.push(detailChunkTimer);
  };

  if ('requestIdleCallback' in window) {
    const idleId = window.requestIdleCallback(
      warmChunks,
      { timeout: 2200 },
    );

    return () => {
      cancelled = true;
      window.cancelIdleCallback?.(idleId);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }

  const timer = window.setTimeout(warmChunks, 1200);

  return () => {
    cancelled = true;
    window.clearTimeout(timer);
    timers.forEach((entry) => window.clearTimeout(entry));
  };
}
