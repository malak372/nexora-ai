import { lazy } from 'react';
import { Navigate, Route } from 'react-router-dom';
import AdminLayout from '../layouts/admin/AdminLayout';

const AdminDashboardPage = lazy(() => import('../features/admin/pages/AdminDashboardPage'));
const AdminResourcePage = lazy(() => import('../features/admin/pages/AdminResourcePage'));
const AdminIdeasPage = lazy(() => import('../features/admin/pages/AdminIdeasPage'));
const AdminPublicationReportsPage = lazy(() => import('../features/admin/pages/AdminPublicationReportsPage'));
const AdminEvidenceLibraryPage = lazy(() => import('../features/admin/pages/AdminEvidenceLibraryPage'));
const AdminComplaintsPage = lazy(() => import('../features/admin/pages/AdminComplaintsPage'));
const AdminContactInboxPage = lazy(() => import('../features/admin/pages/AdminContactInboxPage'));
const AdminSettingsPage = lazy(() => import('../features/admin/pages/AdminSettingsPage'));
const AdminPromptsPage = lazy(() => import('../features/admin/pages/AdminPromptsPage'));
const AdminAiAnalyticsPage = lazy(() => import('../features/admin/pages/AdminAiAnalyticsPage'));
const AdminAccountPage = lazy(() => import('../features/admin/pages/AdminAccountPage'));

export const adminRoutes = (
  <Route path="/admin" element={<AdminLayout />}>
    <Route index element={<Navigate to="dashboard" replace />} />
    <Route path="dashboard" element={<AdminDashboardPage />} />
    <Route path="users" element={<AdminResourcePage section="users" />} />
    <Route path="ideas" element={<AdminIdeasPage />} />
    <Route path="payments" element={<AdminResourcePage section="payments" />} />
    <Route path="credits" element={<AdminResourcePage section="credits" />} />
    <Route path="domains" element={<AdminResourcePage section="domains" />} />
    <Route path="evidence" element={<AdminEvidenceLibraryPage />} />
    <Route path="comments" element={<Navigate to="/admin/evidence" replace />} />
    <Route path="feedback" element={<Navigate to="/admin/dashboard" replace />} />
    <Route path="complaints" element={<AdminComplaintsPage />} />
    <Route path="contact-messages" element={<AdminContactInboxPage />} />
    <Route path="publication-reports" element={<AdminPublicationReportsPage />} />
    <Route path="alerts" element={<AdminResourcePage section="alerts" />} />
    <Route path="data-sources" element={<AdminResourcePage section="dataSources" />} />
    <Route path="ai-models" element={<AdminResourcePage section="aiModels" />} />
    <Route path="ai-monitoring" element={<AdminResourcePage section="aiMonitoring" />} />
    <Route path="ai-analytics" element={<AdminAiAnalyticsPage />} />
    <Route path="audit-logs" element={<AdminResourcePage section="auditLogs" />} />
    <Route path="auth-audit" element={<AdminResourcePage section="authAudit" />} />
    <Route path="collection" element={<AdminResourcePage section="collection" />} />
    <Route path="prompts" element={<AdminPromptsPage />} />
    <Route path="account" element={<AdminAccountPage />} />
    <Route path="settings" element={<AdminSettingsPage />} />
  </Route>
);