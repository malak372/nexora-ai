/**
 * Responsive normal-user navigation drawer.
 *
 * Uses the same live user identity and avatar as the desktop header and stays
 * fully functional at the exact breakpoint where the desktop navigation hides.
 *
 * @author Eman
 */
import {
  Bell,
  BookOpenCheck,
  Coins,
  Compass,
  FileWarning,
  LayoutDashboard,
  Lightbulb,
  LogOut,
  ReceiptText,
  Settings,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';

import { clearAuthSession, getStoredUser } from '../../features/auth/shared/auth.storage';
import useAccountAccess from '../../features/normal-user/shared/hooks/useAccountAccess';
import { preloadRoute } from '../../routes/routePreloaders';
import { resolveMediaUrl } from '../../utils/mediaUrl';

const BASE_ITEMS = [
  ['/normal/dashboard', 'Home', LayoutDashboard],
  ['/normal/generate', 'Generate idea', Sparkles],
  ['/normal/ideas', 'My ideas', Lightbulb],
  ['/normal/discover', 'Discover', Compass],
  ['/normal/published', 'Published ideas', BookOpenCheck],
  ['/normal/compliance', 'Compliance', FileWarning],
  ['/normal/notifications', 'Notifications', Bell],
  ['/normal/billing', 'Billing & invoices', ReceiptText],
  ['/normal/preferences', 'Preferences', SlidersHorizontal],
  ['/normal/settings/profile', 'Settings', Settings],
];

function getInitials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'VX';
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
}

export default function NormalSidebar({ isOpen, onClose }) {
  const navigate = useNavigate();
  const [user, setUser] = useState(() => getStoredUser() ?? {});
  const [avatarFailed, setAvatarFailed] = useState(false);
  const { isPremium, creditBalance } = useAccountAccess();

  const displayName = user.fullName || user.name || 'Voxidence user';
  const imageUrl = resolveMediaUrl(
    user.avatarUrl || user.profileImageUrl || user.photoUrl || '',
  );
  const showAvatarImage = Boolean(imageUrl && !avatarFailed);
  const initials = getInitials(displayName);

  const items = [
    ...BASE_ITEMS,
    [
      '/normal/credits',
      isPremium ? `Buy credits (${creditBalance})` : 'Upgrade to Premium',
      Coins,
    ],
  ];

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

  const logout = () => {
    onClose?.();
    clearAuthSession();
    navigate('/login', { replace: true });
  };

  return (
    <>
      <button
        type="button"
        className={`normal-drawer-backdrop ${isOpen ? 'is-open' : ''}`}
        onClick={onClose}
        aria-label="Close menu"
        tabIndex={isOpen ? 0 : -1}
      />

      <aside
        id="normal-responsive-drawer"
        className={`normal-drawer ${isOpen ? 'is-open' : ''}`}
        aria-hidden={!isOpen}
      >
        <div className="normal-drawer__head">
          <div>
            <strong>Voxidence</strong>
            <small>Workspace menu</small>
          </div>
          <button type="button" onClick={onClose} aria-label="Close menu">
            <X size={19} />
          </button>
        </div>

        <nav aria-label="Responsive workspace navigation">
          {items.map(([to, label, Icon]) => (
            <NavLink
              key={to}
              to={to}
              onMouseEnter={() => preloadRoute(to)}
              onFocus={() => preloadRoute(to)}
              onClick={onClose}
              className={({ isActive }) => (isActive ? 'is-active' : '')}
            >
              <span className="normal-drawer__nav-icon">
                <Icon size={18} />
              </span>
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="normal-drawer__user">
          <span className="normal-drawer__avatar">
            {showAvatarImage ? (
              <img
                src={imageUrl}
                alt=""
                onError={() => setAvatarFailed(true)}
              />
            ) : (
              initials
            )}
          </span>
          <div>
            <b>{displayName}</b>
            <small>
              {isPremium
                ? `Premium · ${creditBalance} credits`
                : (user.email || 'Normal account')}
            </small>
          </div>
          <button type="button" onClick={logout} aria-label="Sign out">
            <LogOut size={18} />
          </button>
        </div>
      </aside>
    </>
  );
}