/**
 * Premium Nexora workspace shell.
 *
 * Responsibilities:
 * - Protects premium-only routes.
 * - Redirects unauthenticated users to the login page.
 * - Redirects non-premium users to the normal workspace.
 * - Renders the premium desktop header and nested premium pages.
 *
 * @author Eman
 */
import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import {
    getAccessToken,
    getStoredUser,
} from '../../features/auth/shared/auth.storage';
import PremiumHeader from './PremiumHeader';
import './premium-user-layout.css';

const PREMIUM_ACCOUNT_STATUS = 'PREMIUM';
const LOGIN_ROUTE = '/login';
const NORMAL_DASHBOARD_ROUTE = '/normal/dashboard';

function normalizeAccountStatus(value) {
    return String(value ?? '').trim().toUpperCase();
}

function hasPremiumAccess(user) {
    return normalizeAccountStatus(user?.accountStatus) === PREMIUM_ACCOUNT_STATUS;
}

export default function PremiumUserLayout() {
    const navigate = useNavigate();
    const location = useLocation();
    const [isAuthorizing, setIsAuthorizing] = useState(true);

    const currentLocation = `${location.pathname}${location.search}${location.hash}`;

    const authorizePremiumWorkspace = useCallback(() => {
        const accessToken = getAccessToken();
        const storedUser = getStoredUser();

        if (!accessToken || !storedUser) {
            navigate(LOGIN_ROUTE, {
                replace: true,
                state: { from: currentLocation },
            });

            return false;
        }

        if (!hasPremiumAccess(storedUser)) {
            navigate(NORMAL_DASHBOARD_ROUTE, { replace: true });
            return false;
        }

        setIsAuthorizing(false);
        return true;
    }, [currentLocation, navigate]);

    useEffect(() => {
        authorizePremiumWorkspace();
    }, [authorizePremiumWorkspace]);

    useEffect(() => {
        const handleAuthStateChanged = () => {
            setIsAuthorizing(true);
            authorizePremiumWorkspace();
        };

        const handleSessionExpired = () => {
            setIsAuthorizing(true);

            navigate(LOGIN_ROUTE, {
                replace: true,
                state: { from: currentLocation },
            });
        };

        window.addEventListener(
            'nexora:auth-session-changed',
            handleAuthStateChanged,
        );
        window.addEventListener('nexora:user-updated', handleAuthStateChanged);
        window.addEventListener('nexora:session-expired', handleSessionExpired);

        return () => {
            window.removeEventListener(
                'nexora:auth-session-changed',
                handleAuthStateChanged,
            );
            window.removeEventListener(
                'nexora:user-updated',
                handleAuthStateChanged,
            );
            window.removeEventListener(
                'nexora:session-expired',
                handleSessionExpired,
            );
        };
    }, [authorizePremiumWorkspace, currentLocation, navigate]);

    if (isAuthorizing) {
        return (
            <div
                className="premium-auth-gate"
                role="status"
                aria-live="polite"
                aria-label="Preparing premium workspace"
            >
                <div className="premium-auth-gate__orb" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                </div>

                <div className="premium-auth-gate__copy">
                    <strong>Preparing your premium workspace</strong>
                    <span>Securing your Nexora intelligence environment...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="premium-app-shell">
            <div className="premium-app-shell__backdrop" aria-hidden="true">
                <span className="premium-app-shell__glow premium-app-shell__glow--violet" />
                <span className="premium-app-shell__glow premium-app-shell__glow--blue" />
                <span className="premium-app-shell__glow premium-app-shell__glow--gold" />
                <span className="premium-app-shell__grid" />
                <span className="premium-app-shell__noise" />
            </div>

            <PremiumHeader />

            <main className="premium-app-shell__main">
                <div className="premium-app-shell__content">
                    <Outlet />
                </div>
            </main>
        </div>
    );
}