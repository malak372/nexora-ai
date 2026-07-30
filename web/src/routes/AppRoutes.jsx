/**
 * Application route configuration.
 *
 * @author Eman
 */

import { Route, Routes } from 'react-router-dom';

import PublicLayout from '../layouts/PublicLayout';
import HomePage from '../pages/public/HomePage';
import NotFoundPage from '../pages/public/NotFoundPage';

export default function AppRoutes() {
    return (
        <Routes>
            <Route element={<PublicLayout />}>
                <Route index element={<HomePage />} />
            </Route>

            <Route path="*" element={<NotFoundPage />} />
        </Routes>
    );
}