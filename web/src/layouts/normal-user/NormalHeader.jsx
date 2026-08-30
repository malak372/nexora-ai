/* @refresh reset */
/**
 * Responsive normal-user workspace header.
 *
 * Keeps desktop navigation, upgrade access, notifications, profile identity,
 * and the mobile/tablet drawer trigger stable across all viewport sizes.
 *
 * @author Eman
 */
import {
  Bell,
  BookOpenCheck,
  ChevronDown,
  Compass,
  Coins,
  Crown,
  LayoutDashboard,
  Lightbulb,
  LogOut,
  Menu,
  ReceiptText,
  Search,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';

import VoxidenceMark from '../../components/brand/VoxidenceMark';
import { clearAuthSession, getStoredUser } from '../../features/auth/shared/auth.storage';
import useAccountAccess from '../../features/normal-user/shared/hooks/useAccountAccess';
import { preloadRoute } from '../../routes/routePreloaders';
import { resolveMediaUrl } from '../../utils/mediaUrl';
import { useUserExperience } from '../../system/user-experience';

const PRIMARY_ITEMS = [
  { path: '/dashboard', label: 'Home', icon: LayoutDashboard },
  { path: '/generate', label: 'Generate', icon: Sparkles },
  { path: '/ideas', label: 'My ideas', icon: Lightbulb },
  { path: '/discover', label: 'Discover', icon: Compass },
  { path: '/published', label: 'Published', icon: BookOpenCheck },
];

function getInitials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'VX';
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
}

export default function NormalHeader({ onOpenMenu, isMenuOpen = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const profileMenuRef = useRef(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [user, setUser] = useState(() => getStoredUser() ?? {});
  const [headerSearch, setHeaderSearch] = useState('');
  const [avatarFailed, setAvatarFailed] = useState(false);
  const { isPremium, creditBalance } = useAccountAccess();
  const { t, isArabic } = useUserExperience();
  const workspaceBase = isPremium ? '/premium' : '/normal';

  const displayName = user.fullName || user.name || 'Voxidence user';
  const accessLabel = isPremium ? 'Premium' : 'Normal access';
  const imageUrl = resolveMediaUrl(
    user.avatarUrl || user.profileImageUrl || user.photoUrl || '',
  );
  const initials = getInitials(displayName);
  const showAvatarImage = Boolean(imageUrl && !avatarFailed);

  useEffect(() => {
    const handleUserUpdated = (event) => {
      setUser(event.detail || getStoredUser() || {});
    };

    window.addEventListener('nexora:user-updated', handleUserUpdated);
    return () => window.removeEventListener('nexora:user-updated', handleUserUpdated);
  }, []);

  useEffect(() => {
    setAvatarFailed(false);
  }, [imageUrl]);

  useEffect(() => {
    const closeOnOutsideClick = (event) => {
      if (
        profileMenuRef.current
        && !profileMenuRef.current.contains(event.target)
      ) {
        setProfileMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, []);

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setProfileMenuOpen(false);
    };

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

  const navigateFromProfileMenu = (path) => {
    setProfileMenuOpen(false);

    if (path === `${workspaceBase}/preferences`) {
      navigate(path, {
        state: {
          returnTo: `${location.pathname}${location.search}`,
          returnLabel: 'Back to previous page',
        },
      });
      return;
    }

    navigate(path);
  };

  const signOut = () => {
    setProfileMenuOpen(false);
    clearAuthSession();
    navigate('/login', { replace: true });
  };

  const openResponsiveMenu = () => {
    setProfileMenuOpen(false);
    onOpenMenu?.();
  };

  return (
    <header className="normal-header-wrap">
      <motion.div
        className="normal-header normal-header--professional"
        initial={{ opacity: 0, y: -18, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.58, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="normal-header__ambient" aria-hidden="true">
          <i />
          <i />
        </div>

        <NavLink
          className="normal-header__brand"
          to={`${workspaceBase}/dashboard`}
          aria-label={t('Voxidence workspace home')}
        >
          <motion.span
            className="normal-header__brand-mark"
            whileHover={{ rotate: 8, scale: 1.06 }}
          >
            <VoxidenceMark size={46} />
          </motion.span>
          <div className="normal-header__brand-copy">
            <strong dir="ltr" data-no-auto-translate="true">Voxidence</strong>
          </div>
        </NavLink>

        <nav className="normal-header__nav" aria-label={t('Workspace navigation')}>
          {PRIMARY_ITEMS.map(({ path, label, icon: Icon }) => {
            const to = `${workspaceBase}${path}`;

            return (
              <NavLink
                key={path}
                to={to}
                onMouseEnter={() => preloadRoute(to)}
                onFocus={() => preloadRoute(to)}
                className={({ isActive }) => (isActive ? 'is-active' : '')}
              >
                {({ isActive }) => (
                  <>
                    <Icon size={16} strokeWidth={1.9} />
                    <span>{t(label)}</span>
                    {isActive ? (
                      <motion.i
                        className="normal-header__active-line"
                        layoutId="normal-nav-active"
                      />
                    ) : null}
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="normal-header__tools">
          <form
            className="normal-header__search"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              const value = headerSearch.trim();
              navigate(
                value
                  ? `${workspaceBase}/ideas?search=${encodeURIComponent(value)}`
                  : `${workspaceBase}/ideas`,
              );
            }}
          >
            <Search size={17} aria-hidden="true" />
            <input
              value={headerSearch}
              onChange={(event) => setHeaderSearch(event.target.value)}
              placeholder={t('Search ideas')}
              aria-label={t('Search your ideas')}
            />
            <kbd>↵</kbd>
          </form>

          <motion.button
            type="button"
            className={`normal-upgrade-button ${isPremium ? 'is-premium' : ''}`}
            onClick={() => navigate(`${workspaceBase}/credits`)}
            aria-label={t(isPremium ? 'Buy more credits' : 'Upgrade to Premium')}
            whileHover={{ y: -2, scale: 1.015 }}
            whileTap={{ scale: 0.975 }}
          >
            <span className="normal-upgrade-button__icon" aria-hidden="true">
              {isPremium ? <Coins size={16} /> : <Crown size={16} />}
            </span>
            <span className="normal-upgrade-button__copy">
              <b>{t(isPremium ? 'Buy more credits' : 'Upgrade')}</b>
              <small>
                {isPremium
                  ? t(`${creditBalance} credits remaining`)
                  : t('Premium workspace')}
              </small>
            </span>
          </motion.button>

          <motion.button
            type="button"
            className="normal-header__icon"
            onClick={() => navigate(`${workspaceBase}/notifications`)}
            aria-label={t('Notifications')}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.94 }}
          >
            <Bell size={18} />
            <i aria-hidden="true" />
          </motion.button>

          <div className="normal-header__profile-wrap" ref={profileMenuRef}>
            <motion.button
              type="button"
              className="normal-header__profile"
              onClick={() => setProfileMenuOpen((open) => !open)}
              aria-expanded={profileMenuOpen}
              aria-haspopup="menu"
              aria-label={t('Open account menu')}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.97 }}
            >
              <span className="normal-header__avatar">
                {showAvatarImage ? (
                  <img
                    src={imageUrl}
                    alt=""
                    onError={() => setAvatarFailed(true)}
                  />
                ) : (
                  <b className="normal-header__avatar-initials" aria-hidden="true">
                    {initials}
                  </b>
                )}
                <i className="normal-header__online-dot" title={t('Online')} />
              </span>
              <div className="normal-header__profile-copy">
                <b>{displayName}</b>
                <small>{t(accessLabel)}</small>
              </div>
              <ChevronDown
                className={profileMenuOpen ? 'is-rotated' : ''}
                size={14}
              />
            </motion.button>

            <AnimatePresence>
              {profileMenuOpen ? (
                <motion.div
                  className="normal-header__profile-menu"
                  role="menu"
                  dir={isArabic ? 'rtl' : 'ltr'}
                  initial={{ opacity: 0, y: -8, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.97 }}
                >
                  <div className="normal-header__profile-menu-head">
                    <span className="normal-header__menu-avatar">
                      {showAvatarImage ? (
                        <img
                          src={imageUrl}
                          alt=""
                          onError={() => setAvatarFailed(true)}
                        />
                      ) : (
                        initials
                      )}
                      <i
                        className="normal-header__online-dot normal-header__online-dot--menu"
                        title={t('Online')}
                      />
                    </span>
                    <div>
                      <b>{displayName}</b>
                      <small>
                        {user.email || t('Manage your Voxidence experience')}
                      </small>
                    </div>
                  </div>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => navigateFromProfileMenu(`${workspaceBase}/compliance`)}
                  >
                    <ShieldAlert size={16} />
                    <span>
                      <b>{t('Complaints')}</b>
                      <small>{t('Cases and admin replies')}</small>
                    </span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => navigateFromProfileMenu(`${workspaceBase}/billing`)}
                  >
                    <ReceiptText size={16} />
                    <span>
                      <b>{t('Billing & invoices')}</b>
                      <small>{t('Payments and downloadable records')}</small>
                    </span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => navigateFromProfileMenu(`${workspaceBase}/preferences`)}
                  >
                    <SlidersHorizontal size={16} />
                    <span>
                      <b>{t('Preferences')}</b>
                      <small>{t('Discovery defaults')}</small>
                    </span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => navigateFromProfileMenu(`${workspaceBase}/settings/profile`)}
                  >
                    <Settings size={16} />
                    <span>
                      <b>{t('Settings')}</b>
                      <small>{t('Profile and privacy')}</small>
                    </span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={signOut}
                    className="normal-header__sign-out"
                  >
                    <LogOut size={16} />
                    <span>
                      <b>{t('Sign out')}</b>
                      <small>{t('End this session safely')}</small>
                    </span>
                  </button>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>

          <button
            type="button"
            id="normal-responsive-menu-button"
            className="normal-header__menu"
            onClick={openResponsiveMenu}
            aria-label={t(isMenuOpen ? 'Close menu' : 'Open menu')}
            aria-expanded={isMenuOpen}
            aria-controls="normal-responsive-drawer"
          >
            <Menu size={20} />
          </button>
        </div>
      </motion.div>
    </header>
  );
}