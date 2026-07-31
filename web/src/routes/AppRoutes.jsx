/**
 * Defines the application route configuration.
 *
 * Public pages are rendered inside PublicLayout so they share the same
 * navigation bar, footer, and general page structure.
 *
 * The About, Domains, How It Works, and Contact content are sections
 * inside HomePage and therefore do not require separate routes.
 *
 * @component
 * @returns {JSX.Element} The application route tree.
 *
 */

import { Route, Routes } from 'react-router-dom';

import AuthLayout from '../layouts/AuthLayout';
import PublicLayout from '../layouts/PublicLayout';

import LoginPage from '../features/auth/Login/pages/LoginPage';
import HomePage from '../pages/public/HomePage';
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
            </Route>

            {/* Authentication pages */}
            <Route element={<AuthLayout />}>
                <Route path="/login" element={<LoginPage />} />
            </Route>

            {/* Normal user pages */}
            {normalUserRoutes}

            {/* This route must always stay last */}
            <Route path="*" element={<NotFoundPage />} />
        </Routes>
    );
}