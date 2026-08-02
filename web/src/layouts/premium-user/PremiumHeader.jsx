/**
 * Desktop navigation header for the Nexora Premium workspace.
 *
 * The header provides:
 * - Premium workspace branding.
 * - Primary premium navigation.
 * - Idea search.
 * - Credit balance visibility.
 * - Notifications access.
 * - Account and session actions.
 *
 * @author Eman 
 */
import {
    BarChart3,
    Bell,
    BookOpenCheck,
    ChevronDown,
    CircleDollarSign,
    Compass,
    Crown,
    FileText,
    LayoutDashboard,
    Lightbulb,
    LogOut,
    Search,
    Settings,
    ShieldAlert,
    SlidersHorizontal,
    Sparkles,
    WalletCards,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';

import {
    clearAuthSession,
    getStoredUser,
} from '../../features/auth/shared/auth.storage';
import { resolveMediaUrl } from '../../utils/mediaUrl';

const PREMIUM_ROUTES = Object.freeze({
    DASHBOARD: '/premium/dashboard',
    GENERATE: '/premium/generate',
    IDEAS: '/premium/ideas',
    DISCOVER: '/premium/discover',
    PUBLISHED: '/premium/published',
    ANALYTICS: '/premium/analytics',
    CREDITS: '/premium/credits',
    BILLING: '/premium/billing',
    NOTIFICATIONS: '/premium/notifications',
    COMPLIANCE: '/premium/compliance',
    PREFERENCES: '/premium/preferences',
    PROFILE: '/premium/settings/profile',
    LOGIN: '/login',
});

const PRIMARY_NAVIGATION = Object.freeze([
    {
        to: PREMIUM_ROUTES.DASHBOARD,
        label: 'Overview',
        icon: LayoutDashboard,
        end: true,
    },
    {
        to: PREMIUM_ROUTES.GENERATE,
        label: 'Generate',
        icon: Sparkles,
    },
    {
        to: PREMIUM_ROUTES.IDEAS,
        label: 'My ideas',
        icon: Lightbulb,
    },
    {
        to: PREMIUM_ROUTES.DISCOVER,
        label: 'Discover',
        icon: Compass,
    },
    {
        to: PREMIUM_ROUTES.ANALYTICS,
        label: 'Analytics',
        icon: BarChart3,
    },
]);

const PROFILE_ACTIONS = Object.freeze([
    {
        path: PREMIUM_ROUTES.BILLING,
        label: 'Billing & invoices',
        description: 'Payments and billing history',
        icon: FileText,
    },
    {
        path: PREMIUM_ROUTES.PREFERENCES,
        label: 'Preferences',
        description: 'Generation and discovery defaults',
        icon: SlidersHorizontal,
    },
    {
        path: PREMIUM_ROUTES.PROFILE,
        label: 'Account settings',
        description: 'Profile, security and privacy',
        icon: Settings,
    },
    {
        path: PREMIUM_ROUTES.COMPLIANCE,
        label: 'Complaints',
        description: 'Cases and administrator replies',
        icon: ShieldAlert,
    },
]);

function getInitials(name = '') {
    const parts = String(name).trim().split(/\s+/).filter(Boolean);

    if (!parts.length) return 'NX';

    return parts
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join('');
}

function getCreditBalance(user) {
    const candidates = [
        user?.creditBalance,
        user?.creditsBalance,
        user?.credits,
        user?.availableCredits,
    ];

    const balance = candidates.find((value) => Number.isFinite(Number(value)));
    return balance === undefined ? null : Math.max(0, Number(balance));
}

export default function PremiumHeader() {
    const navigate = useNavigate();
    const location = useLocation();
    const profileMenuRef = useRef(null);
    const searchInputRef = useRef(null);

    const [user, setUser] = useState(() => getStoredUser() ?? {});
    const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
    const [searchValue, setSearchValue] = useState('');

    const displayName = user.fullName || user.name || 'Nexora member';
    const imageUrl = resolveMediaUrl(
        user.avatarUrl || user.profileImageUrl || user.photoUrl || '',
    );
    const initials = getInitials(displayName);
    const creditBalance = getCreditBalance(user);

    const firstName = useMemo(
        () => String(displayName).trim().split(/\s+/)[0] || 'Member',
        [displayName],
    );

    useEffect(() => {
        const synchronizeUser = (event) => {
            setUser(event.detail || getStoredUser() || {});
        };

        window.addEventListener('nexora:user-updated', synchronizeUser);
        window.addEventListener('nexora:auth-session-changed', synchronizeUser);

        return () => {
            window.removeEventListener('nexora:user-updated', synchronizeUser);
            window.removeEventListener('nexora:auth-session-changed', synchronizeUser);
        };
    }, []);

    useEffect(() => {
        setIsProfileMenuOpen(false);
    }, [location.pathname]);

    useEffect(() => {
        if (!isProfileMenuOpen) return undefined;

        const handlePointerDown = (event) => {
            if (
                profileMenuRef.current &&
                !profileMenuRef.current.contains(event.target)
            ) {
                setIsProfileMenuOpen(false);
            }
        };

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                setIsProfileMenuOpen(false);
            }
        };

        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isProfileMenuOpen]);

    useEffect(() => {
        const handleGlobalSearchShortcut = (event) => {
            const isSearchShortcut =
                (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';

            if (!isSearchShortcut) return;

            event.preventDefault();
            searchInputRef.current?.focus();
        };

        window.addEventListener('keydown', handleGlobalSearchShortcut);
        return () => window.removeEventListener('keydown', handleGlobalSearchShortcut);
    }, []);

    const navigateFromProfileMenu = (path) => {
        setIsProfileMenuOpen(false);
        navigate(path);
    };

    const handleSearchSubmit = (event) => {
        event.preventDefault();

        const query = searchValue.trim();
        const destination = query
            ? `${PREMIUM_ROUTES.IDEAS}?search=${encodeURIComponent(query)}`
            : PREMIUM_ROUTES.IDEAS;

        navigate(destination);
    };

    const handleSignOut = () => {
        setIsProfileMenuOpen(false);
        clearAuthSession();
        navigate(PREMIUM_ROUTES.LOGIN, { replace: true });
    };

    return (
        <header className="premium-header-wrap">
            <motion.div
                className="premium-header"
                initial={{ opacity: 0, y: -16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            >
                <div className="premium-header__ambient" aria-hidden="true">
                    <span />
                    <span />
                </div>

                <NavLink
                    className="premium-header__brand"
                    to={PREMIUM_ROUTES.DASHBOARD}
                    aria-label="Open Nexora Premium dashboard"
                >
                    <motion.span
                        className="premium-header__brand-mark"
                        whileHover={{ rotate: 6, scale: 1.04 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 18 }}
                        aria-hidden="true"
                    >
                        <Sparkles size={20} strokeWidth={2} />
                        <i />
                    </motion.span>

                    <span className="premium-header__brand-copy">
                        <span className="premium-header__brand-row">
                            <strong>Nexora AI</strong>
                            <span className="premium-header__premium-badge">
                                <Crown size={11} aria-hidden="true" />
                                Premium
                            </span>
                        </span>
                        <small>Intelligence workspace</small>
                    </span>
                </NavLink>

                <nav
                    className="premium-header__navigation"
                    aria-label="Premium workspace navigation"
                >
                    {PRIMARY_NAVIGATION.map(({ to, label, icon: Icon, end }) => (
                        <NavLink
                            key={to}
                            to={to}
                            end={end}
                            className={({ isActive }) =>
                                `premium-header__nav-link${isActive ? ' is-active' : ''}`
                            }
                        >
                            {({ isActive }) => (
                                <>
                                    <Icon size={15} strokeWidth={1.9} aria-hidden="true" />
                                    <span>{label}</span>
                                    {isActive ? (
                                        <motion.i
                                            className="premium-header__active-indicator"
                                            layoutId="premium-header-active-route"
                                            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                                        />
                                    ) : null}
                                </>
                            )}
                        </NavLink>
                    ))}
                </nav>

                <div className="premium-header__actions">
                    <form
                        className="premium-header__search"
                        role="search"
                        onSubmit={handleSearchSubmit}
                    >
                        <Search size={16} aria-hidden="true" />
                        <input
                            ref={searchInputRef}
                            type="search"
                            value={searchValue}
                            onChange={(event) => setSearchValue(event.target.value)}
                            placeholder="Search your portfolio"
                            aria-label="Search your premium ideas"
                            autoComplete="off"
                        />
                        <kbd aria-label="Keyboard shortcut Control K">⌘K</kbd>
                    </form>

                    <motion.button
                        type="button"
                        className="premium-header__credits"
                        onClick={() => navigate(PREMIUM_ROUTES.CREDITS)}
                        whileHover={{ y: -2 }}
                        whileTap={{ scale: 0.97 }}
                        aria-label={
                            creditBalance === null
                                ? 'Open credits'
                                : `Open credits. ${creditBalance} credits available`
                        }
                    >
                        <span className="premium-header__credits-icon">
                            <CircleDollarSign size={17} aria-hidden="true" />
                        </span>
                        <span className="premium-header__credits-copy">
                            <small>Available credits</small>
                            <strong>{creditBalance ?? 'View balance'}</strong>
                        </span>
                    </motion.button>

                    <motion.button
                        type="button"
                        className="premium-header__icon-button"
                        onClick={() => navigate(PREMIUM_ROUTES.NOTIFICATIONS)}
                        whileHover={{ y: -2 }}
                        whileTap={{ scale: 0.94 }}
                        aria-label="Open notifications"
                    >
                        <Bell size={18} aria-hidden="true" />
                        {Number(user.unreadNotificationsCount) > 0 ? (
                            <span className="premium-header__notification-dot" />
                        ) : null}
                    </motion.button>

                    <div className="premium-header__profile-wrap" ref={profileMenuRef}>
                        <button
                            type="button"
                            className="premium-header__profile-trigger"
                            onClick={() => setIsProfileMenuOpen((current) => !current)}
                            aria-haspopup="menu"
                            aria-expanded={isProfileMenuOpen}
                        >
                            <span className="premium-header__avatar" aria-hidden="true">
                                {imageUrl ? <img src={imageUrl} alt="" /> : initials}
                                <i />
                            </span>

                            <span className="premium-header__profile-copy">
                                <strong>{firstName}</strong>
                                <small>Premium member</small>
                            </span>

                            <ChevronDown
                                className={isProfileMenuOpen ? 'is-rotated' : ''}
                                size={14}
                                aria-hidden="true"
                            />
                        </button>

                        <AnimatePresence>
                            {isProfileMenuOpen ? (
                                <motion.div
                                    className="premium-header__profile-menu"
                                    role="menu"
                                    aria-label="Premium account menu"
                                    initial={{ opacity: 0, y: -8, scale: 0.97 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: -6, scale: 0.98 }}
                                    transition={{ duration: 0.18 }}
                                >
                                    <div className="premium-header__menu-intro">
                                        <span className="premium-header__menu-avatar" aria-hidden="true">
                                            {imageUrl ? <img src={imageUrl} alt="" /> : initials}
                                        </span>
                                        <span>
                                            <strong>{displayName}</strong>
                                            <small>{user.email || 'Premium Nexora account'}</small>
                                        </span>
                                        <Crown size={16} aria-label="Premium account" />
                                    </div>

                                    <div className="premium-header__menu-summary">
                                        <span>
                                            <WalletCards size={15} aria-hidden="true" />
                                            Credits
                                        </span>
                                        <strong>{creditBalance ?? '—'}</strong>
                                    </div>

                                    <div className="premium-header__menu-actions">
                                        <button
                                            type="button"
                                            role="menuitem"
                                            onClick={() => navigateFromProfileMenu(PREMIUM_ROUTES.PUBLISHED)}
                                        >
                                            <BookOpenCheck size={16} aria-hidden="true" />
                                            <span>
                                                <strong>Published ideas</strong>
                                                <small>Manage your public portfolio</small>
                                            </span>
                                        </button>

                                        {PROFILE_ACTIONS.map(({ path, label, description, icon: Icon }) => (
                                            <button
                                                key={path}
                                                type="button"
                                                role="menuitem"
                                                onClick={() => navigateFromProfileMenu(path)}
                                            >
                                                <Icon size={16} aria-hidden="true" />
                                                <span>
                                                    <strong>{label}</strong>
                                                    <small>{description}</small>
                                                </span>
                                            </button>
                                        ))}
                                    </div>

                                    <div className="premium-header__menu-footer">
                                        <button
                                            type="button"
                                            role="menuitem"
                                            className="premium-header__sign-out"
                                            onClick={handleSignOut}
                                        >
                                            <LogOut size={16} aria-hidden="true" />
                                            <span>
                                                <strong>Sign out</strong>
                                                <small>End this session securely</small>
                                            </span>
                                        </button>
                                    </div>
                                </motion.div>
                            ) : null}
                        </AnimatePresence>
                    </div>
                </div>
            </motion.div>
        </header>
    );
}