/**
 * Normal-user notification center backed by /users/notifications.
 *
 * The page presents a refined activity inbox with:
 * - animated summary cards
 * - category filtering
 * - panel-level actions
 * - elegant notification rows
 * - responsive mobile behavior
 *
 * @author Malak
 */

import {
  Bell,
  CheckCheck,
  ChevronRight,
  Clock3,
  CreditCard,
  Inbox,
  Lightbulb,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  WalletCards,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../api/notificationsApi';
import '../styles/notifications.css';

const TYPE_META = {
  GENERATION: {
    icon: Sparkles,
    label: 'Generation',
    className: 'is-generation',
    description: 'AI generation workflow updates',
  },
  IDEA: {
    icon: Lightbulb,
    label: 'Idea',
    className: 'is-idea',
    description: 'Changes related to your ideas',
  },
  PUBLICATION: {
    icon: Send,
    label: 'Publication',
    className: 'is-publication',
    description: 'Publishing and moderation updates',
  },
  FEEDBACK: {
    icon: MessageSquareText,
    label: 'Feedback',
    className: 'is-feedback',
    description: 'Comments and audience responses',
  },
  PAYMENT: {
    icon: CreditCard,
    label: 'Payment',
    className: 'is-payment',
    description: 'Payment and checkout activity',
  },
  CREDITS: {
    icon: WalletCards,
    label: 'Credits',
    className: 'is-payment',
    description: 'Credit balance updates',
  },
  SECURITY: {
    icon: ShieldCheck,
    label: 'Security',
    className: 'is-security',
    description: 'Account and security notices',
  },
};

function getMeta(type = '') {
  const key = String(type).toUpperCase();

  return (
    TYPE_META[key] || {
      icon: Bell,
      label: key.replaceAll('_', ' ') || 'Update',
      className: 'is-system',
      description: 'General Voxidence activity',
    }
  );
}

function formatDate(value) {
  if (!value) {
    return 'Just now';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Recently';
  }

  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export default function NotificationsPage() {
  const navigate = useNavigate();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeFilter, setActiveFilter] = useState('ALL');
  const [busyId, setBusyId] = useState('');
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      const result = await getNotifications({
        page: 1,
        limit: 50,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });

      setItems(result.items ?? []);
    } catch (requestError) {
      setError(
        requestError?.response?.data?.message ||
          requestError?.message ||
          'Unable to load notifications.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const unreadCount = useMemo(
    () => items.filter((item) => !item.isRead).length,
    [items],
  );

  const categories = useMemo(() => {
    const uniqueCategories = new Set(
      items.map((item) => getMeta(item.type).label.toUpperCase()),
    );

    return ['ALL', ...uniqueCategories];
  }, [items]);

  const visibleItems = useMemo(() => {
    if (activeFilter === 'ALL') {
      return items;
    }

    return items.filter(
      (item) => getMeta(item.type).label.toUpperCase() === activeFilter,
    );
  }, [activeFilter, items]);

  const readOne = async (item) => {
    try {
      setBusyId(item.id);

      if (!item.isRead) {
        await markNotificationRead(item.id);

        setItems((current) =>
          current.map((row) =>
            row.id === item.id ? { ...row, isRead: true } : row,
          ),
        );
      }

      const destination =
        item.actionUrl || item.link || item.metadata?.url;

      if (destination) {
        navigate(destination);
      }
    } finally {
      setBusyId('');
    }
  };

  const readAll = async () => {
    try {
      setMarkingAll(true);
      await markAllNotificationsRead();

      setItems((current) =>
        current.map((row) => ({ ...row, isRead: true })),
      );
    } finally {
      setMarkingAll(false);
    }
  };

  return (
    <main className="notifications-page reveal-page">
      <section className="notifications-shell">
        <header className="notifications-command">
          <div className="notifications-command__identity">
            <span className="notifications-command__icon" aria-hidden="true">
              <Bell size={20} />
            </span>

            <div>
              <span className="notifications-command__eyebrow">
                Notification center
              </span>

              <h1>Your updates, clearly organized.</h1>

              <p>
                Review important activity across ideas, publishing, payments,
                feedback, and account security.
              </p>
            </div>
          </div>

          <div className="notifications-command__summary">
            <article>
              <span>Unread</span>
              <strong>{unreadCount}</strong>
              <i aria-hidden="true" />
            </article>

            <article>
              <span>Total</span>
              <strong>{items.length}</strong>
              <i aria-hidden="true" />
            </article>
          </div>
        </header>

        <div className="notifications-toolbar">
          <nav
            className="notifications-filters"
            aria-label="Notification categories"
          >
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                className={activeFilter === category ? 'is-active' : ''}
                onClick={() => setActiveFilter(category)}
              >
                {category}
              </button>
            ))}
          </nav>

          <span className="notifications-toolbar__result">
            {visibleItems.length}{' '}
            {visibleItems.length === 1 ? 'notification' : 'notifications'}
          </span>
        </div>

        <div className="notifications-panel-actions">
          <div>
            <span>Activity controls</span>
            <p>Refresh the feed or clear every unread notification.</p>
          </div>

          <div className="notifications-panel-actions__buttons">
            <button
              type="button"
              className="notifications-action notifications-action--quiet"
              onClick={load}
              disabled={loading}
            >
              <RefreshCw
                size={16}
                className={loading ? 'spin' : undefined}
              />
              Refresh
            </button>

            <button
              type="button"
              className="notifications-action notifications-action--primary"
              onClick={readAll}
              disabled={!unreadCount || markingAll}
            >
              {markingAll ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <CheckCheck size={16} />
              )}
              Mark all read
            </button>
          </div>
        </div>

        <section className="notifications-panel">
          <div className="notifications-panel__heading">
            <div>
              <span>Activity stream</span>
              <h2>
                {activeFilter === 'ALL'
                  ? 'All notifications'
                  : `${activeFilter.toLowerCase()} notifications`}
              </h2>
            </div>

            <span className="notifications-panel__status">
              <i aria-hidden="true" />
              Live activity
            </span>
          </div>

          {loading ? (
            <div className="notifications-state">
              <LoaderCircle className="spin" size={28} />
              <h3>Loading your activity</h3>
              <p>Gathering your latest Voxidence updates.</p>
            </div>
          ) : error ? (
            <div className="notifications-state notifications-state--error">
              <RefreshCw size={28} />
              <h3>Notifications unavailable</h3>
              <p>{error}</p>
              <button type="button" onClick={load}>
                Try again
              </button>
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="notifications-state">
              <Inbox size={30} />
              <h3>Nothing in this view</h3>
              <p>New activity will appear here automatically.</p>
            </div>
          ) : (
            <div className="notifications-list">
              {visibleItems.map((item, index) => {
                const meta = getMeta(item.type);
                const Icon = meta.icon;
                const destination =
                  item.actionUrl || item.link || item.metadata?.url;
                const isBusy = busyId === item.id;

                return (
                  <button
                    key={item.id}
                    type="button"
                    className={[
                      'notification-row',
                      item.isRead ? 'is-read' : 'is-unread',
                      meta.className,
                    ].join(' ')}
                    style={{ '--notification-index': index }}
                    onClick={() => readOne(item)}
                    disabled={isBusy}
                  >
                    <span
                      className="notification-row__rail"
                      aria-hidden="true"
                    />

                    <span
                      className="notification-row__icon"
                      aria-hidden="true"
                    >
                      {isBusy ? (
                        <LoaderCircle size={20} className="spin" />
                      ) : (
                        <Icon size={20} />
                      )}
                    </span>

                    <span className="notification-row__content">
                      <span className="notification-row__meta">
                        <span className="notification-row__category">
                          {meta.label}
                        </span>

                        <span className="notification-row__time">
                          <Clock3 size={13} />
                          {formatDate(item.createdAt)}
                        </span>
                      </span>

                      <strong>{item.title || meta.label}</strong>

                      <span className="notification-row__message">
                        {item.message || 'A new Voxidence update is ready.'}
                      </span>

                      <small>{meta.description}</small>
                    </span>

                    <span className="notification-row__end">
                      {!item.isRead && (
                        <i
                          className="notification-row__unread"
                          aria-label="Unread"
                        />
                      )}

                      {destination && (
                        <span
                          className="notification-row__open"
                          aria-hidden="true"
                        >
                          Open
                          <ChevronRight size={15} />
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}