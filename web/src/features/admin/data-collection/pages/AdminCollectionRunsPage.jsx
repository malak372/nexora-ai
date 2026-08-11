import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Database,
  FileText,
  Layers3,
  LoaderCircle,
  MapPin,
  MessageSquareText,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { adminApi, getApiErrorMessage } from '../../shared/api/adminApi';
import '../../shared/styles/admin-pages.css';
import '../styles/admin-collection-runs.css';

const PAGE_SIZE = 20;

const STATUS_FILTERS = [
  { key: 'all', label: 'All runs' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'RUNNING', label: 'Running' },
  { key: 'COMPLETED', label: 'Completed' },
  { key: 'FAILED', label: 'Failed' },
  { key: 'STOPPED', label: 'Stopped' },
];

const SORT_OPTIONS = [
  { key: 'createdAt', label: 'Created date' },
  { key: 'startedAt', label: 'Started date' },
  { key: 'completedAt', label: 'Completed date' },
  { key: 'totalPosts', label: 'Posts collected' },
  { key: 'totalComments', label: 'Comments collected' },
];

const STATUS_META = {
  PENDING: { label: 'Pending', className: 'is-pending' },
  RUNNING: { label: 'Running', className: 'is-running' },
  COMPLETED: { label: 'Completed', className: 'is-completed' },
  FAILED: { label: 'Failed', className: 'is-failed' },
  STOPPED: { label: 'Stopped', className: 'is-stopped' },
};

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unwrapRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!isObject(payload)) return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.jobs)) return payload.jobs;
  if (isObject(payload.data)) {
    const nested = Object.values(payload.data).find(Array.isArray);
    if (nested) return nested;
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
    Number(source.totalPages ?? source.pages ?? Math.ceil(total / Math.max(limit, 1))) || 1,
  );
  return { total, page, limit, totalPages };
}

function unwrapStatus(payload) {
  const root = isObject(payload?.data) ? payload.data : payload;
  return isObject(root) ? root : {};
}

function formatDate(value, compact = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  if (compact) {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDuration(startedAt, completedAt, status) {
  if (!startedAt) return 'Not started';
  const start = new Date(startedAt).getTime();
  const end = completedAt
    ? new Date(completedAt).getTime()
    : status === 'RUNNING'
      ? Date.now()
      : start;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '—';

  const totalSeconds = Math.max(0, Math.floor((end - start) / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function shortId(value) {
  const text = String(value || '');
  if (!text) return '—';
  return text.length <= 10 ? text : `${text.slice(0, 8)}…`;
}

function normalizeKeywords(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function sourceName(source) {
  return source?.dataSource?.displayName || source?.dataSource?.key || 'Source';
}

function sourceKey(source) {
  return source?.dataSource?.key || '';
}

function statusInfo(status) {
  return STATUS_META[String(status || '').toUpperCase()] || {
    label: String(status || 'Unknown').replaceAll('_', ' '),
    className: 'is-pending',
  };
}

function StatusBadge({ status, compact = false }) {
  const meta = statusInfo(status);
  return (
    <span className={`admin-cr-status ${meta.className} ${compact ? 'is-compact' : ''}`}>
      <i />
      {meta.label}
    </span>
  );
}

function MetricCard({ icon: Icon, label, value, hint, tone = '' }) {
  return (
    <article className={`admin-cr-metric ${tone}`}>
      <i aria-hidden="true" />
      <span className="admin-cr-metric__icon"><Icon size={20} /></span>
      <div>
        <small>{label}</small>
        <strong>{Number(value || 0).toLocaleString()}</strong>
        <span>{hint}</span>
      </div>
    </article>
  );
}

function SelectMenu({ label, value, options, onChange, icon: Icon = SlidersHorizontal, minWidth = 220 }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = options.find((option) => option.key === value) || options[0];

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);

  return (
    <div className={`admin-cr-picker ${open ? 'is-open' : ''}`} ref={ref} style={{ '--cr-picker-width': `${minWidth}px` }}>
      <button
        type="button"
        className="admin-cr-picker__trigger"
        onClick={() => setOpen((currentOpen) => !currentOpen)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Icon size={15} />
        <span><small>{label}</small><strong>{current?.label || 'Select'}</strong></span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="admin-cr-picker__menu" role="listbox">
          {options.map((option) => (
            <button
              key={option.key}
              type="button"
              role="option"
              aria-selected={option.key === value}
              className={option.key === value ? 'is-active' : ''}
              onClick={() => {
                onChange(option.key);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {option.count !== undefined && <em>{Number(option.count || 0).toLocaleString()}</em>}
              {option.key === value && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SortControl({ sortBy, sortOrder, onChange, onToggle }) {
  const options = SORT_OPTIONS;
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = options.find((option) => option.key === sortBy) || options[0];

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);

  return (
    <div className={`admin-cr-sort ${open ? 'is-open' : ''}`} ref={ref}>
      <button type="button" className="admin-cr-sort__trigger" onClick={() => setOpen((value) => !value)}>
        <SlidersHorizontal size={15} />
        <span><small>Sort runs</small><strong>{current.label}</strong></span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="admin-cr-sort__menu">
          {options.map((option) => (
            <button
              key={option.key}
              type="button"
              className={sortBy === option.key ? 'is-active' : ''}
              onClick={() => {
                onChange(option.key);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {sortBy === option.key && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className="admin-cr-sort__direction"
        onClick={onToggle}
        title={sortOrder === 'asc' ? 'Ascending order' : 'Descending order'}
      >
        {sortOrder === 'asc' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
      </button>
    </div>
  );
}

function SourceChips({ sources }) {
  const visible = (sources || []).slice(0, 2);
  const hidden = Math.max(0, (sources || []).length - visible.length);
  if (!sources?.length) return <span className="admin-cr-muted">No sources</span>;
  return (
    <div className="admin-cr-source-chips">
      {visible.map((source) => (
        <span key={source.id || sourceKey(source)} title={sourceName(source)}>
          {sourceName(source)}
        </span>
      ))}
      {hidden > 0 && <span className="is-more">+{hidden}</span>}
    </div>
  );
}

function RunDetailsModal({ run, onClose, onChanged }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirmStop, setConfirmStop] = useState(false);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [busy, onClose]);

  if (!run || typeof document === 'undefined') return null;

  const sources = Array.isArray(run.sources) ? run.sources : [];
  const keywords = normalizeKeywords(run.keywords);
  const isRunning = String(run.status).toUpperCase() === 'RUNNING';
  const canRetry = ['FAILED', 'STOPPED'].includes(String(run.status).toUpperCase());
  const location = [run.city, run.region, run.country].filter(Boolean).join(', ');

  const stopRun = async () => {
    if (!confirmStop) {
      setConfirmStop(true);
      return;
    }
    setBusy('stop');
    setError('');
    try {
      await adminApi.collection.stop(run.id);
      await onChanged('Collection run stopped.');
      onClose();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Could not stop this collection run.'));
    } finally {
      setBusy('');
      setConfirmStop(false);
    }
  };

  const retryRun = async () => {
    setBusy('retry');
    setError('');
    try {
      const body = {
        domainId: run.domainId || run.domain?.id,
        language: run.language,
        ...(run.country ? { country: run.country } : {}),
        ...(run.city ? { city: run.city } : {}),
        ...(run.region ? { region: run.region } : {}),
        ...(Number.isFinite(Number(run.radiusKm)) && Number(run.radiusKm) > 0 ? { radiusKm: Number(run.radiusKm) } : {}),
        ...(sources.length ? { dataSourceKeys: sources.map(sourceKey).filter(Boolean) } : {}),
        ...(keywords.length ? { keywords } : {}),
      };
      await adminApi.collection.run(body);
      await onChanged('A fresh collection run was started with the same configuration.');
      onClose();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Could not retry this collection run.'));
    } finally {
      setBusy('');
    }
  };

  return createPortal(
    <div className="admin-cr-modal-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section className="admin-cr-modal" role="dialog" aria-modal="true" aria-labelledby="admin-cr-modal-title">
        <header className="admin-cr-modal__head">
          <span className="admin-cr-modal__mark"><Database size={21} /></span>
          <div>
            <span>Collection run inspector</span>
            <h3 id="admin-cr-modal-title">{run.domain?.name || 'Collection run'}</h3>
            <small>Run {shortId(run.id)} · {formatDate(run.createdAt)}</small>
          </div>
          <button type="button" className="admin-cr-modal__close" onClick={onClose} disabled={Boolean(busy)} aria-label="Close"><X size={18} /></button>
        </header>

        <div className="admin-cr-modal__body">
          <section className="admin-cr-modal__overview">
            <div className="admin-cr-overview-card is-status">
              <span>Pipeline status</span>
              <StatusBadge status={run.status} />
              <small>{run.failedReason || (isRunning ? 'Collection is currently processing.' : 'Latest persisted run state.')}</small>
            </div>
            <div className="admin-cr-overview-card">
              <span>Evidence collected</span>
              <strong>{(Number(run.totalPosts || 0) + Number(run.totalComments || 0)).toLocaleString()}</strong>
              <small>{Number(run.totalPosts || 0).toLocaleString()} posts · {Number(run.totalComments || 0).toLocaleString()} comments</small>
            </div>
            <div className="admin-cr-overview-card">
              <span>Duration</span>
              <strong>{formatDuration(run.startedAt, run.completedAt, run.status)}</strong>
              <small>{formatDate(run.startedAt)} → {run.completedAt ? formatDate(run.completedAt) : 'Now'}</small>
            </div>
          </section>

          <div className="admin-cr-modal__columns">
            <div className="admin-cr-modal__main">
              <section className="admin-cr-detail-card">
                <div className="admin-cr-detail-card__title"><Layers3 size={15} /><span><strong>Run context</strong><small>Domain, language and collection scope</small></span></div>
                <div className="admin-cr-facts">
                  <div><span>Domain</span><strong>{run.domain?.name || '—'}</strong></div>
                  <div><span>Language</span><strong>{run.language || '—'}</strong></div>
                  <div><span>Started by</span><strong>{run.createdBy?.fullName || run.createdBy?.email || (run.createdById ? shortId(run.createdById) : 'Internal / legacy')}</strong></div>
                  <div><span>Location</span><strong>{location || 'No location restriction'}</strong></div>
                  <div><span>Radius</span><strong>{run.radiusKm ? `${run.radiusKm} km` : 'Not set'}</strong></div>
                  <div><span>Run ID</span><strong className="is-mono">{run.id}</strong></div>
                </div>
                {keywords.length > 0 && (
                  <div className="admin-cr-keywords">
                    <span>Keywords</span>
                    <div>{keywords.slice(0, 12).map((keyword) => <em key={keyword}>{keyword}</em>)}</div>
                  </div>
                )}
              </section>

              <section className="admin-cr-detail-card">
                <div className="admin-cr-detail-card__title"><Database size={15} /><span><strong>Source execution</strong><small>Collector-level outcomes for this run</small></span></div>
                <div className="admin-cr-source-list">
                  {sources.length === 0 && <div className="admin-cr-source-empty">No source execution records are attached to this run.</div>}
                  {sources.map((source) => (
                    <article key={source.id || `${run.id}-${sourceKey(source)}`}>
                      <span className="admin-cr-source-list__mark">{sourceName(source).charAt(0).toUpperCase()}</span>
                      <div className="admin-cr-source-list__copy">
                        <strong>{sourceName(source)}</strong>
                        <small>{sourceKey(source) || 'collector'}</small>
                      </div>
                      <StatusBadge status={source.status} compact />
                      <div className="admin-cr-source-list__counts">
                        <span><FileText size={12} /> {Number(source.totalPosts || 0).toLocaleString()}</span>
                        <span><MessageSquareText size={12} /> {Number(source.totalComments || 0).toLocaleString()}</span>
                      </div>
                      <div className="admin-cr-source-list__time">
                        <strong>{formatDuration(source.startedAt, source.completedAt, source.status)}</strong>
                        <small>{source.failureReason || formatDate(source.completedAt || source.startedAt, true)}</small>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </div>

            <aside className="admin-cr-modal__aside">
              <section className="admin-cr-side-card">
                <span className="admin-cr-side-card__icon"><Clock3 size={17} /></span>
                <div><small>Created</small><strong>{formatDate(run.createdAt)}</strong></div>
                <div><small>Last update</small><strong>{formatDate(run.updatedAt)}</strong></div>
                <div><small>Completed</small><strong>{formatDate(run.completedAt)}</strong></div>
              </section>

              <section className="admin-cr-side-card">
                <span className="admin-cr-side-card__icon"><ShieldCheck size={17} /></span>
                <div><small>Run state</small><strong>{statusInfo(run.status).label}</strong></div>
                <div><small>Sources</small><strong>{sources.length.toLocaleString()}</strong></div>
                <div><small>NLP analysis</small><strong>{run.nlpAnalysis ? 'Available' : 'Not attached'}</strong></div>
              </section>

              {run.failedReason && (
                <section className="admin-cr-side-card is-warning">
                  <span className="admin-cr-side-card__icon"><AlertTriangle size={17} /></span>
                  <div><small>Failure reason</small><strong>{run.failedReason}</strong></div>
                </section>
              )}
            </aside>
          </div>
        </div>

        {error && <div className="admin-cr-modal__error"><AlertTriangle size={15} /> {error}</div>}

        <footer className="admin-cr-modal__footer">
          <div className="admin-cr-modal__safety">
            <ShieldCheck size={16} />
            <span><strong>Operational controls</strong><small>Stopping affects only running collection work. Retrying creates a new run and keeps this history intact.</small></span>
          </div>
          <div className="admin-cr-modal__actions">
            <button type="button" className="admin-cr-action is-secondary" onClick={onClose} disabled={Boolean(busy)}><X size={15} /> Close</button>
            {canRetry && (
              <button type="button" className="admin-cr-action is-retry" onClick={retryRun} disabled={Boolean(busy)}>
                {busy === 'retry' ? <LoaderCircle className="admin-spin" size={16} /> : <RotateCcw size={16} />}
                <span><strong>Retry collection</strong><small>Start a fresh run</small></span>
              </button>
            )}
            {isRunning && (
              <button type="button" className={`admin-cr-action is-stop ${confirmStop ? 'is-confirming' : ''}`} onClick={stopRun} disabled={Boolean(busy)}>
                {busy === 'stop' ? <LoaderCircle className="admin-spin" size={16} /> : <Square size={15} />}
                <span><strong>{confirmStop ? 'Confirm stop' : 'Stop run'}</strong><small>{confirmStop ? 'Click again to stop now' : 'End active collection'}</small></span>
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

export default function AdminCollectionRunsPage() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: PAGE_SIZE, totalPages: 1 });
  const [statusPayload, setStatusPayload] = useState({});
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [detail, setDetail] = useState(null);
  const [openingId, setOpeningId] = useState('');
  const requestRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 280);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(''), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const onWorkspaceSearch = (event) => setSearchInput(String(event.detail || ''));
    window.addEventListener('voxidence:admin-search', onWorkspaceSearch);
    return () => window.removeEventListener('voxidence:admin-search', onWorkspaceSearch);
  }, []);

  const loadData = useCallback(async ({ quiet = false } = {}) => {
    const requestId = ++requestRef.current;
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError('');

    try {
      const params = {
        page,
        limit: PAGE_SIZE,
        sortBy,
        sortOrder,
        ...(search ? { search } : {}),
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
        ...(sourceFilter !== 'all' ? { dataSourceKey: sourceFilter } : {}),
      };

      const listPayload = await adminApi.collection.list(params);
      if (requestId !== requestRef.current) return;
      const nextRows = unwrapRows(listPayload);
      setRows(nextRows);
      setMeta(unwrapMeta(listPayload, nextRows.length));

      adminApi.collection.status()
        .then((payload) => {
          if (requestId === requestRef.current) setStatusPayload(unwrapStatus(payload));
        })
        .catch(() => null);
    } catch (requestError) {
      if (requestId !== requestRef.current) return;
      setRows([]);
      setError(getApiErrorMessage(requestError, 'Could not load collection runs.'));
    } finally {
      if (requestId === requestRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [page, search, sortBy, sortOrder, sourceFilter, statusFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const metrics = useMemo(() => {
    const jobsStatus = statusPayload?.jobs || {};
    const running = Number(jobsStatus.running || 0);
    const completed = Number(jobsStatus.completed || 0);
    const failed = Number(jobsStatus.failed || 0);
    const stopped = Number(jobsStatus.stopped || 0);
    const pending = Number(jobsStatus.pending || 0);
    const total = Number(
      jobsStatus.total ?? (running + completed + failed + stopped + pending),
    );

    return { total, running, completed, failed, stopped, pending };
  }, [statusPayload?.jobs]);

  const sourceOptions = useMemo(() => {
    const dataSources = Array.isArray(statusPayload?.dataSources) ? statusPayload.dataSources : [];
    return [
      { key: 'all', label: 'All data sources' },
      ...dataSources.map((source) => ({ key: source.key, label: source.displayName || source.key })),
    ];
  }, [statusPayload]);

  const openDetails = async (row) => {
    setOpeningId(row.id);
    setError('');
    try {
      const payload = await adminApi.collection.detail(row.id);
      const value = isObject(payload?.data) ? payload.data : payload;
      setDetail(value);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Could not open collection run details.'));
    } finally {
      setOpeningId('');
    }
  };

  const start = meta.total === 0 ? 0 : ((meta.page - 1) * meta.limit) + 1;
  const end = Math.min(meta.page * meta.limit, meta.total);

  return (
    <div className="admin-page admin-cr-page">
      <section className="admin-hero admin-cr-hero">
        <div className="admin-hero__eyebrow"><Database size={14} /> Evidence pipeline</div>
        <h2>Collection runs</h2>
        <p>Monitor evidence ingestion, inspect source-level execution, stop unhealthy active work, and retry failed collection jobs without exposing raw database fields.</p>
      </section>

      <section className="admin-cr-panel">
        <header className="admin-cr-panel__head">
          <div>
            <span className="admin-cr-kicker"><Database size={13} /> Pipeline operations</span>
            <h3>Collection operations</h3>
            <p>{meta.total.toLocaleString()} matching run{meta.total === 1 ? '' : 's'} in this view</p>
          </div>
          <div className="admin-cr-head-state">
            <span className={`admin-cr-live ${statusPayload?.available === false ? 'is-offline' : ''}`}><i /> {statusPayload?.available === false ? 'Pipeline unavailable' : 'Live pipeline'}</span>
            <button type="button" className="admin-cr-refresh" onClick={() => loadData({ quiet: true })} disabled={refreshing}>
              <RefreshCw size={14} className={refreshing ? 'admin-spin' : ''} /> Refresh
            </button>
          </div>
        </header>

        {!loading && (
          <div className="admin-cr-metrics">
            <MetricCard icon={Database} label="Total runs" value={metrics.total} hint={`${metrics.pending.toLocaleString()} pending`} tone="is-primary" />
            <MetricCard icon={Play} label="Running" value={metrics.running} hint="Currently collecting evidence" tone="is-running" />
            <MetricCard icon={CheckCircle2} label="Completed" value={metrics.completed} hint="Finished successfully" tone="is-completed" />
            <MetricCard icon={AlertTriangle} label="Needs attention" value={metrics.failed + metrics.stopped} hint={`${metrics.failed} failed · ${metrics.stopped} stopped`} tone="is-attention" />
          </div>
        )}

        <div className="admin-cr-status-tabs" role="tablist" aria-label="Filter collection runs by status">
          {STATUS_FILTERS.map((option) => (
            <button
              key={option.key}
              type="button"
              className={statusFilter === option.key ? 'is-active' : ''}
              onClick={() => {
                setStatusFilter(option.key);
                setPage(1);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="admin-cr-tools">
          <SortControl
            sortBy={sortBy}
            sortOrder={sortOrder}
            onChange={(value) => {
              setSortBy(value);
              setSortOrder('desc');
              setPage(1);
            }}
            onToggle={() => {
              setSortOrder((current) => (current === 'asc' ? 'desc' : 'asc'));
              setPage(1);
            }}
          />

          <SelectMenu
            label="Data source"
            value={sourceFilter}
            options={sourceOptions}
            onChange={(value) => {
              setSourceFilter(value);
              setPage(1);
            }}
            icon={Database}
            minWidth={210}
          />

          <label className="admin-cr-search">
            <Search size={17} />
            <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search domain, source or location..." />
            {searchInput && <button type="button" onClick={() => setSearchInput('')} aria-label="Clear search"><X size={14} /></button>}
          </label>
        </div>

        {notice && <div className="admin-cr-notice"><CheckCircle2 size={15} /> {notice}</div>}
        {error && <div className="admin-cr-error"><AlertTriangle size={15} /> {error}</div>}

        <div className="admin-cr-table-wrap">
          <table className="admin-cr-table">
            <thead>
              <tr>
                <th>Run</th>
                <th>Domain</th>
                <th>Pipeline</th>
                <th>Evidence</th>
                <th>Timing</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan="6"><div className="admin-cr-empty"><LoaderCircle size={23} className="admin-spin" /><strong>Loading collection runs…</strong></div></td></tr>
              )}

              {!loading && !error && rows.length === 0 && (
                <tr><td colSpan="6"><div className="admin-cr-empty"><Database size={25} /><strong>No collection runs match this view.</strong><span>Try another status, data source, or search term.</span></div></td></tr>
              )}

              {!loading && rows.map((row) => {
                const totalEvidence = Number(row.totalPosts || 0) + Number(row.totalComments || 0);
                const isOpening = openingId === row.id;
                return (
                  <tr key={row.id}>
                    <td data-label="Run">
                      <div className="admin-cr-run-cell">
                        <span className={`admin-cr-run-mark ${statusInfo(row.status).className}`} aria-label={`${statusInfo(row.status).label} collection run`}><Database size={16} /></span>
                        <div>
                          <strong>Run {shortId(row.id)}</strong>
                          <small>{row.createdBy?.fullName || row.createdBy?.email || (row.createdById ? `User ${shortId(row.createdById)}` : 'Internal / legacy')}</small>
                          <span>{row.language || 'ANY'} · {formatDate(row.createdAt, true)}</span>
                        </div>
                      </div>
                    </td>

                    <td data-label="Domain">
                      <div className="admin-cr-domain-cell">
                        <strong>{row.domain?.name || 'Unknown domain'}</strong>
                        {(row.city || row.region || row.country) ? (
                          <span><MapPin size={11} /> {[row.city, row.region, row.country].filter(Boolean).join(', ')}</span>
                        ) : (
                          <span><Layers3 size={11} /> Global scope</span>
                        )}
                      </div>
                    </td>

                    <td data-label="Pipeline">
                      <div className="admin-cr-pipeline-cell">
                        <StatusBadge status={row.status} />
                        <SourceChips sources={row.sources} />
                      </div>
                    </td>

                    <td data-label="Evidence">
                      <div className="admin-cr-evidence-cell">
                        <strong>{totalEvidence.toLocaleString()}</strong>
                        <div>
                          <span><FileText size={11} /> {Number(row.totalPosts || 0).toLocaleString()} posts</span>
                          <span><MessageSquareText size={11} /> {Number(row.totalComments || 0).toLocaleString()} comments</span>
                        </div>
                      </div>
                    </td>

                    <td data-label="Timing">
                      <div className="admin-cr-time-cell">
                        <strong>{formatDuration(row.startedAt, row.completedAt, row.status)}</strong>
                        <span><Clock3 size={11} /> {row.completedAt ? `Ended ${formatDate(row.completedAt, true)}` : row.startedAt ? `Started ${formatDate(row.startedAt, true)}` : 'Waiting to start'}</span>
                      </div>
                    </td>

                    <td data-label="Actions" className="admin-cr-actions-cell">
                      <button type="button" className="admin-cr-inspect" onClick={() => openDetails(row)} disabled={Boolean(openingId)}>
                        {isOpening ? <LoaderCircle size={14} className="admin-spin" /> : <Search size={14} />}
                        <span>Inspect</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <footer className="admin-cr-pagination">
          <span>{meta.total ? `Showing ${start}-${end} of ${meta.total.toLocaleString()}` : 'No records'}</span>
          <div>
            <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft size={14} /> Previous</button>
            <strong>Page {meta.page} of {meta.totalPages}</strong>
            <button type="button" disabled={page >= meta.totalPages || loading} onClick={() => setPage((current) => Math.min(meta.totalPages, current + 1))}>Next <ChevronRight size={14} /></button>
          </div>
        </footer>
      </section>

      {detail && (
        <RunDetailsModal
          run={detail}
          onClose={() => setDetail(null)}
          onChanged={async (message) => {
            setNotice(message);
            await loadData({ quiet: true });
          }}
        />
      )}
    </div>
  );
}