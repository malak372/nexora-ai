import { lazy } from 'react';
import { Navigate, Route } from 'react-router-dom';
import AdminLayout from '../layouts/admin/AdminLayout';

const AdminDashboardPage = lazy(() => import('../features/admin/pages/AdminDashboardPage'));
const AdminResourcePage = lazy(() => import('../features/admin/pages/AdminResourcePage'));
const AdminSettingsPage = lazy(() => import('../features/admin/pages/AdminSettingsPage'));
const AdminPromptsPage = lazy(() => import('../features/admin/pages/AdminPromptsPage'));
const AdminAiAnalyticsPage = lazy(() => import('../features/admin/pages/AdminAiAnalyticsPage'));
const AdminAccountPage = lazy(() => import('../features/admin/pages/AdminAccountPage'));

export const adminRoutes = (
  <Route path="/admin" element={<AdminLayout />}>
    <Route index element={<Navigate to="dashboard" replace />} />
    <Route path="dashboard" element={<AdminDashboardPage />} />
    <Route path="users" element={<AdminResourcePage section="users" />} />
    <Route path="ideas" element={<AdminResourcePage section="ideas" />} />
    <Route path="payments" element={<AdminResourcePage section="payments" />} />
    <Route path="credits" element={<AdminResourcePage section="credits" />} />
    <Route path="domains" element={<AdminResourcePage section="domains" />} />
    <Route path="comments" element={<AdminResourcePage section="comments" />} />
    <Route path="feedback" element={<AdminResourcePage section="feedback" />} />
    <Route path="complaints" element={<AdminResourcePage section="complaints" />} />
    <Route path="contact-messages" element={<AdminResourcePage section="contactMessages" />} />
    <Route path="publication-reports" element={<AdminResourcePage section="publicationReports" />} />
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