/**
 * Authenticated normal-user routes.
 *
 * @author Malak
 */
import { Navigate, Route } from 'react-router-dom';

import NormalUserLayout from '../layouts/normal-user/NormalUserLayout';
import NormalDashboardPage from '../features/normal-user/dashboard/pages/NormalDashboardPage';
import GenerateIdeaPage from '../features/normal-user/idea-generation/pages/GenerateIdeaPage';
import GenerationProgressPage from '../features/normal-user/idea-generation/pages/GenerationProgressPage';
import MyIdeasPage from '../features/normal-user/ideas/pages/MyIdeasPage';
import DiscoveriesPage from '../features/normal-user/discoveries/pages/DiscoveriesPage';
import PublicationDetailPage from '../features/normal-user/discoveries/pages/PublicationDetailPage';
import PublishedIdeasPage from '../features/normal-user/published/pages/PublishedIdeasPage';
import AcceptedIdeasPage from '../features/normal-user/accepted/pages/AcceptedIdeasPage';
import IdeaWorkspacePage from '../features/normal-user/idea-workspace/pages/IdeaWorkspacePage';
import BusinessModelPage from '../features/normal-user/business-models/pages/BusinessModelPage';
import DirectUnlockPage from '../features/normal-user/payments/pages/DirectUnlockPage';
import DirectUnlockSuccessPage from '../features/normal-user/payments/pages/DirectUnlockSuccessPage';
import PublishIdeaPage from '../features/normal-user/publication/pages/PublishIdeaPage';
import ProfileSettingsPage from '../features/normal-user/profile/pages/ProfileSettingsPage';
import CompliancePage from '../features/normal-user/compliance/pages/CompliancePage';
import NotificationsPage from '../features/normal-user/notifications/pages/NotificationsPage';
import PreferencesPage from '../features/normal-user/preferences/pages/PreferencesPage';
import UpgradePage from '../features/normal-user/upgrade/pages/UpgradePage';

function TemporaryNormalPage({ title }) {
    return (
        <section style={{ minHeight: '55vh', display: 'grid', placeContent: 'center' }}>
            <h1>{title}</h1>
        </section>
    );
}

export const normalUserRoutes = (
    <Route path="/normal" element={<NormalUserLayout />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<NormalDashboardPage />} />
        <Route path="generate" element={<GenerateIdeaPage />} />
        <Route path="generation/:runId" element={<GenerationProgressPage />} />
        <Route path="ideas" element={<MyIdeasPage />} />
        <Route path="ideas/:ideaId" element={<IdeaWorkspacePage />} />
        <Route path="ideas/:ideaId/business-model" element={<BusinessModelPage />} />
        <Route path="ideas/:ideaId/unlock" element={<DirectUnlockPage />} />
        <Route path="ideas/:ideaId/unlock/success" element={<DirectUnlockSuccessPage />} />
        <Route path="ideas/:ideaId/publish" element={<PublishIdeaPage />} />
        <Route path="discover" element={<DiscoveriesPage />} />
        <Route path="discover/:publicationId" element={<PublicationDetailPage />} />
        <Route path="published" element={<PublishedIdeasPage />} />
        <Route path="accepted" element={<AcceptedIdeasPage />} />
        <Route path="compliance" element={<CompliancePage />} />
        <Route path="favorites" element={<TemporaryNormalPage title="Favorites" />} />
        <Route path="credits" element={<UpgradePage />} />
        <Route path="preferences" element={<PreferencesPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="settings/profile" element={<ProfileSettingsPage />} />
        <Route path="support" element={<Navigate to="/normal/compliance" replace />} />
    </Route>
);