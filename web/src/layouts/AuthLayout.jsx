/**
 * Full-screen layout for authentication pages.
 *
 * @author Malak
 */

import { Outlet } from 'react-router-dom';

export default function AuthLayout() {
    return (
        <div className="min-h-screen bg-nexora-background text-nexora-text">
            <Outlet />
        </div>
    );
}