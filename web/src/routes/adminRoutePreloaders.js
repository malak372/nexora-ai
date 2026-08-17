/**
 * Lazy route preload helpers for the administrator workspace.
 *
 * These helpers allow the admin navigation to start loading
 * route chunks before the user actually navigates to them.
 *
 * @author Eman
 */

export const preloadAdminDashboardPage = () =>
  import('../features/admin/dashboard/pages/AdminDashboardPage');

export const preloadAdminUsersPage = () =>
  import('../features/admin/users/pages/AdminResourcePage');

export const preloadAdminAdministratorsPage = () =>
  import('../features/admin/administrators/pages/AdminAdministratorsPage');

export const preloadAdminTeamChatPage = () =>
  import('../features/admin/team-chat/pages/AdminTeamChatPage');

export const preloadAdminIdeasPage = () =>
  import('../features/admin/ideas/pages/AdminIdeasPage');

export const preloadAdminPublicationReportsPage = () =>
  import(
    '../features/admin/publication-reports/pages/AdminPublicationReportsPage'
  );

export const preloadAdminComplaintsPage = () =>
  import('../features/admin/complaints/pages/AdminComplaintsPage');

export const preloadAdminContactInboxPage = () =>
  import('../features/admin/contact-inbox/pages/AdminContactInboxPage');

export const preloadAdminEvidenceLibraryPage = () =>
  import('../features/admin/evidence-library/pages/AdminEvidenceLibraryPage');

export const preloadAdminDataSourcesPage = () =>
  import('../features/admin/data-sources/pages/AdminDataSourcesPage');

export const preloadAdminCollectionRunsPage = () =>
  import(
    '../features/admin/data-collection/pages/AdminCollectionRunsPage'
  );

export const preloadAdminDomainsPage = () =>
  import('../features/admin/domains/pages/AdminDomainsPage');

export const preloadAdminPaymentsPage = () =>
  import('../features/admin/payments/pages/AdminPaymentsPage');

export const preloadAdminCreditsPage = () =>
  import('../features/admin/credits/pages/AdminCreditsPage');

export const preloadAdminAiMonitorPage = () =>
  import('../features/admin/ai-monitoring/pages/AdminAiMonitoringPage');

export const preloadAdminAiAnalyticsPage = () =>
  import('../features/admin/ai-analytics/pages/AdminAiAnalyticsPage');

export const preloadAdminAiModelsPage = () =>
  import('../features/admin/ai-models/pages/AdminAiModelsPage');

export const preloadAdminPromptsPage = () =>
  import('../features/admin/prompt-control/pages/AdminPromptsPage');

export const preloadAdminAlertsPage = () =>
  import('../features/admin/alerts/pages/AdminAlertsPage');

export const preloadAdminAuditLogPage = () =>
  import('../features/admin/audit-trail/pages/AdminAuditLogsPage');

export const preloadAdminAuthenticationPage = () =>
  import('../features/admin/auth-security/pages/AdminAuthSecurityPage');

export const preloadAdminSystemSettingsPage = () =>
  import('../features/admin/system-settings/pages/AdminSettingsPage');

export const preloadAdminAccountPage = () =>
  import('../features/admin/account/pages/AdminAccountPage');

/**
 * Maps administrator routes to their lazy preload functions.
 *
 * This keeps AdminLayout independent from page import paths and lets
 * navigation items preload by passing their route string.
 *
 * @author Eman
 */
const adminRoutePreloaders = {
  '/admin/dashboard': preloadAdminDashboardPage,

  '/admin/administrators': preloadAdminAdministratorsPage,

  '/admin/team-chat': preloadAdminTeamChatPage,

  '/admin/users': preloadAdminUsersPage,

  '/admin/ideas': preloadAdminIdeasPage,

  '/admin/publication-reports': preloadAdminPublicationReportsPage,

  '/admin/complaints': preloadAdminComplaintsPage,

  '/admin/contact-messages': preloadAdminContactInboxPage,

  '/admin/alerts': preloadAdminAlertsPage,

  '/admin/evidence': preloadAdminEvidenceLibraryPage,

  '/admin/data-sources': preloadAdminDataSourcesPage,

  '/admin/collection': preloadAdminCollectionRunsPage,

  '/admin/domains': preloadAdminDomainsPage,

  '/admin/ai-monitoring': preloadAdminAiMonitorPage,

  '/admin/ai-analytics': preloadAdminAiAnalyticsPage,

  '/admin/ai-models': preloadAdminAiModelsPage,

  '/admin/prompts': preloadAdminPromptsPage,

  '/admin/payments': preloadAdminPaymentsPage,

  '/admin/credits': preloadAdminCreditsPage,

  '/admin/auth-audit': preloadAdminAuthenticationPage,

  '/admin/audit-logs': preloadAdminAuditLogPage,

  '/admin/settings': preloadAdminSystemSettingsPage,

  '/admin/account': preloadAdminAccountPage,
};

/**
 * Resolves a route string to its registered lazy preload function.
 *
 * Nested administrator URLs are supported by matching the nearest
 * registered parent route.
 *
 * @param {string} route Administrator route.
 * @returns {Function|null} Matching preload function, if available.
 *
 * @author Eman
 */
function resolveAdminRoutePreloader(route) {
  if (typeof route !== 'string') {
    return null;
  }

  const cleanRoute = route
    .split('?')[0]
    .split('#')[0]
    .replace(/\/$/, '');

  if (adminRoutePreloaders[cleanRoute]) {
    return adminRoutePreloaders[cleanRoute];
  }

  const matchingRoute = Object.keys(adminRoutePreloaders)
    .sort((left, right) => right.length - left.length)
    .find((candidate) =>
      cleanRoute.startsWith(`${candidate}/`)
    );

  return matchingRoute
    ? adminRoutePreloaders[matchingRoute]
    : null;
}

/**
 * Starts loading an administrator route without waiting for completion.
 *
 * The function accepts either a route string or a preload function to remain
 * compatible with existing callers. Preloading is best-effort only; route
 * navigation still handles any real lazy-loading failure.
 *
 * @param {string|Function} routeOrPreloader Route path or preload function.
 * @returns {void}
 *
 * @author Eman
 */
export function preloadAdminRoute(routeOrPreloader) {
  const preloader =
    typeof routeOrPreloader === 'function'
      ? routeOrPreloader
      : resolveAdminRoutePreloader(routeOrPreloader);

  if (typeof preloader !== 'function') {
    return;
  }

  Promise.resolve()
    .then(() => preloader())
    .catch(() => {
      // Route navigation will retry the lazy import when needed.
    });
}

/**
 * Warms the most frequently used administrator route chunks after the admin
 * layout mounts. This improves first navigation without blocking rendering.
 *
 * @returns {void}
 *
 * @author Eman
 */
export function preloadPrimaryAdminRoutes() {
  [
    preloadAdminDashboardPage,
    preloadAdminUsersPage,
    preloadAdminAlertsPage,
    preloadAdminDataSourcesPage,
  ].forEach((preloader) =>
    preloadAdminRoute(preloader)
  );
}