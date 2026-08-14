import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BadgeCheck,
  BellRing,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Download,
  Eye,
  FileText,
  Flag,
  Globe2,
  Lightbulb,
  MessageSquareText,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Send,
  Star,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Unlock,
  UserRound,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { adminApi, getApiErrorMessage } from '../../shared/api/adminApi';
import '../../shared/styles/admin-pages.css';
import '../styles/admin-ideas.css';
import '../styles/admin-publication-insights.css';

const PAGE_SIZE = 20;

const FILTERS = [
  { key: 'all', label: 'All ideas', icon: Sparkles },
  { key: 'published', label: 'Published', icon: Globe2 },
  { key: 'locked', label: 'Locked', icon: LockKeyhole },
  { key: 'unlocked', label: 'Unlocked', icon: Unlock },
];


/**
 * Server-side sort options for the directory.
 * Sorting is applied by the backend before pagination, so the result is
 * correct across all records rather than only the currently visible page.
 */
const SORT_OPTIONS = [
  { key: 'createdAt', label: 'Created date' },
  { key: 'title', label: 'Idea title' },
  { key: 'owner', label: 'Owner' },
  { key: 'domain', label: 'Domain' },
  { key: 'generationType', label: 'Generation type' },
  { key: 'isUnlocked', label: 'Access' },
  { key: 'publication', label: 'Publication' },
];

function IdeaSortPicker({ value, order, onChange, onToggleOrder }) {
  const [open, setOpen] = useState(false);
  const current = SORT_OPTIONS.find((option) => option.key === value) || SORT_OPTIONS[0];

  return (
    <div className={`admin-ideas-sort-picker ${open ? 'is-open' : ''}`}>
      <button type="button" className="admin-ideas-sort-picker__trigger" onClick={() => setOpen((v) => !v)}>
        <SlidersHorizontal size={14} />
        <span><small>Sort ideas</small><strong>{current.label}</strong></span>
        <ChevronDown size={14} />
      </button>
      {open ? (
        <div className="admin-ideas-sort-picker__menu">
          {SORT_OPTIONS.map((option) => (
            <button
              type="button"
              key={option.key}
              className={option.key === value ? 'is-active' : ''}
              onClick={() => { onChange(option.key); setOpen(false); }}
            >
              <span>{option.label}</span>
              {option.key === value ? <CheckCircle2 size={13} /> : null}
            </button>
          ))}
        </div>
      ) : null}
      <button type="button" className="admin-ideas-sort-picker__direction" onClick={onToggleOrder}>
        {order === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
      </button>
    </div>
  );
}


const nf = new Intl.NumberFormat('en-US');
const fmt = (value) => nf.format(Number(value || 0));

function getItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

function getMeta(payload, count) {
  const source = payload?.meta || payload?.pagination || {};
  const total = Number(source.total ?? payload?.total ?? count) || 0;
  const page = Number(source.page ?? source.currentPage ?? 1) || 1;
  const limit = Number(source.limit ?? source.pageSize ?? PAGE_SIZE) || PAGE_SIZE;
  return {
    total,
    page,
    limit,
    totalPages: Math.max(1, Number(source.totalPages ?? Math.ceil(total / Math.max(1, limit))) || 1),
  };
}

function formatDate(value, withTime = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return withTime
    ? date.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function titleCase(value) {
  return String(value || '—')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getOwner(idea) {
  return idea?.user?.fullName || idea?.user?.email || idea?.userEmail || (idea?.guestSession ? 'Guest session' : 'Unknown owner');
}

function getOwnerMeta(idea) {
  return idea?.user?.email || (idea?.guestSession ? 'Guest idea' : 'No email');
}

function getDomain(idea) {
  return idea?.domain?.name || idea?.domain || 'Unassigned';
}

function isPublished(idea) {
  return String(idea?.publication?.status || '').toUpperCase() === 'PUBLISHED';
}

function statusTone(value) {
  const normalized = String(value || '').toUpperCase();
  if (['COMPLETED', 'PUBLISHED', 'ACTIVE', 'SUCCEEDED'].includes(normalized)) return 'is-success';
  if (['FAILED', 'CANCELLED', 'REJECTED'].includes(normalized)) return 'is-danger';
  if (['RUNNING', 'PREPARING', 'PENDING', 'QUEUED'].includes(normalized)) return 'is-warning';
  return 'is-neutral';
}

function MetricCard({ icon: Icon, label, value, hint, tone = 'mint', delay = 0 }) {
  return (
    <article className={`admin-ideas-metric admin-ideas-metric--${tone}`} style={{ '--delay': `${delay}ms` }}>
      <span className="admin-ideas-metric__icon"><Icon size={18} /></span>
      <div>
        <small>{label}</small>
        <strong>{fmt(value)}</strong>
        <span>{hint}</span>
      </div>
      <i aria-hidden="true" />
    </article>
  );
}

function IdeasSkeleton() {
  return (
    <div className="admin-ideas-skeleton" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, index) => (
        <div className="admin-ideas-skeleton__row" key={index}>
          <span /><span /><span /><span /><span />
        </div>
      ))}
    </div>
  );
}

function DetailBlock({ icon: Icon, label, children, className = '' }) {
  return (
    <section className={`admin-idea-detail-block ${className}`}>
      <header><span><Icon size={16} /></span><h4>{label}</h4></header>
      <div>{children}</div>
    </section>
  );
}


/**
 * Reusable accessible header button for sortable columns.
 * The icon always communicates whether the column is idle, ascending or
 * descending without adding another row of controls to the table.
 */
function SortHeader({ field, label, sortBy, sortOrder, onSort, className = '' }) {
  const active = sortBy === field;
  const Icon = !active ? ArrowUpDown : sortOrder === 'asc' ? ArrowUp : ArrowDown;

  return (
    <th className={className} aria-sort={active ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={`admin-ideas-sort-head ${active ? 'is-active' : ''}`} onClick={() => onSort(field)}>
        <span>{label}</span>
        <Icon size={12} />
      </button>
    </th>
  );
}

export default function AdminIdeasPage() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: PAGE_SIZE, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [moderationTarget, setModerationTarget] = useState(null);
  const [moderationReason, setModerationReason] = useState('');
  const [moderationLoading, setModerationLoading] = useState(false);
  const [moderationError, setModerationError] = useState('');
  const [notice, setNotice] = useState('');
  const [insightTarget, setInsightTarget] = useState(null);
  const [insightReports, setInsightReports] = useState([]);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState('');
  const [reportReplies, setReportReplies] = useState({});
  const [reportBusyId, setReportBusyId] = useState('');
  const requestIdRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const queryParams = useMemo(() => {
    const params = {
      page,
      limit: PAGE_SIZE,
      sortBy,
      sortOrder,
    };
    if (search) params.search = search;
    if (activeFilter === 'locked') params.isUnlocked = 'false';
    if (activeFilter === 'unlocked') params.isUnlocked = 'true';
    return params;
  }, [activeFilter, page, search, sortBy, sortOrder]);

  const summaryParams = useMemo(() => ({}), []);

  const load = useCallback(async ({ quiet = false, force = false } = {}) => {
    const requestId = ++requestIdRef.current;

    if (quiet) setRefreshing(true);
    else setLoading(true);

    setError('');

    setSummaryLoading(true);

    const listPromise = activeFilter === 'published'
      ? (force
        ? adminApi.ideas.publishedListFresh(queryParams)
        : adminApi.ideas.publishedList(queryParams))
      : (force
        ? adminApi.ideas.listFresh(queryParams)
        : adminApi.ideas.list(queryParams));

    const summaryPromise = force
      ? adminApi.ideas.summaryFresh(summaryParams)
      : adminApi.ideas.summary(summaryParams);

    summaryPromise
      .then((payload) => {
        if (requestId === requestIdRef.current) setSummary(payload);
      })
      .catch(() => {
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setSummaryLoading(false);
      });

    try {
      const listPayload = await listPromise;
      if (requestId !== requestIdRef.current) return;

      const nextRows = getItems(listPayload);
      setRows(nextRows);
      setMeta(getMeta(listPayload, nextRows.length));
    } catch (requestError) {
      if (requestId !== requestIdRef.current) return;

      setRows([]);
      setError(getApiErrorMessage(requestError, 'Could not load ideas.'));
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [activeFilter, queryParams, summaryParams]);

  useEffect(() => {
    load();
  }, [load]);

  const chooseFilter = (key) => {
    if (key === activeFilter) return;
    setActiveFilter(key);
    setPage(1);
  };


  /**
   * Changes the global directory ordering and resets pagination. Clicking the
   * same table header toggles direction; clicking a new header starts with a
   * natural order (newest-first for dates, A-Z for text).
   */
  const applySort = (field) => {
    if (field === sortBy) {
      setSortOrder((value) => (value === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortOrder(field === 'createdAt' ? 'desc' : 'asc');
    }
    setPage(1);
  };


  const openIdea = async (idea) => {
    const id = idea?.id;
    if (!id) return;
    setSelected(idea);
    setDetailError('');
    setDetailLoading(true);
    try {
      const payload = await adminApi.ideas.quickDetail(id);
      const detail = payload?.data && !Array.isArray(payload.data) ? payload.data : payload;
      if (detail && typeof detail === 'object') setSelected({ ...idea, ...detail });
    } catch (requestError) {
      setDetailError(getApiErrorMessage(requestError, 'Could not load the idea details.'));
    } finally {
      setDetailLoading(false);
    }
  };

  const closeIdea = () => {
    setSelected(null);
    setDetailError('');
    setDetailLoading(false);
  };

  useEffect(() => {
    if (!selected) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closeIdea();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [selected]);

  const summarySource = summary?.data && typeof summary.data === 'object' ? summary.data : summary || {};
  const totalIdeas = summarySource.totalIdeas ?? meta.total;
  const publishedIdeas = summarySource.publications?.publishedIdeas ?? 0;
  const lockedIdeas = summarySource.access?.lockedIdeas ?? 0;
  const unlockedIdeas = summarySource.access?.unlockedIdeas ?? 0;

  const requestUnpublish = (idea) => {
    const publicationId = idea?.publication?.id;
    if (!publicationId) return;
    setModerationTarget(idea);
    setModerationReason('');
    setModerationError('');
  };

  const closeModeration = () => {
    if (moderationLoading) return;
    setModerationTarget(null);
    setModerationReason('');
    setModerationError('');
  };

  const confirmUnpublish = async () => {
    const reason = moderationReason.trim();
    const publicationId = moderationTarget?.publication?.id;
    if (!publicationId) return;
    if (reason.length < 3) {
      setModerationError('Please enter a clear reason of at least 3 characters.');
      return;
    }

    setModerationLoading(true);
    setModerationError('');
    try {
      await adminApi.publications.unpublish(publicationId, reason);
      setNotice('Publication removed from community discovery. The publisher was notified.');
      if (selected?.id === moderationTarget?.id) closeIdea();
      if (insightTarget?.id === moderationTarget?.id) {
        setInsightTarget(null);
        setInsightReports([]);
      }
      setModerationTarget(null);
      setModerationReason('');
      await load({ quiet: true, force: true });
      window.setTimeout(() => setNotice(''), 4200);
    } catch (requestError) {
      setModerationError(getApiErrorMessage(requestError, 'Could not unpublish this idea.'));
    } finally {
      setModerationLoading(false);
    }
  };

  const openPublicationInsights = async (idea) => {
    const publicationId = idea?.publication?.id;
    if (!publicationId || !idea?.id) return;


    setInsightTarget(idea);
    setInsightReports([]);
    setInsightError('');
    setInsightLoading(true);

    const [insightResult, reportsResult] = await Promise.allSettled([
      adminApi.ideas.publicationInsights(idea.id),
      adminApi.publicationReports.listForPublication(publicationId, {
        page: 1,
        limit: 20,
      }),
    ]);

    if (insightResult.status === 'fulfilled') {
      const payload = insightResult.value;
      const detail =
        payload?.data && !Array.isArray(payload.data)
          ? payload.data
          : payload;

      if (detail && typeof detail === 'object') {
        setInsightTarget((current) => ({
          ...(current || idea),
          ...detail,
        }));
      }
    }

    if (reportsResult.status === 'fulfilled') {
      setInsightReports(getItems(reportsResult.value));
    }

    if (
      insightResult.status === 'rejected' &&
      reportsResult.status === 'rejected'
    ) {
      setInsightError(
        getApiErrorMessage(
          insightResult.reason || reportsResult.reason,
          'Publication insights could not be loaded.',
        ),
      );
    } else if (insightResult.status === 'rejected') {
      setInsightError('The publication snapshot could not be refreshed. Reports are still available.');
    } else if (reportsResult.status === 'rejected') {
      setInsightError('Reports could not be refreshed. Publication insights are still available.');
    }

    setInsightLoading(false);
  };

  const closePublicationInsights = useCallback(() => {
    if (reportBusyId) return;

    setInsightTarget(null);
    setInsightReports([]);
    setInsightError('');
    setReportReplies({});
  }, [reportBusyId]);

  const reviewInsightReport = async (report, status) => {
    const reply = String(reportReplies[report.id] || '').trim();

    if (reply.length < 3) {
      setInsightError('Write a short response before resolving or dismissing the report.');
      return;
    }

    setReportBusyId(report.id);
    setInsightError('');

    try {
      const result = await adminApi.publicationReports.review(report.id, {
        status,
        adminNote: reply,
        reporterMessage: reply,
        moderationAction: 'NONE',
      });

      setInsightReports((current) =>
        current.map((item) =>
          item.id === report.id
            ? {
              ...item,
              status: result?.report?.status || status,
              adminNote: result?.report?.adminNote || reply,
              reviewedAt: result?.report?.reviewedAt || new Date().toISOString(),
            }
            : item,
        ),
      );

      setReportReplies((current) => ({ ...current, [report.id]: '' }));
      setNotice(`Report ${status.toLowerCase()} and reporter notified.`);
      window.setTimeout(() => setNotice(''), 3500);
    } catch (requestError) {
      setInsightError(
        getApiErrorMessage(requestError, 'Could not review this report.'),
      );
    } finally {
      setReportBusyId('');
    }
  };

  useEffect(() => {
    if (!insightTarget) return undefined;

    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') closePublicationInsights();
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [insightTarget, closePublicationInsights]);

  const handleExport = async () => {
    try {
      setRefreshing(true);
      if (activeFilter === 'published') await adminApi.ideas.exportPublishedCsv({ search });
      else await adminApi.ideas.exportCsv({ ...queryParams, page: undefined, limit: undefined });
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'CSV export failed.'));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="admin-page admin-ideas-page">
      <section className="admin-ideas-hero">
        <div className="admin-ideas-hero__copy">
          <div className="admin-hero__eyebrow"><Sparkles size={14} /> Idea intelligence</div>
          <h2>Ideas, without the spreadsheet feeling.</h2>
          <p>Filter access states, find published work, inspect ownership and open any idea in a focused admin view.</p>
          <div className="admin-ideas-hero__chips">
            <span><i /> Live directory</span>
            <span><Lightbulb size={13} /> {fmt(meta.total)} records</span>
            <span><Globe2 size={13} /> {summaryLoading ? '…' : `${fmt(publishedIdeas)} published`}</span>
          </div>
        </div>
        <div className="admin-ideas-hero__visual" aria-hidden="true">
          <div className="admin-ideas-orbit">
            <span className="admin-ideas-orbit__ring" />
            <span className="admin-ideas-orbit__ring admin-ideas-orbit__ring--two" />
            <div><Lightbulb size={24} /><strong>{fmt(totalIdeas)}</strong><small>ideas</small></div>
            <span className="admin-ideas-orbit__track admin-ideas-orbit__track--one"><i className="admin-ideas-orbit__node" /></span>
            <span className="admin-ideas-orbit__track admin-ideas-orbit__track--two"><i className="admin-ideas-orbit__node" /></span>
          </div>
        </div>
      </section>

      <section className="admin-ideas-metrics">
        <MetricCard icon={Sparkles} label="All ideas" value={totalIdeas} hint="platform total" tone="mint" delay={0} />
        <MetricCard icon={Globe2} label="Published" value={publishedIdeas} hint="visible to community" tone="aqua" delay={45} />
        <MetricCard icon={LockKeyhole} label="Locked" value={lockedIdeas} hint="advanced access closed" tone="rose" delay={90} />
        <MetricCard icon={Unlock} label="Unlocked" value={unlockedIdeas} hint="advanced access available" tone="sage" delay={135} />
      </section>

      <section className="admin-ideas-workspace">
        <header className="admin-ideas-workspace__head">
          <div>
            <span className="admin-ideas-workspace__kicker">IDEA DIRECTORY</span>
            <h3>Explore platform ideas</h3>
            <p>{meta.total ? `${fmt(meta.total)} matching ideas` : 'Live administrative records'}</p>
          </div>
          <div className="admin-toolbar">
            <button className="admin-btn" type="button" onClick={() => load({ quiet: true, force: true })} disabled={refreshing}>
              <RefreshCw size={14} className={refreshing ? 'admin-spin' : ''} /> Refresh
            </button>
            <button className="admin-btn" type="button" onClick={handleExport} disabled={refreshing}>
              <Download size={14} /> Export CSV
            </button>
          </div>
        </header>

        {notice ? (
          <div className="admin-ideas-notice"><BadgeCheck size={17} /><span>{notice}</span></div>
        ) : null}

        <div className="admin-ideas-controls">
          <div className="admin-ideas-filters" role="tablist" aria-label="Idea filters">
            {FILTERS.map(({ key, label, icon: FilterIcon }) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={activeFilter === key}
                className={activeFilter === key ? 'is-active' : ''}
                onClick={() => chooseFilter(key)}
              >
                <FilterIcon size={14} />
                <span>{label}</span>
              </button>
            ))}
          </div>

          <div className="admin-ideas-control-right">
            <IdeaSortPicker
              value={sortBy}
              order={sortOrder}
              onChange={(field) => {
                setSortBy(field);
                setSortOrder(field === 'createdAt' ? 'desc' : 'asc');
                setPage(1);
              }}
              onToggleOrder={() => {
                setSortOrder((value) => (value === 'asc' ? 'desc' : 'asc'));
                setPage(1);
              }}
            />

            <label className="admin-ideas-search">
              <Search size={16} />
              <input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search title or problem…"
                aria-label="Search ideas"
              />
              {searchInput ? <button type="button" onClick={() => setSearchInput('')} aria-label="Clear search"><X size={14} /></button> : null}
            </label>
          </div>
        </div>

        {error ? (
          <div className="admin-ideas-error"><AlertCircle size={18} /><span>{error}</span><button type="button" onClick={() => load()}>Try again</button></div>
        ) : null}

        {loading && rows.length === 0 && !error ? <IdeasSkeleton /> : rows.length ? (
          <div className={`admin-ideas-table-wrap ${loading ? 'is-updating' : ''}`}>
            {loading ? <div className="admin-ideas-inline-loader"><LoaderCircle size={15} className="admin-spin" /> Updating ideas…</div> : null}
            <table className="admin-ideas-table">
              <thead>
                <tr>
                  <SortHeader field="title" label="Idea" sortBy={sortBy} sortOrder={sortOrder} onSort={applySort} />
                  <SortHeader field="owner" label="Owner" sortBy={sortBy} sortOrder={sortOrder} onSort={applySort} />
                  <SortHeader field="domain" label="Domain" sortBy={sortBy} sortOrder={sortOrder} onSort={applySort} />
                  <SortHeader field="generationType" label="Generation" sortBy={sortBy} sortOrder={sortOrder} onSort={applySort} />
                  <SortHeader field="isUnlocked" label="Access" sortBy={sortBy} sortOrder={sortOrder} onSort={applySort} />
                  <SortHeader field="publication" label="Publication" sortBy={sortBy} sortOrder={sortOrder} onSort={applySort} />
                  <SortHeader field="createdAt" label="Created" sortBy={sortBy} sortOrder={sortOrder} onSort={applySort} />
                  <th className="admin-ideas-actions-head" aria-label="Actions"><span>Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((idea) => {
                  const runStatus = idea?.generationRun?.status;
                  return (
                    <tr key={idea.id} onClick={() => openIdea(idea)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') openIdea(idea); }}>
                      <td>
                        <div className="admin-idea-title-cell">
                          <span className="admin-idea-row-mark"><Lightbulb size={16} /></span>
                          <div><strong>{idea.title || 'Untitled idea'}</strong><small><i className={`admin-idea-status-dot ${statusTone(runStatus)}`} />{runStatus ? titleCase(runStatus) : 'Idea record'}</small></div>
                        </div>
                      </td>
                      <td><div className="admin-idea-owner-cell"><span className="admin-idea-owner-avatar">{String(getOwner(idea)).charAt(0).toUpperCase()}</span><div><strong className="admin-idea-owner">{getOwner(idea)}</strong><small className="admin-idea-cell-note">{getOwnerMeta(idea)}</small></div></div></td>
                      <td><span className="admin-idea-domain-chip">{getDomain(idea)}</span></td>
                      <td><span className="admin-idea-pill is-neutral">{titleCase(idea.generationType)}</span></td>
                      <td><span className={`admin-idea-pill ${idea.isUnlocked ? 'is-success' : 'is-danger'}`}>{idea.isUnlocked ? <Unlock size={12} /> : <LockKeyhole size={12} />}{idea.isUnlocked ? 'Unlocked' : 'Locked'}</span></td>
                      <td><span className={`admin-idea-pill ${isPublished(idea) ? 'is-success' : 'is-neutral'}`}>{isPublished(idea) ? <Globe2 size={12} /> : <FileText size={12} />}{isPublished(idea) ? 'Published' : 'Not published'}</span></td>
                      <td><span className="admin-idea-date"><CalendarDays size={13} /> {formatDate(idea.createdAt)}</span></td>
                      <td>
                        <div className="admin-idea-row-actions">
                          {isPublished(idea) ? (
                            <button
                              type="button"
                              className="admin-idea-insights-btn"
                              onClick={(event) => {
                                event.stopPropagation();
                                openPublicationInsights(idea);
                              }}
                              title="Publication insights and reports"
                              aria-label="Publication insights"
                            >
                              <Sparkles size={15} />
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="admin-idea-open-btn admin-idea-open-btn--modern"
                            onClick={(event) => { event.stopPropagation(); openIdea(idea); }}
                            title="Open idea details"
                            aria-label={`Open ${idea.title || 'idea'} details`}
                          >
                            <Eye size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : !error ? (
          <div className="admin-ideas-empty"><Search size={24} /><strong>No ideas match this view</strong><span>Try another filter or search phrase.</span></div>
        ) : null}

        {!loading && meta.totalPages > 1 ? (
          <footer className="admin-ideas-pagination">
            <span>Page {meta.page} of {meta.totalPages} · {fmt(meta.total)} records</span>
            <div>
              <button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={15} /> Previous</button>
              <button type="button" disabled={page >= meta.totalPages} onClick={() => setPage((value) => Math.min(meta.totalPages, value + 1))}>Next <ChevronRight size={15} /></button>
            </div>
          </footer>
        ) : null}
      </section>

      {insightTarget ? createPortal(
        <div
          className="admin-publication-insights-backdrop"
          role="presentation"
          onMouseDown={closePublicationInsights}
        >
          <aside
            className="admin-publication-insights-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Publication insights and reports"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="admin-publication-insights-drawer__header">
              <div>
                <span><Globe2 size={14} /> PUBLISHED IDEA</span>
                <h3>{insightTarget?.publication?.publicTitle || insightTarget?.title || 'Publication insights'}</h3>
                <p>{getOwner(insightTarget)} · {getDomain(insightTarget)}</p>
              </div>
              <button type="button" onClick={closePublicationInsights} aria-label="Close publication insights">
                <X size={18} />
              </button>
            </header>

            {insightLoading ? (
              <div className="admin-publication-insights-loading">
                <LoaderCircle className="admin-spin" size={20} />
                Loading publication activity…
              </div>
            ) : null}

            {insightError ? (
              <div className="admin-publication-insights-error">
                <AlertCircle size={16} />
                <span>{insightError}</span>
              </div>
            ) : null}

            {!insightLoading ? (
              <div className="admin-publication-insights-drawer__body">
                <section className="admin-publication-signal-strip">
                  <div>
                    <Star size={16} />
                    <strong>{Number(insightTarget?.publication?.averageRating || 0).toFixed(1)}</strong>
                    <span>{fmt(insightTarget?.publication?.ratingsCount)} ratings</span>
                  </div>
                  <div>
                    <ThumbsUp size={16} />
                    <strong>{fmt(insightTarget?.publication?.upvotesCount)}</strong>
                    <span>upvotes</span>
                  </div>
                  <div>
                    <ThumbsDown size={16} />
                    <strong>{fmt(insightTarget?.publication?.downvotesCount)}</strong>
                    <span>downvotes</span>
                  </div>
                  <div>
                    <MessageSquareText size={16} />
                    <strong>{fmt(insightTarget?.publication?.feedbackCount)}</strong>
                    <span>feedback</span>
                  </div>
                  <div>
                    <Flag size={16} />
                    <strong>{fmt(insightReports.length)}</strong>
                    <span>reports</span>
                  </div>
                </section>

                <section className="admin-publication-insights-section">
                  <header>
                    <div>
                      <span><FileText size={15} /></span>
                      <div>
                        <h4>Publication snapshot</h4>
                        <p>Public copy and current community settings.</p>
                      </div>
                    </div>
                  </header>

                  <dl className="admin-publication-snapshot">
                    <div><dt>Status</dt><dd>{titleCase(insightTarget?.publication?.status)}</dd></div>
                    <div><dt>Visibility</dt><dd>{titleCase(insightTarget?.publication?.visibility)}</dd></div>
                    <div><dt>Published</dt><dd>{formatDate(insightTarget?.publication?.publishedAt, true)}</dd></div>
                    <div><dt>Voting</dt><dd>{insightTarget?.publication?.allowVoting ? 'Enabled' : 'Disabled'}</dd></div>
                    <div><dt>Ratings</dt><dd>{insightTarget?.publication?.allowRatings ? 'Enabled' : 'Disabled'}</dd></div>
                    <div><dt>Feedback</dt><dd>{insightTarget?.publication?.allowFeedback ? 'Enabled' : 'Disabled'}</dd></div>
                  </dl>

                  {insightTarget?.publication?.publicAbstract ? (
                    <p className="admin-publication-public-copy">
                      {insightTarget.publication.publicAbstract}
                    </p>
                  ) : null}
                </section>

                <section className="admin-publication-insights-section">
                  <header>
                    <div>
                      <span><MessageSquareText size={15} /></span>
                      <div>
                        <h4>Recent community feedback</h4>
                        <p>Latest written feedback visible on this publication.</p>
                      </div>
                    </div>
                    <strong>{fmt(insightTarget?.publication?.feedback?.length)}</strong>
                  </header>

                  <div className="admin-publication-feedback-list">
                    {Array.isArray(insightTarget?.publication?.feedback) && insightTarget.publication.feedback.length ? (
                      insightTarget.publication.feedback.slice(0, 6).map((item) => (
                        <article key={item.id}>
                          <div>
                            <strong>{item?.user?.fullName || 'Community member'}</strong>
                            <time>{formatDate(item.updatedAt || item.createdAt, true)}</time>
                          </div>
                          <p>{item.comment}</p>
                        </article>
                      ))
                    ) : (
                      <p className="admin-publication-insights-empty">No written feedback yet.</p>
                    )}
                  </div>
                </section>

                <section className="admin-publication-insights-section admin-publication-reports-section">
                  <header>
                    <div>
                      <span><Flag size={15} /></span>
                      <div>
                        <h4>Reports on this publication</h4>
                        <p>Review every report without leaving the idea directory.</p>
                      </div>
                    </div>
                    <strong>{fmt(insightReports.length)}</strong>
                  </header>

                  <div className="admin-publication-report-list">
                    {insightReports.length ? insightReports.map((report) => (
                      <article key={report.id} className={`admin-publication-report is-${String(report.status || '').toLowerCase()}`}>
                        <div className="admin-publication-report__top">
                          <div>
                            <span className="admin-publication-report__status">{titleCase(report.status)}</span>
                            <strong>{titleCase(report.reason)}</strong>
                            <small>{report?.reporter?.fullName || report?.reporter?.email || 'Reporter'} · {formatDate(report.createdAt, true)}</small>
                          </div>
                        </div>

                        {report.details ? <p className="admin-publication-report__details">{report.details}</p> : null}

                        {['PENDING', 'REVIEWING'].includes(String(report.status || '').toUpperCase()) ? (
                          <div className="admin-publication-report__reply">
                            <label>
                              <span>Response to reporter</span>
                              <textarea
                                value={reportReplies[report.id] || ''}
                                onChange={(event) =>
                                  setReportReplies((current) => ({
                                    ...current,
                                    [report.id]: event.target.value,
                                  }))
                                }
                                placeholder="Write the moderation response that the reporter should receive…"
                                maxLength={1000}
                              />
                            </label>

                            <div>
                              <button
                                type="button"
                                className="is-secondary"
                                disabled={reportBusyId === report.id}
                                onClick={() => reviewInsightReport(report, 'DISMISSED')}
                              >
                                Dismiss
                              </button>
                              <button
                                type="button"
                                className="is-primary"
                                disabled={reportBusyId === report.id}
                                onClick={() => reviewInsightReport(report, 'RESOLVED')}
                              >
                                {reportBusyId === report.id ? <LoaderCircle size={14} className="admin-spin" /> : <Send size={14} />}
                                Resolve & reply
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="admin-publication-report__reviewed">
                            <BadgeCheck size={14} />
                            <span>{report.adminNote || 'Reviewed by administration.'}</span>
                          </div>
                        )}
                      </article>
                    )) : (
                      <p className="admin-publication-insights-empty">No reports were submitted for this publication.</p>
                    )}
                  </div>
                </section>

                {isPublished(insightTarget) && insightTarget?.publication?.id ? (
                  <section className="admin-publication-moderation-footer">
                    <div>
                      <ShieldAlert size={17} />
                      <div>
                        <strong>Publication moderation</strong>
                        <span>Unpublishing stays out of the table and is available only after reviewing context.</span>
                      </div>
                    </div>
                    <button type="button" onClick={() => requestUnpublish(insightTarget)}>
                      <ShieldAlert size={14} />
                      Unpublish
                    </button>
                  </section>
                ) : null}
              </div>
            ) : null}
          </aside>
        </div>,
        document.body,
      ) : null}

      {selected ? createPortal(
        <div className="admin-idea-drawer-backdrop" role="presentation" onMouseDown={closeIdea}>
          <aside className="admin-idea-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="admin-idea-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="admin-idea-modal__topbar">
              <div>
                <span><Sparkles size={13} /> IDEA INSPECTOR</span>
                <h3 id="admin-idea-modal-title">{selected.title || 'Idea details'}</h3>
              </div>
              <button type="button" onClick={closeIdea} aria-label="Close idea details"><X size={18} /></button>
            </header>

            <div className="admin-idea-modal__body">
              <section className="admin-idea-modal__hero">
                <div className="admin-idea-modal__mark"><Lightbulb size={24} /></div>
                <div className="admin-idea-modal__hero-copy">
                  <small>{getDomain(selected)}</small>
                  <h4>{selected.title || 'Untitled idea'}</h4>
                  <div className="admin-idea-modal__chips">
                    <span className={selected.isUnlocked ? 'is-success' : 'is-danger'}>{selected.isUnlocked ? <Unlock size={12} /> : <LockKeyhole size={12} />}{selected.isUnlocked ? 'Unlocked' : 'Locked'}</span>
                    <span className={isPublished(selected) ? 'is-success' : ''}><Globe2 size={12} />{isPublished(selected) ? 'Published' : 'Not published'}</span>
                    <span><Sparkles size={12} />{titleCase(selected.generationType)}</span>
                  </div>
                </div>
                <div className="admin-idea-modal__owner"><span><UserRound size={15} /></span><div><small>Owner</small><strong>{getOwner(selected)}</strong><p>{getOwnerMeta(selected)}</p></div></div>
              </section>

              {detailLoading ? (
                <div className="admin-idea-detail-loading"><LoaderCircle size={22} className="admin-spin" /><span>Loading idea details…</span></div>
              ) : null}
              {detailError ? <div className="admin-ideas-error"><AlertCircle size={17} /><span>{detailError}</span></div> : null}

              <div className="admin-idea-modal__quick-grid">
                <article><span><BadgeCheck size={16} /></span><div><small>Pipeline</small><strong className={statusTone(selected?.generationRun?.status)}>{titleCase(selected?.generationRun?.status || 'Unknown')}</strong></div></article>
                <article><span><Clock3 size={16} /></span><div><small>Created</small><strong>{formatDate(selected.createdAt, true)}</strong></div></article>
                <article><span><CircleDollarSign size={16} /></span><div><small>Unlock method</small><strong>{titleCase(selected.unlockMethod || 'None')}</strong></div></article>
                <article><span><Globe2 size={16} /></span><div><small>Region</small><strong>{selected.selectedRegion || selected?.collectionJob?.region || 'Any region'}</strong></div></article>
              </div>

              <div className="admin-idea-modal__content-grid">
                <div className="admin-idea-modal__main">
                  <DetailBlock icon={FileText} label="Problem statement">
                    <p>{selected.problemStatement || 'No problem statement is available for this record.'}</p>
                  </DetailBlock>
                  <DetailBlock icon={Sparkles} label="Abstract">
                    <p>{selected.fullAbstract || selected.partialAbstract || selected.limitedAbstract || 'No abstract is available for this record.'}</p>
                  </DetailBlock>
                  <DetailBlock icon={BadgeCheck} label="Objectives">
                    {Array.isArray(selected.objectives) ? <ul>{selected.objectives.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <p>{selected.objectives || 'No objectives available.'}</p>}
                  </DetailBlock>
                  <DetailBlock icon={UserRound} label="Target users">
                    {Array.isArray(selected.targetUsers) ? <div className="admin-idea-tags">{selected.targetUsers.map((item) => <span key={item}>{item}</span>)}</div> : <p>{selected.targetUsers || 'No target-user information available.'}</p>}
                  </DetailBlock>
                </div>

                <aside className="admin-idea-modal__aside">
                  <DetailBlock icon={Sparkles} label="Generation status" className="is-compact">
                    <dl>
                      <div><dt>Stage</dt><dd>{titleCase(selected?.generationRun?.currentStageKey || '—')}</dd></div>
                      <div><dt>Progress</dt><dd>{Number(selected?.generationRun?.progressPercent || 0)}%</dd></div>
                      <div><dt>Started</dt><dd>{formatDate(selected?.generationRun?.startedAt, true)}</dd></div>
                      <div><dt>Completed</dt><dd>{formatDate(selected?.generationRun?.completedAt, true)}</dd></div>
                    </dl>
                  </DetailBlock>
                  <DetailBlock icon={Globe2} label="Publication" className="is-compact">
                    <dl>
                      <div><dt>Status</dt><dd>{titleCase(selected?.publication?.status || 'Not published')}</dd></div>
                      <div><dt>Visibility</dt><dd>{titleCase(selected?.publication?.visibility || '—')}</dd></div>
                      <div><dt>Published</dt><dd>{formatDate(selected?.publication?.publishedAt, true)}</dd></div>
                    </dl>
                  </DetailBlock>
                  <DetailBlock icon={FileText} label="Record" className="is-compact">
                    <dl>
                      <div><dt>Idea ID</dt><dd className="is-code">{selected.id || '—'}</dd></div>
                      <div><dt>Outputs</dt><dd>{fmt(selected?._count?.generatedOutputs)}</dd></div>
                      <div><dt>Payments</dt><dd>{fmt(selected?._count?.payments)}</dd></div>
                    </dl>
                  </DetailBlock>
                </aside>
              </div>

              {isPublished(selected) && selected?.publication?.id ? (
                <section className="admin-idea-moderation-strip">
                  <div>
                    <span><ShieldAlert size={16} /></span>
                    <div><strong>Publication moderation</strong><p>Remove this idea from community discovery and automatically notify its publisher.</p></div>
                  </div>
                  <button type="button" onClick={() => requestUnpublish(selected)}><ShieldAlert size={15} /> Unpublish idea</button>
                </section>
              ) : null}
            </div>
          </aside>
        </div>,
        document.body,
      ) : null}

      {moderationTarget ? createPortal(
        <div className="admin-idea-confirm-layer" role="presentation" onMouseDown={closeModeration}>
          <section className="admin-idea-confirm" role="dialog" aria-modal="true" aria-labelledby="unpublish-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="admin-idea-confirm__icon"><ShieldAlert size={22} /></div>
            <button className="admin-idea-confirm__close" type="button" onClick={closeModeration} aria-label="Close"><X size={17} /></button>
            <span className="admin-idea-confirm__eyebrow">PUBLICATION MODERATION</span>
            <h3 id="unpublish-title">Unpublish this idea?</h3>
            <p className="admin-idea-confirm__lead">
              <strong>{moderationTarget.title || 'Untitled idea'}</strong> will disappear from community discovery. The publication record and its history will stay preserved.
            </p>

            <div className="admin-idea-confirm__notify">
              <BellRing size={17} />
              <div><strong>Publisher notification is automatic</strong><span>{getOwnerMeta(moderationTarget)} will receive an in-app admin alert containing the reason below.</span></div>
            </div>

            <label className="admin-idea-confirm__field">
              <span>Reason for unpublishing</span>
              <textarea
                value={moderationReason}
                onChange={(event) => { setModerationReason(event.target.value); if (moderationError) setModerationError(''); }}
                placeholder="Example: The publication contains information that should be corrected before it is visible to the community."
                maxLength={1000}
                autoFocus
              />
              <small>{moderationReason.trim().length}/1000 · This reason is included in the publisher alert.</small>
            </label>

            {moderationError ? <div className="admin-idea-confirm__error"><AlertCircle size={15} /> {moderationError}</div> : null}

            <footer className="admin-idea-confirm__actions">
              <button type="button" className="is-secondary" onClick={closeModeration} disabled={moderationLoading}>Keep published</button>
              <button type="button" className="is-danger" onClick={confirmUnpublish} disabled={moderationLoading || moderationReason.trim().length < 3}>
                {moderationLoading ? <LoaderCircle size={15} className="admin-spin" /> : <ShieldAlert size={15} />}
                {moderationLoading ? 'Unpublishing…' : 'Unpublish & notify'}
              </button>
            </footer>
          </section>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}