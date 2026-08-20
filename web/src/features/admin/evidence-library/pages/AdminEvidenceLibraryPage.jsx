import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BookOpenCheck,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Database,
  ExternalLink,
  FileText,
  Heart,
  Languages,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { adminApi, getApiErrorMessage } from '../../shared/api/adminApi';
import '../../shared/styles/admin-pages.css';
import '../styles/admin-evidence-library.css';

const PAGE_SIZE = 20;

const EVIDENCE_SORT_OPTIONS = [
  { key: 'createdAt', label: 'Added to library' },
  { key: 'collectedAt', label: 'Collection date' },
  { key: 'publishedAt', label: 'Published date' },
  { key: 'likesCount', label: 'Engagement' },
];

const EVIDENCE_COLUMN_SORT_FIELD = {
  engagement: 'likesCount',
  published: 'publishedAt',
  collected: 'collectedAt',
};

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unwrapRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!isObject(payload)) return [];

  const candidates = [
    payload.data,
    payload.items,
    payload.results,
    payload.records,
    payload.comments,
    payload.evidence,
  ];

  const direct = candidates.find(Array.isArray);
  if (direct) return direct;

  if (isObject(payload.data)) {
    const nested = Object.values(payload.data).find(Array.isArray);
    if (nested) return nested;
  }

  return [];
}

function unwrapMeta(payload, itemCount) {
  const source = payload?.meta || payload?.pagination || payload?.data?.meta || {};
  const total = Number(source.total ?? source.totalItems ?? payload?.total ?? itemCount) || 0;
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

function firstValue(object, keys, fallback = '') {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return fallback;
}

function firstNestedValue(row, paths, fallback = '') {
  for (const path of paths) {
    const value = path.split('.').reduce((current, key) => current?.[key], row);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return fallback;
}

function evidenceContent(row) {
  return firstValue(
    row,
    ['content', 'text', 'body', 'comment', 'message', 'description'],
    'No evidence text available.',
  );
}

function evidenceAuthor(row) {
  return firstValue(
    row,
    ['author', 'authorName', 'username', 'userName', 'channelTitle', 'creator'],
    'Unknown author',
  );
}

function evidenceLanguage(row) {
  return firstValue(row, ['languageCode', 'language', 'lang', 'locale'], '—');
}

function evidenceSource(row) {
  const value = firstNestedValue(
    row,
    [
      'post.dataSource.displayName',
      'post.dataSource.key',
      'dataSource.displayName',
      'dataSource.key',
      'sourceName',
      'sourceType',
      'platform',
      'provider',
      'source',
      'post.sourceType',
      'post.source',
      'collectionJob.sourceType',
    ],
    '',
  );

  if (isObject(value)) {
    return firstValue(value, ['displayName', 'name', 'label', 'key', 'type'], 'External source');
  }

  return String(value || 'External source');
}

function evidenceEngagement(row) {
  const value = firstValue(
    row,
    ['likesCount', 'likeCount', 'likes', 'upvotes', 'score', 'reactionsCount'],
    0,
  );
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function evidenceSentiment(row) {
  const value = firstValue(row, ['sentiment', 'sentimentLabel', 'sentimentClass'], '');
  if (isObject(value)) return firstValue(value, ['label', 'name', 'value'], '');
  return String(value || '').trim();
}

function publishedAt(row) {
  return firstValue(row, ['publishedAt', 'postedAt', 'createdAtSource', 'sourceCreatedAt'], '');
}

function collectedAt(row) {
  return firstValue(row, ['collectedAt', 'ingestedAt', 'fetchedAt', 'createdAt'], '');
}

function sourceUrl(row) {
  return firstNestedValue(row, ['post.url', 'sourcePost.url', 'url', 'sourceUrl', 'permalink', 'link'], '');
}

function formatDate(value, compact = false) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);

  return compact
    ? parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : parsed.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
}

function latestCollection(rows, summary) {
  const summaryDate = firstValue(
    summary,
    ['latestCollectedAt', 'lastCollectedAt', 'lastCollectionAt', 'latestCollectionAt'],
    '',
  );
  if (summaryDate) return summaryDate;

  const values = rows
    .map(collectedAt)
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());

  return values[0]?.toISOString() || '';
}


function sourceInitial(value) {
  const text = String(value || 'E').trim();
  return text.charAt(0).toUpperCase() || 'E';
}

function unwrapDataSourceOptions(payload) {
  const root = isObject(payload?.data) ? payload.data : payload;
  const candidates = [
    root?.byDataSource,
    root?.dataSources,
    root?.sources,
    payload?.byDataSource,
  ];
  const rows = candidates.find(Array.isArray) || [];
  const seen = new Set();

  return rows
    .map((item) => ({
      id: String(firstValue(item, ['dataSourceId', 'id'], '') || ''),
      label: String(firstValue(item, ['label', 'displayName', 'name', 'key'], 'Unknown source')),
      count: Number(firstValue(item, ['count', 'total', 'records'], 0)) || 0,
    }))
    .filter((item) => {
      if (!item.id || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

function MetricCard({ icon: Icon, label, value, hint, tone = '' }) {
  return (
    <article className={`admin-evidence-metric ${tone}`}>
      <i aria-hidden="true" />
      <span className="admin-evidence-metric__icon"><Icon size={20} /></span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <span>{hint}</span>
      </div>
    </article>
  );
}

function EvidenceSortPicker({ value, order, onChange, onToggleOrder }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const current = EVIDENCE_SORT_OPTIONS.find((option) => option.key === value) || EVIDENCE_SORT_OPTIONS[0];

  useEffect(() => {
    if (!open) return undefined;

    const close = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };

    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className={`admin-evidence-sort ${open ? 'is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="admin-evidence-sort__trigger"
        onClick={() => setOpen((currentOpen) => !currentOpen)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <SlidersHorizontal size={15} />
        <span><small>Sort evidence</small><strong>{current.label}</strong></span>
        <ChevronDown size={14} />
      </button>

      {open && (
        <div className="admin-evidence-sort__menu" role="listbox" aria-label="Sort evidence">
          {EVIDENCE_SORT_OPTIONS.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={option.key === value}
              key={option.key}
              className={option.key === value ? 'is-active' : ''}
              onClick={() => {
                onChange(option.key);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {option.key === value && <CheckCircle2 size={14} />}
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        className="admin-evidence-sort__direction"
        onClick={onToggleOrder}
        title={order === 'asc' ? 'Ascending order' : 'Descending order'}
        aria-label={order === 'asc' ? 'Switch to descending order' : 'Switch to ascending order'}
      >
        {order === 'asc' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
      </button>
    </div>
  );
}

function EvidenceSourceFilter({ value, options, loading, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const current = options.find((option) => option.id === value);

  useEffect(() => {
    if (!open) return undefined;

    const close = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };

    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div
      className={`admin-evidence-source-filter ${open ? 'is-open' : ''} ${value ? 'has-value' : ''}`}
      ref={rootRef}
    >
      <button
        type="button"
        className="admin-evidence-source-filter__trigger"
        onClick={() => setOpen((currentOpen) => !currentOpen)}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={loading && options.length === 0}
      >
        <span className="admin-evidence-source-filter__icon"><Database size={15} /></span>
        <span className="admin-evidence-source-filter__copy">
          <small>Data source</small>
          <strong>{loading && options.length === 0 ? 'Loading sources…' : current?.label || 'All data sources'}</strong>
        </span>
        <ChevronDown size={14} className="admin-evidence-source-filter__chevron" />
      </button>

      {open && (
        <div className="admin-evidence-source-filter__menu" role="listbox" aria-label="Filter evidence by data source">
          <button
            type="button"
            role="option"
            aria-selected={!value}
            className={!value ? 'is-active' : ''}
            onClick={() => {
              onChange('');
              setOpen(false);
            }}
          >
            <span className="admin-evidence-source-filter__option-mark">A</span>
            <span className="admin-evidence-source-filter__option-copy">
              <strong>All data sources</strong>
              <small>Show evidence from every source</small>
            </span>
            {!value && <CheckCircle2 size={14} />}
          </button>

          <div className="admin-evidence-source-filter__divider" />

          {options.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={option.id === value}
              key={option.id}
              className={option.id === value ? 'is-active' : ''}
              onClick={() => {
                onChange(option.id);
                setOpen(false);
              }}
            >
              <span className="admin-evidence-source-filter__option-mark">{sourceInitial(option.label)}</span>
              <span className="admin-evidence-source-filter__option-copy">
                <strong>{option.label}</strong>
                <small>{option.count.toLocaleString()} evidence records</small>
              </span>
              {option.id === value && <CheckCircle2 size={14} />}
            </button>
          ))}

          {!loading && options.length === 0 && (
            <div className="admin-evidence-source-filter__empty">No evidence sources available.</div>
          )}
        </div>
      )}
    </div>
  );
}

function SortHeader({ label, column, sortBy, sortOrder, onSort }) {
  const field = EVIDENCE_COLUMN_SORT_FIELD[column];
  const active = field && sortBy === field;
  const Icon = !active ? ArrowUpDown : sortOrder === 'asc' ? ArrowUp : ArrowDown;

  if (!field) return <th>{label}</th>;

  return (
    <th aria-sort={active ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        className={`admin-evidence-sort-head ${active ? 'is-active' : ''}`}
        onClick={() => onSort(field)}
        title={`Sort by ${label}`}
      >
        <span>{label}</span>
        <Icon size={12} />
      </button>
    </th>
  );
}

function EvidenceDrawer({ item, onClose }) {
  useEffect(() => {
    if (!item) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [item, onClose]);

  if (!item) return null;

  const source = evidenceSource(item);
  const content = evidenceContent(item);
  const sentiment = evidenceSentiment(item);
  const externalId = firstValue(item, ['externalId', 'sourceId', 'commentId', 'id'], '—');
  const url = sourceUrl(item);

  return createPortal(
    <div className="admin-evidence-drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        className="admin-evidence-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Evidence inspector"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="admin-evidence-drawer__head">
          <div className="admin-evidence-drawer__identity">
            <span className="admin-evidence-drawer__source-mark">{sourceInitial(source)}</span>
            <div>
              <small>Evidence inspector</small>
              <h3>{source}</h3>
              <p>Read-only record captured by the evidence pipeline.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close evidence inspector"><X size={18} /></button>
        </header>

        <div className="admin-evidence-drawer__body">
          <section className="admin-evidence-copy-card">
            <span className="admin-evidence-copy-card__label"><FileText size={14} /> Collected text</span>
            <p>{content}</p>
          </section>

          <section className="admin-evidence-readonly-note">
            <ShieldCheck size={18} />
            <div>
              <strong>Evidence, not a platform comment</strong>
              <span>This text is kept for collection transparency, NLP review and debugging. It has no moderation action.</span>
            </div>
          </section>

          <div className="admin-evidence-detail-grid">
            <div><small>Source</small><strong>{source}</strong></div>
            <div><small>Author</small><strong>{evidenceAuthor(item)}</strong></div>
            <div><small>Language</small><strong>{evidenceLanguage(item)}</strong></div>
            <div><small>Engagement</small><strong>{evidenceEngagement(item).toLocaleString()}</strong></div>
            <div><small>Sentiment</small><strong>{sentiment || 'Not analyzed'}</strong></div>
            <div><small>Published</small><strong>{formatDate(publishedAt(item))}</strong></div>
            <div><small>Collected</small><strong>{formatDate(collectedAt(item))}</strong></div>
            <div className="is-wide"><small>External ID</small><strong className="is-code">{String(externalId)}</strong></div>
          </div>

          {url && /^https?:\/\//i.test(String(url)) && (
            <a className="admin-evidence-source-link" href={url} target="_blank" rel="noreferrer">
              <ExternalLink size={15} /> Open original source
            </a>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

export default function AdminEvidenceLibraryPage() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: PAGE_SIZE, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('collectedAt');
  const [sortOrder, setSortOrder] = useState('desc');
  const [dataSourceId, setDataSourceId] = useState('');
  const [dataSourceOptions, setDataSourceOptions] = useState([]);
  const [dataSourcesLoading, setDataSourcesLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let active = true;

    const loadSources = async () => {
      setDataSourcesLoading(true);

      try {
        const chartsPayload = await adminApi.evidence.charts({});
        if (!active) return;

        let options = unwrapDataSourceOptions(chartsPayload);

        if (options.length === 0) {
          const sourcePayload = await adminApi.dataSources.list({
            page: 1,
            limit: 100,
            sortBy: 'displayName',
            sortOrder: 'asc',
          });
          if (!active) return;

          options = unwrapRows(sourcePayload)
            .map((item) => ({
              id: String(firstValue(item, ['id'], '') || ''),
              label: String(firstValue(item, ['displayName', 'name', 'key'], 'Unknown source')),
              count: 0,
            }))
            .filter((item) => item.id);
        }

        setDataSourceOptions(options);
      } catch {
        if (active) setDataSourceOptions([]);
      } finally {
        if (active) setDataSourcesLoading(false);
      }
    };

    loadSources();

    return () => {
      active = false;
    };
  }, []);

  const loadData = useCallback(async ({ quiet = false, fresh = false } = {}) => {
    const requestId = ++requestIdRef.current;
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
        ...(dataSourceId ? { dataSourceId } : {}),
      };

      const listLoader = fresh ? adminApi.evidence.listFresh : adminApi.evidence.list;
      const summaryLoader = fresh ? adminApi.evidence.summaryFresh : adminApi.evidence.summary;
      const listPayload = await listLoader(params);
      if (requestId !== requestIdRef.current) return;

      const nextRows = unwrapRows(listPayload);
      setRows(nextRows);
      setMeta(unwrapMeta(listPayload, nextRows.length));
      if (!quiet) setLoading(false);

      summaryLoader({
        ...(search ? { search } : {}),
        ...(dataSourceId ? { dataSourceId } : {}),
      })
        .then((payload) => {
          if (requestId === requestIdRef.current) setSummary(unwrapSummary(payload));
        })
        .catch(() => null);
    } catch (requestError) {
      if (requestId !== requestIdRef.current) return;
      setRows([]);
      setError(getApiErrorMessage(requestError, 'Could not load the evidence library.'));
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [dataSourceId, page, search, sortBy, sortOrder]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const metrics = useMemo(() => {
    const total = Number(
      firstValue(summary, ['total', 'totalComments', 'totalEvidence', 'count'], meta.total),
    ) || meta.total;
    const languagesCount = Number(
      firstValue(summary, ['languagesCount', 'languageCount'], 0),
    ) || new Set(rows.map(evidenceLanguage).filter((value) => value && value !== '—')).size;
    const sourceCountFromSummary = Number(
      firstValue(summary, ['dataSourcesCount', 'sourcesCount', 'sourceCount', 'platformsCount'], 0),
    ) || 0;
    const visibleSources = new Set(rows.map(evidenceSource).filter(Boolean)).size;
    const sourceCount = sourceCountFromSummary || visibleSources;
    const lastCollected = latestCollection(rows, summary);

    return {
      total,
      languagesCount,
      sourceCount,
      lastCollected,
    };
  }, [meta.total, rows, summary]);

  const applySort = (field) => {
    setPage(1);
    if (field === sortBy) {
      setSortOrder((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortBy(field);
    setSortOrder('desc');
  };

  const changeSortField = (field) => {
    setPage(1);
    setSortBy(field);
    setSortOrder('desc');
  };

  const start = meta.total === 0 ? 0 : ((meta.page - 1) * meta.limit) + 1;
  const end = Math.min(meta.page * meta.limit, meta.total);

  return (
    <div className="admin-page admin-evidence-page">
      <section className="admin-hero admin-evidence-hero">
        <div className="admin-hero__eyebrow"><BookOpenCheck size={14} /> Data & evidence</div>
        <h2>Evidence Library</h2>
        <p>
          Inspect external text collected for discovery, NLP analysis and evidence-backed idea generation. These records are read-only evidence from external sources, not comments written inside Voxidence.
        </p>
      </section>

      <section className="admin-evidence-panel">
        <div className="admin-evidence-panel__head">
          <div>
            <span className="admin-evidence-panel__kicker"><Database size={13} /> Evidence index</span>
            <h3>Collected evidence directory</h3>
            <p>{meta.total.toLocaleString()} records available</p>
          </div>

          <div className="admin-evidence-panel__actions">
            <span className="admin-evidence-live-chip"><i /> Live evidence</span>
            <button
              type="button"
              className="admin-btn"
              disabled={refreshing}
              onClick={() => loadData({ quiet: true, fresh: true })}
            >
              <RefreshCw size={14} className={refreshing ? 'admin-spin' : ''} /> Refresh
            </button>
          </div>
        </div>

        {!loading && !error && (
          <div className="admin-evidence-metrics">
            <MetricCard
              icon={FileText}
              label="Total evidence"
              value={metrics.total.toLocaleString()}
              hint="Collected text records"
              tone="is-primary"
            />
            <MetricCard
              icon={Database}
              label="Data sources"
              value={metrics.sourceCount.toLocaleString()}
              hint="Sources represented"
            />
            <MetricCard
              icon={Languages}
              label="Languages"
              value={metrics.languagesCount.toLocaleString()}
              hint="Languages represented"
            />
            <MetricCard
              icon={CalendarClock}
              label="Last collection"
              value={formatDate(metrics.lastCollected, true)}
              hint={metrics.lastCollected ? formatDate(metrics.lastCollected) : 'No collection date available'}
              tone="is-date"
            />
          </div>
        )}

        <div className="admin-evidence-tools">
          <EvidenceSortPicker
            value={sortBy}
            order={sortOrder}
            onChange={changeSortField}
            onToggleOrder={() => {
              setPage(1);
              setSortOrder((current) => (current === 'asc' ? 'desc' : 'asc'));
            }}
          />

          <EvidenceSourceFilter
            value={dataSourceId}
            options={dataSourceOptions}
            loading={dataSourcesLoading}
            onChange={(nextSourceId) => {
              setDataSourceId(nextSourceId);
              setPage(1);
            }}
          />

          <label className="admin-evidence-search">
            <Search size={16} />
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search collected evidence text..."
              aria-label="Search evidence library"
            />
            {searchInput && (
              <button type="button" onClick={() => setSearchInput('')} aria-label="Clear search"><X size={14} /></button>
            )}
          </label>

          <div className="admin-evidence-tools__hint"><ShieldCheck size={14} /> Read-only · no moderation actions</div>
        </div>

        {error && (
          <div className="admin-evidence-error">
            <ShieldCheck size={18} />
            <span>{error}</span>
            <button type="button" className="admin-btn" onClick={() => loadData()}>Try again</button>
          </div>
        )}

        {loading ? (
          <div className="admin-evidence-loading">
            <LoaderCircle size={26} className="admin-spin" />
            <strong>Loading evidence library…</strong>
            <span>Reading the latest collected records.</span>
          </div>
        ) : !error && rows.length === 0 ? (
          <div className="admin-evidence-empty">
            <Search size={26} />
            <strong>{search || dataSourceId ? 'No matching evidence' : 'No collected evidence yet'}</strong>
            <span>
              {search || dataSourceId
                ? 'Try a different search phrase or data source.'
                : 'Evidence records will appear after data collection runs.'}
            </span>
          </div>
        ) : !error ? (
          <>
            <div className="admin-evidence-grid">
              {rows.map((item, index) => {
                const id = firstValue(item, ['id', 'externalId', 'commentId'], `${page}-${index}`);
                const source = evidenceSource(item);
                const sentiment = evidenceSentiment(item);

                return (
                  <article
                    key={String(id)}
                    className="admin-evidence-card"
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelected(item)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelected(item);
                      }
                    }}
                  >
                    <div className="admin-evidence-card__hero">
                      <div className="admin-evidence-card__identity">
                        <span className="admin-evidence-card__icon"><FileText size={18} /></span>
                        <div className="admin-evidence-card__headline">
                          <small>Evidence</small>
                          <strong>{evidenceContent(item)}</strong>
                          <span>{sentiment ? `Sentiment: ${sentiment}` : 'Pipeline evidence record'}</span>
                        </div>
                      </div>
                      <i className="admin-evidence-card__dots" aria-hidden="true" />
                    </div>

                    <div className="admin-evidence-card__meta-grid">
                      <div className="admin-evidence-card__meta-item">
                        <small>Source</small>
                        <div className="admin-evidence-source-pill"><i>{sourceInitial(source)}</i>{source}</div>
                      </div>

                      <div className="admin-evidence-card__meta-item">
                        <small>Author</small>
                        <strong className="admin-evidence-card__text">{evidenceAuthor(item)}</strong>
                      </div>

                      <div className="admin-evidence-card__meta-item">
                        <small>Language</small>
                        <div className="admin-evidence-language-pill">{evidenceLanguage(item)}</div>
                      </div>

                      <div className="admin-evidence-card__meta-item">
                        <small>Engagement</small>
                        <div className="admin-evidence-engagement"><Heart size={13} /> {evidenceEngagement(item).toLocaleString()}</div>
                      </div>

                      <div className="admin-evidence-card__meta-item admin-evidence-card__meta-item--wide">
                        <small>Published</small>
                        <strong className="admin-evidence-card__text">{formatDate(publishedAt(item), true)}</strong>
                      </div>

                      <div className="admin-evidence-card__meta-item admin-evidence-card__meta-item--wide">
                        <small>Collected</small>
                        <strong className="admin-evidence-card__text">{formatDate(collectedAt(item), true)}</strong>
                      </div>
                    </div>

                    <div className="admin-evidence-card__footer">
                      <span className="admin-evidence-card__actions-label">Actions</span>
                      <button
                        type="button"
                        className="admin-evidence-inspect-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelected(item);
                        }}
                      >
                        <Search size={15} />
                        <span>Inspect</span>
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="admin-evidence-pagination">
              <div>
                <strong>Showing {start.toLocaleString()}–{end.toLocaleString()} of {meta.total.toLocaleString()}</strong>
                <span>Page {meta.page} of {meta.totalPages}</span>
              </div>
              <div>
                <button
                  type="button"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                >
                  <ChevronLeft size={15} /> Previous
                </button>
                <button
                  type="button"
                  disabled={page >= meta.totalPages || loading}
                  onClick={() => setPage((value) => value + 1)}
                >
                  Next <ChevronRight size={15} />
                </button>
              </div>
            </div>
          </>
        ) : null}
      </section>

      <EvidenceDrawer item={selected} onClose={() => setSelected(null)} />
    </div>
  );
}