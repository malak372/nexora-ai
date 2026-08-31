/* @refresh reset */
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
import { NavLink, useLocation, useNavigate } from 'react-router-dom';

import { clearAuthSession, getStoredUser } from '../../features/auth/shared/auth.storage';
import useAccountAccess from '../../features/normal-user/shared/hooks/useAccountAccess';
import { preloadRoute } from '../../routes/routePreloaders';
import { resolveMediaUrl } from '../../utils/mediaUrl';
import { useUserExperience } from '../../system/user-experience';

const BASE_ITEMS = [
  ['/dashboard', 'Home', LayoutDashboard],
  ['/generate', 'Generate idea', Sparkles],
  ['/ideas', 'My ideas', Lightbulb],
  ['/discover', 'Discover', Compass],
  ['/published', 'Published ideas', BookOpenCheck],
  ['/compliance', 'Compliance', FileWarning],
  ['/notifications', 'Notifications', Bell],
  ['/billing', 'Billing & invoices', ReceiptText],
  ['/preferences', 'Preferences', SlidersHorizontal],
  ['/settings/profile', 'Settings', Settings],
];

function getInitials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'VX';
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
}

export default function NormalSidebar({ isOpen, onClose }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState(() => getStoredUser() ?? {});
  const [avatarFailed, setAvatarFailed] = useState(false);
  const { isPremium, creditBalance } = useAccountAccess();
  const { t } = useUserExperience();
  const workspaceBase = isPremium ? '/premium' : '/normal';

  const displayName = user.fullName || user.name || 'Voxidence user';
  const imageUrl = resolveMediaUrl(
    user.avatarUrl || user.profileImageUrl || user.photoUrl || '',
  );
  const showAvatarImage = Boolean(imageUrl && !avatarFailed);
  const initials = getInitials(displayName);

  const items = [
    ...BASE_ITEMS.map(([path, label, Icon]) => [`${workspaceBase}${path}`, label, Icon]),
    [
      `${workspaceBase}/credits`,
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
        aria-label={t('Close menu')}
        tabIndex={isOpen ? 0 : -1}
      />

      <aside
        id="normal-responsive-drawer"
        className={`normal-drawer ${isOpen ? 'is-open' : ''}`}
        aria-hidden={!isOpen}
      >
        <div className="normal-drawer__head">
          <div>
            <strong dir="ltr" data-no-auto-translate="true">Voxidence</strong>
            <small>{t('Workspace menu')}</small>
          </div>
          <button type="button" onClick={onClose} aria-label={t('Close menu')}>
            <X size={19} />
          </button>
        </div>

        <nav aria-label={t('Responsive workspace navigation')}>
          {items.map(([to, label, Icon]) => (
            <NavLink
              key={to}
              to={to}
              state={
                to === `${workspaceBase}/preferences`
                  ? {
                    returnTo: `${location.pathname}${location.search}`,
                    returnLabel: 'Back to previous page',
                  }
                  : undefined
              }
              onMouseEnter={() => preloadRoute(to)}
              onFocus={() => preloadRoute(to)}
              onClick={onClose}
              className={({ isActive }) => (isActive ? 'is-active' : '')}
            >
              <span className="normal-drawer__nav-icon">
                <Icon size={18} />
              </span>
              <span>{t(label)}</span>
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
                ? `${t('Premium')} · ${t(`${creditBalance} credits`)}`
                : (user.email || t('Normal account'))}
            </small>
          </div>
          <button type="button" onClick={logout} aria-label={t('Sign out')}>
            <LogOut size={18} />
          </button>
        </div>
      </aside>
    </>
  );
}