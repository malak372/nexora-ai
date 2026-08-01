/**
 * Defines the application route configuration.
 *
 * Public pages are rendered inside PublicLayout so they share the same
 * navigation bar, footer, and general page structure.
 *
 * Authentication pages are rendered inside AuthLayout.
 *
 * The About, Domains, How It Works, and Contact content are sections
 * inside HomePage and therefore do not require separate routes.
 *
 * @component
 * @returns {JSX.Element} The application route tree.
 */

import { Route, Routes } from 'react-router-dom';

import AuthLayout from '../layouts/AuthLayout';
import PublicLayout from '../layouts/PublicLayout';

import LoginPage from '../features/auth/Login/pages/LoginPage';
import RegisterPage from '../features/auth/Register/pages/RegisterPage';
import VerifyEmailPage from '../features/auth/Register/EmailVerification/pages/VerifyEmailPage';
import HomePage from '../pages/public/HomePage';
import GuestGenerateIdeaPage from '../features/guest-idea/pages/GuestGenerateIdeaPage';
import NotFoundPage from '../pages/public/NotFoundPage';

import { normalUserRoutes } from './normal-user.routes';

export default function AppRoutes() {
    return (
        <Routes>
            {/* Public pages */}
            <Route element={<PublicLayout />}>
                <Route
                    index
                    element={<HomePage />}
                />
                <Route
                    path="/generate"
                    element={<GuestGenerateIdeaPage />}
                />
            </Route>

            {/* Authentication pages */}
            <Route element={<AuthLayout />}>
                <Route
                    path="/login"
                    element={<LoginPage />}
                />

                <Route
                    path="/register"
                    element={<RegisterPage />}
                />

                <Route
                    path="/verify-email"
                    element={<VerifyEmailPage />}
                />
            </Route>

            {/* Normal user pages */}
            {normalUserRoutes}

            {/* This route must always stay last */}
            <Route
                path="*"
                element={<NotFoundPage />}
            />
        </Routes>
    );
}