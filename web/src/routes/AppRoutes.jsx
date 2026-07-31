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
 * @author Eman
 */

import { Route, Routes } from 'react-router-dom';

import PublicLayout from '../layouts/PublicLayout';
import HomePage from '../pages/public/HomePage';
import NotFoundPage from '../pages/public/NotFoundPage';

/**
 * Renders all currently available application routes.
 *
 * @returns {JSX.Element}
 */
export default function AppRoutes() {
    return (
        <Routes>
            <Route element={<PublicLayout />}>
                <Route
                    index
                    element={<HomePage />}
                />
            </Route>

            <Route
                path="*"
                element={<NotFoundPage />}
            />
        </Routes>
    );
}