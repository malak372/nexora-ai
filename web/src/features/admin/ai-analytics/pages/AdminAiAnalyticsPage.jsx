import {
  Activity,
  ArrowDown,
  ArrowUp,
  BarChart3,
  BrainCircuit,
  CalendarRange,
  Check,
  ChevronDown,
  CircleDollarSign,
  Coins,
  Cpu,
  Gauge,
  RefreshCw,
  Search,
  ServerCog,
  Sparkles,
  Timer,
  TriangleAlert,
  X,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { adminApi, getApiErrorMessage } from '../../shared/api/adminApi';
import '../../shared/styles/admin-pages.css';
import '../styles/admin-ai-analytics.css';

const PROVIDER_OPTIONS = [
  { key: '', label: 'All providers' },
  { key: 'google', label: 'Google AI' },
  { key: 'openrouter', label: 'OpenRouter' },
  { key: 'ollama', label: 'Ollama (Local)' },
];

const REQUEST_TYPE_OPTIONS = [
  { key: '', label: 'All request types' },
  { key: 'IDEA_GENERATION', label: 'Idea generation' },
  { key: 'AI_CHAT', label: 'AI chat' },
  { key: 'COMMENT_ANALYSIS', label: 'Comment analysis' },
  { key: 'NLP_ENHANCEMENT', label: 'NLP enhancement' },
  { key: 'DATA_COLLECTION', label: 'Data collection' },
  { key: 'OTHER', label: 'Other' },
];

const SORT_OPTIONS = [
  { key: 'requests', label: 'Request volume' },
  { key: 'successRate', label: 'Success rate' },
  { key: 'averageResponseTimeMs', label: 'Average latency' },
  { key: 'tokens', label: 'Token usage' },
  { key: 'cost', label: 'Estimated cost' },
  { key: 'modelName', label: 'Model name' },
];

function number(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function compactNumber(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return '0';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(numeric);
}

function money(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric === 0) return '$0';
  if (numeric < 0.01) return `$${numeric.toFixed(6)}`;
  return `$${numeric.toFixed(4)}`;
}

function latency(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return '0 ms';
  if (numeric >= 1000) return `${(numeric / 1000).toFixed(numeric >= 10000 ? 1 : 2)}s`;
  return `${Math.round(numeric)} ms`;
}

function percent(part, whole) {
  const denominator = Number(whole || 0);
  if (!denominator) return 0;
  return Math.max(0, Math.min(100, (Number(part || 0) / denominator) * 100));
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

function modelName(item) {
  return item?.model?.modelName || item?.model?.apiModelId || 'Unmapped model';
}

function providerName(key) {
  const normalized = String(key || '').toLowerCase();
  return PROVIDER_OPTIONS.find((item) => item.key === normalized)?.label || (key || 'Unknown provider');
}

function MetricCard({ icon: Icon, label, value, hint, tone = '' }) {
  return (
    <article className={`admin-ai-analytics-metric ${tone}`}>
      <i aria-hidden="true" />
      <span className="admin-ai-analytics-metric__icon"><Icon size={19} /></span>
      <div className="admin-ai-analytics-metric__copy">
        <small>{label}</small>
        <strong>{value}</strong>
        <span>{hint}</span>
      </div>
    </article>
  );
}

function SelectMenu({ label, value, options, onChange, icon: Icon = ServerCog }) {
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
    <div className={`admin-ai-analytics-picker ${open ? 'is-open' : ''}`} ref={ref}>
      <button
        type="button"
        className="admin-ai-analytics-picker__trigger"
        onClick={() => setOpen((state) => !state)}
        aria-expanded={open}
      >
        <Icon size={16} />
        <span>
          <small>{label}</small>
          <strong>{current?.label || 'All'}</strong>
        </span>
        <ChevronDown size={15} className="admin-ai-analytics-picker__chevron" />
      </button>
      {open && (
        <div className="admin-ai-analytics-picker__menu" role="listbox">
          {options.map((option) => (
            <button
              type="button"
              key={option.key || 'all'}
              className={option.key === value ? 'is-active' : ''}
              onClick={() => {
                onChange(option.key);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {option.key === value && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ReliabilityBadge({ successRate }) {
  const rate = Number(successRate || 0);
  const tone = rate >= 90 ? 'is-strong' : rate >= 70 ? 'is-mid' : 'is-low';
  return (
    <span className={`admin-ai-analytics-reliability ${tone}`}>
      <i aria-hidden="true" />
      {rate.toFixed(1)}%
    </span>
  );
}

export default function AdminAiAnalyticsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const [filters, setFilters] = useState({
    fromDate: '',
    toDate: '',
    providerKey: '',
    requestType: '',
  });
  const [appliedFilters, setAppliedFilters] = useState(filters);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('requests');
  const [sortOrder, setSortOrder] = useState('desc');

  const buildParams = useCallback((source) => ({
    ...(source.fromDate ? { fromDate: dateBoundaryIso(source.fromDate, false) } : {}),
    ...(source.toDate ? { toDate: dateBoundaryIso(source.toDate, true) } : {}),
    ...(source.providerKey ? { providerKey: source.providerKey } : {}),
    ...(source.requestType ? { requestType: source.requestType } : {}),
  }), []);

  const load = useCallback(async (source = appliedFilters, fresh = false) => {
    setError('');
    if (fresh) setRefreshing(true);
    else setLoading(true);
    try {
      const params = buildParams(source);
      const payload = fresh && adminApi.aiAnalytics.summaryFresh
        ? await adminApi.aiAnalytics.summaryFresh(params)
        : await adminApi.aiAnalytics.summary(params);
      setData(payload || {});
    } catch (e) {
      setError(getApiErrorMessage(e, 'Could not load AI usage analytics.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [appliedFilters, buildParams]);

  useEffect(() => {
    load(appliedFilters, false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const applyFilters = () => {
    if (filters.fromDate && filters.toDate && filters.fromDate > filters.toDate) {
      setError('From date must be earlier than or equal to To date.');
      return;
    }
    setAppliedFilters(filters);
    load(filters, true);
  };

  const clearFilters = () => {
    const empty = { fromDate: '', toDate: '', providerKey: '', requestType: '' };
    setFilters(empty);
    setAppliedFilters(empty);
    setSearch('');
    load(empty, true);
  };

  const rawModels = useMemo(() => (Array.isArray(data?.models) ? data.models : []), [data]);

  const models = useMemo(() => {
    const query = search.trim().toLowerCase();
    const prepared = rawModels
      .filter((item) => {
        if (!query) return true;
        return [
          modelName(item),
          item?.model?.apiModelId,
          item?.model?.providerKey,
        ].some((value) => String(value || '').toLowerCase().includes(query));
      })
      .map((item) => {
        const requests = Number(item?.requests || 0);
        const successfulRequests = Number(item?.successfulRequests || 0);
        return {
          ...item,
          calculatedSuccessRate: percent(successfulRequests, requests),
          calculatedTokens: Number(item?.inputTokens || 0) + Number(item?.outputTokens || 0),
        };
      });

    const direction = sortOrder === 'asc' ? 1 : -1;
    return [...prepared].sort((a, b) => {
      if (sortBy === 'modelName') return modelName(a).localeCompare(modelName(b)) * direction;
      if (sortBy === 'successRate') return (a.calculatedSuccessRate - b.calculatedSuccessRate) * direction;
      if (sortBy === 'tokens') return (a.calculatedTokens - b.calculatedTokens) * direction;
      return (Number(a?.[sortBy] || 0) - Number(b?.[sortBy] || 0)) * direction;
    });
  }, [rawModels, search, sortBy, sortOrder]);

  const totalRequests = Number(data?.totalRequests || 0);
  const totalTokens = Number(data?.totalInputTokens || 0) + Number(data?.totalOutputTokens || 0);
  const topModel = useMemo(() => [...rawModels].sort((a, b) => Number(b.requests || 0) - Number(a.requests || 0))[0], [rawModels]);
  const fastestModel = useMemo(() => rawModels
    .filter((item) => Number(item.averageResponseTimeMs || 0) > 0)
    .sort((a, b) => Number(a.averageResponseTimeMs || 0) - Number(b.averageResponseTimeMs || 0))[0], [rawModels]);

  return (
    <div className="admin-page admin-ai-analytics-page">
      <section className="admin-hero admin-ai-analytics-hero">
        <div className="admin-hero__eyebrow"><Sparkles size={14} /> AI intelligence</div>
        <h2>AI analytics</h2>
        <p>Understand model reliability, provider traffic, latency, token consumption and estimated AI spend from one operational view.</p>
      </section>

      {error && <div className="admin-error">{error}</div>}

      <section className="admin-ai-analytics-panel">
        <header className="admin-ai-analytics-panel__head">
          <div>
            <span className="admin-ai-analytics-panel__kicker"><BarChart3 size={13} /> Usage overview</span>
            <h3>AI economics & performance</h3>
            <p>Aggregated provider attempts, including retries, repairs and fallbacks.</p>
          </div>
          <div className="admin-ai-analytics-panel__actions">
            <span className="admin-ai-analytics-live"><i /> Aggregated metrics</span>
            <button type="button" className="admin-ai-analytics-action" onClick={() => load(appliedFilters, true)} disabled={refreshing || loading}>
              <RefreshCw size={15} className={refreshing ? 'is-spinning' : ''} /> Refresh
            </button>
          </div>
        </header>

        {loading ? (
          <div className="admin-ai-analytics-loading"><div className="admin-spinner" /></div>
        ) : (
          <>
            <div className="admin-ai-analytics-metrics">
              <MetricCard icon={BrainCircuit} label="AI requests" value={number(data?.totalRequests)} hint={`${number(data?.successfulRequests)} successful attempts`} tone="is-primary" />
              <MetricCard icon={Gauge} label="Success rate" value={`${Number(data?.successRate || 0).toFixed(2)}%`} hint={`${number(data?.failedRequests)} failed attempts`} tone={Number(data?.successRate || 0) < 70 ? 'is-warning' : ''} />
              <MetricCard icon={Timer} label="Average latency" value={latency(data?.averageResponseTimeMs)} hint="Across matching provider attempts" tone="is-latency" />
              <MetricCard icon={CircleDollarSign} label="Estimated AI cost" value={money(data?.totalCost)} hint="Backend-calculated usage estimate" tone="is-cost" />
            </div>

            <div className="admin-ai-analytics-signal-strip">
              <span><Coins size={13} /><b>{compactNumber(data?.totalInputTokens)}</b> input tokens</span>
              <span><Zap size={13} /><b>{compactNumber(data?.totalOutputTokens)}</b> output tokens</span>
              <span><TriangleAlert size={13} /><b>{number(data?.fallbackAttempts)}</b> fallback attempts</span>
              <span><Cpu size={13} /><b>{rawModels.length}</b> models represented</span>
            </div>

            <div className="admin-ai-analytics-filterbar">
              <div className="admin-ai-analytics-filterbar__top">
                <div>
                  <span className="admin-ai-analytics-panel__kicker"><CalendarRange size={13} /> Analytics filters</span>
                  <p>Filter the backend aggregation before comparing model performance.</p>
                </div>
                <div className="admin-ai-analytics-filterbar__buttons">
                  {(filters.fromDate || filters.toDate || filters.providerKey || filters.requestType) && (
                    <button type="button" className="admin-ai-analytics-clear" onClick={clearFilters}><X size={14} /> Clear</button>
                  )}
                  <button type="button" className="admin-ai-analytics-apply" onClick={applyFilters} disabled={refreshing}>
                    <RefreshCw size={14} /> Apply filters
                  </button>
                </div>
              </div>

              <div className="admin-ai-analytics-filter-grid">
                <label className="admin-ai-analytics-date-field">
                  <CalendarRange size={16} />
                  <span><small>From date</small><input type="date" value={filters.fromDate} max={filters.toDate || undefined} onChange={(event) => setFilters((old) => ({ ...old, fromDate: event.target.value }))} /></span>
                </label>
                <label className="admin-ai-analytics-date-field">
                  <CalendarRange size={16} />
                  <span><small>To date</small><input type="date" value={filters.toDate} min={filters.fromDate || undefined} onChange={(event) => setFilters((old) => ({ ...old, toDate: event.target.value }))} /></span>
                </label>
                <SelectMenu label="Provider" value={filters.providerKey} options={PROVIDER_OPTIONS} onChange={(value) => setFilters((old) => ({ ...old, providerKey: value }))} icon={ServerCog} />
                <SelectMenu label="Request type" value={filters.requestType} options={REQUEST_TYPE_OPTIONS} onChange={(value) => setFilters((old) => ({ ...old, requestType: value }))} icon={Activity} />
              </div>
            </div>
          </>
        )}
      </section>

      {!loading && (
        <section className="admin-ai-analytics-model-panel">
          <header className="admin-ai-analytics-model-head">
            <div>
              <span className="admin-ai-analytics-panel__kicker"><BrainCircuit size={13} /> Model intelligence</span>
              <h3>Model usage</h3>
              <p>{models.length} matching models · {compactNumber(totalTokens)} total tokens</p>
            </div>
            <div className="admin-ai-analytics-highlights">
              <span><small>Most used</small><strong>{topModel ? modelName(topModel) : '—'}</strong></span>
              <span><small>Fastest</small><strong>{fastestModel ? modelName(fastestModel) : '—'}</strong></span>
            </div>
          </header>

          <div className="admin-ai-analytics-controls">
            <SelectMenu label="Sort models" value={sortBy} options={SORT_OPTIONS} onChange={setSortBy} icon={BarChart3} />
            <button type="button" className="admin-ai-analytics-sort-direction" onClick={() => setSortOrder((old) => (old === 'desc' ? 'asc' : 'desc'))} title={sortOrder === 'desc' ? 'Descending' : 'Ascending'}>
              {sortOrder === 'desc' ? <ArrowDown size={17} /> : <ArrowUp size={17} />}
            </button>
            <label className="admin-ai-analytics-search">
              <Search size={17} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search model, API model or provider..." />
              {search && <button type="button" onClick={() => setSearch('')}><X size={14} /></button>}
            </label>
          </div>

          {models.length ? (
            <div className="admin-ai-analytics-table-wrap">
              <table className="admin-ai-analytics-table">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Requests</th>
                    <th>Reliability</th>
                    <th>Latency</th>
                    <th>Tokens</th>
                    <th>Cost</th>
                    <th>Traffic share</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((item, index) => {
                    const requests = Number(item.requests || 0);
                    const traffic = percent(requests, totalRequests);
                    return (
                      <tr key={item.aiModelId || `${modelName(item)}-${index}`}>
                        <td>
                          <div className="admin-ai-analytics-model-cell">
                            <span className="admin-ai-analytics-model-icon"><BrainCircuit size={17} /></span>
                            <div>
                              <strong>{modelName(item)}</strong>
                              <span>{providerName(item?.model?.providerKey)} · {item?.model?.apiModelId || 'Legacy / unmapped'}</span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="admin-ai-analytics-number-cell">
                            <strong>{number(requests)}</strong>
                            <span>{number(item.successfulRequests)} success · {number(item.failedRequests)} failed</span>
                          </div>
                        </td>
                        <td><ReliabilityBadge successRate={item.calculatedSuccessRate} /></td>
                        <td><span className="admin-ai-analytics-latency"><Timer size={13} /> {latency(item.averageResponseTimeMs)}</span></td>
                        <td>
                          <div className="admin-ai-analytics-number-cell">
                            <strong>{compactNumber(item.calculatedTokens)}</strong>
                            <span>{compactNumber(item.inputTokens)} in · {compactNumber(item.outputTokens)} out</span>
                          </div>
                        </td>
                        <td><span className="admin-ai-analytics-cost">{money(item.cost)}</span></td>
                        <td>
                          <div className="admin-ai-analytics-share">
                            <div><i style={{ width: `${traffic}%` }} /></div>
                            <span>{traffic.toFixed(1)}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="admin-ai-analytics-empty">
              <BrainCircuit size={28} />
              <strong>No model usage found</strong>
              <p>Try changing the analytics filters or model search.</p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}