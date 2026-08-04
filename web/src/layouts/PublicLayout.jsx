/**
 * Renders the shared layout used by Voxidence public pages.
 *
 * The layout provides the common public-page structure:
 * - A persistent navigation bar.
 * - A semantic main-content region.
 * - Nested route content through React Router Outlet.
 * - A shared application footer.
 *
 * @component
 * @returns {JSX.Element} The shared public application layout.
 *
 * @author Eman
 */

import { Outlet } from 'react-router-dom';

import Footer from '../components/layout/Footer';
import Navbar from '../components/layout/Navbar';

import './public-theme.css';

/**
 * Displays the common structure for all public routes.
 *
 * @returns {JSX.Element}
 */
export default function PublicLayout() {
    return (
        <div className="vox-public-shell flex min-h-screen flex-col">
            <Navbar />

            <main
                id="main-content"
                className="flex-1"
            >
                <Outlet />
            </main>

            <Footer />
        </div>
    );
}