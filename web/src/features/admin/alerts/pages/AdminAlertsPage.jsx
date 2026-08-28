import {
  ArrowDown,
  ArrowUp,
  Bell,
  BellRing,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  Eye,
  Inbox,
  LoaderCircle,
  Mail,
  MessageSquareText,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useUserExperience } from '../../../../system/user-experience';
import { adminApi, getApiErrorMessage } from '../../shared/api/adminApi';
import '../../shared/styles/admin-pages.css';
import '../styles/admin-alerts.css';

const PAGE_SIZE = 20;

const TYPE_OPTIONS = [
  { key: '', label: 'All categories' },
  { key: 'ADMIN', label: 'Admin notices' },
  { key: 'SYSTEM', label: 'System' },
  { key: 'PAYMENT', label: 'Payment' },
  { key: 'CREDIT_LOW', label: 'Credit low' },
  { key: 'CREDIT_EXHAUSTED', label: 'Credits exhausted' },
];

const SORT_OPTIONS = [
  { key: 'createdAt', label: 'Newest activity' },
  { key: 'title', label: 'Title' },
  { key: 'type', label: 'Category' },
  { key: 'isRead', label: 'Read status' },
];

const STATUS_TABS = [
  { key: 'all', label: 'All alerts' },
  { key: 'unread', label: 'Unread' },
  { key: 'read', label: 'Read' },
];

const CHANNEL_OPTIONS = [
  { key: '', label: 'All channels' },
  { key: 'IN_APP', label: 'In-app only' },
  { key: 'EMAIL', label: 'Email only' },
  { key: 'BOTH', label: 'In-app + email' },
];

const AUDIENCE_OPTIONS = [
  { key: '', label: 'All audiences' },
  { key: 'SELECTED', label: 'Selected users' },
  { key: 'BROADCAST', label: 'Broadcasts' },
];

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unwrapRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!isObject(payload)) return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.alerts)) return payload.alerts;

  if (isObject(payload.data)) {
    if (Array.isArray(payload.data.data)) return payload.data.data;
    if (Array.isArray(payload.data.items)) return payload.data.items;
    if (Array.isArray(payload.data.alerts)) return payload.data.alerts;
  }

  return [];
}

function unwrapMeta(payload, count) {
  const source =
    payload?.meta ||
    payload?.pagination ||
    payload?.data?.meta ||
    payload?.data?.pagination ||
    {};

  const total = Number(source.total ?? source.totalItems ?? payload?.total ?? count) || 0;
  const page = Number(source.page ?? source.currentPage ?? 1) || 1;
  const limit = Number(source.limit ?? source.pageSize ?? PAGE_SIZE) || PAGE_SIZE;
  const totalPages = Math.max(
    1,
    Number(source.totalPages ?? source.pages ?? Math.ceil(total / Math.max(1, limit))) || 1,
  );

  return { total, page, limit, totalPages };
}

function unwrapSummary(payload) {
  if (!isObject(payload)) return {};
  return isObject(payload.data) ? payload.data : payload;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatShortDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function titleCase(value) {
  return String(value || 'SYSTEM')
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function toStartOfDayIso(value) {
  if (!value) return undefined;
  return new Date(`${value}T00:00:00`).toISOString();
}

function toEndOfDayIso(value) {
  if (!value) return undefined;
  return new Date(`${value}T23:59:59.999`).toISOString();
}

function statusFilter(tab) {
  if (tab === 'read') return true;
  if (tab === 'unread') return false;
  return undefined;
}

function alertTone(type) {
  switch (type) {
    case 'ADMIN':
      return 'admin';
    case 'PAYMENT':
      return 'payment';
    case 'CREDIT_LOW':
    case 'CREDIT_EXHAUSTED':
      return 'credit';
    default:
      return 'system';
  }
}

function MetricCard({ icon: Icon, label, value, hint, tone = '' }) {
  return (
    <article className={`admin-alert-metric ${tone}`}>
      <i aria-hidden="true" />
      <span className="admin-alert-metric__icon"><Icon size={19} /></span>
      <div>
        <small>{label}</small>
        <strong>{Number(value || 0).toLocaleString()}</strong>
        <span>{hint}</span>
      </div>
    </article>
  );
}

function Dropdown({ label, value, options, onChange, icon: Icon }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const current = options.find((option) => option.key === value) || options[0];

  useEffect(() => {
    if (!open) return undefined;

    const close = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };

    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className={`admin-alert-dropdown ${open ? 'is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="admin-alert-dropdown__trigger"
        onClick={() => setOpen((state) => !state)}
      >
        <Icon size={15} />
        <span>
          <small>{label}</small>
          <strong>{current?.label || label}</strong>
        </span>
        <ChevronDown size={14} />
      </button>

      {open && (
        <div className="admin-alert-dropdown__menu">
          {options.map((option) => (
            <button
              type="button"
              key={option.key}
              className={value === option.key ? 'is-active' : ''}
              onClick={() => {
                onChange(option.key);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {value === option.key && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SortControl({ value, order, onChange, onToggle }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const current = SORT_OPTIONS.find((option) => option.key === value) || SORT_OPTIONS[0];

  useEffect(() => {
    if (!open) return undefined;

    const close = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };

    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className={`admin-alert-sort ${open ? 'is-open' : ''}`} ref={rootRef}>
      <button type="button" className="admin-alert-sort__main" onClick={() => setOpen((state) => !state)}>
        <Clock3 size={15} />
        <span>
          <small>Sort alerts</small>
          <strong>{current.label}</strong>
        </span>
        <ChevronDown size={14} />
      </button>

      <button
        type="button"
        className="admin-alert-sort__direction"
        onClick={onToggle}
        title={order === 'asc' ? 'Ascending' : 'Descending'}
      >
        {order === 'asc' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
      </button>

      {open && (
        <div className="admin-alert-sort__menu">
          {SORT_OPTIONS.map((option) => (
            <button
              type="button"
              key={option.key}
              className={value === option.key ? 'is-active' : ''}
              onClick={() => {
                onChange(option.key);
                setOpen(false);
              }}
            >
              {option.label}
              {value === option.key && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AlertInspector({ alert, onClose }) {
  if (!alert || typeof document === 'undefined') return null;

  return createPortal(
    <div className="admin-alert-modal-layer" role="presentation">
      <div className="admin-alert-modal-backdrop" onMouseDown={onClose} />
      <section
        className="admin-alert-inspector"
        role="dialog"
        aria-modal="true"
        aria-label="Alert details"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="admin-alert-inspector__header">
          <span className={`admin-alert-inspector__mark is-${alertTone(alert.type)}`}>
            <MessageSquareText size={21} />
          </span>
          <div>
            <small>IN-APP COMMUNICATION</small>
            <h2>{alert.title}</h2>
            <p>{formatDate(alert.createdAt)}</p>
          </div>
          <button type="button" className="admin-alert-icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="admin-alert-inspector__body">
          <section className="admin-alert-inspector__summary">
            <article>
              <span><UserRound size={15} /></span>
              <div>
                <small>Recipient</small>
                <strong>{alert.user?.fullName || 'Platform user'}</strong>
                <p>{alert.user?.email || '—'}</p>
              </div>
            </article>

            <article>
              <span><Bell size={15} /></span>
              <div>
                <small>Category</small>
                <strong>{titleCase(alert.type)}</strong>
                <p>Persisted in-app alert</p>
              </div>
            </article>

            <article>
              <span>{alert.isRead ? <CheckCircle2 size={15} /> : <Inbox size={15} />}</span>
              <div>
                <small>Delivery state</small>
                <strong>{alert.isRead ? 'Read by user' : 'Unread'}</strong>
                <p>{alert.isRead ? 'The user opened this notification.' : 'Waiting in the user notification center.'}</p>
              </div>
            </article>
          </section>

          <section className="admin-alert-message-card">
            <header>
              <span><Sparkles size={15} /></span>
              <div>
                <small>MESSAGE</small>
                <h3>Administrator communication</h3>
              </div>
            </header>
            <p>{alert.message}</p>
          </section>

          <section className="admin-alert-inspector__meta">
            <article>
              <small>Alert ID</small>
              <strong>{alert.id || '—'}</strong>
            </article>
            <article>
              <small>User ID</small>
              <strong>{alert.user?.id || '—'}</strong>
            </article>
            <article>
              <small>Created</small>
              <strong>{formatDate(alert.createdAt)}</strong>
            </article>
            <article>
              <small>Channel</small>
              <strong>In-app notification</strong>
            </article>
          </section>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function ChannelCard({ checked, onChange, icon: Icon, title, description }) {
  return (
    <button
      type="button"
      className={`admin-alert-channel ${checked ? 'is-selected' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="admin-alert-channel__icon"><Icon size={18} /></span>
      <span className="admin-alert-channel__copy">
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <span className="admin-alert-channel__check">
        {checked && <Check size={13} />}
      </span>
    </button>
  );
}

function RecipientPicker({
  scope,
  setScope,
  selectedUsers,
  setSelectedUsers,
  userSearch,
  setUserSearch,
  users,
  loadingUsers,
}) {
  const selectedIds = new Set(selectedUsers.map((user) => user.id));
  const availableUsers = users.filter((user) => !selectedIds.has(user.id));

  const addUser = (user) => {
    if (selectedIds.has(user.id) || selectedUsers.length >= 50) return;
    setSelectedUsers((current) => [...current, user]);
    setUserSearch('');
  };

  const removeUser = (userId) => {
    setSelectedUsers((current) => current.filter((user) => user.id !== userId));
  };

  return (
    <section className="admin-alert-compose-section">
      <div className="admin-alert-compose-section__heading">
        <span><UsersRound size={16} /></span>
        <div>
          <small>RECIPIENTS</small>
          <h3>Who should receive this communication?</h3>
        </div>
      </div>

      <div className="admin-alert-scope">
        <button
          type="button"
          className={scope === 'selected' ? 'is-active' : ''}
          onClick={() => setScope('selected')}
        >
          <UserRound size={15} />
          Selected users
        </button>
        <button
          type="button"
          className={scope === 'broadcast' ? 'is-active' : ''}
          onClick={() => {
            setScope('broadcast');
            setSelectedUsers([]);
            setUserSearch('');
          }}
        >
          <UsersRound size={15} />
          All active users
        </button>
      </div>

      {scope === 'selected' ? (
        <div className="admin-alert-user-picker">
          <div className="admin-alert-selected-summary">
            <div>
              <strong>{selectedUsers.length} {selectedUsers.length === 1 ? 'recipient' : 'recipients'} selected</strong>
              <span>Select up to 50 active registered users.</span>
            </div>
            {selectedUsers.length > 0 && (
              <button type="button" onClick={() => setSelectedUsers([])}>
                Clear all
              </button>
            )}
          </div>

          {selectedUsers.length > 0 && (
            <div className="admin-alert-selected-users">
              {selectedUsers.map((user) => (
                <span key={user.id} className="admin-alert-selected-chip">
                  <i>{String(user.fullName || user.email || 'U').charAt(0).toUpperCase()}</i>
                  <span>
                    <strong>{user.fullName || 'Platform user'}</strong>
                    <small>{user.email}</small>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeUser(user.id)}
                    aria-label={`Remove ${user.fullName || user.email}`}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {selectedUsers.length < 50 && (
            <>
              <label className="admin-alert-user-search">
                <Search size={16} />
                <input
                  value={userSearch}
                  onChange={(event) => setUserSearch(event.target.value)}
                  placeholder="Search another active user by name or email..."
                />
                {loadingUsers && <LoaderCircle className="admin-alert-spin" size={15} />}
              </label>

              <div className="admin-alert-user-results">
                {availableUsers.map((user) => (
                  <button
                    type="button"
                    key={user.id}
                    onClick={() => addUser(user)}
                  >
                    <span>{String(user.fullName || user.email || 'U').charAt(0).toUpperCase()}</span>
                    <div>
                      <strong>{user.fullName || 'Platform user'}</strong>
                      <small>{user.email}</small>
                    </div>
                    <CheckCircle2 size={15} />
                  </button>
                ))}

                {!loadingUsers && availableUsers.length === 0 && (
                  <div className="admin-alert-user-empty">
                    <UserRound size={19} />
                    <span>
                      {selectedUsers.length > 0
                        ? 'No additional active user matches this search.'
                        : 'No active user matches this search.'}
                    </span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="admin-alert-broadcast-note">
          <CircleAlert size={16} />
          <div>
            <strong>Broadcast delivery</strong>
            <span>This sends the selected channel(s) to every active registered user.</span>
          </div>
        </div>
      )}
    </section>
  );
}

function ComposeAlertModal({ onClose, onSent }) {
  const [scope, setScope] = useState('selected');
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [userSearch, setUserSearch] = useState('');
  const [debouncedUserSearch, setDebouncedUserSearch] = useState('');
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  const [sendInApp, setSendInApp] = useState(true);
  const [sendEmail, setSendEmail] = useState(false);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [confirmBroadcast, setConfirmBroadcast] = useState(false);

  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedUserSearch(userSearch.trim());
    }, 260);

    return () => window.clearTimeout(timer);
  }, [userSearch]);

  useEffect(() => {
    if (scope !== 'selected') return undefined;

    let cancelled = false;

    const run = async () => {
      setLoadingUsers(true);

      try {
        const result = await adminApi.users.list({
          page: 1,
          limit: 10,
          isActive: 'true',
          sortBy: 'fullName',
          sortOrder: 'asc',
          ...(debouncedUserSearch ? { search: debouncedUserSearch } : {}),
        });

        if (!cancelled) setUsers(unwrapRows(result));
      } catch {
        if (!cancelled) setUsers([]);
      } finally {
        if (!cancelled) setLoadingUsers(false);
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [scope, debouncedUserSearch]);

  useEffect(() => {
    setConfirmBroadcast(false);
  }, [scope]);

  if (typeof document === 'undefined') return null;

  const maxMessageLength = sendInApp ? 1000 : 3000;
  const channelsValid = sendInApp || sendEmail;
  const recipientValid =
    scope === 'broadcast'
      ? confirmBroadcast
      : selectedUsers.length > 0;
  const titleValid = title.trim().length >= 1 && title.trim().length <= 100;
  const messageValid = message.trim().length >= 1 && message.trim().length <= maxMessageLength;
  const canSend = channelsValid && recipientValid && titleValid && messageValid && !sending;

  const send = async () => {
    if (!canSend) return;

    setSending(true);
    setError('');

    try {
      const result = await adminApi.alerts.send({
        ...(scope === 'selected'
          ? { userIds: selectedUsers.map((user) => user.id) }
          : { broadcast: true }),
        title: title.trim(),
        message: message.trim(),
        sendInApp,
        sendEmail,
      });

      const failedEmailCount = Number(result?.delivery?.email?.failedCount || 0);

      const label =
        failedEmailCount > 0
          ? `Communication sent, but ${failedEmailCount} email ${failedEmailCount === 1 ? 'delivery failed' : 'deliveries failed'}.`
          : sendInApp && sendEmail
            ? `In-app alert and email sent to ${Number(result?.recipientCount || 0).toLocaleString()} recipients.`
            : sendInApp
              ? `In-app alert sent to ${Number(result?.recipientCount || 0).toLocaleString()} recipients.`
              : `Email sent to ${Number(result?.recipientCount || 0).toLocaleString()} recipients.`;

      await onSent(label);
      onClose();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Could not send this communication.'));
    } finally {
      setSending(false);
    }
  };

  return createPortal(
    <div className="admin-alert-modal-layer admin-alert-compose-layer" role="presentation">
      <div className="admin-alert-modal-backdrop" onMouseDown={sending ? undefined : onClose} />
      <section
        className="admin-alert-compose"
        role="dialog"
        aria-modal="true"
        aria-label="Send platform communication"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="admin-alert-compose__header">
          <span className="admin-alert-compose__mark"><Send size={21} /></span>
          <div>
            <small>ADMINISTRATOR COMMUNICATION</small>
            <h2>Send an alert</h2>
            <p>Deliver one message to selected users, or broadcast it to all active users, by in-app alert, email, or both.</p>
          </div>
          <button
            type="button"
            className="admin-alert-icon-button"
            onClick={onClose}
            disabled={sending}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </header>

        <div className="admin-alert-compose__body">
          {error && (
            <div className="admin-alert-compose-error">
              <CircleAlert size={15} />
              <span>{error}</span>
            </div>
          )}

          <RecipientPicker
            scope={scope}
            setScope={setScope}
            selectedUsers={selectedUsers}
            setSelectedUsers={setSelectedUsers}
            userSearch={userSearch}
            setUserSearch={setUserSearch}
            users={users}
            loadingUsers={loadingUsers}
          />

          <section className="admin-alert-compose-section">
            <div className="admin-alert-compose-section__heading">
              <span><BellRing size={16} /></span>
              <div>
                <small>DELIVERY CHANNELS</small>
                <h3>How should Voxidence deliver it?</h3>
              </div>
            </div>

            <div className="admin-alert-channel-grid">
              <ChannelCard
                checked={sendInApp}
                onChange={setSendInApp}
                icon={Bell}
                title="In-app alert"
                description="Appears in each selected user's Notifications center."
              />
              <ChannelCard
                checked={sendEmail}
                onChange={setSendEmail}
                icon={Mail}
                title="Email"
                description="Uses each recipient's current registered email address."
              />
            </div>
          </section>

          <section className="admin-alert-compose-section">
            <div className="admin-alert-compose-section__heading">
              <span><MessageSquareText size={16} /></span>
              <div>
                <small>MESSAGE</small>
                <h3>Write the communication</h3>
              </div>
            </div>

            <div className="admin-alert-compose-fields">
              <label>
                <span>{sendEmail && !sendInApp ? 'Email subject' : 'Alert title'}</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={100}
                  placeholder="Short, clear title"
                />
                <small>{title.length}/100</small>
              </label>

              <label className="is-message">
                <span>Message</span>
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  maxLength={maxMessageLength}
                  placeholder="Explain what the user needs to know and what happens next..."
                />
                <small>{message.length}/{maxMessageLength}</small>
              </label>
            </div>
          </section>

          {scope === 'broadcast' && (
            <label className="admin-alert-broadcast-confirm">
              <input
                type="checkbox"
                checked={confirmBroadcast}
                onChange={(event) => setConfirmBroadcast(event.target.checked)}
              />
              <span>
                <strong>I confirm this broadcast</strong>
                <small>Send this communication to all active registered users.</small>
              </span>
            </label>
          )}
        </div>

        <footer className="admin-alert-compose__footer">
          <div>
            {sendEmail && (
              <span className="admin-alert-email-note">
                <ShieldCheck size={13} />
                Email addresses are resolved from current user accounts on the backend.
              </span>
            )}
          </div>

          <div>
            <button type="button" className="admin-alert-button is-quiet" onClick={onClose} disabled={sending}>
              <X size={15} />
              Cancel
            </button>

            <button type="button" className="admin-alert-button is-primary" onClick={send} disabled={!canSend}>
              {sending ? <LoaderCircle className="admin-alert-spin" size={16} /> : <Send size={16} />}
              <span>
                <strong>Send communication</strong>
                <small>
                  {scope === 'broadcast'
                    ? 'All active users'
                    : `${selectedUsers.length} selected ${selectedUsers.length === 1 ? 'user' : 'users'}`}
                </small>
              </span>
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function CommunicationInspector({ communication, onClose }) {
  if (!communication || typeof document === 'undefined') return null;

  const inApp = Boolean(communication.channels?.inApp);
  const email = Boolean(communication.channels?.email);
  const delivered =
    Number(communication.delivery?.inAppDeliveredCount || 0) +
    Number(communication.delivery?.emailSentCount || 0);
  const failed = Number(communication.delivery?.emailFailedCount || 0);

  return createPortal(
    <div className="admin-alert-modal-layer" role="presentation">
      <div className="admin-alert-modal-backdrop" onMouseDown={onClose} />
      <section
        className="admin-alert-inspector admin-alert-communication-inspector"
        role="dialog"
        aria-modal="true"
        aria-label="Sent communication details"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="admin-alert-inspector__header">
          <span className="admin-alert-inspector__mark is-admin">
            <Send size={20} />
          </span>
          <div>
            <small>ADMIN SENT COMMUNICATION</small>
            <h2>{communication.title}</h2>
            <p>{formatDate(communication.createdAt)}</p>
          </div>
          <button type="button" className="admin-alert-icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="admin-alert-inspector__body">
          <section className="admin-alert-inspector__summary">
            <article>
              <span><UsersRound size={15} /></span>
              <div>
                <small>Audience</small>
                <strong>
                  {communication.scope === 'BROADCAST'
                    ? 'All active users'
                    : `${communication.recipientCount} selected ${communication.recipientCount === 1 ? 'user' : 'users'}`}
                </strong>
                <p>{communication.recipientCount} recipients</p>
              </div>
            </article>

            <article>
              <span><BellRing size={15} /></span>
              <div>
                <small>Channels</small>
                <strong>{inApp && email ? 'In-app + Email' : inApp ? 'In-app' : 'Email'}</strong>
                <p>Requested delivery channels</p>
              </div>
            </article>

            <article>
              <span>{failed > 0 ? <CircleAlert size={15} /> : <CheckCircle2 size={15} />}</span>
              <div>
                <small>Delivery</small>
                <strong>{failed > 0 ? 'Partially delivered' : 'Delivered'}</strong>
                <p>{delivered} deliveries · {failed} email failures</p>
              </div>
            </article>
          </section>

          <section className="admin-alert-message-card">
            <header>
              <span><MessageSquareText size={15} /></span>
              <div>
                <small>MESSAGE</small>
                <h3>Sent content</h3>
              </div>
            </header>
            <p>{communication.message}</p>
          </section>

          {communication.scope === 'SELECTED' && (
            <section className="admin-alert-recipient-history">
              <header>
                <div>
                  <small>RECIPIENTS</small>
                  <h3>Selected users and delivery results</h3>
                </div>
                <span>{communication.recipientCount} total</span>
              </header>

              <div>
                {(communication.recipients || []).map((recipient) => (
                  <article key={recipient.recipientRecordId || recipient.id}>
                    <span>{String(recipient.fullName || recipient.email || 'U').charAt(0).toUpperCase()}</span>
                    <div className="admin-alert-recipient-history__copy">
                      <strong>{recipient.fullName || 'Platform user'}</strong>
                      <small>{recipient.email || '—'}</small>

                      <div className="admin-alert-recipient-delivery">
                        {communication.channels?.inApp && (
                          <em className={recipient.inAppDelivered ? 'is-success' : 'is-failed'}>
                            <Bell size={10} />
                            {recipient.inAppDelivered ? 'In-app delivered' : 'In-app not delivered'}
                          </em>
                        )}

                        {communication.channels?.email && (
                          <em
                            className={
                              recipient.emailStatus === 'SENT'
                                ? 'is-success'
                                : recipient.emailStatus === 'FAILED'
                                  ? 'is-failed'
                                  : 'is-pending'
                            }
                            title={recipient.emailError || undefined}
                          >
                            <Mail size={10} />
                            {recipient.emailStatus === 'SENT'
                              ? 'Email sent'
                              : recipient.emailStatus === 'FAILED'
                                ? 'Email failed'
                                : 'Email pending'}
                          </em>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          <section className="admin-alert-inspector__meta">
            <article>
              <small>Communication ID</small>
              <strong>{communication.id}</strong>
            </article>
            <article>
              <small>Sent by</small>
              <strong>{communication.actor?.fullName || communication.actor?.email || 'Administrator'}</strong>
            </article>
            <article>
              <small>Database record</small>
              <strong>{communication.persisted ? 'Persisted' : '—'}</strong>
            </article>
            <article>
              <small>Completed</small>
              <strong>{formatDate(communication.completedAt)}</strong>
            </article>
            <article>
              <small>In-app delivered</small>
              <strong>{Number(communication.delivery?.inAppDeliveredCount || 0).toLocaleString()}</strong>
            </article>
            <article>
              <small>Email delivered</small>
              <strong>{Number(communication.delivery?.emailSentCount || 0).toLocaleString()}</strong>
            </article>
            <article>
              <small>Email failed</small>
              <strong>{Number(communication.delivery?.emailFailedCount || 0).toLocaleString()}</strong>
            </article>
            <article>
              <small>Stored message</small>
              <strong>{communication.message ? 'Yes' : 'No'}</strong>
            </article>
          </section>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function channelLabel(communication) {
  if (communication.channel === 'BOTH') return 'In-app + Email';
  if (communication.channel === 'EMAIL') return 'Email';
  return 'In-app';
}

function audienceLabel(communication) {
  if (communication.scope === 'BROADCAST') return 'All active users';

  const recipients = communication.recipients || [];
  if (recipients.length === 1) {
    return recipients[0].fullName || recipients[0].email || '1 selected user';
  }

  return `${communication.recipientCount} selected users`;
}

function communicationStatus(communication) {
  if (communication.status === 'FAILED') {
    return { label: 'Failed', tone: 'failed' };
  }

  if (communication.status === 'PARTIAL') {
    return { label: 'Partial', tone: 'partial' };
  }

  if (communication.status === 'PENDING') {
    return { label: 'Pending', tone: 'pending' };
  }

  return { label: 'Delivered', tone: 'delivered' };
}

export default function AdminAlertsPage() {
  const { isArabic } = useUserExperience();
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: PAGE_SIZE, totalPages: 1 });
  const [summary, setSummary] = useState({});

  const [sentRows, setSentRows] = useState([]);
  const [sentMeta, setSentMeta] = useState({ total: 0, page: 1, limit: PAGE_SIZE, totalPages: 1 });

  const [ledgerMode, setLedgerMode] = useState('activity');
  const [activityPage, setActivityPage] = useState(1);
  const [sentPage, setSentPage] = useState(1);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusTab, setStatusTab] = useState('all');
  const [type, setType] = useState('');
  const [sentChannel, setSentChannel] = useState('');
  const [sentAudience, setSentAudience] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const [loading, setLoading] = useState(true);
  const [sentLoading, setSentLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [selectedAlert, setSelectedAlert] = useState(null);
  const [selectedCommunication, setSelectedCommunication] = useState(null);
  const [composerOpen, setComposerOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setActivityPage(1);
      setSentPage(1);
    }, 280);

    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(''), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const commonParams = useMemo(
    () => ({
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...(fromDate ? { fromDate: toStartOfDayIso(fromDate) } : {}),
      ...(toDate ? { toDate: toEndOfDayIso(toDate) } : {}),
    }),
    [debouncedSearch, fromDate, toDate],
  );

  const listParams = useMemo(
    () => ({
      page: activityPage,
      limit: PAGE_SIZE,
      ...commonParams,
      ...(type ? { type } : {}),
      ...(statusFilter(statusTab) !== undefined ? { isRead: statusFilter(statusTab) } : {}),
      sortBy,
      sortOrder,
    }),
    [activityPage, commonParams, type, statusTab, sortBy, sortOrder],
  );

  const sentParams = useMemo(
    () => ({
      page: sentPage,
      limit: PAGE_SIZE,
      ...commonParams,
      ...(sentChannel ? { channel: sentChannel } : {}),
      ...(sentAudience ? { scope: sentAudience } : {}),
      sortBy: 'createdAt',
      sortOrder: 'desc',
    }),
    [sentPage, commonParams, sentChannel, sentAudience],
  );

  const loadActivity = useCallback(async ({ fresh = false, silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError('');

    try {
      const listLoader =
        fresh && adminApi.alerts.listFresh
          ? adminApi.alerts.listFresh
          : adminApi.alerts.list;

      const summaryLoader =
        fresh && adminApi.alerts.summaryFresh
          ? adminApi.alerts.summaryFresh
          : adminApi.alerts.summary;

      const [listResult, summaryResult] = await Promise.all([
        listLoader(listParams),
        summaryLoader(commonParams),
      ]);

      const nextRows = unwrapRows(listResult);
      setRows(nextRows);
      setMeta(unwrapMeta(listResult, nextRows.length));
      setSummary(unwrapSummary(summaryResult));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Could not load administrator alerts.'));
    } finally {
      setLoading(false);
    }
  }, [listParams, commonParams]);

  const loadSent = useCallback(async ({ fresh = false, silent = false } = {}) => {
    if (!silent) setSentLoading(true);

    try {
      const loader =
        fresh && adminApi.alerts.sentFresh
          ? adminApi.alerts.sentFresh
          : adminApi.alerts.sent;

      const result = await loader(sentParams);
      const nextRows = unwrapRows(result);
      setSentRows(nextRows);
      setSentMeta(unwrapMeta(result, nextRows.length));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Could not load sent communication history.'));
    } finally {
      setSentLoading(false);
    }
  }, [sentParams]);

  useEffect(() => {
    loadActivity();
  }, [loadActivity]);

  useEffect(() => {
    loadSent({ silent: ledgerMode !== 'sent' });
  }, [ledgerMode, loadSent]);

  const refresh = async () => {
    setRefreshing(true);

    try {
      await Promise.all([
        loadActivity({ fresh: true, silent: true }),
        loadSent({ fresh: true, silent: true }),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  const clearDates = () => {
    setFromDate('');
    setToDate('');
    setActivityPage(1);
    setSentPage(1);
  };

  const sent = async (message) => {
    setNotice(message);
    setLedgerMode('sent');
    setSentPage(1);

    await Promise.all([
      loadActivity({ fresh: true, silent: true }),
      loadSent({ fresh: true, silent: true }),
    ]);
  };

  const totalAlerts = Number(summary.totalAlerts ?? meta.total ?? 0);
  const unreadAlerts = Number(summary.unreadAlerts ?? 0);
  const readAlerts = Number(summary.readAlerts ?? 0);
  const adminAlerts = Number(summary.adminAlerts ?? 0);
  const uniqueRecipients = Number(summary.uniqueRecipients ?? 0);

  const activeRows = ledgerMode === 'activity' ? rows : sentRows;
  const activeMeta = ledgerMode === 'activity' ? meta : sentMeta;
  const activeLoading = ledgerMode === 'activity' ? loading : sentLoading;

  return (
    <div className="admin-alert-page">
      <section className="admin-alert-hero">
        <div className="admin-alert-hero__content">
          <span className="admin-alert-eyebrow"><BellRing size={16} /> PLATFORM COMMUNICATION</span>
          <h1>Alerts & messaging</h1>
          <p>Review notification activity and send targeted administrator communication by in-app alert, email, or both.</p>
        </div>

        <div className="admin-alert-hero__actions">
          <button type="button" className="admin-alert-button is-quiet" onClick={refresh} disabled={refreshing}>
            <RefreshCw className={refreshing ? 'admin-alert-spin' : ''} size={16} />
            Refresh
          </button>

          <button type="button" className="admin-alert-button is-primary is-single-line" onClick={() => setComposerOpen(true)}>
            <Send size={16} />
            Send alert
          </button>
        </div>

        <div className="admin-alert-hero__visual" aria-hidden="true">
          <span className="admin-alert-hero__wave admin-alert-hero__wave--one" />
          <span className="admin-alert-hero__wave admin-alert-hero__wave--two" />
          <span className="admin-alert-hero__orbit admin-alert-hero__orbit--one" />
          <span className="admin-alert-hero__orbit admin-alert-hero__orbit--two" />

          <span className="admin-alert-hero__particle admin-alert-hero__particle--one" />
          <span className="admin-alert-hero__particle admin-alert-hero__particle--two" />
          <span className="admin-alert-hero__particle admin-alert-hero__particle--three" />
          <span className="admin-alert-hero__particle admin-alert-hero__particle--four" />
          <span className="admin-alert-hero__particle admin-alert-hero__particle--five" />

          <div className="admin-alert-visual-card admin-alert-visual-card--message">
            <MessageSquareText size={18} />
            <span>
              <i />
              <i />
            </span>
          </div>

          <div className="admin-alert-visual-card admin-alert-visual-card--mail">
            <Mail size={24} />
          </div>

          <div className="admin-alert-visual-card admin-alert-visual-card--audience">
            <UsersRound size={19} />
            <span>
              <i />
              <i />
              <i />
            </span>
          </div>

          <div className="admin-alert-visual-core">
            <span className="admin-alert-visual-core__glow" />
            <span className="admin-alert-visual-core__ring admin-alert-visual-core__ring--back" />
            <span className="admin-alert-visual-core__bell"><BellRing size={44} /></span>
            <span className="admin-alert-visual-core__ring admin-alert-visual-core__ring--front" />
          </div>

          <div className="admin-alert-visual-send">
            <Send size={25} />
          </div>

        </div>
      </section>

      {error && (
        <div className="admin-alert-feedback is-error">
          <CircleAlert size={16} />
          <span>{error}</span>
          <button type="button" onClick={() => setError('')}><X size={14} /></button>
        </div>
      )}

      {notice && (
        <div className="admin-alert-feedback is-success">
          <CheckCircle2 size={16} />
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')}><X size={14} /></button>
        </div>
      )}

      <section className="admin-alert-directory">
        <header className="admin-alert-directory__header">
          <div>
            <small>COMMUNICATION LEDGER</small>
            <h2>{ledgerMode === 'activity' ? 'Notification activity' : 'Sent communications'}</h2>
            <p>
              {activeMeta.total.toLocaleString()} matching {activeMeta.total === 1 ? 'record' : 'records'}
            </p>
          </div>
          <span className="admin-alert-live"><i /> Live communication activity</span>
        </header>

        <div className="admin-alert-metrics">
          <MetricCard icon={Bell} label="Total alerts" value={totalAlerts} hint="Matching in-app notification records" />
          <MetricCard icon={Inbox} label="Unread" value={unreadAlerts} hint="Waiting in notification centers" tone="is-rose" />
          <MetricCard icon={MessageSquareText} label="Admin notices" value={adminAlerts} hint="Administrator-created in-app alerts" tone="is-mint" />
          <MetricCard icon={UsersRound} label="Recipients reached" value={uniqueRecipients} hint={`${readAlerts.toLocaleString()} alerts already read`} />
        </div>

        <div className="admin-alert-ledger-tabs">
          <button
            type="button"
            className={ledgerMode === 'activity' ? 'is-active' : ''}
            onClick={() => {
              setLedgerMode('activity');
              setActivityPage(1);
            }}
          >
            <Bell size={14} />
            Notification activity
            <span>{meta.total}</span>
          </button>

          <button
            type="button"
            className={ledgerMode === 'sent' ? 'is-active' : ''}
            onClick={() => {
              setLedgerMode('sent');
              setSentPage(1);
            }}
          >
            <Send size={14} />
            Sent communications
            <span>{sentMeta.total}</span>
          </button>
        </div>

        {ledgerMode === 'activity' ? (
          <div className="admin-alert-status-tabs">
            {STATUS_TABS.map((tab) => (
              <button
                type="button"
                key={tab.key}
                className={statusTab === tab.key ? 'is-active' : ''}
                onClick={() => {
                  setStatusTab(tab.key);
                  setActivityPage(1);
                }}
              >
                {tab.label}
                <span>
                  {tab.key === 'all'
                    ? totalAlerts
                    : tab.key === 'unread'
                      ? unreadAlerts
                      : readAlerts}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        <div className={`admin-alert-toolbar ${ledgerMode === 'sent' ? 'is-sent-mode' : ''}`}>
          {ledgerMode === 'activity' ? (
            <>
              <Dropdown
                label="Category"
                value={type}
                options={TYPE_OPTIONS}
                onChange={(value) => {
                  setType(value);
                  setActivityPage(1);
                }}
                icon={Bell}
              />

              <SortControl
                value={sortBy}
                order={sortOrder}
                onChange={(value) => {
                  setSortBy(value);
                  setActivityPage(1);
                }}
                onToggle={() => {
                  setSortOrder((current) => current === 'asc' ? 'desc' : 'asc');
                  setActivityPage(1);
                }}
              />
            </>
          ) : (
            <>
              <Dropdown
                label="Channel"
                value={sentChannel}
                options={CHANNEL_OPTIONS}
                onChange={(value) => {
                  setSentChannel(value);
                  setSentPage(1);
                }}
                icon={Mail}
              />

              <Dropdown
                label="Audience"
                value={sentAudience}
                options={AUDIENCE_OPTIONS}
                onChange={(value) => {
                  setSentAudience(value);
                  setSentPage(1);
                }}
                icon={UsersRound}
              />
            </>
          )}

          <div className="admin-alert-date-range">
            <label>
              <CalendarDays size={14} />
              <span>
                <small>From</small>
                <input
                  type="date"
                  className={isArabic && !fromDate ? 'is-empty-arabic-date' : undefined}
                  value={fromDate}
                  max={toDate || undefined}
                  aria-label={isArabic ? 'من تاريخ' : 'From date'}
                  onChange={(event) => {
                    const value = event.target.value;
                    setFromDate(value);
                    if (toDate && value > toDate) setToDate(value);
                    setActivityPage(1);
                    setSentPage(1);
                  }}
                />
                {isArabic && !fromDate && (
                  <em className="admin-alert-date-placeholder" aria-hidden="true">يوم/شهر/سنة</em>
                )}
              </span>
            </label>

            <label>
              <CalendarDays size={14} />
              <span>
                <small>To</small>
                <input
                  type="date"
                  className={isArabic && !toDate ? 'is-empty-arabic-date' : undefined}
                  value={toDate}
                  min={fromDate || undefined}
                  aria-label={isArabic ? 'إلى تاريخ' : 'To date'}
                  onChange={(event) => {
                    const value = event.target.value;
                    setToDate(value);
                    if (fromDate && value < fromDate) setFromDate(value);
                    setActivityPage(1);
                    setSentPage(1);
                  }}
                />
                {isArabic && !toDate && (
                  <em className="admin-alert-date-placeholder" aria-hidden="true">يوم/شهر/سنة</em>
                )}
              </span>
            </label>

            {(fromDate || toDate) && (
              <button type="button" onClick={clearDates} title="Clear date range">
                <X size={14} />
              </button>
            )}
          </div>

          <label className="admin-alert-search">
            <Search size={17} />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={
                ledgerMode === 'activity'
                  ? 'Search title, message, user or email...'
                  : 'Search sent title, message or recipient...'
              }
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="Clear search">
                <X size={14} />
              </button>
            )}
          </label>
        </div>

        <div className="admin-alert-card-shell">
          {activeLoading ? (
            <div className="admin-alert-table-state admin-alert-card-state">
              <LoaderCircle className="admin-alert-spin" size={24} />
              <strong>
                {ledgerMode === 'activity'
                  ? 'Loading notification activity…'
                  : 'Loading sent communications…'}
              </strong>
            </div>
          ) : activeRows.length === 0 ? (
            <div className="admin-alert-table-state admin-alert-card-state">
              {ledgerMode === 'activity' ? <Bell size={26} /> : <Send size={26} />}
              <strong>
                {ledgerMode === 'activity'
                  ? 'No alerts match these filters.'
                  : 'No sent communications match these filters.'}
              </strong>
              <span>Try another filter, date range or search phrase.</span>
            </div>
          ) : ledgerMode === 'activity' ? (
            <div className="admin-alert-card-grid">
              {rows.map((alert) => (
                <article
                  className={`admin-alert-card is-${alertTone(alert.type)} ${alert.isRead ? 'is-read' : 'is-unread'}`}
                  key={alert.id}
                >
                  <div className="admin-alert-card__visual">
                    <span className="admin-alert-card__pattern" aria-hidden="true" />
                    <span className={`admin-alert-record__icon is-${alertTone(alert.type)}`}>
                      <MessageSquareText size={18} />
                      <i aria-hidden="true" />
                    </span>
                    <div className="admin-alert-card__visual-copy">
                      <small>In-app notification</small>
                      <strong>{alert.title || 'Untitled alert'}</strong>
                      <span className={alert.isRead ? 'is-read' : 'is-unread'}>
                        {alert.isRead ? <CheckCircle2 size={12} /> : <Inbox size={12} />}
                        {alert.isRead ? 'Read' : 'Unread'}
                      </span>
                    </div>
                  </div>

                  <div className="admin-alert-card__body">
                    <p className="admin-alert-card__message">{alert.message || 'No message content.'}</p>

                    <div className="admin-alert-card__meta-grid">
                      <section>
                        <small>Recipient</small>
                        <div className="admin-alert-recipient admin-alert-recipient--card">
                          <span>{String(alert.user?.fullName || alert.user?.email || 'U').charAt(0).toUpperCase()}</span>
                          <div>
                            <strong>{alert.user?.fullName || 'Platform user'}</strong>
                            <small>{alert.user?.email || '—'}</small>
                          </div>
                        </div>
                      </section>

                      <section>
                        <small>Category</small>
                        <span className={`admin-alert-type-badge is-${alertTone(alert.type)}`}>
                          <Bell size={12} />
                          {titleCase(alert.type)}
                        </span>
                      </section>
                    </div>

                    <div className="admin-alert-card__footer">
                      <div className="admin-alert-created">
                        <strong>{formatShortDate(alert.createdAt)}</strong>
                        <span><Clock3 size={11} /> {formatTime(alert.createdAt)}</span>
                      </div>

                      <button type="button" className="admin-alert-inspect-button" onClick={() => setSelectedAlert(alert)}>
                        <Eye size={15} />
                        View alert
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="admin-alert-card-grid">
              {sentRows.map((communication) => {
                const state = communicationStatus(communication);

                return (
                  <article className={`admin-alert-card admin-alert-card--sent is-${state.tone}`} key={communication.id}>
                    <div className="admin-alert-card__visual">
                      <span className="admin-alert-card__pattern" aria-hidden="true" />
                      <span className="admin-alert-record__icon is-admin">
                        <Send size={17} />
                        <i aria-hidden="true" />
                      </span>
                      <div className="admin-alert-card__visual-copy">
                        <small>Administrator communication</small>
                        <strong>{communication.title || 'Untitled communication'}</strong>
                        <span className={`is-${state.tone}`}>
                          {state.tone === 'delivered'
                            ? <CheckCircle2 size={12} />
                            : state.tone === 'pending'
                              ? <Clock3 size={12} />
                              : <CircleAlert size={12} />}
                          {state.label}
                        </span>
                      </div>
                    </div>

                    <div className="admin-alert-card__body">
                      <p className="admin-alert-card__message">{communication.message || 'No message content.'}</p>

                      <div className="admin-alert-card__meta-grid admin-alert-card__meta-grid--sent">
                        <section>
                          <small>Audience</small>
                          <div className="admin-alert-sent-audience">
                            <span>{communication.scope === 'BROADCAST' ? <UsersRound size={14} /> : <UserRound size={14} />}</span>
                            <div>
                              <strong>{audienceLabel(communication)}</strong>
                              <small>{communication.recipientCount} recipients</small>
                            </div>
                          </div>
                        </section>

                        <section>
                          <small>Channels</small>
                          <div className="admin-alert-channel-badges">
                            {communication.channels?.inApp && <span><Bell size={12} /> In-app</span>}
                            {communication.channels?.email && <span><Mail size={12} /> Email</span>}
                          </div>
                        </section>
                      </div>

                      <div className="admin-alert-card__sender">
                        <ShieldCheck size={13} />
                        Sent by {communication.actor?.fullName || communication.actor?.email || 'Administrator'}
                        <span>·</span>
                        {channelLabel(communication)}
                      </div>

                      <div className="admin-alert-card__footer">
                        <div className="admin-alert-created">
                          <strong>{formatShortDate(communication.createdAt)}</strong>
                          <span><Clock3 size={11} /> {formatTime(communication.createdAt)}</span>
                        </div>

                        <button
                          type="button"
                          className="admin-alert-inspect-button"
                          onClick={() => setSelectedCommunication(communication)}
                        >
                          <Eye size={15} />
                          View message
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <footer className="admin-alert-pagination">
          <span>
            Showing {activeRows.length ? (activeMeta.page - 1) * activeMeta.limit + 1 : 0}
            {'–'}
            {Math.min(activeMeta.page * activeMeta.limit, activeMeta.total)} of {activeMeta.total}
          </span>

          <div>
            <button
              type="button"
              disabled={activeMeta.page <= 1}
              onClick={() => {
                if (ledgerMode === 'activity') {
                  setActivityPage((current) => Math.max(1, current - 1));
                } else {
                  setSentPage((current) => Math.max(1, current - 1));
                }
              }}
            >
              Previous
            </button>

            <span>Page {activeMeta.page} of {activeMeta.totalPages}</span>

            <button
              type="button"
              disabled={activeMeta.page >= activeMeta.totalPages}
              onClick={() => {
                if (ledgerMode === 'activity') {
                  setActivityPage((current) => current + 1);
                } else {
                  setSentPage((current) => current + 1);
                }
              }}
            >
              Next
            </button>
          </div>
        </footer>
      </section>

      <AlertInspector alert={selectedAlert} onClose={() => setSelectedAlert(null)} />
      <CommunicationInspector communication={selectedCommunication} onClose={() => setSelectedCommunication(null)} />

      {composerOpen && (
        <ComposeAlertModal
          onClose={() => setComposerOpen(false)}
          onSent={sent}
        />
      )}
    </div>
  );
}