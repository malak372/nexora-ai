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
import { NavLink, useNavigate } from 'react-router-dom';

import VoxidenceMark from '../../components/brand/VoxidenceMark';
import { clearAuthSession, getStoredUser } from '../../features/auth/shared/auth.storage';
import useAccountAccess from '../../features/normal-user/shared/hooks/useAccountAccess';
import { preloadRoute } from '../../routes/routePreloaders';
import { resolveMediaUrl } from '../../utils/mediaUrl';

const PRIMARY_ITEMS = [
  { to: '/normal/dashboard', label: 'Home', icon: LayoutDashboard },
  { to: '/normal/generate', label: 'Generate', icon: Sparkles },
  { to: '/normal/ideas', label: 'My ideas', icon: Lightbulb },
  { to: '/normal/discover', label: 'Discover', icon: Compass },
  { to: '/normal/published', label: 'Published', icon: BookOpenCheck },
];

function getInitials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'VX';
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
}

export default function NormalHeader({ onOpenMenu, isMenuOpen = false }) {
  const navigate = useNavigate();
  const profileMenuRef = useRef(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [user, setUser] = useState(() => getStoredUser() ?? {});
  const [headerSearch, setHeaderSearch] = useState('');
  const [avatarFailed, setAvatarFailed] = useState(false);
  const { isPremium, creditBalance } = useAccountAccess();

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
          to="/normal/dashboard"
          aria-label="Voxidence workspace home"
        >
          <motion.span
            className="normal-header__brand-mark"
            whileHover={{ rotate: 8, scale: 1.06 }}
          >
            <VoxidenceMark size={46} />
          </motion.span>
          <div className="normal-header__brand-copy">
            <strong>Voxidence</strong>
          </div>
        </NavLink>

        <nav className="normal-header__nav" aria-label="Workspace navigation">
          {PRIMARY_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onMouseEnter={() => preloadRoute(to)}
              onFocus={() => preloadRoute(to)}
              className={({ isActive }) => (isActive ? 'is-active' : '')}
            >
              {({ isActive }) => (
                <>
                  <Icon size={16} strokeWidth={1.9} />
                  <span>{label}</span>
                  {isActive ? (
                    <motion.i
                      className="normal-header__active-line"
                      layoutId="normal-nav-active"
                    />
                  ) : null}
                </>
              )}
            </NavLink>
          ))}
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
                  ? `/normal/ideas?search=${encodeURIComponent(value)}`
                  : '/normal/ideas',
              );
            }}
          >
            <Search size={17} aria-hidden="true" />
            <input
              value={headerSearch}
              onChange={(event) => setHeaderSearch(event.target.value)}
              placeholder="Search ideas"
              aria-label="Search your ideas"
            />
            <kbd>↵</kbd>
          </form>

          <motion.button
            type="button"
            className={`normal-upgrade-button ${isPremium ? 'is-premium' : ''}`}
            onClick={() => navigate('/normal/credits')}
            aria-label={isPremium ? 'Buy more credits' : 'Upgrade to Premium'}
            whileHover={{ y: -2, scale: 1.015 }}
            whileTap={{ scale: 0.975 }}
          >
            <span className="normal-upgrade-button__icon" aria-hidden="true">
              {isPremium ? <Coins size={16} /> : <Crown size={16} />}
            </span>
            <span className="normal-upgrade-button__copy">
              <b>{isPremium ? 'Buy more credits' : 'Upgrade'}</b>
              <small>
                {isPremium
                  ? `${creditBalance} credits remaining`
                  : 'Premium workspace'}
              </small>
            </span>
          </motion.button>

          <motion.button
            type="button"
            className="normal-header__icon"
            onClick={() => navigate('/normal/notifications')}
            aria-label="Notifications"
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
              aria-label="Open account menu"
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
                <i className="normal-header__online-dot" title="Online" />
              </span>
              <div className="normal-header__profile-copy">
                <b>{displayName}</b>
                <small>{accessLabel}</small>
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
                        title="Online"
                      />
                    </span>
                    <div>
                      <b>{displayName}</b>
                      <small>
                        {user.email || 'Manage your Voxidence experience'}
                      </small>
                    </div>
                  </div>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => navigateFromProfileMenu('/normal/compliance')}
                  >
                    <ShieldAlert size={16} />
                    <span>
                      <b>Complaints</b>
                      <small>Cases and admin replies</small>
                    </span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => navigateFromProfileMenu('/normal/billing')}
                  >
                    <ReceiptText size={16} />
                    <span>
                      <b>Billing & invoices</b>
                      <small>Payments and downloadable records</small>
                    </span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => navigateFromProfileMenu('/normal/preferences')}
                  >
                    <SlidersHorizontal size={16} />
                    <span>
                      <b>Preferences</b>
                      <small>Discovery defaults</small>
                    </span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => navigateFromProfileMenu('/normal/settings/profile')}
                  >
                    <Settings size={16} />
                    <span>
                      <b>Settings</b>
                      <small>Profile and privacy</small>
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
                      <b>Sign out</b>
                      <small>End this session safely</small>
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
            aria-label={isMenuOpen ? 'Close menu' : 'Open menu'}
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