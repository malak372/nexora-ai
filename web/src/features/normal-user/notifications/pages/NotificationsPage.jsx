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
 * @author Eman
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
  X,
  ExternalLink,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  WalletCards,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useUserExperience } from '../../../../system/user-experience';
import NormalPageHero from '../../shared/components/NormalPageHero';
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
  CREDIT_LOW: {
    icon: WalletCards,
    label: 'Credits',
    className: 'is-payment',
    description: 'Low credit balance warning',
  },
  CREDIT_EXHAUSTED: {
    icon: WalletCards,
    label: 'Credits',
    className: 'is-payment',
    description: 'Credit balance exhausted',
  },
  SECURITY: {
    icon: ShieldCheck,
    label: 'Security',
    className: 'is-security',
    description: 'Account and security notices',
  },
  ADMIN: {
    icon: ShieldCheck,
    label: 'Admin',
    className: 'is-system',
    description: 'Administrator and moderation notices',
  },
  SYSTEM: {
    icon: Bell,
    label: 'System',
    className: 'is-system',
    description: 'General system updates',
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

function formatDate(value, locale = 'en') {
  if (!value) {
    return locale === 'ar' ? 'الآن' : 'Just now';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return locale === 'ar' ? 'مؤخرًا' : 'Recently';
  }

  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function localizeNotificationMessage(message, t, isArabic) {
  const text = String(message || '').trim();
  if (!text) return t('A new Voxidence update is ready.');
  if (!isArabic) return text;

  const generatedIdeaMatch = text.match(/^Your new idea(?:\s+[“"](.+?)[”"])?\s+has been created successfully\.\s+Open My Ideas to review it\.$/i);
  if (generatedIdeaMatch) {
    const title = generatedIdeaMatch[1] ? ` ⁦${generatedIdeaMatch[1]}⁩` : '';
    return `تم إنشاء فكرتك الجديدة${title} بنجاح. افتح «أفكاري» لمراجعتها.`;
  }

  return t(text);
}

export default function NotificationsPage() {
  const navigate = useNavigate();
  const { t, isArabic } = useUserExperience();
  const locale = isArabic ? 'ar' : 'en';

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeFilter, setActiveFilter] = useState('ALL');
  const [readFilter, setReadFilter] = useState('ALL');
  const [busyId, setBusyId] = useState('');
  const [markingAll, setMarkingAll] = useState(false);
  const [selectedNotification, setSelectedNotification] = useState(null);

  const load = useCallback(async ({ quiet = false, forceRefresh = false } = {}) => {
    try {
      if (!quiet) setLoading(true);
      setError('');

      const result = await getNotifications(
        {
          page: 1,
          limit: 100,
          sortBy: 'createdAt',
          sortOrder: 'desc',
        },
        { forceRefresh },
      );

      setItems(result.items ?? []);
    } catch (requestError) {
      const networkMessage = requestError?.isNetworkError
        ? 'Could not reach the backend. Make sure the Nest server is running on port 3000, then try again.'
        : '';

      setError(
        networkMessage ||
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

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        void load({ quiet: true, forceRefresh: true });
      }
    };

    const intervalId = window.setInterval(refresh, 10000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
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
    return items.filter((item) => {
      const categoryMatches =
        activeFilter === 'ALL' ||
        getMeta(item.type).label.toUpperCase() === activeFilter;

      const readMatches =
        readFilter === 'ALL' ||
        (readFilter === 'READ' && item.isRead) ||
        (readFilter === 'UNREAD' && !item.isRead);

      return categoryMatches && readMatches;
    });
  }, [activeFilter, items, readFilter]);

  const readOne = async (item) => {
    setSelectedNotification(item);

    if (item.isRead) {
      return;
    }

    try {
      setBusyId(item.id);
      setItems((current) =>
        current.map((row) =>
          row.id === item.id ? { ...row, isRead: true } : row,
        ),
      );
      setSelectedNotification((current) =>
        current?.id === item.id ? { ...current, isRead: true } : current,
      );
      await markNotificationRead(item.id);
    } catch (requestError) {
      setItems((current) =>
        current.map((row) =>
          row.id === item.id ? { ...row, isRead: false } : row,
        ),
      );
      setSelectedNotification((current) =>
        current?.id === item.id ? { ...current, isRead: false } : current,
      );
      setError(requestError?.message || 'The notification could not be marked as read.');
    } finally {
      setBusyId('');
    }
  };

  const closeDetails = () => setSelectedNotification(null);

  const openRelatedPage = () => {
    const destination =
      selectedNotification?.actionUrl ||
      selectedNotification?.link ||
      selectedNotification?.metadata?.url;

    if (destination) {
      setSelectedNotification(null);
      navigate(destination);
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
        <NormalPageHero
          variant="notifications"
          eyebrow={t('Notification center')}
          title={t('Updates that keep your Voxidence work moving.')}
          description={t('Review generation, publishing, payment, feedback, and account activity without losing the context behind each update.')}
          chips={[t('Live activity'), t('Focused filters'), t('Account-aware updates')]}
          stats={[
            { label: t('Unread'), value: unreadCount },
            { label: t('Total'), value: items.length },
          ]}
          compact
        />

        <div className="notifications-toolbar">
          <nav
            className="notifications-filters"
            aria-label={t('Notification categories')}
          >
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                className={activeFilter === category ? 'is-active' : ''}
                onClick={() => setActiveFilter(category)}
              >
                {t(category === 'ALL' ? 'All' : category.charAt(0) + category.slice(1).toLowerCase())}
              </button>
            ))}
          </nav>

          <nav
            className="notifications-read-filters"
            aria-label={t('Read status')}
          >
            {['ALL', 'UNREAD', 'READ'].map((filter) => (
              <button
                key={filter}
                type="button"
                className={readFilter === filter ? 'is-active' : ''}
                onClick={() => setReadFilter(filter)}
              >
                {t(filter === 'ALL' ? 'All status' : filter === 'UNREAD' ? 'Unread' : 'Read')}
              </button>
            ))}
          </nav>

          <span className="notifications-toolbar__result">
            {visibleItems.length}{' '}
            {t(visibleItems.length === 1 ? 'notification' : 'notifications')}
          </span>
        </div>

        <div className="notifications-panel-actions">
          <div>
            <span>{t('Activity controls')}</span>
            <p>{t('Refresh the feed or clear every unread notification.')}</p>
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
              {t('Refresh')}
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
              {t('Mark all read')}
            </button>
          </div>
        </div>

        <section className="notifications-panel">
          <div className="notifications-panel__heading">
            <div>
              <span>{t('Activity stream')}</span>
              <h2>
                {readFilter === 'ALL' && activeFilter === 'ALL'
                  ? t('All notifications')
                  : isArabic
                    ? t('Filtered notifications')
                    : `${
                        readFilter === 'ALL' ? '' : `${readFilter.toLowerCase()} `
                      }${
                        activeFilter === 'ALL'
                          ? 'notifications'
                          : `${activeFilter.toLowerCase()} notifications`
                      }`}
              </h2>
            </div>

            <span className="notifications-panel__status">
              <i aria-hidden="true" />
              {t('Live activity')}
            </span>
          </div>

          {loading ? (
            <div className="notifications-state">
              <LoaderCircle className="spin" size={28} />
              <h3>{t('Loading your activity')}</h3>
              <p>{t('Gathering your latest Voxidence updates.')}</p>
            </div>
          ) : error ? (
            <div className="notifications-state notifications-state--error">
              <RefreshCw size={28} />
              <h3>{t('Notifications unavailable')}</h3>
              <p>{error}</p>
              <button type="button" onClick={load}>
                {t('Try again')}
              </button>
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="notifications-state">
              <Inbox size={30} />
              <h3>{t('Nothing in this view')}</h3>
              <p>{t('New activity will appear here automatically.')}</p>
            </div>
          ) : (
            <div className="notifications-list">
              {visibleItems.map((item, index) => {
                const meta = getMeta(item.type);
                const Icon = meta.icon;
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
                          {t(meta.label)}
                        </span>

                        <span className="notification-row__time">
                          <Clock3 size={13} />
                          {formatDate(item.createdAt, locale)}
                        </span>
                      </span>

                      <strong>{t(item.title || meta.label)}</strong>

                      <span className="notification-row__message">
                        {localizeNotificationMessage(item.message, t, isArabic)}
                      </span>

                      <small>{t(meta.description)}</small>
                    </span>

                    <span className="notification-row__end">
                      {!item.isRead && (
                        <i
                          className="notification-row__unread"
                          aria-label="Unread"
                        />
                      )}

                      <span className="notification-row__open" aria-hidden="true">
                        {t('View message')}
                        <ChevronRight size={15} />
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </section>
      {selectedNotification && (() => {
        const selectedMeta = getMeta(selectedNotification.type);
        const SelectedIcon = selectedMeta.icon;
        const destination = selectedNotification.actionUrl || selectedNotification.link || selectedNotification.metadata?.url;
        const isAdminMessage = selectedMeta.label === 'Admin';

        return createPortal(
          <div
            className="notification-detail-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeDetails();
            }}
          >
            <section
              className={`notification-detail ${selectedMeta.className} ${isAdminMessage ? 'is-admin-message' : ''}`}
              role="dialog"
              aria-modal="true"
              aria-labelledby="notification-detail-title"
            >
              <button
                type="button"
                className="notification-detail__close"
                onClick={closeDetails}
                aria-label={t('Close notification')}
              >
                <X size={18} />
              </button>

              <div className="notification-detail__topbar">
                <span className="notification-detail__icon" aria-hidden="true">
                  <SelectedIcon size={21} />
                </span>
                <div className="notification-detail__identity">
                  <div>
                    <span className="notification-detail__category">{t(selectedMeta.label)}</span>
                    <span className={`notification-detail__read-state ${selectedNotification.isRead ? 'is-read' : 'is-unread'}`}>
                      {t(selectedNotification.isRead ? 'Read' : 'Unread')}
                    </span>
                  </div>
                  <span className="notification-detail__date">
                    <Clock3 size={13} /> {formatDate(selectedNotification.createdAt, locale)}
                  </span>
                </div>
              </div>

              <div className="notification-detail__content">
                <section className="notification-detail__hero">
                  <div className="notification-detail__hero-copy">
                    <span className="notification-detail__eyebrow">
                      <MessageSquareText size={14} /> {t(isAdminMessage ? 'Administrator message' : 'Voxidence update')}
                    </span>
                    <h2 id="notification-detail-title">
                      {t(selectedNotification.title || selectedMeta.label)}
                    </h2>
                    <p>
                      {t(isAdminMessage ? 'A direct notice from the Voxidence moderation team.' : selectedMeta.description)}
                    </p>
                  </div>
                  <div className="notification-detail__hero-mark" aria-hidden="true">
                    <span><SelectedIcon size={22} /></span>
                    <i />
                  </div>
                </section>

                <article className="notification-detail__letter">
                  <div className="notification-detail__letter-head">
                    <span aria-hidden="true">
                      {isAdminMessage ? <ShieldCheck size={17} /> : <SelectedIcon size={17} />}
                    </span>
                    <div>
                      <small>{t(isAdminMessage ? 'Voxidence moderation' : selectedMeta.label)}</small>
                      <strong>{t(isAdminMessage ? 'In-app message sent specifically to your account' : selectedMeta.description)}</strong>
                    </div>
                    <em>{t('IN APP')}</em>
                  </div>
                  <p dir="auto" data-no-auto-translate="true">{localizeNotificationMessage(selectedNotification.message, t, isArabic)}</p>
                  <div className="notification-detail__letter-foot">
                    <span><Clock3 size={12} /> {t('Delivered')} {formatDate(selectedNotification.createdAt, locale)}</span>
                    <span><ShieldCheck size={12} /> {t('Verified Voxidence notice')}</span>
                  </div>
                </article>
              </div>

              <footer className="notification-detail__actions">
                <div>
                  <span>{t(isAdminMessage ? 'Administrator & moderation notice' : selectedMeta.description)}</span>
                  <small>{t(selectedNotification.isRead ? 'Already read' : 'Marked as read when opened')}</small>
                </div>
                <div>
                  {destination ? (
                    <button type="button" className="is-primary" onClick={openRelatedPage}>
                      {t('Open related page')} <ExternalLink size={14} />
                    </button>
                  ) : null}
                  <button type="button" className="is-secondary" onClick={closeDetails}>{t('Close')}</button>
                </div>
              </footer>
            </section>
          </div>,
          document.body,
        );
      })()}
    </main>
  );
}