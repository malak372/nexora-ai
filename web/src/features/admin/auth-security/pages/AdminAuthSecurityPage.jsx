import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  Eye,
  Fingerprint,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldX,
  Smartphone,
  UserRound,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { adminApi, getApiErrorMessage } from '../../shared/api/adminApi';
import '../../shared/styles/admin-pages.css';
import '../styles/admin-auth-security.css';

const PAGE_SIZE = 20;

const ACTION_OPTIONS = [
  { key: '', label: 'All authentication events' },
  { key: 'REGISTER', label: 'Register' },
  { key: 'LOGIN_SUCCESS', label: 'Login success' },
  { key: 'LOGIN_FAILED', label: 'Login failed' },
  { key: 'LOGOUT', label: 'Logout' },
  { key: 'REFRESH_TOKEN', label: 'Refresh token' },
  { key: 'CHANGE_PASSWORD', label: 'Change password' },
  { key: 'FORGOT_PASSWORD', label: 'Forgot password' },
  { key: 'RESET_PASSWORD', label: 'Reset password' },
  { key: 'EMAIL_VERIFIED', label: 'Email verified' },
  { key: 'RESEND_VERIFICATION_EMAIL', label: 'Resend verification email' },
  { key: 'ACCOUNT_LOCKED', label: 'Account locked' },
  { key: 'ACCOUNT_DEACTIVATED', label: 'Account deactivated' },
  { key: 'EMAIL_CHANGED', label: 'Email changed' },
  { key: 'VERIFICATION_EMAIL_SENT', label: 'Verification email sent' },
  { key: 'VERIFY_EMAIL_FAILED', label: 'Verify email failed' },
  { key: 'RESET_PASSWORD_FAILED', label: 'Reset password failed' },
  { key: 'REFRESH_TOKEN_FAILED', label: 'Refresh token failed' },
];

const RESULT_OPTIONS = [
  { key: '', label: 'All results' },
  { key: 'true', label: 'Successful' },
  { key: 'false', label: 'Failed' },
];

const SORT_OPTIONS = [
  { key: 'createdAt', label: 'Event date' },
  { key: 'action', label: 'Event type' },
  { key: 'email', label: 'Email' },
  { key: 'isSuccess', label: 'Result' },
];

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unwrapRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!isObject(payload)) return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.items)) return payload.items;
  if (isObject(payload.data) && Array.isArray(payload.data.data)) return payload.data.data;
  return [];
}

function unwrapMeta(payload, count) {
  const source = payload?.meta || payload?.pagination || payload?.data?.meta || {};
  const total = Number(source.total ?? count) || 0;
  const page = Number(source.page ?? 1) || 1;
  const limit = Number(source.limit ?? PAGE_SIZE) || PAGE_SIZE;
  const totalPages = Math.max(1, Number(source.totalPages ?? Math.ceil(total / Math.max(limit, 1))) || 1);
  return { total, page, limit, totalPages };
}

function unwrapSummary(payload) {
  if (!isObject(payload)) return {};
  return isObject(payload.data) ? payload.data : payload;
}

function humanize(value) {
  return String(value || '')
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
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
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function toStartOfDayIso(value) {
  if (!value) return undefined;
  return new Date(`${value}T00:00:00`).toISOString();
}

function toEndOfDayIso(value) {
  if (!value) return undefined;
  return new Date(`${value}T23:59:59.999`).toISOString();
}

function deviceLabel(userAgent) {
  if (!userAgent) return 'Unknown device';
  const platform = /Android/i.test(userAgent)
    ? 'Android'
    : /iPhone|iPad|iPod/i.test(userAgent)
      ? 'iOS'
      : /Windows/i.test(userAgent)
        ? 'Windows'
        : /Macintosh|Mac OS X/i.test(userAgent)
          ? 'macOS'
          : /Linux/i.test(userAgent)
            ? 'Linux'
            : 'Unknown OS';

  const browser = /Edg\//i.test(userAgent)
    ? 'Edge'
    : /Chrome\//i.test(userAgent)
      ? 'Chrome'
      : /Firefox\//i.test(userAgent)
        ? 'Firefox'
        : /Safari\//i.test(userAgent)
          ? 'Safari'
          : 'Unknown browser';

  return `${browser} on ${platform}`;
}

function MetricCard({ icon: Icon, label, value, hint, tone = '' }) {
  return (
    <article className={`admin-auth-metric ${tone}`}>
      <i />
      <span className="admin-auth-metric__icon"><Icon size={19} /></span>
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
  const ref = useRef(null);
  const current = options.find((item) => item.key === value) || options[0];

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className={`admin-auth-dropdown ${open ? 'is-open' : ''}`} ref={ref}>
      <button type="button" className="admin-auth-dropdown__trigger" onClick={() => setOpen((state) => !state)}>
        <Icon size={15} />
        <span><small>{label}</small><strong>{current.label}</strong></span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="admin-auth-dropdown__menu">
          {options.map((item) => (
            <button
              type="button"
              key={item.key}
              className={item.key === value ? 'is-active' : ''}
              onClick={() => {
                onChange(item.key);
                setOpen(false);
              }}
            >
              {item.label}
              {item.key === value && <Check size={13} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SortControl({ value, order, onChange, onToggle }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = SORT_OPTIONS.find((item) => item.key === value) || SORT_OPTIONS[0];

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="admin-auth-sort" ref={ref}>
      <button type="button" className="admin-auth-sort__main" onClick={() => setOpen((state) => !state)}>
        <Clock3 size={15} />
        <span><small>Sort events</small><strong>{current.label}</strong></span>
        <ChevronDown size={14} />
      </button>
      <button type="button" className="admin-auth-sort__direction" onClick={onToggle}>
        {order === 'asc' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
      </button>
      {open && (
        <div className="admin-auth-sort__menu">
          {SORT_OPTIONS.map((item) => (
            <button
              type="button"
              key={item.key}
              className={item.key === value ? 'is-active' : ''}
              onClick={() => {
                onChange(item.key);
                setOpen(false);
              }}
            >
              {item.label}
              {item.key === value && <Check size={13} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SecurityInspector({ row, onClose }) {
  if (!row || typeof document === 'undefined') return null;

  return createPortal(
    <div className="admin-auth-modal-layer">
      <div className="admin-auth-modal-backdrop" onMouseDown={onClose} />
      <section className="admin-auth-inspector" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header className="admin-auth-inspector__header">
          <span className={`admin-auth-inspector__mark ${row.isSuccess ? 'is-success' : 'is-failed'}`}>
            {row.isSuccess ? <ShieldCheck size={21} /> : <ShieldX size={21} />}
          </span>
          <div>
            <small>AUTHENTICATION EVENT</small>
            <h2>{humanize(row.action)}</h2>
            <p>{formatDate(row.createdAt)}</p>
          </div>
          <button type="button" className="admin-auth-icon-button" onClick={onClose} aria-label="Close security event details"><X size={18} /></button>
        </header>

        <div className="admin-auth-inspector__body">
          <section className="admin-auth-inspector__summary">
            <article>
              <span><UserRound size={15} /></span>
              <div>
                <small>Account</small>
                <strong>{row.user?.fullName || row.email || 'Unknown account'}</strong>
                <p>{row.user?.email || row.email || '—'}</p>
              </div>
            </article>
            <article>
              <span><Fingerprint size={15} /></span>
              <div>
                <small>Network</small>
                <strong>{row.ipAddress || 'Unknown IP'}</strong>
                <p>Recorded request address</p>
              </div>
            </article>
            <article>
              <span><Smartphone size={15} /></span>
              <div>
                <small>Device</small>
                <strong>{deviceLabel(row.userAgent)}</strong>
                <p>{row.userAgent || 'No user agent stored'}</p>
              </div>
            </article>
          </section>

          <section className="admin-auth-message-card">
            <header>
              <span>{row.isSuccess ? <CheckCircle2 size={15} /> : <CircleAlert size={15} />}</span>
              <div>
                <small>SECURITY RESULT</small>
                <h3>{row.isSuccess ? 'Authentication event completed successfully' : 'Authentication event failed'}</h3>
              </div>
            </header>
            <p>{row.message || 'No additional security message was recorded for this event.'}</p>
          </section>

          <section className="admin-auth-inspector__meta">
            <article><small>Log ID</small><strong>{row.id}</strong></article>
            <article><small>User ID</small><strong>{row.userId || row.user?.id || '—'}</strong></article>
            <article><small>Role</small><strong>{row.user?.role || '—'}</strong></article>
            <article><small>Account active</small><strong>{row.user ? (row.user.isActive ? 'Yes' : 'No') : '—'}</strong></article>
            <article><small>Email verified</small><strong>{row.user ? (row.user.isVerified ? 'Yes' : 'No') : '—'}</strong></article>
            <article><small>Event result</small><strong>{row.isSuccess ? 'Successful' : 'Failed'}</strong></article>
          </section>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export default function AdminAuthSecurityPage() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: PAGE_SIZE, totalPages: 1 });
  const [summary, setSummary] = useState({});
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [action, setAction] = useState('');
  const [result, setResult] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 280);
    return () => window.clearTimeout(timer);
  }, [search]);

  const commonParams = useMemo(() => ({
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(action ? { action } : {}),
    ...(fromDate ? { fromDate: toStartOfDayIso(fromDate) } : {}),
    ...(toDate ? { toDate: toEndOfDayIso(toDate) } : {}),
  }), [debouncedSearch, action, fromDate, toDate]);

  const listParams = useMemo(() => ({
    page,
    limit: PAGE_SIZE,
    ...commonParams,
    ...(result ? { isSuccess: result } : {}),
    sortBy,
    sortOrder,
  }), [page, commonParams, result, sortBy, sortOrder]);

  const load = useCallback(async ({ fresh = false, silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const listLoader = fresh && adminApi.authAudit.listFresh ? adminApi.authAudit.listFresh : adminApi.authAudit.list;
      const summaryLoader = fresh && adminApi.authAudit.summaryFresh ? adminApi.authAudit.summaryFresh : adminApi.authAudit.summary;
      const [listResult, summaryResult] = await Promise.all([
        listLoader(listParams),
        summaryLoader(commonParams),
      ]);
      const nextRows = unwrapRows(listResult);
      setRows(nextRows);
      setMeta(unwrapMeta(listResult, nextRows.length));
      setSummary(unwrapSummary(summaryResult));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Could not load authentication security activity.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [listParams, commonParams]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load({ fresh: true, silent: true });
  };

  const total = Number(summary.totalEvents ?? meta.total ?? 0);
  const success = Number(summary.successfulEvents ?? 0);
  const failed = Number(summary.failedEvents ?? 0);
  const uniqueIps = Number(summary.uniqueIpAddresses ?? 0);

  return (
    <div className="admin-auth-page">
      <section className="admin-auth-hero">
        <div>
          <span className="admin-auth-eyebrow"><ShieldCheck size={16} /> IDENTITY SECURITY</span>
          <h1>Authentication security</h1>
          <p>Inspect login, password, verification and token activity with account, device and network context.</p>
        </div>
        <button type="button" className="admin-auth-button" onClick={refresh} disabled={refreshing}>
          <RefreshCw className={refreshing ? 'admin-auth-spin' : ''} size={16} />
          Refresh
        </button>
      </section>

      {error && (
        <div className="admin-auth-feedback">
          <CircleAlert size={16} />
          <span>{error}</span>
          <button type="button" onClick={() => setError('')}><X size={14} /></button>
        </div>
      )}

      <section className="admin-auth-directory">
        <header className="admin-auth-directory__header">
          <div>
            <small>SECURITY EVENT LEDGER</small>
            <h2>Authentication activity</h2>
            <p>{meta.total.toLocaleString()} matching {meta.total === 1 ? 'event' : 'events'}</p>
          </div>
          <span className="admin-auth-live"><i /> Security telemetry</span>
        </header>

        <div className="admin-auth-metrics">
          <MetricCard icon={KeyRound} label="Total events" value={total} hint="Matching authentication records" />
          <MetricCard icon={ShieldCheck} label="Successful" value={success} hint="Successful authentication activity" />
          <MetricCard icon={ShieldX} label="Failed" value={failed} hint={`${Number(summary.accountLockEvents || 0)} account lock events`} tone="is-rose" />
          <MetricCard icon={Fingerprint} label="Network sources" value={uniqueIps} hint={`${Number(summary.uniqueUsers || 0)} identified users`} />
        </div>

        <div className="admin-auth-toolbar">
          <Dropdown label="Event" value={action} options={ACTION_OPTIONS} onChange={(value) => { setAction(value); setPage(1); }} icon={KeyRound} />
          <Dropdown label="Result" value={result} options={RESULT_OPTIONS} onChange={(value) => { setResult(value); setPage(1); }} icon={ShieldCheck} />
          <SortControl
            value={sortBy}
            order={sortOrder}
            onChange={(value) => { setSortBy(value); setPage(1); }}
            onToggle={() => { setSortOrder((current) => current === 'asc' ? 'desc' : 'asc'); setPage(1); }}
          />

          <div className="admin-auth-date-range">
            <label><CalendarDays size={14} /><span><small>From</small><input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => { setFromDate(event.target.value); setPage(1); }} /></span></label>
            <label><CalendarDays size={14} /><span><small>To</small><input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => { setToDate(event.target.value); setPage(1); }} /></span></label>
            {(fromDate || toDate) && <button type="button" onClick={() => { setFromDate(''); setToDate(''); setPage(1); }}><X size={14} /></button>}
          </div>

          <label className="admin-auth-search">
            <Search size={17} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search account, email, IP or device..." />
            {search && <button type="button" onClick={() => setSearch('')}><X size={14} /></button>}
          </label>
        </div>

        <div className="admin-auth-table-wrap">
          {loading ? (
            <div className="admin-auth-state"><LoaderCircle className="admin-auth-spin" size={25} /><strong>Loading security events…</strong></div>
          ) : rows.length === 0 ? (
            <div className="admin-auth-state"><LockKeyhole size={27} /><strong>No authentication events match these filters.</strong></div>
          ) : (
            <table className="admin-auth-table">
              <thead>
                <tr><th>EVENT</th><th>ACCOUNT</th><th>RESULT</th><th>NETWORK & DEVICE</th><th>CREATED</th><th>ACTIONS</th></tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="admin-auth-event">
                        <span className={row.isSuccess ? 'is-success' : 'is-failed'}>{row.isSuccess ? <ShieldCheck size={16} /> : <ShieldX size={16} />}</span>
                        <div><strong>{humanize(row.action)}</strong><small>{row.message || 'Authentication event'}</small></div>
                      </div>
                    </td>
                    <td>
                      <div className="admin-auth-account">
                        <span>{String(row.user?.fullName || row.email || 'U').charAt(0).toUpperCase()}</span>
                        <div><strong>{row.user?.fullName || 'Platform user'}</strong><small>{row.user?.email || row.email || '—'}</small></div>
                      </div>
                    </td>
                    <td><span className={`admin-auth-result ${row.isSuccess ? 'is-success' : 'is-failed'}`}>{row.isSuccess ? <CheckCircle2 size={12} /> : <CircleAlert size={12} />}{row.isSuccess ? 'Successful' : 'Failed'}</span></td>
                    <td><div className="admin-auth-source"><strong>{row.ipAddress || 'Unknown IP'}</strong><small>{deviceLabel(row.userAgent)}</small></div></td>
                    <td><div className="admin-auth-created"><strong>{formatShortDate(row.createdAt)}</strong><span><Clock3 size={11} /> {formatTime(row.createdAt)}</span></div></td>
                    <td><button type="button" className="admin-auth-view" onClick={() => setSelected(row)}><Eye size={15} /> Inspect</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <footer className="admin-auth-pagination">
          <span>Showing {rows.length ? (meta.page - 1) * meta.limit + 1 : 0}–{Math.min(meta.page * meta.limit, meta.total)} of {meta.total}</span>
          <div>
            <button type="button" disabled={meta.page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
            <span>Page {meta.page} of {meta.totalPages}</span>
            <button type="button" disabled={meta.page >= meta.totalPages} onClick={() => setPage((current) => current + 1)}>Next</button>
          </div>
        </footer>
      </section>

      <SecurityInspector row={selected} onClose={() => setSelected(null)} />
    </div>
  );
}