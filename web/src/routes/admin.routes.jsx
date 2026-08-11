import { lazy } from 'react';
import { Navigate, Route } from 'react-router-dom';
import AdminLayout from '../layouts/admin/AdminLayout';

const AdminDashboardPage = lazy(() => import('../features/admin/dashboard/pages/AdminDashboardPage'));
const AdminAdministratorsPage = lazy(() => import('../features/admin/administrators/pages/AdminAdministratorsPage'));
const AdminResourcePage = lazy(() => import('../features/admin/users/pages/AdminResourcePage'));
const AdminIdeasPage = lazy(() => import('../features/admin/ideas/pages/AdminIdeasPage'));
const AdminPublicationReportsPage = lazy(() => import('../features/admin/publication-reports/pages/AdminPublicationReportsPage'));
const AdminEvidenceLibraryPage = lazy(() => import('../features/admin/evidence-library/pages/AdminEvidenceLibraryPage'));
const AdminDataSourcesPage = lazy(() => import('../features/admin/data-sources/pages/AdminDataSourcesPage'));
const AdminCollectionRunsPage = lazy(() => import('../features/admin/data-collection/pages/AdminCollectionRunsPage'));
const AdminDomainsPage = lazy(() => import('../features/admin/domains/pages/AdminDomainsPage'));
const AdminPaymentsPage = lazy(() => import('../features/admin/payments/pages/AdminPaymentsPage'));
const AdminCreditsPage = lazy(() => import('../features/admin/credits/pages/AdminCreditsPage'));
const AdminComplaintsPage = lazy(() => import('../features/admin/complaints/pages/AdminComplaintsPage'));
const AdminContactInboxPage = lazy(() => import('../features/admin/contact-inbox/pages/AdminContactInboxPage'));
const AdminSettingsPage = lazy(() => import('../features/admin/system-settings/pages/AdminSettingsPage'));
const AdminPromptsPage = lazy(() => import('../features/admin/prompt-control/pages/AdminPromptsPage'));
const AdminAiAnalyticsPage = lazy(() => import('../features/admin/ai-analytics/pages/AdminAiAnalyticsPage'));
const AdminAiMonitoringPage = lazy(() => import('../features/admin/ai-monitoring/pages/AdminAiMonitoringPage'));
const AdminAiModelsPage = lazy(() => import('../features/admin/ai-models/pages/AdminAiModelsPage'));
const AdminAccountPage = lazy(() => import('../features/admin/account/pages/AdminAccountPage'));
const AdminAlertsPage = lazy(() => import('../features/admin/alerts/pages/AdminAlertsPage'));
const AdminAuditLogsPage = lazy(() => import('../features/admin/audit-trail/pages/AdminAuditLogsPage'));
const AdminAuthSecurityPage = lazy(() => import('../features/admin/auth-security/pages/AdminAuthSecurityPage'));

export const adminRoutes = (
  <Route path="/admin" element={<AdminLayout />}>
    <Route index element={<Navigate to="dashboard" replace />} />
    <Route path="dashboard" element={<AdminDashboardPage />} />
    <Route path="administrators" element={<AdminAdministratorsPage />} />
    <Route path="users" element={<AdminResourcePage section="users" />} />
    <Route path="ideas" element={<AdminIdeasPage />} />
    <Route path="payments" element={<AdminPaymentsPage />} />
    <Route path="credits" element={<AdminCreditsPage />} />
    <Route path="domains" element={<AdminDomainsPage />} />
    <Route path="evidence" element={<AdminEvidenceLibraryPage />} />
    <Route path="comments" element={<Navigate to="/admin/evidence" replace />} />
    <Route path="feedback" element={<Navigate to="/admin/dashboard" replace />} />
    <Route path="complaints" element={<AdminComplaintsPage />} />
    <Route path="contact-messages" element={<AdminContactInboxPage />} />
    <Route path="publication-reports" element={<AdminPublicationReportsPage />} />
    <Route path="alerts" element={<AdminAlertsPage />} />
    <Route path="data-sources" element={<AdminDataSourcesPage />} />
    <Route path="ai-models" element={<AdminAiModelsPage />} />
    <Route path="ai-monitoring" element={<AdminAiMonitoringPage />} />
    <Route path="ai-analytics" element={<AdminAiAnalyticsPage />} />
    <Route path="audit-logs" element={<AdminAuditLogsPage />} />
    <Route path="auth-audit" element={<AdminAuthSecurityPage />} />
    <Route path="collection" element={<AdminCollectionRunsPage />} />
    <Route path="prompts" element={<AdminPromptsPage />} />
    <Route path="account" element={<AdminAccountPage />} />
    <Route path="settings" element={<AdminSettingsPage />} />
  </Route>
);