import {
  Activity,
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  Download,
  Eye,
  FileClock,
  FileDiff,
  FileText,
  Fingerprint,
  History,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  TerminalSquare,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { adminApi, getApiErrorMessage } from '../../shared/api/adminApi';
import '../../shared/styles/admin-pages.css';
import '../styles/admin-audit-logs.css';

const PAGE_SIZE = 20;

const ACTION_OPTIONS = [
  { key: '', label: 'All actions' },
  { key: 'ADMIN_UPDATE_USER', label: 'Update user' },
  { key: 'ADMIN_UPDATE_USER_STATUS', label: 'Update user status' },
  { key: 'ADMIN_SOFT_DELETE_USER', label: 'Soft-delete user' },
  { key: 'ADMIN_ADJUST_USER_CREDITS', label: 'Adjust user credits' },
  { key: 'ADMIN_SEND_PASSWORD_RESET_EMAIL', label: 'Send password reset email' },
  { key: 'ADMIN_UPDATE_SETTINGS', label: 'Update settings' },
  { key: 'ADMIN_UPDATE_PROMPT', label: 'Update prompt' },
  { key: 'ADMIN_CREATE_ALERT', label: 'Create alert' },
  { key: 'ADMIN_CREATE_DATA_SOURCE', label: 'Create data source' },
  { key: 'ADMIN_UPDATE_DATA_SOURCE', label: 'Update data source' },
  { key: 'ADMIN_ACTIVATE_DATA_SOURCE', label: 'Activate data source' },
  { key: 'ADMIN_DEACTIVATE_DATA_SOURCE', label: 'Deactivate data source' },
  { key: 'ADMIN_CREATE_DOMAIN', label: 'Create domain' },
  { key: 'ADMIN_UPDATE_DOMAIN', label: 'Update domain' },
  { key: 'ADMIN_DEACTIVATE_DOMAIN', label: 'Deactivate domain' },
  { key: 'ADMIN_UPDATE_COMPLAINT', label: 'Update complaint' },
  { key: 'ADMIN_UPDATE_CONTACT_MESSAGE', label: 'Update contact message' },
  { key: 'ADMIN_CREATE_AI_MODEL', label: 'Create AI model' },
  { key: 'ADMIN_UPDATE_AI_MODEL', label: 'Update AI model' },
  { key: 'ADMIN_ACTIVATE_AI_MODEL', label: 'Activate AI model' },
  { key: 'ADMIN_DEACTIVATE_AI_MODEL', label: 'Deactivate AI model' },
  { key: 'ADMIN_SET_DEFAULT_AI_MODEL', label: 'Set default AI model' },
  { key: 'ADMIN_START_DATA_COLLECTION', label: 'Start data collection' },
  { key: 'ADMIN_STOP_DATA_COLLECTION', label: 'Stop data collection' },
  { key: 'ADMIN_HIDE_PUBLICATION', label: 'Hide publication' },
  { key: 'ADMIN_RESTORE_PUBLICATION', label: 'Restore publication' },
  { key: 'ADMIN_ARCHIVE_PUBLICATION', label: 'Archive publication' },
  { key: 'ADMIN_REVIEW_PUBLICATION_REPORT', label: 'Review publication report' },
  { key: 'USER_GENERATE_IDEA', label: 'User generated idea' },
  { key: 'USER_UNLOCK_IDEA', label: 'User unlocked idea' },
  { key: 'USER_CREATE_COMPLAINT', label: 'User created complaint' },
  { key: 'USER_CREATE_CONTACT_MESSAGE', label: 'User created contact message' },
  { key: 'USER_AI_CHAT', label: 'User AI chat' },
  { key: 'USER_UPDATE_PROFILE', label: 'User updated profile' },
  { key: 'USER_MARK_NOTIFICATION_READ', label: 'User read notification' },
  { key: 'USER_MARK_ALL_NOTIFICATIONS_READ', label: 'User read all notifications' },
  { key: 'RUN_DATA_COLLECTION', label: 'Run data collection' },
  { key: 'COMPLETE_DATA_COLLECTION', label: 'Complete data collection' },
  { key: 'FAIL_DATA_COLLECTION', label: 'Fail data collection' },
  { key: 'STOP_DATA_COLLECTION', label: 'Stop data collection' },
  { key: 'NLP_ANALYSIS_RUN', label: 'NLP analysis run' },
  { key: 'ABSTRACT_GENERATION_RUN', label: 'Abstract generation run' },
  { key: 'PROMPT_HISTORY_CREATED', label: 'Prompt history created' },
  { key: 'USER_CREATE_PUBLICATION', label: 'User created publication' },
  { key: 'USER_PUBLISH_IDEA', label: 'User published idea' },
  { key: 'USER_UPDATE_PUBLICATION', label: 'User updated publication' },
  { key: 'USER_ARCHIVE_PUBLICATION', label: 'User archived publication' },
  { key: 'USER_REPORT_PUBLICATION', label: 'User reported publication' },
  { key: 'USER_ACCEPT_PUBLICATION', label: 'User accepted publication' },
  { key: 'USER_UNLOCK_PUBLICATION_ADVANCED', label: 'User unlocked publication advanced' },
];

const TARGET_OPTIONS = [
  { key: '', label: 'All target types' },
  { key: 'USER', label: 'User' },
  { key: 'IDEA', label: 'Idea' },
  { key: 'PAYMENT', label: 'Payment' },
  { key: 'DOMAIN', label: 'Domain' },
  { key: 'DATA_SOURCE', label: 'Data source' },
  { key: 'SYSTEM_SETTING', label: 'System setting' },
  { key: 'PROMPT', label: 'Prompt' },
  { key: 'COMPLAINT', label: 'Complaint' },
  { key: 'AI_MODEL', label: 'AI model' },
  { key: 'IDEA_PUBLICATION', label: 'Publication' },
  { key: 'CONTACT_MESSAGE', label: 'Contact message' },
  { key: 'ALERT', label: 'Alert' },
  { key: 'CREDIT_TRANSACTION', label: 'Credit transaction' },
  { key: 'DATA_COLLECTION', label: 'Data collection' },
  { key: 'NLP_ANALYSIS', label: 'NLP analysis' },
  { key: 'IDEA_PUBLICATION_FEEDBACK', label: 'Publication feedback' },
  { key: 'IDEA_PUBLICATION_REPORT', label: 'Publication report' },
  { key: 'IDEA_PUBLICATION_ACCEPTANCE', label: 'Publication acceptance' },
];

const SORT_OPTIONS = [
  { key: 'createdAt', label: 'Event date' },
  { key: 'action', label: 'Action' },
  { key: 'targetType', label: 'Target type' },
  { key: 'targetId', label: 'Target ID' },
];

const SENSITIVE_KEYS = [
  'password',
  'passwordHash',
  'accessToken',
  'refreshToken',
  'token',
  'secret',
  'apiKey',
  'authorization',
  'cookie',
];

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unwrapRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!isObject(payload)) return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.logs)) return payload.logs;
  if (isObject(payload.data)) {
    if (Array.isArray(payload.data.data)) return payload.data.data;
    if (Array.isArray(payload.data.items)) return payload.data.items;
  }
  return [];
}

function unwrapMeta(payload, count) {
  const source = payload?.meta || payload?.pagination || payload?.data?.meta || {};
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
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function humanize(value) {
  return String(value || '')
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function actionGroup(action) {
  const value = String(action || '');
  if (value.startsWith('ADMIN_')) return 'admin';
  if (value.startsWith('USER_')) return 'user';
  return 'system';
}

function targetTone(targetType) {
  const value = String(targetType || '');
  if (['PAYMENT', 'CREDIT_TRANSACTION'].includes(value)) return 'finance';
  if (['AI_MODEL', 'NLP_ANALYSIS', 'PROMPT'].includes(value)) return 'ai';
  if (['COMPLAINT', 'IDEA_PUBLICATION_REPORT'].includes(value)) return 'safety';
  return 'default';
}

function toStartOfDayIso(value) {
  if (!value) return undefined;
  return new Date(`${value}T00:00:00`).toISOString();
}

function toEndOfDayIso(value) {
  if (!value) return undefined;
  return new Date(`${value}T23:59:59.999`).toISOString();
}

function sanitizeAuditValue(value, parentKey = '') {
  if (value === null || value === undefined) return value;

  const normalizedParent = String(parentKey).toLowerCase();
  if (SENSITIVE_KEYS.some((key) => normalizedParent.includes(key.toLowerCase()))) {
    return '[REDACTED]';
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditValue(item));
  }

  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeAuditValue(item, key)]),
    );
  }

  return value;
}


function formatAuditPrimitive(value) {
  if (value === null) return 'Null';
  if (value === undefined) return 'Not stored';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return value.toLocaleString();
  if (typeof value === 'string') {
    const date = new Date(value);
    if (
      /^\d{4}-\d{2}-\d{2}T/.test(value) &&
      !Number.isNaN(date.getTime())
    ) {
      return formatDate(value);
    }
    return value || 'Empty';
  }
  return String(value);
}

function SnapshotValue({ value }) {
  const safeValue = sanitizeAuditValue(value);

  if (Array.isArray(safeValue)) {
    if (safeValue.length === 0) {
      return <span className="admin-audit-value-empty">Empty list</span>;
    }

    return (
      <div className="admin-audit-value-list">
        {safeValue.slice(0, 8).map((item, index) => (
          <span key={`${index}-${JSON.stringify(item)}`}>
            {isObject(item) || Array.isArray(item)
              ? JSON.stringify(item)
              : formatAuditPrimitive(item)}
          </span>
        ))}
        {safeValue.length > 8 ? (
          <small>+{safeValue.length - 8} more</small>
        ) : null}
      </div>
    );
  }

  if (isObject(safeValue)) {
    return (
      <div className="admin-audit-value-object">
        {Object.entries(safeValue).slice(0, 8).map(([key, item]) => (
          <div key={key}>
            <small>{humanize(key)}</small>
            <strong>
              {isObject(item) || Array.isArray(item)
                ? JSON.stringify(item)
                : formatAuditPrimitive(item)}
            </strong>
          </div>
        ))}
      </div>
    );
  }

  return (
    <span className="admin-audit-value-primitive">
      {formatAuditPrimitive(safeValue)}
    </span>
  );
}

function SnapshotCard({
  label,
  title,
  value,
  changed,
  tone = 'before',
}) {
  const safeValue = sanitizeAuditValue(value);
  const hasSnapshot = safeValue !== null && safeValue !== undefined;
  const entries = isObject(safeValue) ? Object.entries(safeValue) : [];

  return (
    <article className={`admin-audit-snapshot-card is-${tone}`}>
      <header>
        <div>
          <small>{label}</small>
          <h3>{title}</h3>
        </div>
        <span className={hasSnapshot ? 'is-stored' : 'is-empty'}>
          {hasSnapshot ? 'Stored' : 'Empty'}
        </span>
      </header>

      {!hasSnapshot ? (
        <div className="admin-audit-snapshot-empty">
          <FileText size={18} />
          <strong>No snapshot stored</strong>
          <span>
            This event did not persist a {tone === 'before' ? 'previous' : 'new'} state.
          </span>
        </div>
      ) : entries.length ? (
        <div className="admin-audit-snapshot-fields">
          {entries.map(([key, item]) => {
            const isChanged = changed.includes(key);

            return (
              <div
                className={`admin-audit-snapshot-field ${isChanged ? 'is-changed' : ''}`}
                key={key}
              >
                <div className="admin-audit-snapshot-field__label">
                  <span>{humanize(key)}</span>
                  {isChanged ? <i>Changed</i> : null}
                </div>
                <SnapshotValue value={item} />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="admin-audit-snapshot-single">
          <SnapshotValue value={safeValue} />
        </div>
      )}
    </article>
  );
}

function changedFields(oldValue, newValue) {
  if (!isObject(oldValue) && !isObject(newValue)) return [];

  const before = isObject(oldValue) ? oldValue : {};
  const after = isObject(newValue) ? newValue : {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];

  return keys.filter((key) => {
    const left = JSON.stringify(sanitizeAuditValue(before[key], key));
    const right = JSON.stringify(sanitizeAuditValue(after[key], key));
    return left !== right;
  });
}

function changeSummary(row) {
  const fields = changedFields(row.oldValue, row.newValue);

  if (fields.length > 0) {
    return {
      label: `${fields.length} ${fields.length === 1 ? 'field' : 'fields'} changed`,
      detail: fields.slice(0, 3).map(humanize).join(', '),
    };
  }

  if (row.newValue !== null && row.newValue !== undefined) {
    return { label: 'State recorded', detail: 'New state snapshot' };
  }

  if (row.oldValue !== null && row.oldValue !== undefined) {
    return { label: 'Previous state', detail: 'Old state snapshot' };
  }

  return { label: 'Event only', detail: 'No state snapshot' };
}

function MetricCard({ icon: Icon, label, value, hint, tone = '' }) {
  return (
    <article className={`admin-audit-metric ${tone}`}>
      <i aria-hidden="true" />
      <span className="admin-audit-metric__icon"><Icon size={19} /></span>
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
  const [filter, setFilter] = useState('');
  const rootRef = useRef(null);
  const current = options.find((option) => option.key === value) || options[0];

  useEffect(() => {
    if (!open) return undefined;

    const close = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
        setFilter('');
      }
    };

    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const visible = options.filter((option) =>
    option.label.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  return (
    <div className={`admin-audit-dropdown ${open ? 'is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="admin-audit-dropdown__trigger"
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
        <div className="admin-audit-dropdown__menu">
          {options.length > 12 && (
            <label className="admin-audit-dropdown__search">
              <Search size={13} />
              <input
                autoFocus
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Find an option..."
              />
            </label>
          )}

          <div>
            {visible.map((option) => (
              <button
                type="button"
                key={option.key}
                className={value === option.key ? 'is-active' : ''}
                onClick={() => {
                  onChange(option.key);
                  setOpen(false);
                  setFilter('');
                }}
              >
                <span>{option.label}</span>
                {value === option.key && <Check size={14} />}
              </button>
            ))}
          </div>
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
    <div className={`admin-audit-sort ${open ? 'is-open' : ''}`} ref={rootRef}>
      <button type="button" className="admin-audit-sort__main" onClick={() => setOpen((state) => !state)}>
        <FileClock size={15} />
        <span>
          <small>Sort audit</small>
          <strong>{current.label}</strong>
        </span>
        <ChevronDown size={14} />
      </button>

      <button
        type="button"
        className="admin-audit-sort__direction"
        onClick={onToggle}
        title={order === 'asc' ? 'Ascending' : 'Descending'}
      >
        {order === 'asc' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
      </button>

      {open && (
        <div className="admin-audit-sort__menu">
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

function AuditInspector({ row, onClose }) {
  if (!row || typeof document === 'undefined') return null;

  const fields = changedFields(row.oldValue, row.newValue);
  const group = actionGroup(row.action);

  return createPortal(
    <div className="admin-audit-modal-layer" role="presentation">
      <div className="admin-audit-modal-backdrop" onMouseDown={onClose} />

      <section
        className="admin-audit-inspector"
        role="dialog"
        aria-modal="true"
        aria-label="Audit event details"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="admin-audit-inspector__header">
          <span className={`admin-audit-inspector__mark is-${group}`}>
            <History size={21} />
          </span>

          <div>
            <small>AUDIT EVENT</small>
            <h2>{humanize(row.action)}</h2>
            <p>{formatDate(row.createdAt)}</p>
          </div>

          <button type="button" className="admin-audit-icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="admin-audit-inspector__body">
          <section className="admin-audit-inspector__summary">
            <article>
              <span><UserRound size={15} /></span>
              <div>
                <small>Actor</small>
                <strong>{row.actor?.fullName || (row.actor ? 'Platform user' : 'Internal system')}</strong>
                <p>{row.actor?.email || 'No actor account'}</p>
              </div>
            </article>

            <article>
              <span><Fingerprint size={15} /></span>
              <div>
                <small>Target</small>
                <strong>{humanize(row.targetType)}</strong>
                <p>{row.targetId || 'No target ID'}</p>
              </div>
            </article>

            <article>
              <span><FileDiff size={15} /></span>
              <div>
                <small>State change</small>
                <strong>{fields.length ? `${fields.length} changed fields` : 'Snapshot event'}</strong>
                <p>{fields.length ? fields.slice(0, 4).map(humanize).join(', ') : 'No comparable field changes'}</p>
              </div>
            </article>
          </section>

          {fields.length > 0 && (
            <section className="admin-audit-change-list">
              <header>
                <span><Activity size={15} /></span>
                <div>
                  <small>CHANGESET</small>
                  <h3>Changed fields</h3>
                </div>
              </header>

              <div>
                {fields.slice(0, 24).map((field) => (
                  <span key={field}>{humanize(field)}</span>
                ))}
              </div>
            </section>
          )}

          <section className="admin-audit-snapshots">
            <SnapshotCard
              label="BEFORE"
              title="Previous state"
              value={row.oldValue}
              changed={fields}
              tone="before"
            />

            <SnapshotCard
              label="AFTER"
              title="New state"
              value={row.newValue}
              changed={fields}
              tone="after"
            />
          </section>

          <section className="admin-audit-inspector__meta">
            <article>
              <small>Audit ID</small>
              <strong>{row.id || '—'}</strong>
            </article>
            <article>
              <small>Actor ID</small>
              <strong>{row.actorId || row.actor?.id || 'SYSTEM'}</strong>
            </article>
            <article>
              <small>Actor role</small>
              <strong>{row.actor?.role || 'SYSTEM'}</strong>
            </article>
            <article>
              <small>Target ID</small>
              <strong>{row.targetId || '—'}</strong>
            </article>
          </section>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export default function AdminAuditLogsPage() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: PAGE_SIZE, totalPages: 1 });
  const [summary, setSummary] = useState({});

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [action, setAction] = useState('');
  const [targetType, setTargetType] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [selectedRow, setSelectedRow] = useState(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 280);

    return () => window.clearTimeout(timer);
  }, [search]);

  const commonParams = useMemo(
    () => ({
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...(action ? { action } : {}),
      ...(targetType ? { targetType } : {}),
      ...(fromDate ? { fromDate: toStartOfDayIso(fromDate) } : {}),
      ...(toDate ? { toDate: toEndOfDayIso(toDate) } : {}),
    }),
    [debouncedSearch, action, targetType, fromDate, toDate],
  );

  const listParams = useMemo(
    () => ({
      page,
      limit: PAGE_SIZE,
      ...commonParams,
      sortBy,
      sortOrder,
    }),
    [page, commonParams, sortBy, sortOrder],
  );

  const load = useCallback(async ({ fresh = false, silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError('');

    try {
      const listLoader =
        fresh && adminApi.auditLogs.listFresh
          ? adminApi.auditLogs.listFresh
          : adminApi.auditLogs.list;

      const summaryLoader =
        fresh && adminApi.auditLogs.summaryFresh
          ? adminApi.auditLogs.summaryFresh
          : adminApi.auditLogs.summary;

      const [listResult, summaryResult] = await Promise.all([
        listLoader(listParams),
        summaryLoader(commonParams),
      ]);

      const nextRows = unwrapRows(listResult);
      setRows(nextRows);
      setMeta(unwrapMeta(listResult, nextRows.length));
      setSummary(unwrapSummary(summaryResult));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Could not load audit history.'));
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

  const exportCsv = async () => {
    if (exporting) return;

    setExporting(true);
    setError('');

    try {
      await adminApi.auditLogs.exportCsv({
        ...commonParams,
        sortBy,
        sortOrder,
      });
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Could not export the audit trail.'));
    } finally {
      setExporting(false);
    }
  };

  const clearDates = () => {
    setFromDate('');
    setToDate('');
    setPage(1);
  };

  const totalLogs = Number(summary.totalLogs ?? meta.total ?? 0);
  const adminActions = Number(summary.adminActions ?? 0);
  const systemEvents = Number(summary.logsWithoutActor ?? 0);
  const uniqueActors = Number(summary.uniqueActors ?? 0);

  return (
    <div className="admin-audit-page">
      <section className="admin-audit-hero">
        <div>
          <span className="admin-audit-eyebrow"><ShieldCheck size={16} /> SECURITY & GOVERNANCE</span>
          <h1>Audit trail</h1>
          <p>Trace privileged changes, user activity and internal system events with immutable before-and-after snapshots.</p>
        </div>

        <div className="admin-audit-hero__actions">
          <button type="button" className="admin-audit-button is-quiet" onClick={refresh} disabled={refreshing}>
            <RefreshCw className={refreshing ? 'admin-audit-spin' : ''} size={16} />
            Refresh
          </button>

          <button type="button" className="admin-audit-button is-primary" onClick={exportCsv} disabled={exporting}>
            {exporting ? <LoaderCircle className="admin-audit-spin" size={16} /> : <Download size={16} />}
            Export CSV
          </button>
        </div>
      </section>

      {error && (
        <div className="admin-audit-feedback">
          <CircleAlert size={16} />
          <span>{error}</span>
          <button type="button" onClick={() => setError('')}><X size={14} /></button>
        </div>
      )}

      <section className="admin-audit-directory">
        <header className="admin-audit-directory__header">
          <div>
            <small>IMMUTABLE EVENT LEDGER</small>
            <h2>Audit activity</h2>
            <p>{meta.total.toLocaleString()} matching {meta.total === 1 ? 'record' : 'records'}</p>
          </div>

          <span className="admin-audit-readonly">
            <ShieldCheck size={14} />
            Read-only · append-only
          </span>
        </header>

        <div className="admin-audit-metrics">
          <MetricCard icon={FileText} label="Total records" value={totalLogs} hint="Matching audit events" />
          <MetricCard icon={ShieldCheck} label="Admin actions" value={adminActions} hint="Privileged administrator events" tone="is-mint" />
          <MetricCard icon={TerminalSquare} label="System events" value={systemEvents} hint="Events without a user actor" tone="is-gray" />
          <MetricCard icon={UsersRound} label="Active actors" value={uniqueActors} hint="Distinct actors in this result set" />
        </div>

        <div className="admin-audit-toolbar">
          <Dropdown
            label="Action"
            value={action}
            options={ACTION_OPTIONS}
            onChange={(value) => {
              setAction(value);
              setPage(1);
            }}
            icon={Activity}
          />

          <Dropdown
            label="Target type"
            value={targetType}
            options={TARGET_OPTIONS}
            onChange={(value) => {
              setTargetType(value);
              setPage(1);
            }}
            icon={Fingerprint}
          />

          <SortControl
            value={sortBy}
            order={sortOrder}
            onChange={(value) => {
              setSortBy(value);
              setPage(1);
            }}
            onToggle={() => {
              setSortOrder((current) => current === 'asc' ? 'desc' : 'asc');
              setPage(1);
            }}
          />

          <div className="admin-audit-date-range">
            <label>
              <CalendarDays size={14} />
              <span>
                <small>From</small>
                <input
                  type="date"
                  value={fromDate}
                  max={toDate || undefined}
                  onChange={(event) => {
                    const value = event.target.value;
                    setFromDate(value);
                    if (toDate && value > toDate) setToDate(value);
                    setPage(1);
                  }}
                />
              </span>
            </label>

            <label>
              <CalendarDays size={14} />
              <span>
                <small>To</small>
                <input
                  type="date"
                  value={toDate}
                  min={fromDate || undefined}
                  onChange={(event) => {
                    const value = event.target.value;
                    setToDate(value);
                    if (fromDate && value < fromDate) setFromDate(value);
                    setPage(1);
                  }}
                />
              </span>
            </label>

            {(fromDate || toDate) && (
              <button type="button" onClick={clearDates} title="Clear date range">
                <X size={14} />
              </button>
            )}
          </div>

          <label className="admin-audit-search">
            <Search size={17} />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search actor, email or target ID..."
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="Clear search">
                <X size={14} />
              </button>
            )}
          </label>
        </div>

        <div className="admin-audit-table-wrap">
          {loading ? (
            <div className="admin-audit-table-state">
              <LoaderCircle className="admin-audit-spin" size={24} />
              <strong>Loading audit history…</strong>
            </div>
          ) : rows.length === 0 ? (
            <div className="admin-audit-table-state">
              <History size={27} />
              <strong>No audit events match these filters.</strong>
              <span>Try another action, target type, date range or search phrase.</span>
            </div>
          ) : (
            <table className="admin-audit-table">
              <thead>
                <tr>
                  <th>EVENT</th>
                  <th>ACTOR</th>
                  <th>TARGET</th>
                  <th>CHANGE</th>
                  <th>CREATED</th>
                  <th className="is-actions">ACTIONS</th>
                </tr>
              </thead>

              <tbody>
                {rows.map((row) => {
                  const group = actionGroup(row.action);
                  const change = changeSummary(row);

                  return (
                    <tr key={row.id}>
                      <td>
                        <div className="admin-audit-event">
                          <span className={`admin-audit-event__icon is-${group}`}>
                            {group === 'system' ? <TerminalSquare size={16} /> : <History size={16} />}
                            <i aria-hidden="true" />
                          </span>

                          <div>
                            <strong title={humanize(row.action)}>{humanize(row.action)}</strong>
                            <span>{group === 'admin' ? 'Administrator action' : group === 'user' ? 'User activity' : 'System pipeline event'}</span>
                            <small>{row.id?.slice(0, 12)}…</small>
                          </div>
                        </div>
                      </td>

                      <td>
                        <div className="admin-audit-actor">
                          <span>{row.actor ? String(row.actor.fullName || row.actor.email || 'U').charAt(0).toUpperCase() : 'S'}</span>
                          <div>
                            <strong>{row.actor?.fullName || (row.actor ? 'Platform user' : 'Internal system')}</strong>
                            <small>{row.actor?.email || 'No actor account'}</small>
                          </div>
                        </div>
                      </td>

                      <td>
                        <div className="admin-audit-target">
                          <span className={`is-${targetTone(row.targetType)}`}>{humanize(row.targetType)}</span>
                          <small title={row.targetId || ''}>{row.targetId || 'No target ID'}</small>
                        </div>
                      </td>

                      <td>
                        <div className="admin-audit-change">
                          <strong>{change.label}</strong>
                          <span>{change.detail}</span>
                        </div>
                      </td>

                      <td>
                        <div className="admin-audit-created">
                          <strong>{formatShortDate(row.createdAt)}</strong>
                          <span><Clock3 size={11} /> {formatTime(row.createdAt)}</span>
                        </div>
                      </td>

                      <td className="is-actions">
                        <button type="button" className="admin-audit-view" onClick={() => setSelectedRow(row)}>
                          <Eye size={15} />
                          Inspect
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <footer className="admin-audit-pagination">
          <span>
            Showing {rows.length ? (meta.page - 1) * meta.limit + 1 : 0}
            {'–'}
            {Math.min(meta.page * meta.limit, meta.total)} of {meta.total}
          </span>

          <div>
            <button
              type="button"
              disabled={meta.page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Previous
            </button>

            <span>Page {meta.page} of {meta.totalPages}</span>

            <button
              type="button"
              disabled={meta.page >= meta.totalPages}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </button>
          </div>
        </footer>
      </section>

      <AuditInspector row={selectedRow} onClose={() => setSelectedRow(null)} />
    </div>
  );
}