import {
  Activity,
  ArrowDown,
  ArrowUp,
  Bot,
  CalendarRange,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Cpu,
  Download,
  Eye,
  Gauge,
  GitBranch,
  LoaderCircle,
  RefreshCw,
  Search,
  ServerCog,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Timer,
  TriangleAlert,
  UserRound,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { adminApi, getApiErrorMessage } from '../../shared/api/adminApi';
import '../../shared/styles/admin-pages.css';
import '../styles/admin-ai-monitoring.css';

const PAGE_SIZE = 20;

const STATUS_OPTIONS = [
  { key: 'all', label: 'All requests' },
  { key: 'success', label: 'Successful' },
  { key: 'failed', label: 'Failed' },
];

const EXECUTION_OPTIONS = [
  { key: 'all', label: 'All execution paths' },
  { key: 'retryable', label: 'Retryable failures' },
  { key: 'fallback', label: 'Fallback attempts' },
];

const SORT_OPTIONS = [
  { key: 'createdAt', label: 'Request date' },
  { key: 'responseTimeMs', label: 'Latency' },
  { key: 'costEstimate', label: 'Estimated cost' },
  { key: 'attemptNumber', label: 'Attempt number' },
  { key: 'providerKey', label: 'Provider' },
  { key: 'requestType', label: 'Request type' },
];

const REQUEST_TYPE_LABELS = {
  DATA_COLLECTION: 'Data collection',
  COMMENT_ANALYSIS: 'Comment analysis',
  IDEA_GENERATION: 'Idea generation',
  AI_CHAT: 'AI chat',
  PAYMENT: 'Payment',
  OTHER: 'Other',
  NLP_ENHANCEMENT: 'NLP enhancement',
};

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

function unwrapObject(payload) {
  if (!isObject(payload)) return {};
  return isObject(payload.data) ? payload.data : payload;
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

function number(value) {
  return Number(value || 0).toLocaleString();
}

function money(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return '$0';
  if (amount === 0) return '$0';
  if (amount < 0.01) return `$${amount.toFixed(6)}`;
  return `$${amount.toFixed(2)}`;
}

function shortId(value, length = 9) {
  const text = String(value || '').trim();
  if (!text) return '—';
  return text.length > length + 1 ? `${text.slice(0, length)}…` : text;
}

function titleCase(value) {
  return String(value || '')
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function requestTypeLabel(value) {
  return REQUEST_TYPE_LABELS[String(value || '').toUpperCase()] || titleCase(value || 'AI request');
}

function dateBoundaryIso(value, endOfDay = false) {
  if (!value) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  if (![year, month, day].every(Number.isFinite)) return undefined;
  const date = new Date(
    year,
    month - 1,
    day,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  );
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function MetricCard({ icon: Icon, label, value, hint, tone = '' }) {
  return (
    <article className={`admin-ai-monitor-metric ${tone}`}>
      <i aria-hidden="true" />
      <span className="admin-ai-monitor-metric__icon"><Icon size={19} /></span>
      <div className="admin-ai-monitor-metric__copy">
        <small>{label}</small>
        <strong>{value}</strong>
        <span>{hint}</span>
      </div>
    </article>
  );
}

function OutcomeBadge({ success, retryable = false }) {
  if (success) {
    return (
      <span className="admin-ai-monitor-outcome is-success">
        <CheckCircle2 size={12} /> Successful
      </span>
    );
  }
  return (
    <span className={`admin-ai-monitor-outcome ${retryable ? 'is-retryable' : 'is-failed'}`}>
      {retryable ? <RefreshCw size={12} /> : <XCircle size={12} />}
      {retryable ? 'Retryable' : 'Failed'}
    </span>
  );
}

function SelectMenu({ label, value, options, onChange, icon: Icon = SlidersHorizontal }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = options.find((option) => option.key === value) || options[0];

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className={`admin-ai-monitor-picker ${open ? 'is-open' : ''}`} ref={ref}>
      <button
        type="button"
        className="admin-ai-monitor-picker__trigger"
        onClick={() => setOpen((state) => !state)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Icon size={15} />
        <span className="admin-ai-monitor-picker__copy">
          <small>{label}</small>
          <strong>{current?.label || 'All'}</strong>
        </span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="admin-ai-monitor-picker__menu" role="listbox">
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
              {option.key === value && <Check size={13} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SortControl({ sortBy, sortOrder, onSortBy, onToggle }) {
  const options = SORT_OPTIONS;
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = options.find((option) => option.key === sortBy) || options[0];

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="admin-ai-monitor-sort" ref={ref}>
      <div className={`admin-ai-monitor-picker ${open ? 'is-open' : ''}`}>
        <button type="button" className="admin-ai-monitor-picker__trigger" onClick={() => setOpen((state) => !state)}>
          <SlidersHorizontal size={15} />
          <span className="admin-ai-monitor-picker__copy"><small>Sort requests</small><strong>{current.label}</strong></span>
          <ChevronDown size={14} />
        </button>
        {open && (
          <div className="admin-ai-monitor-picker__menu">
            {options.map((option) => (
              <button
                key={option.key}
                type="button"
                className={option.key === sortBy ? 'is-active' : ''}
                onClick={() => {
                  onSortBy(option.key);
                  setOpen(false);
                }}
              >
                <span>{option.label}</span>
                {option.key === sortBy && <Check size={13} />}
              </button>
            ))}
          </div>
        )}
      </div>
      <button type="button" className="admin-ai-monitor-sort__direction" onClick={onToggle} title={sortOrder === 'asc' ? 'Ascending order' : 'Descending order'}>
        {sortOrder === 'asc' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
      </button>
    </div>
  );
}

function DateRangeFilter({ fromDate, toDate, onFromChange, onToChange, onClear }) {
  const active = Boolean(fromDate || toDate);
  return (
    <div className={`admin-ai-monitor-date ${active ? 'is-active' : ''}`}>
      <span className="admin-ai-monitor-date__icon"><CalendarRange size={16} /></span>
      <label>
        <small>From</small>
        <input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => onFromChange(event.target.value)} />
      </label>
      <span className="admin-ai-monitor-date__divider" />
      <label>
        <small>To</small>
        <input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => onToChange(event.target.value)} />
      </label>
      {active && (
        <button type="button" onClick={onClear} aria-label="Clear AI monitoring date range"><X size={13} /></button>
      )}
    </div>
  );
}

function DetailItem({ icon: Icon, label, value, mono = false, wide = false }) {
  return (
    <div className={`admin-ai-monitor-detail ${wide ? 'is-wide' : ''}`}>
      {Icon && <span className="admin-ai-monitor-detail__icon"><Icon size={14} /></span>}
      <div className="admin-ai-monitor-detail__copy">
        <small>{label}</small>
        <strong className={mono ? 'is-mono' : ''}>{value ?? '—'}</strong>
      </div>
    </div>
  );
}

function AttemptTimeline({ operation }) {
  const attempts = Array.isArray(operation?.attempts) ? operation.attempts : [];
  if (!attempts.length) {
    return (
      <div className="admin-ai-monitor-timeline-empty">
        <GitBranch size={20} />
        <span>No operation timeline is available for this legacy request.</span>
      </div>
    );
  }

  return (
    <div className="admin-ai-monitor-timeline">
      {attempts.map((attempt, index) => (
        <article className={`admin-ai-monitor-attempt ${attempt.isSuccess ? 'is-success' : 'is-failed'}`} key={attempt.id || `${attempt.operationId}-${index}`}>
          <span className="admin-ai-monitor-attempt__rail" aria-hidden="true">
            <i>{attempt.attemptNumber || index + 1}</i>
          </span>
          <div className="admin-ai-monitor-attempt__body">
            <div className="admin-ai-monitor-attempt__top">
              <div>
                <strong>{attempt.aiModel?.displayName || attempt.aiModel?.modelName || attempt.apiModelId || 'AI model'}</strong>
                <span>{titleCase(attempt.providerKey || 'Unknown provider')} · {attempt.apiModelId || 'Unmapped API model'}</span>
              </div>
              <OutcomeBadge success={attempt.isSuccess} retryable={attempt.isRetryable} />
            </div>
            <div className="admin-ai-monitor-attempt__facts">
              <span><Timer size={12} /> {number(attempt.responseTimeMs)} ms</span>
              <span><Zap size={12} /> {number(Number(attempt.inputTokens || 0) + Number(attempt.outputTokens || 0))} tokens</span>
              <span><span className="admin-ai-monitor-attempt__money">$</span> {money(attempt.costEstimate)}</span>
              {attempt.fallbackUsed && <span className="is-fallback"><GitBranch size={12} /> Fallback</span>}
            </div>
            {!attempt.isSuccess && (attempt.errorCode || attempt.errorMessage) && (
              <div className="admin-ai-monitor-attempt__error">
                <TriangleAlert size={13} />
                <span><strong>{attempt.errorCode || 'Provider error'}</strong>{attempt.errorMessage ? ` — ${attempt.errorMessage}` : ''}</span>
              </div>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

function MonitoringModal({ log, loading, operation, onClose }) {
  useEffect(() => {
    if (!log) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [log, onClose]);

  if (!log) return null;

  const modelName = log.aiModel?.displayName || log.aiModel?.modelName || log.apiModelId || 'AI model';
  const provider = titleCase(log.providerKey || 'Unknown provider');
  const totalTokens = Number(log.inputTokens || 0) + Number(log.outputTokens || 0);

  return createPortal(
    <div className="admin-ai-monitor-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="admin-ai-monitor-modal" role="dialog" aria-modal="true" aria-label="AI request diagnostics">
        <header className="admin-ai-monitor-modal__head">
          <div className="admin-ai-monitor-modal__identity">
            <span className={`admin-ai-monitor-modal__mark ${log.isSuccess ? 'is-success' : 'is-failed'}`}><Bot size={21} /></span>
            <div>
              <small>AI REQUEST DIAGNOSTICS</small>
              <h3>{requestTypeLabel(log.requestType)}</h3>
              <p>{provider} · {modelName}</p>
            </div>
          </div>
          <button type="button" className="admin-ai-monitor-modal__close" onClick={onClose} aria-label="Close diagnostics"><X size={18} /></button>
        </header>

        <div className="admin-ai-monitor-modal__body">
          <aside className="admin-ai-monitor-modal__summary">
            <div className="admin-ai-monitor-modal__outcome-card">
              <div className="admin-ai-monitor-modal__outcome-head">
                <OutcomeBadge success={log.isSuccess} retryable={log.isRetryable} />
                {log.fallbackUsed && <span className="admin-ai-monitor-fallback"><GitBranch size={12} /> Fallback</span>}
              </div>
              <strong>{number(log.responseTimeMs)} ms</strong>
              <span>Provider response time</span>
            </div>

            <div className="admin-ai-monitor-modal__detail-grid">
              <DetailItem icon={ServerCog} label="Provider" value={provider} />
              <DetailItem icon={Cpu} label="API model" value={log.apiModelId || '—'} />
              <DetailItem icon={Zap} label="Tokens" value={number(totalTokens)} />
              <DetailItem icon={Gauge} label="Status code" value={log.statusCode ?? '—'} />
              <DetailItem icon={Clock3} label="Created" value={formatDate(log.createdAt)} wide />
              <DetailItem icon={Activity} label="Attempt" value={`#${log.attemptNumber || 1}`} />
              <DetailItem icon={Sparkles} label="Estimated cost" value={money(log.costEstimate)} />
            </div>

            {(log.user || log.idea) && (
              <div className="admin-ai-monitor-modal__context-card">
                <small>REQUEST CONTEXT</small>
                {log.user && (
                  <div><UserRound size={14} /><span><strong>{log.user.fullName || 'Platform user'}</strong><small>{log.user.email || '—'}</small></span></div>
                )}
                {log.idea && (
                  <div><Sparkles size={14} /><span><strong>{log.idea.title || 'Related idea'}</strong><small>{shortId(log.idea.id, 13)}</small></span></div>
                )}
              </div>
            )}

            {(!log.isSuccess && (log.errorCode || log.errorMessage)) && (
              <div className="admin-ai-monitor-modal__error-card">
                <TriangleAlert size={16} />
                <div><small>{log.errorCode || 'REQUEST FAILURE'}</small><p>{log.errorMessage || 'The provider request failed without a stored message.'}</p></div>
              </div>
            )}
          </aside>

          <main className="admin-ai-monitor-modal__timeline-pane">
            <div className="admin-ai-monitor-modal__section-head">
              <div>
                <small>OPERATION TIMELINE</small>
                <h4>Retries and fallback path</h4>
                <p>Every provider attempt belonging to this logical AI operation.</p>
              </div>
              {operation?.totalAttempts ? (
                <span className="admin-ai-monitor-modal__attempt-count">{operation.totalAttempts} attempts</span>
              ) : null}
            </div>

            {loading ? (
              <div className="admin-ai-monitor-modal__loading"><LoaderCircle size={22} className="is-spinning" /><span>Loading operation diagnostics…</span></div>
            ) : (
              <AttemptTimeline operation={operation} />
            )}

            <div className="admin-ai-monitor-modal__technical">
              <small>TECHNICAL REFERENCES</small>
              <div className="admin-ai-monitor-modal__technical-grid">
                <DetailItem label="Log ID" value={log.id} mono wide />
                <DetailItem label="Operation ID" value={log.operationId || 'Legacy / unavailable'} mono wide />
                <DetailItem label="Provider request ID" value={log.requestId || '—'} mono wide />
                <DetailItem label="Endpoint" value={log.endpoint || '—'} mono wide />
              </div>
            </div>
          </main>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export default function AdminAiMonitoringPage() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: PAGE_SIZE, totalPages: 1 });
  const [summary, setSummary] = useState({});
  const [baseSummary, setBaseSummary] = useState({});
  const [charts, setCharts] = useState({});
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [execution, setExecution] = useState('all');
  const [providerKey, setProviderKey] = useState('all');
  const [requestType, setRequestType] = useState('all');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [operation, setOperation] = useState(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const commonParams = useMemo(() => ({
    ...(search ? { search } : {}),
    ...(providerKey !== 'all' ? { providerKey } : {}),
    ...(requestType !== 'all' ? { requestType } : {}),
    ...(fromDate ? { fromDate: dateBoundaryIso(fromDate) } : {}),
    ...(toDate ? { toDate: dateBoundaryIso(toDate, true) } : {}),
  }), [fromDate, providerKey, requestType, search, toDate]);

  const activeParams = useMemo(() => {
    const params = { ...commonParams };
    if (status === 'success') params.isSuccess = true;
    if (status === 'failed') params.isSuccess = false;
    if (execution === 'retryable') {
      params.isSuccess = false;
      params.isRetryable = true;
    }
    if (execution === 'fallback') params.fallbackUsed = true;
    return params;
  }, [commonParams, execution, status]);

  const loadData = useCallback(async ({ fresh = false, quiet = false } = {}) => {
    const requestId = ++requestIdRef.current;
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError('');

    try {
      const listParams = { page, limit: PAGE_SIZE, sortBy, sortOrder, ...activeParams };
      const listMethod = fresh && adminApi.aiMonitoring.listFresh
        ? adminApi.aiMonitoring.listFresh
        : adminApi.aiMonitoring.list;
      const listPayload = await listMethod(listParams);
      if (requestId !== requestIdRef.current) return;

      const nextRows = unwrapRows(listPayload);
      setRows(nextRows);
      setMeta(unwrapMeta(listPayload, nextRows.length));
      if (!quiet) setLoading(false);

      const summaryMethod = fresh && adminApi.aiMonitoring.summaryFresh
        ? adminApi.aiMonitoring.summaryFresh
        : adminApi.aiMonitoring.summary;
      const chartsMethod = fresh && adminApi.aiMonitoring.chartsFresh
        ? adminApi.aiMonitoring.chartsFresh
        : adminApi.aiMonitoring.charts;

      Promise.allSettled([
        summaryMethod(activeParams),
        summaryMethod(commonParams),
        chartsMethod({
          ...(fromDate ? { fromDate: dateBoundaryIso(fromDate) } : {}),
          ...(toDate ? { toDate: dateBoundaryIso(toDate, true) } : {}),
        }),
      ]).then(([currentSummaryResult, baseSummaryResult, chartsResult]) => {
        if (requestId !== requestIdRef.current) return;
        if (currentSummaryResult.status === 'fulfilled') setSummary(unwrapObject(currentSummaryResult.value));
        if (baseSummaryResult.status === 'fulfilled') setBaseSummary(unwrapObject(baseSummaryResult.value));
        if (chartsResult.status === 'fulfilled') setCharts(unwrapObject(chartsResult.value));
      });
    } catch (loadError) {
      if (requestId !== requestIdRef.current) return;
      setRows([]);
      setError(getApiErrorMessage(loadError, 'Could not load AI monitoring requests.'));
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [activeParams, commonParams, fromDate, page, sortBy, sortOrder, toDate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const providerOptions = useMemo(() => {
    const raw = Array.isArray(charts?.requestsByProvider) ? charts.requestsByProvider : [];
    const keys = [...new Set(raw.map((item) => String(item?.label || item?.providerKey || '').trim()).filter(Boolean))];
    if (providerKey !== 'all' && !keys.includes(providerKey)) keys.push(providerKey);
    return [
      { key: 'all', label: 'All providers' },
      ...keys.map((key) => ({ key, label: titleCase(key) })),
    ];
  }, [charts, providerKey]);

  const requestTypeOptions = useMemo(() => {
    const raw = Array.isArray(charts?.requestsByType) ? charts.requestsByType : [];
    const keys = [...new Set(raw.map((item) => String(item?.label || item?.requestType || '').trim()).filter(Boolean))];
    if (requestType !== 'all' && !keys.includes(requestType)) keys.push(requestType);
    return [
      { key: 'all', label: 'All request types' },
      ...keys.map((key) => ({ key, label: requestTypeLabel(key) })),
    ];
  }, [charts, requestType]);

  const statusCount = (key) => {
    if (key === 'all') return Number(baseSummary?.totalRequests || 0);
    if (key === 'success') return Number(baseSummary?.successfulRequests || 0);
    return Number(baseSummary?.failedRequests || 0);
  };

  const openDetails = useCallback(async (row) => {
    setSelected(row);
    setOperation(null);
    setModalLoading(true);
    try {
      const detailPayload = await adminApi.aiMonitoring.detail(row.id);
      const detail = unwrapObject(detailPayload);
      setSelected({ ...row, ...detail });
      if (detail.operationId) {
        try {
          const operationPayload = await adminApi.aiMonitoring.operation(detail.operationId);
          setOperation(unwrapObject(operationPayload));
        } catch {
          setOperation(null);
        }
      }
    } catch (detailError) {
      setError(getApiErrorMessage(detailError, 'Could not load AI request diagnostics.'));
    } finally {
      setModalLoading(false);
    }
  }, []);

  const handleExport = async () => {
    setRefreshing(true);
    setError('');
    try {
      await adminApi.aiMonitoring.exportCsv({ sortBy, sortOrder, ...activeParams });
    } catch (exportError) {
      setError(getApiErrorMessage(exportError, 'AI monitoring CSV export failed.'));
    } finally {
      setRefreshing(false);
    }
  };

  const handleFromDate = (value) => {
    setFromDate(value);
    if (value && toDate && value > toDate) setToDate(value);
    setPage(1);
  };

  const handleToDate = (value) => {
    setToDate(value);
    if (value && fromDate && value < fromDate) setFromDate(value);
    setPage(1);
  };

  const chooseExecution = (value) => {
    setExecution(value);
    if (value === 'retryable') setStatus('failed');
    setPage(1);
  };

  const successRate = Number(summary?.successRate || 0);
  const avgLatency = Number(summary?.averageResponseTime || 0);

  return (
    <div className="admin-page admin-ai-monitor-page">
      <section className="admin-hero admin-ai-monitor-hero">
        <div className="admin-hero__eyebrow"><Activity size={14} /> Observability</div>
        <h2>AI monitoring</h2>
        <p>Trace provider attempts, retries, fallback decisions, latency and operational failures without exposing raw provider payloads.</p>
      </section>

      {error && <div className="admin-error">{error}</div>}

      <section className="admin-ai-monitor-panel">
        <header className="admin-ai-monitor-panel__head">
          <div>
            <span className="admin-ai-monitor-panel__kicker"><ShieldCheck size={13} /> AI execution ledger</span>
            <h3>Provider request operations</h3>
            <p>{number(meta.total)} matching request attempts</p>
          </div>
          <div className="admin-ai-monitor-panel__actions">
            <span className="admin-ai-monitor-live"><i /> Live diagnostics</span>
            <button type="button" className="admin-ai-monitor-action" onClick={() => loadData({ fresh: true, quiet: true })} disabled={refreshing}>
              <RefreshCw size={14} className={refreshing ? 'is-spinning' : ''} /> Refresh
            </button>
            <button type="button" className="admin-ai-monitor-action" onClick={handleExport} disabled={refreshing}>
              <Download size={14} /> Export CSV
            </button>
          </div>
        </header>

        <div className="admin-ai-monitor-metrics">
          <MetricCard icon={Activity} label="Total requests" value={number(summary?.totalRequests)} hint="Matching provider attempts" tone="is-primary" />
          <MetricCard icon={CheckCircle2} label="Success rate" value={`${successRate.toFixed(1)}%`} hint={`${number(summary?.successfulRequests)} successful`} tone="is-success" />
          <MetricCard icon={CircleAlert} label="Failed requests" value={number(summary?.failedRequests)} hint={`${number(summary?.retryableFailures)} retryable`} tone="is-failed" />
          <MetricCard icon={Timer} label="Average latency" value={`${number(avgLatency)} ms`} hint={`${money(summary?.totalCost)} estimated cost`} tone="is-latency" />
        </div>

        <div className="admin-ai-monitor-signal-strip">
          <span><RefreshCw size={13} /><strong>{number(summary?.retryableFailures)}</strong> retryable failures</span>
          <span><GitBranch size={13} /><strong>{number(summary?.fallbackAttempts)}</strong> fallback attempts</span>
          <span><TriangleAlert size={13} /><strong>{Number(summary?.errorRate || 0).toFixed(1)}%</strong> error rate</span>
          <span><Sparkles size={13} /><strong>{money(summary?.totalCost)}</strong> estimated cost</span>
        </div>

        <nav className="admin-ai-monitor-status-tabs" aria-label="AI request status">
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              className={status === option.key ? 'is-active' : ''}
              onClick={() => {
                setStatus(option.key);
                if (option.key === 'success' && execution === 'retryable') setExecution('all');
                setPage(1);
              }}
            >
              {option.label}<em>{number(statusCount(option.key))}</em>
            </button>
          ))}
        </nav>

        <div className="admin-ai-monitor-controls">
          <SelectMenu
            label="Provider"
            value={providerKey}
            options={providerOptions}
            onChange={(value) => { setProviderKey(value); setPage(1); }}
            icon={ServerCog}
          />
          <SelectMenu
            label="Request type"
            value={requestType}
            options={requestTypeOptions}
            onChange={(value) => { setRequestType(value); setPage(1); }}
            icon={Bot}
          />
          <SelectMenu
            label="Execution path"
            value={execution}
            options={EXECUTION_OPTIONS}
            onChange={chooseExecution}
            icon={GitBranch}
          />
          <DateRangeFilter
            fromDate={fromDate}
            toDate={toDate}
            onFromChange={handleFromDate}
            onToChange={handleToDate}
            onClear={() => { setFromDate(''); setToDate(''); setPage(1); }}
          />
        </div>

        <div className="admin-ai-monitor-search-row">
          <SortControl
            sortBy={sortBy}
            sortOrder={sortOrder}
            onSortBy={(value) => { setSortBy(value); setPage(1); }}
            onToggle={() => { setSortOrder((value) => (value === 'asc' ? 'desc' : 'asc')); setPage(1); }}
          />
          <label className="admin-ai-monitor-search">
            <Search size={17} />
            <input
              type="search"
              placeholder="Search model, provider request ID, operation, user, idea or error..."
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
            {searchInput && <button type="button" onClick={() => setSearchInput('')} aria-label="Clear search"><X size={13} /></button>}
          </label>
        </div>

        {loading ? (
          <div className="admin-ai-monitor-loading"><LoaderCircle size={24} className="is-spinning" /><span>Loading AI request diagnostics…</span></div>
        ) : rows.length ? (
          <div className="admin-ai-monitor-table-shell">
            <table className="admin-ai-monitor-table">
              <colgroup>
                <col className="is-request" />
                <col className="is-provider" />
                <col className="is-outcome" />
                <col className="is-performance" />
                <col className="is-context" />
                <col className="is-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th>Request</th>
                  <th>Provider & model</th>
                  <th>Outcome</th>
                  <th>Performance</th>
                  <th>Context</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const modelName = row.aiModel?.displayName || row.aiModel?.modelName || row.apiModelId || 'Unmapped model';
                  const tokens = Number(row.inputTokens || 0) + Number(row.outputTokens || 0);
                  return (
                    <tr key={row.id}>
                      <td>
                        <div className="admin-ai-monitor-request-cell">
                          <span className={`admin-ai-monitor-request-icon ${row.isSuccess ? 'is-success' : 'is-failed'}`}>
                            <Bot size={17} />
                            <i aria-hidden="true" />
                          </span>
                          <div className="admin-ai-monitor-request-copy">
                            <strong>{requestTypeLabel(row.requestType)}</strong>
                            <span>Op {shortId(row.operationId || row.id, 9)} · Attempt {row.attemptNumber || 1}</span>
                            <small>{formatDate(row.createdAt, true)}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="admin-ai-monitor-provider-cell">
                          <strong>{titleCase(row.providerKey || 'Unknown')}</strong>
                          <span>{modelName}</span>
                          <small>{row.apiModelId || '—'}</small>
                        </div>
                      </td>
                      <td>
                        <div className="admin-ai-monitor-outcome-cell">
                          <OutcomeBadge success={row.isSuccess} retryable={row.isRetryable} />
                          <span className="admin-ai-monitor-status-code">HTTP {row.statusCode ?? '—'}</span>
                          {row.fallbackUsed && <small><GitBranch size={11} /> Fallback path</small>}
                        </div>
                      </td>
                      <td>
                        <div className="admin-ai-monitor-performance-cell">
                          <strong>{number(row.responseTimeMs)} ms</strong>
                          <span><Zap size={11} /> {number(tokens)} tokens</span>
                          <small>{money(row.costEstimate)}</small>
                        </div>
                      </td>
                      <td>
                        <div className="admin-ai-monitor-context-cell">
                          <strong>{row.user?.fullName || row.user?.email || 'System operation'}</strong>
                          <span>{row.idea?.title || row.endpoint || 'No idea context'}</span>
                          {!row.isSuccess && row.errorCode && <small className="is-error"><TriangleAlert size={11} /> {row.errorCode}</small>}
                        </div>
                      </td>
                      <td>
                        <button type="button" className="admin-ai-monitor-inspect" onClick={() => openDetails(row)}>
                          <Eye size={15} /> <span>Inspect</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="admin-ai-monitor-empty">
            <Activity size={26} />
            <strong>No request attempts match these filters</strong>
            <span>Adjust the provider, status, date range or search phrase.</span>
          </div>
        )}

        <footer className="admin-ai-monitor-pagination">
          <span>Showing {rows.length ? ((meta.page - 1) * meta.limit) + 1 : 0}–{Math.min(meta.page * meta.limit, meta.total)} of {number(meta.total)}</span>
          <div>
            <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={meta.page <= 1}><ChevronLeft size={14} /> Previous</button>
            <em>Page {meta.page} of {meta.totalPages}</em>
            <button type="button" onClick={() => setPage((value) => Math.min(meta.totalPages, value + 1))} disabled={meta.page >= meta.totalPages}>Next <ChevronRight size={14} /></button>
          </div>
        </footer>
      </section>

      <MonitoringModal log={selected} loading={modalLoading} operation={operation} onClose={() => { setSelected(null); setOperation(null); }} />
    </div>
  );
}