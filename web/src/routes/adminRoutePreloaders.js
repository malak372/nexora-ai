import { adminApi } from '../features/admin/shared/api/adminApi';

const adminRouteChunkPreloaders = {
  '/admin/dashboard': () => import('../features/admin/dashboard/pages/AdminDashboardPage'),
  '/admin/administrators': () => import('../features/admin/administrators/pages/AdminAdministratorsPage'),
  '/admin/users': () => import('../features/admin/users/pages/AdminResourcePage'),
  '/admin/ideas': () => import('../features/admin/ideas/pages/AdminIdeasPage'),
  '/admin/publication-reports': () => import('../features/admin/publication-reports/pages/AdminPublicationReportsPage'),
  '/admin/evidence': () => import('../features/admin/evidence-library/pages/AdminEvidenceLibraryPage'),
  '/admin/data-sources': () => import('../features/admin/data-sources/pages/AdminDataSourcesPage'),
  '/admin/collection': () => import('../features/admin/data-collection/pages/AdminCollectionRunsPage'),
  '/admin/domains': () => import('../features/admin/domains/pages/AdminDomainsPage'),
  '/admin/payments': () => import('../features/admin/payments/pages/AdminPaymentsPage'),
  '/admin/credits': () => import('../features/admin/credits/pages/AdminCreditsPage'),
  '/admin/complaints': () => import('../features/admin/complaints/pages/AdminComplaintsPage'),
  '/admin/contact-messages': () => import('../features/admin/contact-inbox/pages/AdminContactInboxPage'),
  '/admin/settings': () => import('../features/admin/system-settings/pages/AdminSettingsPage'),
  '/admin/prompts': () => import('../features/admin/prompt-control/pages/AdminPromptsPage'),
  '/admin/ai-analytics': () => import('../features/admin/ai-analytics/pages/AdminAiAnalyticsPage'),
  '/admin/ai-monitoring': () => import('../features/admin/ai-monitoring/pages/AdminAiMonitoringPage'),
  '/admin/ai-models': () => import('../features/admin/ai-models/pages/AdminAiModelsPage'),
  '/admin/account': () => import('../features/admin/account/pages/AdminAccountPage'),
  '/admin/alerts': () => import('../features/admin/alerts/pages/AdminAlertsPage'),
  '/admin/audit-logs': () => import('../features/admin/audit-trail/pages/AdminAuditLogsPage'),
  '/admin/auth-audit': () => import('../features/admin/auth-security/pages/AdminAuthSecurityPage'),
};

function normalizePath(path = '') {
  return String(path).split('?')[0].replace(/\/$/, '') || '/';
}

function canWarmInBackground() {
  if (typeof navigator === 'undefined') return false;

  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!connection) return true;
  if (connection.saveData) return false;

  const effectiveType = String(connection.effectiveType || '').toLowerCase();
  return effectiveType !== 'slow-2g' && effectiveType !== '2g';
}

export function preloadAdminRoute(path) {
  const normalized = normalizePath(path);
  const chunkPreloader = adminRouteChunkPreloaders[normalized];

  if (chunkPreloader) {
    void chunkPreloader().catch(() => undefined);
  }

  adminApi.prefetchRoute?.(normalized);
}

export function preloadPrimaryAdminRoutes() {
  if (typeof window === 'undefined' || !canWarmInBackground()) return () => {};

  const routesToWarm = [
    '/admin/users',
    '/admin/ideas',
    '/admin/publication-reports',
    '/admin/payments',
    '/admin/credits',
    '/admin/complaints',
    '/admin/ai-monitoring',
  ];

  let cancelled = false;
  const timers = [];

  const warmChunks = () => {
    routesToWarm.forEach((route, index) => {
      const timer = window.setTimeout(() => {
        if (cancelled) return;
        const loader = adminRouteChunkPreloaders[route];
        if (loader) void loader().catch(() => undefined);
      }, index * 300);
      timers.push(timer);
    });
  };

  if ('requestIdleCallback' in window) {
    const idleId = window.requestIdleCallback(warmChunks, { timeout: 2500 });
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
