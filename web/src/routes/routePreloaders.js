/**
 * Route chunk preloaders.
 *
 * Navigation links call these functions on hover/focus so the browser starts
 * downloading the next page before the click. Duplicate calls are naturally
 * deduplicated by the module loader.
 *
 * @author Eman, Malak
 */
const preloaders = {
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

export function preloadRoute(path) {
  const normalized = path.split('?')[0];
  const preload = preloaders[normalized];
  if (preload) void preload().catch(() => undefined);
}

export function preloadPrimaryRoutes() {
  const run = () => {
    ['/normal/dashboard', '/normal/generate', '/normal/ideas', '/normal/discover']
      .forEach(preloadRoute);
  };

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout: 2500 });
  } else {
    window.setTimeout(run, 1200);
  }
}
