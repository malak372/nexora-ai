import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  BellRing,
  BookOpenCheck,
  BrainCircuit,
  ChevronDown,
  CircleDollarSign,
  Coins,
  Database,
  FileWarning,
  Gauge,
  Layers3,
  Lightbulb,
  LogOut,
  Menu,
  MessageCircleMore,
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
import {
  preloadAdminRoute,
  preloadPrimaryAdminRoutes,
} from '../../routes/adminRoutePreloaders';
import {
  clearAuthSession,
  getAccessToken,
  getStoredUser,
} from '../../features/auth/shared/auth.storage';
import { resolveMediaUrl } from '../../utils/mediaUrl';
import './admin-layout.css';

/**
 * Defines the grouped navigation structure used by
 * the administrator workspace.
 *
 * Each group contains:
 * - A group label.
 * - A representative icon.
 * - One or more administrator workspace routes.
 * - A visual tone associated with each route.
 *
 * @author Eman
 */
const groups = [
  {
    label: 'Overview',
    icon: Gauge,
    items: [
      {
        to: '/admin/dashboard',
        label: 'Command center',
        icon: Gauge,
        tone: 'dashboard',
      },
    ],
  },
  {
    label: 'People & access',
    icon: UsersRound,
    items: [
      {
        to: '/admin/administrators',
        label: 'Administrators',
        icon: UserRoundCog,
        tone: 'administrators',
      },
      {
        to: '/admin/team-chat',
        label: 'Team chat',
        icon: MessageCircleMore,
        tone: 'team-chat',
      },
      {
        to: '/admin/users',
        label: 'Users',
        icon: UsersRound,
        tone: 'users',
      },
    ],
  },
  {
    label: 'Community & support',
    icon: BellRing,
    items: [
      {
        to: '/admin/ideas',
        label: 'Ideas',
        icon: Lightbulb,
        tone: 'ideas',
      },
      {
        to: '/admin/publication-reports',
        label: 'Publication reports',
        icon: FileWarning,
        tone: 'reports',
      },
      {
        to: '/admin/complaints',
        label: 'Complaints',
        icon: ShieldCheck,
        tone: 'complaints',
      },
      {
        to: '/admin/contact-messages',
        label: 'Contact inbox',
        icon: BookOpenCheck,
        tone: 'contact',
      },
      {
        to: '/admin/alerts',
        label: 'Alerts',
        icon: BellRing,
        tone: 'alerts',
      },
    ],
  },
  {
    label: 'Data & evidence',
    icon: Database,
    items: [
      {
        to: '/admin/evidence',
        label: 'Evidence Library',
        icon: BookOpenCheck,
        tone: 'evidence',
      },
      {
        to: '/admin/data-sources',
        label: 'Data sources',
        icon: Database,
        tone: 'data-sources',
      },
      {
        to: '/admin/collection',
        label: 'Data collection',
        icon: Workflow,
        tone: 'collection',
      },
      {
        to: '/admin/domains',
        label: 'Domains',
        icon: Layers3,
        tone: 'domains',
      },
    ],
  },
  {
    label: 'Intelligence',
    icon: BrainCircuit,
    items: [
      {
        to: '/admin/ai-monitoring',
        label: 'AI monitoring',
        icon: Activity,
        tone: 'ai-monitoring',
      },
      {
        to: '/admin/ai-analytics',
        label: 'AI analytics',
        icon: Sparkles,
        tone: 'ai-analytics',
      },
      {
        to: '/admin/ai-models',
        label: 'AI models',
        icon: BrainCircuit,
        tone: 'ai-models',
      },
      {
        to: '/admin/prompts',
        label: 'Prompt control',
        icon: Sparkles,
        tone: 'prompts',
      },
    ],
  },
  {
    label: 'Finance',
    icon: CircleDollarSign,
    items: [
      {
        to: '/admin/payments',
        label: 'Payments',
        icon: CircleDollarSign,
        tone: 'payments',
      },
      {
        to: '/admin/credits',
        label: 'Credits',
        icon: Coins,
        tone: 'credits',
      },
    ],
  },
  {
    label: 'Security & system',
    icon: ShieldCheck,
    items: [
      {
        to: '/admin/auth-audit',
        label: 'Auth security',
        icon: ShieldCheck,
        tone: 'auth',
      },
      {
        to: '/admin/audit-logs',
        label: 'Audit trail',
        icon: UserRoundCog,
        tone: 'audit',
      },
      {
        to: '/admin/settings',
        label: 'System settings',
        icon: SlidersHorizontal,
        tone: 'settings',
      },
    ],
  },
];

/**
 * Standalone administrator account navigation item.
 *
 * This entry is placed outside the primary grouped navigation
 * and provides access to profile and security settings.
 *
 * @author Eman
 */
const accountItem = {
  to: '/admin/account',
  label: 'Profile & security',
  icon: UserRound,
  tone: 'account',
};

/**
 * Flattened collection containing every administrator route.
 *
 * Used to build route-specific page titles and visual tones.
 */
const allItems = [
  ...groups.flatMap((group) => group.items),
  accountItem,
];

/**
 * Maps administrator routes to their display titles.
 */
const routeTitles = Object.fromEntries(
  allItems.map((item) => [item.to, item.label]),
);

/**
 * Maps administrator routes to their visual theme tones.
 */
const routeTones = Object.fromEntries(
  allItems.map((item) => [item.to, item.tone]),
);

/**
 * Determines whether a navigation route is currently active.
 *
 * A route is considered active when the current pathname
 * exactly matches the route or belongs to one of its nested paths.
 *
 * @param {string} pathname Current browser pathname.
 * @param {string} to Navigation destination.
 * @returns {boolean} Whether the route is active.
 *
 * @author Eman
 */
function isRouteActive(pathname, to) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

/**
 * Main layout for the administrator web application.
 *
 * Responsibilities include:
 * - Validating administrator authentication and role access.
 * - Rendering the global administrator header.
 * - Rendering grouped top navigation.
 * - Managing responsive mobile navigation.
 * - Displaying administrator profile information.
 * - Managing route-specific titles and visual themes.
 * - Dispatching administrator workspace search events.
 * - Preloading administrator routes for faster navigation.
 * - Synchronizing authentication and user profile changes.
 * - Handling expired authentication sessions.
 * - Providing administrator logout functionality.
 * - Rendering nested administrator routes through React Router.
 *
 * @returns {JSX.Element} The administrator application layout.
 *
 * @author Eman
 */
export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const navRef = useRef(null);

  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState('');
  const [search, setSearch] = useState('');
  const [user, setUser] = useState(() => getStoredUser() || {});

  const role = String(user.role || '').toUpperCase();

  /**
   * Protects the administrator layout from unauthorized access.
   *
   * Users without an access token are redirected to login,
   * while authenticated non-administrator users are redirected
   * to the normal-user dashboard.
   */
  useEffect(() => {
    if (!getAccessToken()) {
      navigate('/login', { replace: true });
      return;
    }

    if (role !== 'ADMIN') {
      navigate('/normal/dashboard', { replace: true });
    }
  }, [navigate, role]);

  /**
   * Closes responsive navigation elements whenever
   * the active administrator route changes.
   */
  useEffect(() => {
    setMobileOpen(false);
    setOpenGroup('');
  }, [location.pathname]);

  /**
   * Preloads the primary administrator routes after
   * the layout is initially mounted.
   */
  useEffect(() => preloadPrimaryAdminRoutes(), []);

  /**
   * Synchronizes locally stored administrator information
   * whenever the authentication layer broadcasts user changes.
   */
  useEffect(() => {
    const syncUser = (event) =>
      setUser(event.detail || getStoredUser() || {});

    window.addEventListener(
      'voxidence :user-updated',
      syncUser,
    );

    window.addEventListener(
      'voxidence :auth-session-changed',
      syncUser,
    );

    return () => {
      window.removeEventListener(
        'voxidence :user-updated',
        syncUser,
      );

      window.removeEventListener(
        'voxidence :auth-session-changed',
        syncUser,
      );
    };
  }, []);

  /**
   * Redirects the administrator to login whenever
   * the application reports that the current session has expired.
   */
  useEffect(() => {
    const onExpired = () =>
      navigate('/login', { replace: true });

    window.addEventListener(
      'voxidence :session-expired',
      onExpired,
    );

    return () =>
      window.removeEventListener(
        'voxidence :session-expired',
        onExpired,
      );
  }, [navigate]);

  /**
   * Closes any open navigation dropdown when the user
   * clicks or taps outside the navigation area.
   */
  useEffect(() => {
    const closeMenus = (event) => {
      if (
        navRef.current &&
        !navRef.current.contains(event.target)
      ) {
        setOpenGroup('');
      }
    };

    document.addEventListener(
      'pointerdown',
      closeMenus,
    );

    return () =>
      document.removeEventListener(
        'pointerdown',
        closeMenus,
      );
  }, []);

  /**
   * Resolves the current administrator workspace title.
   */
  const title =
    routeTitles[location.pathname] ||
    'Admin workspace';

  /**
   * Resolves the visual theme associated with the
   * currently active administrator route.
   */
  const tone =
    routeTones[location.pathname] ||
    'dashboard';

  /**
   * Generates administrator initials for use when
   * no profile image is available.
   */
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

  /**
   * Resolves the administrator profile image URL.
   */
  const avatarUrl = resolveMediaUrl(
    user.avatarUrl ||
    user.profileImageUrl ||
    user.avatar ||
    '',
  );

  /**
   * Clears the current authentication session and
   * returns the administrator to the login page.
   */
  const signOut = () => {
    clearAuthSession();

    navigate('/login', {
      replace: true,
    });
  };

  /**
   * Dispatches a global administrator workspace search event.
   *
   * Individual administrator pages can listen for
   * `voxidence:admin-search` and process the search value
   * according to their own workspace data.
   *
   * @param {React.FormEvent<HTMLFormElement>} event Form submission event.
   */
  const submitSearch = (event) => {
    event.preventDefault();

    window.dispatchEvent(
      new CustomEvent('voxidence:admin-search', {
        detail: search.trim(),
      }),
    );
  };

  return (
    <div className={`admin-shell admin-theme-${tone}`}>
      <div
        className="admin-shell__backdrop"
        aria-hidden="true"
      />

      <header className="admin-header">
        <div className="admin-header__primary">
          <button
            className="admin-icon-btn admin-header__mobile-menu"
            onClick={() =>
              setMobileOpen((value) => !value)
            }
            aria-label={
              mobileOpen
                ? 'Close admin navigation'
                : 'Open admin navigation'
            }
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? (
              <X size={19} />
            ) : (
              <Menu size={20} />
            )}
          </button>

          <button
            type="button"
            className="admin-brand"
            onClick={() =>
              navigate('/admin/dashboard')
            }
            aria-label="Open admin command center"
          >
            <VoxidenceMark size={36} />

            <span>
              <strong>Voxidence</strong>
              <small>Administration</small>
            </span>
          </button>

          <div className="admin-header__route">
            <span>Operations console</span>
            <h1>{title}</h1>
          </div>

          <form
            className="admin-global-search"
            onSubmit={submitSearch}
          >
            <Search size={17} />

            <input
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              placeholder="Search this workspace…"
            />

            <kbd>↵</kbd>
          </form>

          <button
            className="admin-profile-pill"
            type="button"
            onClick={() =>
              navigate('/admin/account')
            }
            title="Open profile and security settings"
          >
            <span className="admin-profile-pill__avatar">
              {avatarUrl ? (
                <img src={avatarUrl} alt="" />
              ) : (
                initials
              )}
            </span>

            <div>
              <strong>
                {user.fullName ||
                  user.name ||
                  'Administrator'}
              </strong>

              <small>
                Profile & security
              </small>
            </div>
          </button>
        </div>

        <div
          className={`admin-nav-row ${mobileOpen ? 'is-open' : ''
            }`}
          ref={navRef}
        >
          <nav
            className="admin-topnav"
            aria-label="Admin navigation"
          >
            {groups.map((group) => {
              const GroupIcon = group.icon;

              const groupActive =
                group.items.some((item) =>
                  isRouteActive(
                    location.pathname,
                    item.to,
                  ),
                );

              /**
               * Groups containing one route are rendered
               * directly as a top-level navigation link.
               */
              if (group.items.length === 1) {
                const item = group.items[0];
                const ItemIcon = item.icon;

                return (
                  <NavLink
                    key={group.label}
                    to={item.to}
                    className={({ isActive }) =>
                      `admin-topnav__single tone-${item.tone}${isActive
                        ? ' is-active'
                        : ''
                      }`
                    }
                    onMouseEnter={() =>
                      preloadAdminRoute(item.to)
                    }
                    onFocus={() =>
                      preloadAdminRoute(item.to)
                    }
                  >
                    <ItemIcon size={16} />
                    <span>{group.label}</span>
                  </NavLink>
                );
              }

              const isOpen =
                openGroup === group.label;

              return (
                <div
                  key={group.label}
                  className={`admin-topnav__group ${groupActive
                      ? 'is-active'
                      : ''
                    } ${isOpen
                      ? 'is-open'
                      : ''
                    }`}
                >
                  <button
                    type="button"
                    className="admin-topnav__group-trigger"
                    onClick={() =>
                      setOpenGroup((current) =>
                        current === group.label
                          ? ''
                          : group.label,
                      )
                    }
                    aria-haspopup="menu"
                    aria-expanded={isOpen}
                  >
                    <GroupIcon size={16} />

                    <span>
                      {group.label}
                    </span>

                    <ChevronDown
                      className="admin-topnav__chevron"
                      size={14}
                    />
                  </button>

                  <div
                    className="admin-topnav__menu"
                    role="menu"
                  >
                    <div className="admin-topnav__menu-head">
                      <span>
                        {group.label}
                      </span>

                      <small>
                        {group.items.length}{' '}
                        workspaces
                      </small>
                    </div>

                    {group.items.map(
                      ({
                        to,
                        label,
                        icon: Icon,
                        tone: itemTone,
                      }) => (
                        <NavLink
                          key={to}
                          to={to}
                          role="menuitem"
                          className={({
                            isActive,
                          }) =>
                            `admin-topnav__menu-link tone-${itemTone}${isActive
                              ? ' is-active'
                              : ''
                            }`
                          }
                          onMouseEnter={() =>
                            preloadAdminRoute(to)
                          }
                          onFocus={() =>
                            preloadAdminRoute(to)
                          }
                        >
                          <span className="admin-topnav__menu-icon">
                            <Icon size={16} />
                          </span>

                          <span className="admin-topnav__menu-copy">
                            <strong>
                              {label}
                            </strong>

                            <small>
                              Open workspace
                            </small>
                          </span>

                          <i aria-hidden="true" />
                        </NavLink>
                      ),
                    )}
                  </div>
                </div>
              );
            })}
          </nav>

          <div className="admin-nav-row__utilities">
            <NavLink
              to={accountItem.to}
              className={({ isActive }) =>
                `admin-topnav__account tone-account${isActive
                  ? ' is-active'
                  : ''
                }`
              }
              onMouseEnter={() =>
                preloadAdminRoute(
                  accountItem.to,
                )
              }
              onFocus={() =>
                preloadAdminRoute(
                  accountItem.to,
                )
              }
            >
              <UserRound size={16} />
              <span>Account</span>
            </NavLink>

            <button
              className="admin-topnav__signout"
              type="button"
              onClick={signOut}
              title="Sign out"
            >
              <LogOut size={16} />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </header>

      {mobileOpen && (
        <button
          className="admin-mobile-scrim"
          onClick={() =>
            setMobileOpen(false)
          }
          aria-label="Close navigation"
        />
      )}

      <div className="admin-workspace">
        <main className="admin-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}