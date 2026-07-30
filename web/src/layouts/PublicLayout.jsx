/**
 * Shared layout for public pages.
 *
 * @author Eman
 */

import { Outlet } from 'react-router-dom';

import Footer from '../components/layout/Footer';
import Navbar from '../components/layout/Navbar';

export default function PublicLayout() {
    return (
        <div className="min-h-screen bg-nexora-background text-nexora-text">
            <Navbar />

            <main>
                <Outlet />
            </main>

            <Footer />
        </div>
    );
}