/**
 * Authenticated premium-user routes.
 *
 * Premium users reuse stable workspace pages while premium-specific pages
 * are implemented independently.
 *
 * @author Eman
 */
import { Navigate, Route } from 'react-router-dom';

import PremiumUserLayout from '../layouts/premium-user/PremiumUserLayout';

import BusinessModelPage from '../features/normal-user/business-models/pages/BusinessModelPage';
import CompliancePage from '../features/normal-user/compliance/pages/CompliancePage';
import AcceptedIdeaWorkspacePage from '../features/normal-user/discoveries/pages/AcceptedIdeaWorkspacePage';
import DiscoveriesPage from '../features/normal-user/discoveries/pages/DiscoveriesPage';
import PublicationDetailPage from '../features/normal-user/discoveries/pages/PublicationDetailPage';
import GenerateIdeaPage from '../features/normal-user/idea-generation/pages/GenerateIdeaPage';
import GenerationProgressPage from '../features/normal-user/idea-generation/pages/GenerationProgressPage';
import IdeaWorkspacePage from '../features/normal-user/idea-workspace/pages/IdeaWorkspacePage';
import MyIdeasPage from '../features/normal-user/ideas/pages/MyIdeasPage';
import NotificationsPage from '../features/normal-user/notifications/pages/NotificationsPage';
import PaymentResultPage from '../features/normal-user/payments/pages/PaymentResultPage';
import PreferencesPage from '../features/normal-user/preferences/pages/PreferencesPage';
import ProfileSettingsPage from '../features/normal-user/profile/pages/ProfileSettingsPage';
import PublishIdeaPage from '../features/normal-user/publication/pages/PublishIdeaPage';
import PublishedIdeasPage from '../features/normal-user/published/pages/PublishedIdeasPage';
import UpgradePage from '../features/normal-user/upgrade/pages/UpgradePage';

const PREMIUM_BASE_ROUTE = '/premium';

/**
 * Temporary route content used only until the dedicated premium page exists.
 *
 * @param {{ eyebrow: string, title: string, description: string }} props
 * @returns {JSX.Element}
 */
function PremiumRoutePlaceholder({ eyebrow, title, description }) {
    return (
        <section className="premium-route-placeholder" aria-labelledby="premium-route-title">
            <span className="premium-route-placeholder__eyebrow">{eyebrow}</span>
            <h1 id="premium-route-title">{title}</h1>
            <p>{description}</p>
        </section>
    );
}

export const premiumUserRoutes = (
    <Route path={PREMIUM_BASE_ROUTE} element={<PremiumUserLayout />}>
        <Route index element={<Navigate to="dashboard" replace />} />

        <Route
            path="dashboard"
            element={
                <PremiumRoutePlaceholder
                    eyebrow="Premium command center"
                    title="Your premium workspace is being prepared"
                    description="The dedicated premium dashboard will replace this temporary screen in the next implementation step."
                />
            }
        />

        <Route path="generate" element={<GenerateIdeaPage />} />
        <Route path="generation/:runId" element={<GenerationProgressPage />} />

        <Route path="ideas" element={<MyIdeasPage />} />
        <Route path="ideas/:ideaId" element={<IdeaWorkspacePage />} />
        <Route
            path="ideas/:ideaId/business-model"
            element={<BusinessModelPage />}
        />
        <Route path="ideas/:ideaId/publish" element={<PublishIdeaPage />} />

        <Route path="discover" element={<DiscoveriesPage />} />
        <Route
            path="discover/:publicationId"
            element={<PublicationDetailPage />}
        />
        <Route
            path="accepted/:publicationId/workspace"
            element={<AcceptedIdeaWorkspacePage />}
        />

        <Route path="published" element={<PublishedIdeasPage />} />
        <Route
            path="accepted"
            element={<Navigate to="/premium/ideas?view=accepted" replace />}
        />

        <Route
            path="analytics"
            element={
                <PremiumRoutePlaceholder
                    eyebrow="Portfolio intelligence"
                    title="Premium analytics"
                    description="Idea quality, activity, publication, and credit insights will be presented here."
                />
            }
        />

        <Route path="credits" element={<UpgradePage />} />
        <Route
            path="billing"
            element={
                <PremiumRoutePlaceholder
                    eyebrow="Payments and invoices"
                    title="Billing center"
                    description="Your verified payments, credit purchases, and provider invoices will be available here."
                />
            }
        />

        <Route path="payments/success" element={<PaymentResultPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="preferences" element={<PreferencesPage />} />
        <Route path="settings/profile" element={<ProfileSettingsPage />} />
        <Route path="compliance" element={<CompliancePage />} />
        <Route
            path="support"
            element={<Navigate to="/premium/compliance" replace />}
        />

        <Route path="*" element={<Navigate to="dashboard" replace />} />
    </Route>
);