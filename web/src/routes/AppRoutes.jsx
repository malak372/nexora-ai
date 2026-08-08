/**
 * Application route configuration with route-level code splitting.
 *
 * Each page is downloaded only when its route is visited. This keeps the
 * initial bundle small and prevents public pages from loading dashboard,
 * payment, chart, AI chat, and generation code unnecessarily.
 *
 * @author Eman
 */
import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import RouteLoadingFallback from '../components/RouteLoadingFallback';
import AuthLayout from '../layouts/AuthLayout';
import PublicLayout from '../layouts/PublicLayout';
import { normalUserRoutes } from './normal-user.routes';
import { adminRoutes } from './admin.routes';

const HomePage = lazy(() => import('../pages/public/HomePage'));
const NotFoundPage = lazy(() => import('../pages/public/NotFoundPage'));
const LoginPage = lazy(() => import('../features/auth/Login/pages/LoginPage'));
const RegisterPage = lazy(() => import('../features/auth/Register/pages/RegisterPage'));
const VerifyEmailPage = lazy(() => import('../features/auth/Register/EmailVerification/pages/VerifyEmailPage'));
const ForgotPasswordPage = lazy(() => import('../features/auth/PasswordRecovery/pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('../features/auth/PasswordRecovery/pages/ResetPasswordPage'));
const GuestGenerateIdeaPage = lazy(() => import('../features/guest-idea/pages/GuestGenerateIdeaPage'));
const PublicPublicationDetailsPage = lazy(() => import('../features/home/pages/PublicPublicationDetailsPage'));

export default function AppRoutes() {
    return (
        <Suspense fallback={<RouteLoadingFallback />}>
            <Routes>
                <Route element={<PublicLayout />}>
                    <Route index element={<HomePage />} />
                    <Route path="/generate" element={<GuestGenerateIdeaPage />} />
                    <Route
                        path="/publications/:publicationId"
                        element={<PublicPublicationDetailsPage />}
                    />
                </Route>

                <Route element={<AuthLayout />}>
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/register" element={<RegisterPage />} />
                    <Route path="/verify-email" element={<VerifyEmailPage />} />
                    <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                    <Route path="/reset-password" element={<ResetPasswordPage />} />
                </Route>

                {normalUserRoutes}

                {/*
                 * Premium route bridge.
                 *
                 * This codebase currently renders Premium capabilities from the
                 * accountStatus-aware normal workspace instead of shipping a
                 * separate premium-user feature tree. PaymentResultPage already
                 * sends a newly activated account to /premium/dashboard, so keep
                 * that destination valid and hand it to the Premium-aware
                 * workspace instead of falling through to the 404 page.
                 */}
                <Route
                    path="/premium/dashboard"
                    element={<Navigate to="/normal/dashboard" replace />}
                />
                <Route
                    path="/premium/credits"
                    element={<Navigate to="/normal/credits" replace />}
                />

                {adminRoutes}

                <Route path="*" element={<NotFoundPage />} />
            </Routes>
        </Suspense>
    );
}