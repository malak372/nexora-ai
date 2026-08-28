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
import {
  adminTeamChatApi,
  createAdminTeamChatSocket,
  disconnectAdminTeamChatSocket,
} from '../../features/admin/team-chat/api/adminTeamChatApi';
import { resolveMediaUrl } from '../../utils/mediaUrl';
import { useUserExperience } from '../../system/user-experience';
import './admin-layout.css';

const dashboardItem = {
  to: '/admin/dashboard',
  label: 'Overview',
  navLabelAr: 'نظرة',
  icon: Gauge,
  tone: 'dashboard',
};

const navigationGroups = [
  {
    key: 'people',
    navLabel: 'People',
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
    key: 'community',
    navLabel: 'Community',
    label: 'Community & support',
    icon: Lightbulb,
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
    ],
  },
  {
    key: 'data',
    navLabel: 'Data',
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
    key: 'intelligence',
    navLabel: 'AI',
    navLabelAr: 'الذكاء',
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
    key: 'finance',
    navLabel: 'Finance',
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
    key: 'system',
    navLabel: 'System',
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

const alertItem = {
  to: '/admin/alerts',
  label: 'Alerts',
  icon: BellRing,
  tone: 'alerts',
};

const accountItem = {
  to: '/admin/account',
  label: 'Profile & security',
  icon: UserRound,
  tone: 'account',
};

const mobileGroups = [
  {
    label: 'Overview',
    items: [dashboardItem],
  },
  ...navigationGroups.map((group) => ({
    label: group.label,
    items:
      group.key === 'community'
        ? [...group.items, alertItem]
        : group.items,
  })),
];

const allItems = [
  dashboardItem,
  ...navigationGroups.flatMap((group) => group.items),
  alertItem,
  accountItem,
];

const routeTitles = Object.fromEntries(
  allItems.map((item) => [item.to, item.label]),
);

const routeTones = Object.fromEntries(
  allItems.map((item) => [item.to, item.tone]),
);

const sensitiveAdminRoutes = new Set([
  '/admin/administrators',
  '/admin/team-chat',
  '/admin/settings',
]);

function getLocationPath(location) {
  return `${location.pathname}${location.search || ''}${location.hash || ''}`;
}

function isRouteActive(pathname, to) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

function AdminNavLink({
  item,
  className,
  children,
  onClick,
}) {
  const Icon = item.icon;
  const location = useLocation();
  const { isArabic, t } = useUserExperience();
  const sensitiveReturnState =
    sensitiveAdminRoutes.has(item.to) &&
      !isRouteActive(location.pathname, item.to)
      ? { sensitiveReturnTo: getLocationPath(location) }
      : undefined;

  return (
    <NavLink
      to={item.to}
      state={sensitiveReturnState}
      className={({ isActive }) =>
        `${className} tone-${item.tone}${isActive ? ' is-active' : ''}`
      }
      onMouseEnter={() => preloadAdminRoute(item.to)}
      onFocus={() => preloadAdminRoute(item.to)}
      onClick={onClick}
    >
      {children || (
        <>
          <Icon size={16} />
          <span>{isArabic && item.navLabelAr ? item.navLabelAr : t(item.label)}</span>
        </>
      )}
    </NavLink>
  );
}

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const headerRef = useRef(null);
  const { isArabic, isDark, t } = useUserExperience();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState('');
  const [search, setSearch] = useState('');
  const [user, setUser] = useState(() => getStoredUser() || {});
  const [teamChatUnread, setTeamChatUnread] = useState(0);
  const [teamChatNotice, setTeamChatNotice] = useState(null);

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

  useEffect(() => {
    setMobileOpen(false);
    setOpenGroup('');
  }, [location.pathname]);

  useEffect(() => preloadPrimaryAdminRoutes(), []);

  useEffect(() => {
    if (role !== 'ADMIN' || !getAccessToken()) {
      setTeamChatUnread(0);
      setTeamChatNotice(null);
      return undefined;
    }

    let active = true;

    const refreshUnread = async ({ announce = false } = {}) => {
      try {
        const summary = await adminTeamChatApi.unreadSummary();
        if (!active) return;

        const total = Number(summary?.unreadCount || 0);
        const latest = summary?.latestMessage || null;

        setTeamChatUnread(total);

        if (total === 0) {
          setTeamChatNotice(null);
          return;
        }

        if (announce) {
          setTeamChatNotice({
            senderName:
              latest?.sender?.fullName ||
              'Administrator',
            preview: latest?.content || '',
            total,
          });
        }
      } catch { }
    };

    const socket = createAdminTeamChatSocket();

    const onMessage = (message) => {
      if (!message?.conversationId || message.senderId === user.id) {
        return;
      }

      setTeamChatUnread((current) => current + 1);
      setTeamChatNotice({
        senderName: message.sender?.fullName || 'Administrator',
        preview: message.content || '',
        total: null,
      });
    };

    const onConversation = () => {
      void refreshUnread();
    };

    const onRead = (payload) => {
      if (!payload?.userId || payload.userId === user.id) {
        void refreshUnread();
      }
    };

    const onMessageDeleted = (payload) => {
      if (payload?.scope === 'everyone' || payload?.userId === user.id) {
        void refreshUnread();
      }
    };

    socket.on('admin-chat:message', onMessage);
    socket.on('admin-chat:conversation', onConversation);
    socket.on('admin-chat:read', onRead);
    socket.on('admin-chat:message-deleted', onMessageDeleted);

    void refreshUnread({ announce: true });

    return () => {
      active = false;
      socket.off('admin-chat:message', onMessage);
      socket.off('admin-chat:conversation', onConversation);
      socket.off('admin-chat:read', onRead);
      socket.off('admin-chat:message-deleted', onMessageDeleted);
      socket.disconnect();
    };
  }, [role, user.id]);

  useEffect(() => {
    if (!teamChatNotice) return undefined;

    const timer = window.setTimeout(() => {
      setTeamChatNotice(null);
    }, 4500);

    return () => window.clearTimeout(timer);
  }, [teamChatNotice]);

  useEffect(() => {
    const syncUser = (event) =>
      setUser(event.detail || getStoredUser() || {});

    const syncAuthSession = (event) => {
      const nextUser = event.detail?.user || getStoredUser() || {};

      if (!event.detail?.user) {
        disconnectAdminTeamChatSocket();
      }

      setUser(nextUser);
    };

    window.addEventListener(
      'nexora:user-updated',
      syncUser,
    );

    window.addEventListener(
      'nexora:auth-session-changed',
      syncAuthSession,
    );

    return () => {
      window.removeEventListener(
        'nexora:user-updated',
        syncUser,
      );

      window.removeEventListener(
        'nexora:auth-session-changed',
        syncAuthSession,
      );
    };
  }, []);

  useEffect(() => {
    const onExpired = () => {
      disconnectAdminTeamChatSocket();
      navigate('/login', { replace: true });
    };

    window.addEventListener(
      'nexora:session-expired',
      onExpired,
    );

    return () =>
      window.removeEventListener(
        'nexora:session-expired',
        onExpired,
      );
  }, [navigate]);

  useEffect(() => {
    const closeMenus = (event) => {
      if (
        headerRef.current &&
        !headerRef.current.contains(event.target)
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

  const title =
    routeTitles[location.pathname] ||
    'Admin workspace';

  const tone =
    routeTones[location.pathname] ||
    'dashboard';

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
    user.avatarUrl ||
    user.profileImageUrl ||
    user.avatar ||
    '',
  );

  const signOut = () => {
    disconnectAdminTeamChatSocket();
    clearAuthSession();

    navigate('/login', {
      replace: true,
    });
  };

  const submitSearch = (event) => {
    event.preventDefault();

    window.dispatchEvent(
      new CustomEvent('voxidence:admin-search', {
        detail: search.trim(),
      }),
    );
  };

  const profileOpen = openGroup === 'profile';

  return (
    <div className={`admin-shell admin-theme-${tone}${isArabic ? ' admin-shell--rtl' : ''}${isDark ? ' admin-shell--dark' : ''}`} dir={isArabic ? 'rtl' : 'ltr'}>
      <div
        className="admin-shell__backdrop"
        aria-hidden="true"
      />

      <header className="admin-header" ref={headerRef}>
        <div className="admin-header__bar">
          <button
            className="admin-icon-btn admin-header__mobile-menu"
            type="button"
            onClick={() =>
              setMobileOpen((value) => !value)
            }
            aria-label={
              mobileOpen
                ? t('Close admin navigation')
                : t('Open admin navigation')
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
            aria-label={t('Open admin command center')}
          >
            <VoxidenceMark size={46} />

            <span className="admin-brand__copy">
              <strong>Voxidence</strong>
            </span>
          </button>

          <nav
            className="admin-topnav"
            aria-label={t('Admin navigation')}
          >
            <AdminNavLink
              item={dashboardItem}
              className="admin-topnav__link admin-topnav__link--overview"
            />

            {navigationGroups.map((group) => {
              const GroupIcon = group.icon;
              const groupActive = group.items.some((item) =>
                isRouteActive(location.pathname, item.to),
              );
              const groupOpen = openGroup === group.key;

              return (
                <div
                  key={group.key}
                  className={`admin-topnav__dropdown${groupActive ? ' is-active' : ''}${groupOpen ? ' is-open' : ''}`}
                >
                  <button
                    type="button"
                    className="admin-topnav__category"
                    onClick={() =>
                      setOpenGroup((current) =>
                        current === group.key ? '' : group.key,
                      )
                    }
                    aria-haspopup="menu"
                    aria-expanded={groupOpen}
                  >
                    <GroupIcon size={16} />
                    <span>{isArabic && group.navLabelAr ? group.navLabelAr : t(group.navLabel)}</span>

                    {group.key === 'people' && teamChatUnread > 0 ? (
                      <b className="admin-topnav__group-badge">
                        {teamChatUnread > 99 ? '99+' : teamChatUnread}
                      </b>
                    ) : null}

                    <ChevronDown
                      className="admin-topnav__chevron"
                      size={13}
                    />
                  </button>

                  <div
                    className="admin-category-menu"
                    role="menu"
                  >
                    <div className="admin-category-menu__head">
                      <span>{t('Admin category')}</span>
                      <strong>{t(group.label)}</strong>
                      <small>{group.items.length} {t('workspaces')}</small>
                    </div>

                    <div className="admin-category-menu__items">
                      {group.items.map((item) => {
                        const Icon = item.icon;

                        return (
                          <AdminNavLink
                            key={item.to}
                            item={item}
                            className="admin-category-menu__link"
                            onClick={() => setOpenGroup('')}
                          >
                            <span className="admin-category-menu__icon">
                              <Icon size={16} />
                            </span>

                            <span className="admin-category-menu__copy">
                              <strong>{t(item.label)}</strong>
                              <small>{t('Open workspace')}</small>
                            </span>

                            {item.to === '/admin/team-chat' &&
                              teamChatUnread > 0 ? (
                              <b className="admin-topnav__menu-badge">
                                {teamChatUnread > 99 ? '99+' : teamChatUnread}
                              </b>
                            ) : null}
                          </AdminNavLink>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </nav>

          <form
            className="admin-global-search"
            onSubmit={submitSearch}
          >
            <Search size={16} />

            <input
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              placeholder={
                isArabic
                  ? `ابحث في ${t(title)}…`
                  : `Search ${title.toLowerCase()}…`
              }
            />

            <kbd>↵</kbd>
          </form>

          <NavLink
            to={alertItem.to}
            className={({ isActive }) =>
              `admin-header__alert tone-alerts${isActive ? ' is-active' : ''}`
            }
            onMouseEnter={() =>
              preloadAdminRoute(alertItem.to)
            }
            onFocus={() =>
              preloadAdminRoute(alertItem.to)
            }
            aria-label={t('Open alerts')}
            title={t('Alerts')}
          >
            <BellRing size={18} />
          </NavLink>

          <div
            className={`admin-profile-menu${profileOpen ? ' is-open' : ''}`}
          >
            <button
              className="admin-profile-pill"
              type="button"
              onClick={() =>
                setOpenGroup((current) =>
                  current === 'profile' ? '' : 'profile',
                )
              }
              title={t('Administrator menu')}
              aria-haspopup="menu"
              aria-expanded={profileOpen}
            >
              <span className="admin-profile-pill__avatar">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" />
                ) : (
                  initials
                )}
              </span>

              <span className="admin-profile-pill__copy">
                <strong>
                  {user.fullName ||
                    user.name ||
                    t('Administrator')}
                </strong>

                <small>{t('Administrator')}</small>
              </span>

              <ChevronDown
                className="admin-profile-pill__chevron"
                size={14}
              />
            </button>

            <div
              className="admin-profile-menu__dropdown"
              role="menu"
            >
              <div className="admin-profile-menu__summary">
                <span className="admin-profile-pill__avatar admin-profile-pill__avatar--large">
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
                      t('Administrator')}
                  </strong>
                  <small>
                    {user.email || t('Admin account')}
                  </small>
                </div>
              </div>

              <AdminNavLink
                item={accountItem}
                className="admin-profile-menu__item"
              >
                <UserRound size={16} />
                <span>{t('Profile & security')}</span>
              </AdminNavLink>

              <button
                className="admin-profile-menu__item admin-profile-menu__signout"
                type="button"
                onClick={signOut}
              >
                <LogOut size={16} />
                <span>{t('Sign out')}</span>
              </button>
            </div>
          </div>
        </div>

        <div
          className={`admin-mobile-panel${mobileOpen ? ' is-open' : ''}`}
        >
          <form
            className="admin-mobile-search"
            onSubmit={submitSearch}
          >
            <Search size={16} />
            <input
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              placeholder={t('Search this workspace…')}
            />
          </form>

          <div className="admin-mobile-panel__scroll">
            {mobileGroups.map((group) => (
              <section
                key={group.label}
                className="admin-mobile-group"
              >
                <h3>{t(group.label)}</h3>

                <div className="admin-mobile-group__items">
                  {group.items.map((item) => {
                    const Icon = item.icon;

                    return (
                      <AdminNavLink
                        key={item.to}
                        item={item}
                        className="admin-mobile-link"
                        onClick={() => setMobileOpen(false)}
                      >
                        <span className="admin-mobile-link__icon">
                          <Icon size={17} />
                        </span>

                        <span>{t(item.label)}</span>

                        {item.to === '/admin/team-chat' &&
                          teamChatUnread > 0 ? (
                          <b className="admin-topnav__menu-badge">
                            {teamChatUnread > 99 ? '99+' : teamChatUnread}
                          </b>
                        ) : null}
                      </AdminNavLink>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>

          <div className="admin-mobile-panel__footer">
            <AdminNavLink
              item={accountItem}
              className="admin-mobile-footer-link"
              onClick={() => setMobileOpen(false)}
            />

            <button
              type="button"
              className="admin-mobile-footer-link admin-mobile-footer-link--signout"
              onClick={signOut}
            >
              <LogOut size={16} />
              <span>{t('Sign out')}</span>
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
          aria-label={t('Close navigation')}
        />
      )}

      {teamChatNotice ? (
        <div className="admin-team-chat-notice" role="status">
          <button
            type="button"
            className="admin-team-chat-notice__content"
            onClick={() => {
              setTeamChatNotice(null);
              navigate('/admin/team-chat', {
                state: {
                  sensitiveReturnTo: getLocationPath(location),
                },
              });
            }}
          >
            <span className="admin-team-chat-notice__icon">
              <MessageCircleMore size={18} />
            </span>

            <span className="admin-team-chat-notice__copy">
              <strong>{t('New team message')}</strong>
              <span>
                {teamChatNotice.senderName}
                {teamChatNotice.preview
                  ? `: ${teamChatNotice.preview}`
                  : ` ${t('sent you a message.')}`}
              </span>
              {teamChatUnread > 1 ? (
                <small>{teamChatUnread} {t('unread messages')}</small>
              ) : null}
            </span>
          </button>

          <button
            type="button"
            className="admin-team-chat-notice__close"
            onClick={() => setTeamChatNotice(null)}
            aria-label={t('Dismiss team chat notification')}
          >
            <X size={15} />
          </button>
        </div>
      ) : null}

      <div className="admin-workspace">
        <main className="admin-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}