import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  BellRing,
  BookOpenCheck,
  BrainCircuit,
  CircleDollarSign,
  Coins,
  Database,
  FileWarning,
  Gauge,
  Layers3,
  Lightbulb,
  LogOut,
  Menu,
  PanelLeftClose,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  UserRoundCog,
  UsersRound,
  Workflow,
  X,
} from 'lucide-react';

import VoxidenceMark from '../../components/brand/VoxidenceMark';
import { preloadAdminRoute, preloadPrimaryAdminRoutes } from '../../routes/adminRoutePreloaders';
import {
  clearAuthSession,
  getAccessToken,
  getStoredUser,
} from '../../features/auth/shared/auth.storage';
import { resolveMediaUrl } from '../../utils/mediaUrl';
import './admin-layout.css';

const groups = [
  {
    label: 'Overview',
    items: [
      { to: '/admin/dashboard', label: 'Command center', icon: Gauge },
    ],
  },
  {
    label: 'People & access',
    items: [
      {
        to: '/admin/administrators',
        label: 'Administrators',
        icon: UserRoundCog,
      },
      { to: '/admin/users', label: 'Users', icon: UsersRound },
    ],
  },
  {
    label: 'Community & support',
    items: [
      { to: '/admin/ideas', label: 'Ideas', icon: Lightbulb },
      {
        to: '/admin/publication-reports',
        label: 'Publication reports',
        icon: FileWarning,
      },
      { to: '/admin/complaints', label: 'Complaints', icon: ShieldCheck },
      {
        to: '/admin/contact-messages',
        label: 'Contact inbox',
        icon: BookOpenCheck,
      },
      { to: '/admin/alerts', label: 'Alerts', icon: BellRing },
    ],
  },
  {
    label: 'Data & evidence',
    items: [
      { to: '/admin/evidence', label: 'Evidence Library', icon: Database },
      { to: '/admin/data-sources', label: 'Data sources', icon: Database },
      { to: '/admin/collection', label: 'Data collection', icon: Workflow },
      { to: '/admin/domains', label: 'Domains', icon: Layers3 },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { to: '/admin/ai-monitoring', label: 'AI monitoring', icon: Activity },
      { to: '/admin/ai-analytics', label: 'AI analytics', icon: Sparkles },
      { to: '/admin/ai-models', label: 'AI models', icon: BrainCircuit },
      { to: '/admin/prompts', label: 'Prompt control', icon: Sparkles },
    ],
  },
  {
    label: 'Finance',
    items: [
      { to: '/admin/payments', label: 'Payments', icon: CircleDollarSign },
      { to: '/admin/credits', label: 'Credits', icon: Coins },
    ],
  },
  {
    label: 'Security & system',
    items: [
      { to: '/admin/auth-audit', label: 'Auth security', icon: ShieldCheck },
      { to: '/admin/audit-logs', label: 'Audit trail', icon: UserRoundCog },
      {
        to: '/admin/settings',
        label: 'System settings',
        icon: SlidersHorizontal,
      },
    ],
  },
  {
    label: 'My account',
    items: [
      { to: '/admin/account', label: 'Profile & security', icon: UserRound },
    ],
  },
];

const routeTitles = Object.fromEntries(
  groups.flatMap((group) => group.items.map((item) => [item.to, item.label])),
);

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [user, setUser] = useState(() => getStoredUser() || {});
  const role = String(user.role || '').toUpperCase();

  useEffect(() => {
    if (!getAccessToken()) {
      navigate('/login', { replace: true });
      return;
    }

    if (role !== 'ADMIN') {
      navigate('/normal/dashboard', { replace: true });
    }
  }, [navigate, role]);

  useEffect(() => setMobileOpen(false), [location.pathname]);

  useEffect(() => preloadPrimaryAdminRoutes(), []);

  useEffect(() => {
    const syncUser = (event) => setUser(event.detail || getStoredUser() || {});

    window.addEventListener('voxidence :user-updated', syncUser);
    window.addEventListener('voxidence :auth-session-changed', syncUser);

    return () => {
      window.removeEventListener('voxidence :user-updated', syncUser);
      window.removeEventListener('voxidence :auth-session-changed', syncUser);
    };
  }, []);

  useEffect(() => {
    const onExpired = () => navigate('/login', { replace: true });
    window.addEventListener('voxidence :session-expired', onExpired);
    return () => window.removeEventListener('voxidence :session-expired', onExpired);
  }, [navigate]);

  const title = routeTitles[location.pathname] || 'Admin workspace';
  const initials = useMemo(
    () =>
      (user.fullName || user.name || 'Admin')
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0])
        .join('')
        .toUpperCase(),
    [user.fullName, user.name],
  );
  const avatarUrl = resolveMediaUrl(
    user.avatarUrl || user.profileImageUrl || user.avatar || '',
  );

  const signOut = () => {
    clearAuthSession();
    navigate('/login', { replace: true });
  };

  const submitSearch = (event) => {
    event.preventDefault();
    window.dispatchEvent(
      new CustomEvent('voxidence:admin-search', { detail: search.trim() }),
    );
  };

  return (
    <div className={`admin-shell ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="admin-shell__backdrop" aria-hidden="true" />

      <aside className={`admin-sidebar ${mobileOpen ? 'is-open' : ''}`}>
        <div className="admin-sidebar__brand">
          <VoxidenceMark size={38} />
          {!collapsed && (
            <div>
              <strong>Voxidence</strong>
              <span>Administration</span>
            </div>
          )}
          <button
            className="admin-icon-btn admin-sidebar__mobile-close"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="admin-sidebar__nav">
          {groups.map((group) => (
            <section key={group.label}>
              {!collapsed && <p>{group.label}</p>}
              {group.items.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) => (isActive ? 'is-active' : '')}
                  title={collapsed ? label : undefined}
                  onMouseEnter={() => preloadAdminRoute(to)}
                  onFocus={() => preloadAdminRoute(to)}
                >
                  <Icon size={18} strokeWidth={1.9} />
                  <span>{label}</span>
                </NavLink>
              ))}
            </section>
          ))}
        </nav>

        <div className="admin-sidebar__footer">
          <button onClick={() => setCollapsed((value) => !value)}>
            <PanelLeftClose size={17} />
            <span>{collapsed ? 'Expand' : 'Collapse'}</span>
          </button>
          <button onClick={signOut}>
            <LogOut size={17} />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {mobileOpen && (
        <button
          className="admin-mobile-scrim"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
        />
      )}

      <div className="admin-workspace">
        <header className="admin-topbar">
          <div className="admin-topbar__title">
            <button
              className="admin-icon-btn admin-topbar__menu"
              onClick={() => setMobileOpen(true)}
              aria-label="Open admin navigation"
            >
              <Menu size={20} />
            </button>
            <div>
              <span>Operations console</span>
              <h1>{title}</h1>
            </div>
          </div>

          <form className="admin-global-search" onSubmit={submitSearch}>
            <Search size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search this workspace…"
            />
            <kbd>↵</kbd>
          </form>

          <button
            className="admin-profile-pill"
            type="button"
            onClick={() => navigate('/admin/account')}
            title="Open profile and security settings"
          >
            <span className="admin-profile-pill__avatar">
              {avatarUrl ? <img src={avatarUrl} alt="" /> : initials}
            </span>
            <div>
              <strong>{user.fullName || user.name || 'Administrator'}</strong>
              <small>Profile & security</small>
            </div>
          </button>
        </header>

        <main className="admin-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}