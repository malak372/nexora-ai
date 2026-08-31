import { getStoredUser } from '../../../auth/shared/auth.storage';

const NORMAL_BASE = '/normal';
const PREMIUM_BASE = '/premium';

export function getWorkspaceBasePath() {
    if (typeof window !== 'undefined') {
        const pathname = window.location?.pathname || '';

        if (pathname === PREMIUM_BASE || pathname.startsWith(`${PREMIUM_BASE}/`)) {
            return PREMIUM_BASE;
        }

        if (pathname === NORMAL_BASE || pathname.startsWith(`${NORMAL_BASE}/`)) {
            const storedStatus = String(getStoredUser()?.accountStatus || '')
                .trim()
                .toUpperCase();

            return storedStatus === 'PREMIUM' ? PREMIUM_BASE : NORMAL_BASE;
        }
    }

    const accountStatus = String(getStoredUser()?.accountStatus || '')
        .trim()
        .toUpperCase();

    return accountStatus === 'PREMIUM' ? PREMIUM_BASE : NORMAL_BASE;
}

export function workspacePath(path = '') {
    const rawPath = String(path || '');
    const suffix = rawPath.replace(/^\/(?:normal|premium)(?=\/|$)/, '');
    const normalizedSuffix = suffix && !suffix.startsWith('/') ? `/${suffix}` : suffix;

    return `${getWorkspaceBasePath()}${normalizedSuffix}`;
}
