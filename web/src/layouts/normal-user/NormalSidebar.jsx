/**
 * Responsive normal-user navigation drawer.
 *
 * @author Malak
 */
import {
  Bell,
  Coins,
  BookOpenCheck,
  ReceiptText,
  Compass,
  FileWarning,
  LayoutDashboard,
  Lightbulb,
  LogOut,
  Settings,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import { NavLink, useNavigate } from 'react-router-dom';

import { clearAuthSession, getStoredUser } from '../../features/auth/shared/auth.storage';
import useAccountAccess from '../../features/normal-user/shared/hooks/useAccountAccess';

const baseItems = [
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

export default function NormalSidebar({ isOpen, onClose }) {
  const navigate = useNavigate();
  const user = getStoredUser();
  const { isPremium, creditBalance } = useAccountAccess();
  const items = [
    ...baseItems,
    ['/normal/credits', isPremium ? `Buy credits (${creditBalance})` : 'Upgrade to Premium', Coins],
  ];

  const logout = () => {
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
      />

      <aside className={`normal-drawer ${isOpen ? 'is-open' : ''}`}>
        <div className="normal-drawer__head">
          <strong>Voxidence workspace</strong>
          <button type="button" onClick={onClose}><X size={19} /></button>
        </div>

        <nav>
          {items.map(([to, label, Icon]) => (
            <NavLink
              key={to}
              to={to}
              onClick={onClose}
              className={({ isActive }) => (isActive ? 'is-active' : '')}
            >
              <Icon size={18} />{label}
            </NavLink>
          ))}
        </nav>

        <div className="normal-drawer__user">
          <span>{(user?.fullName || user?.email || 'N')[0].toUpperCase()}</span>
          <div>
            <b>{user?.fullName || 'Voxidence user'}</b>
            <small>{isPremium ? `Premium · ${creditBalance} credits` : (user?.email || 'Normal account')}</small>
          </div>
          <button type="button" onClick={logout}><LogOut size={18} /></button>
        </div>
      </aside>
    </>
  );
}