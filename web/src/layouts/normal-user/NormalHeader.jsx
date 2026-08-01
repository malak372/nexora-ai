/**
 * Normal-user workspace header.
 *
 * Displays the authenticated user's name and optional profile image. When the
 * backend does not provide an image URL, the component falls back to initials.
 * Secondary account actions remain inside the profile menu.
 */
import {
  Bell,
  BookOpenCheck,
  ChevronDown,
  Compass,
  Crown,
  LayoutDashboard,
  Lightbulb,
  LogOut,
  Menu,
  Settings,
  SlidersHorizontal,
  Search,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';

import { clearAuthSession, getStoredUser } from '../../features/auth/shared/auth.storage';
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
  if (!parts.length) return 'NX';
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
}

export default function NormalHeader({ onOpenMenu }) {
  const navigate = useNavigate();
  const menuRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser] = useState(() => getStoredUser() ?? {});
  const [headerSearch, setHeaderSearch] = useState('');

  const displayName = user.fullName || user.name || 'Nexora user';
  const accessLabel = user.accountStatus === 'PREMIUM' ? 'Premium access' : 'Normal access';
  const imageUrl = resolveMediaUrl(user.avatarUrl || user.profileImageUrl || user.photoUrl || '');
  const initials = getInitials(displayName);

  useEffect(() => {
    const handleUserUpdated = (event) => {
      setUser(event.detail || getStoredUser() || {});
    };

    window.addEventListener('nexora:user-updated', handleUserUpdated);
    return () => window.removeEventListener('nexora:user-updated', handleUserUpdated);
  }, []);

  useEffect(() => {
    const closeOnOutsideClick = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, []);

  const navigateFromMenu = (path) => {
    setMenuOpen(false);
    navigate(path);
  };

  const signOut = () => {
    setMenuOpen(false);
    clearAuthSession();
    navigate('/login', { replace: true });
  };

  return (
    <header className="normal-header-wrap">
      <motion.div
        className="normal-header normal-header--professional"
        initial={{ opacity: 0, y: -18, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.58, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="normal-header__ambient" aria-hidden="true"><i /><i /></div>

        <NavLink className="normal-header__brand" to="/normal/dashboard" aria-label="Nexora workspace home">
          <motion.span className="normal-header__brand-mark" whileHover={{ rotate: 8, scale: 1.06 }}>
            <Sparkles size={20} />
            <i />
          </motion.span>
          <div className="normal-header__brand-copy">
            <strong>Nexora AI</strong>
            <small>Ideas built from real needs</small>
          </div>
        </NavLink>

        <nav className="normal-header__nav" aria-label="Workspace navigation">
          {PRIMARY_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'is-active' : '')}>
              {({ isActive }) => (
                <>
                  <Icon size={16} strokeWidth={1.9} />
                  <span>{label}</span>
                  {isActive ? <motion.i className="normal-header__active-line" layoutId="normal-nav-active" /> : null}
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
              navigate(value ? `/normal/ideas?search=${encodeURIComponent(value)}` : '/normal/ideas');
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
            className="normal-upgrade-button"
            onClick={() => navigate('/normal/credits?intent=upgrade')}
            whileHover={{ y: -2, scale: 1.015 }}
            whileTap={{ scale: 0.975 }}
          >
            <span className="normal-upgrade-button__icon"><Crown size={16} /></span>
            <span className="normal-upgrade-button__copy"><b>Upgrade</b><small>Premium workspace</small></span>
          </motion.button>

          <motion.button
            type="button"
            className="normal-header__icon"
            onClick={() => navigate('/normal/notifications')}
            aria-label="Notifications"
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.94 }}
          >
            <Bell size={18} /><i />
          </motion.button>

          <div className="normal-header__profile-wrap" ref={menuRef}>
            <button
              type="button"
              className="normal-header__profile"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
            >
              <span className="normal-header__avatar" aria-hidden="true">
                {imageUrl ? <img src={imageUrl} alt="" /> : initials}
                <i className="normal-header__online-dot" title="Online" />
              </span>
              <div className="normal-header__profile-copy">
                <b>{displayName}</b>
                <small>{accessLabel}</small>
              </div>
              <ChevronDown className={menuOpen ? 'is-rotated' : ''} size={14} />
            </button>

            <AnimatePresence>
              {menuOpen ? (
                <motion.div
                  className="normal-header__profile-menu"
                  role="menu"
                  initial={{ opacity: 0, y: -8, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.97 }}
                >
                  <div className="normal-header__profile-menu-head">
                    <span className="normal-header__menu-avatar">
                      {imageUrl ? <img src={imageUrl} alt="" /> : initials}
                      <i className="normal-header__online-dot normal-header__online-dot--menu" title="Online" />
                    </span>
                    <div><b>{displayName}</b><small>{user.email || 'Manage your Nexora experience'}</small></div>
                  </div>
                  <button type="button" onClick={() => navigateFromMenu('/normal/compliance')}>
                    <ShieldAlert size={16} /><span><b>Complaints</b><small>Cases and admin replies</small></span>
                  </button>
                  <button type="button" onClick={() => navigateFromMenu('/normal/preferences')}>
                    <SlidersHorizontal size={16} /><span><b>Preferences</b><small>Discovery defaults</small></span>
                  </button>
                  <button type="button" onClick={() => navigateFromMenu('/normal/settings/profile')}>
                    <Settings size={16} /><span><b>Settings</b><small>Profile and privacy</small></span>
                  </button>
                  <button type="button" onClick={signOut} className="normal-header__sign-out">
                    <LogOut size={16} /><span><b>Sign out</b><small>End this session safely</small></span>
                  </button>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>

          <button type="button" className="normal-header__menu" onClick={onOpenMenu} aria-label="Open menu">
            <Menu size={20} />
          </button>
        </div>
      </motion.div>
    </header>
  );
}