/**
 * Authenticated normal-user and premium-user routes with route-level code splitting.
 *
 * NORMAL and PREMIUM accounts share the same workspace implementation, while
 * keeping an account-appropriate URL prefix in the browser.
 *
 * @author Eman
 */
import { lazy } from 'react';
import { Navigate, Route } from 'react-router-dom';

import NormalUserLayout from '../layouts/normal-user/NormalUserLayout';

const NormalDashboardPage = lazy(() => import('../features/normal-user/dashboard/pages/NormalDashboardPage'));
const GenerateIdeaPage = lazy(() => import('../features/normal-user/idea-generation/pages/GenerateIdeaPage'));
const GenerationProgressPage = lazy(() => import('../features/normal-user/idea-generation/pages/GenerationProgressPage'));
const MyIdeasPage = lazy(() => import('../features/normal-user/ideas/pages/MyIdeasPage'));
const DiscoveriesPage = lazy(() => import('../features/normal-user/discoveries/pages/DiscoveriesPage'));
const PublicationDetailPage = lazy(() => import('../features/normal-user/discoveries/pages/PublicationDetailPage'));
const AcceptedIdeaWorkspacePage = lazy(() => import('../features/normal-user/discoveries/pages/AcceptedIdeaWorkspacePage'));
const PublishedIdeasPage = lazy(() => import('../features/normal-user/published/pages/PublishedIdeasPage'));
const IdeaWorkspacePage = lazy(() => import('../features/normal-user/idea-workspace/pages/IdeaWorkspacePage'));
const BusinessModelPage = lazy(() => import('../features/normal-user/business-models/pages/BusinessModelPage'));
const DirectUnlockPage = lazy(() => import('../features/normal-user/payments/pages/DirectUnlockPage'));
const PaymentResultPage = lazy(() => import('../features/normal-user/payments/pages/PaymentResultPage'));
const PublishIdeaPage = lazy(() => import('../features/normal-user/publication/pages/PublishIdeaPage'));
const ProfileSettingsPage = lazy(() => import('../features/normal-user/profile/pages/ProfileSettingsPage'));
const CompliancePage = lazy(() => import('../features/normal-user/compliance/pages/CompliancePage'));
const NotificationsPage = lazy(() => import('../features/normal-user/notifications/pages/NotificationsPage'));
const PreferencesPage = lazy(() => import('../features/normal-user/preferences/pages/PreferencesPage'));
const UpgradePage = lazy(() => import('../features/normal-user/upgrade/pages/UpgradePage'));
const BillingHistoryPage = lazy(() => import('../features/normal-user/billing/pages/BillingHistoryPage'));
const AiChatPage = lazy(() => import('../features/normal-user/ai-chat/pages/AiChatPage'));

function TemporaryNormalPage({ title }) {
    return (
        <section style={{ minHeight: '55vh', display: 'grid', placeContent: 'center' }}>
            <h1>{title}</h1>
        </section>
    );
}

function createWorkspaceRoute(basePath) {
    return (
        <Route key={basePath} path={basePath} element={<NormalUserLayout />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<NormalDashboardPage />} />
            <Route path="generate" element={<GenerateIdeaPage />} />
            <Route path="generation/:runId" element={<GenerationProgressPage />} />
            <Route path="ideas" element={<MyIdeasPage />} />
            <Route path="ideas/:ideaId" element={<IdeaWorkspacePage />} />
            <Route path="ideas/:ideaId/business-model" element={<BusinessModelPage />} />
            <Route path="ideas/:ideaId/chat" element={<AiChatPage />} />
            <Route path="ideas/:ideaId/unlock" element={<DirectUnlockPage />} />
            <Route path="payments/success" element={<PaymentResultPage />} />
            <Route path="ideas/:ideaId/publish" element={<PublishIdeaPage />} />
            <Route path="discover" element={<DiscoveriesPage />} />
            <Route path="discover/:publicationId" element={<PublicationDetailPage />} />
            <Route path="accepted/:publicationId/workspace" element={<AcceptedIdeaWorkspacePage />} />
            <Route path="published" element={<PublishedIdeasPage />} />
            <Route path="accepted" element={<Navigate to={`${basePath}/ideas?view=accepted`} replace />} />
            <Route path="compliance" element={<CompliancePage />} />
            <Route path="favorites" element={<TemporaryNormalPage title="Favorites" />} />
            <Route path="credits" element={<UpgradePage />} />
            <Route path="preferences" element={<PreferencesPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="billing" element={<BillingHistoryPage />} />
            <Route path="settings/profile" element={<ProfileSettingsPage />} />
            <Route path="support" element={<Navigate to={`${basePath}/compliance`} replace />} />
        </Route>
    );
}

export const normalUserRoutes = (
    <>
        {createWorkspaceRoute('/normal')}
        {createWorkspaceRoute('/premium')}
    </>
);
