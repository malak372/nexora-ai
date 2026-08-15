/**
 * Publication report moderation workspace.
 *
 * @author  Malak
 */

import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BadgeCheck,
  CheckCircle2,
  Clock3,
  BellRing,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Flag,
  Globe2,
  LoaderCircle,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  ThumbsDown,
  ThumbsUp,
  MessageSquareText,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { adminApi, getApiErrorMessage } from '../../shared/api/adminApi';
import '../../shared/styles/admin-pages.css';
import '../styles/admin-publication-reports.css';
import '../../ideas/styles/admin-publication-insights.css';

const PAGE_SIZE = 20;

const STATUS_FILTERS = [
  { key: '', label: 'All reports' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'REVIEWING', label: 'Reviewing' },
  { key: 'RESOLVED', label: 'Resolved' },
  { key: 'DISMISSED', label: 'Dismissed' },
];

/**
 * Report sorting is server-side, so ordering is stable across all pages.
 * Relation-backed fields (publication/reporter) are handled explicitly by the
 * backend service instead of trusting arbitrary query input.
 */
const REPORT_SORT_OPTIONS = [
  { key: 'createdAt', label: 'Submitted date' },
  { key: 'status', label: 'Status' },
  { key: 'reason', label: 'Reason' },
  { key: 'publication', label: 'Publication title' },
  { key: 'reporter', label: 'Reporter' },
  { key: 'reviewedAt', label: 'Reviewed date' },
];

const MODERATION_ACTIONS = [
  { key: 'NONE', label: 'No publication action', description: 'Only update the report workflow state.', icon: CheckCircle2, tone: 'neutral' },
  { key: 'WARN_PUBLISHER', label: 'Notify publisher', description: 'Keep it live and send an administrator notice.', icon: BellRing, tone: 'info' },
  { key: 'HIDE_PUBLICATION', label: 'Hide temporarily', description: 'Remove it from discovery while keeping the publication record.', icon: EyeOff, tone: 'warning' },
  { key: 'ARCHIVE_PUBLICATION', label: 'Unpublish', description: 'Archive it and remove it from community discovery.', icon: Archive, tone: 'danger' },
  { key: 'RESTORE_PUBLICATION', label: 'Restore / republish', description: 'Return a hidden or archived publication to the community.', icon: ArchiveRestore, tone: 'success' },
];

const REPORT_STATUS_OPTIONS = ['PENDING', 'REVIEWING', 'RESOLVED', 'DISMISSED'];

function ReportSortPicker({ value, order, onChange, onToggleOrder }) {
  const [open, setOpen] = useState(false);
  const current = REPORT_SORT_OPTIONS.find((option) => option.key === value) || REPORT_SORT_OPTIONS[0];

  return (
    <div className={`admin-report-sort-picker ${open ? 'is-open' : ''}`}>
      <button type="button" className="admin-report-sort-picker__trigger" onClick={() => setOpen((v) => !v)}>
        <SlidersHorizontal size={14} />
        <span><small>Sort reports</small><strong>{current.label}</strong></span>
        <ChevronDown size={14} />
      </button>
      {open ? (
        <div className="admin-report-sort-picker__menu">
          {REPORT_SORT_OPTIONS.map((option) => (
            <button type="button" key={option.key} className={option.key === value ? 'is-active' : ''} onClick={() => { onChange(option.key); setOpen(false); }}>
              <span>{option.label}</span>
              {option.key === value ? <BadgeCheck size={13} /> : null}
            </button>
          ))}
        </div>
      ) : null}
      <button type="button" className="admin-report-sort-picker__direction" onClick={onToggleOrder}>
        {order === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
      </button>
    </div>
  );
}


function SortHead({ field, label, sortBy, sortOrder, onSort }) {
  const active = sortBy === field;
  const Icon = !active ? ArrowUpDown : sortOrder === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th aria-sort={active ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={`admin-report-sort-head ${active ? 'is-active' : ''}`} onClick={() => onSort(field)}>
        <span>{label}</span><Icon size={12} />
      </button>
    </th>
  );
}


function getItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function getMeta(payload, count) {
  const source = payload?.meta || payload?.pagination || {};
  const total = Number(source.total ?? count) || 0;
  const page = Number(source.page ?? 1) || 1;
  const totalPages = Math.max(1, Number(source.totalPages ?? Math.ceil(total / PAGE_SIZE)) || 1);
  return { total, page, totalPages };
}

function titleCase(value) {
  return String(value || '—')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getReportActionLabel(report) {
  const stored = report?.moderationAction;
  if (stored) {
    return MODERATION_ACTIONS.find((item) => item.key === stored)?.label || titleCase(stored);
  }

  if (String(report?.publication?.status || '').toUpperCase() === 'ARCHIVED') {
    return 'Unpublish';
  }

  if (report?.publication?.isHidden) {
    return 'Hide temporarily';
  }

  return report?.reviewedAt ? 'No publication action' : 'Not reviewed';
}

export default function AdminPublicationReportsPage() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [meta, setMeta] = useState({ total: 0, page: 1, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');
  const [drawerTab, setDrawerTab] = useState('review');
  const [reportStatus, setReportStatus] = useState('REVIEWING');
  const [moderationAction, setModerationAction] = useState('NONE');
  const [publisherMessage, setPublisherMessage] = useState('');
  const [notifyReporter, setNotifyReporter] = useState(true);
  const [reporterMessage, setReporterMessage] = useState('');
  const [ideaDetail, setIdeaDetail] = useState(null);
  const [ideaInsight, setIdeaInsight] = useState(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState('');
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [response, setResponse] = useState('');
  const [busy, setBusy] = useState(false);
  const [drawerError, setDrawerError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const params = useMemo(() => {
    const value = { page, limit: PAGE_SIZE, sortBy, sortOrder };
    if (status) value.status = status;
    if (search) value.search = search;
    return value;
  }, [page, search, sortBy, sortOrder, status]);

  const loadSummary = useCallback(async ({ fresh = false } = {}) => {
    setSummaryLoading(true);
    try {
      const summaryLoader = fresh ? adminApi.publicationReports.summaryFresh : adminApi.publicationReports.summary;
      const payload = await summaryLoader();
      setSummary(payload);
    } catch {
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  const load = useCallback(async ({ quiet = false, fresh = false } = {}) => {
    if (!quiet) setLoading(true);
    setError('');

    try {
      const listLoader = fresh ? adminApi.publicationReports.listFresh : adminApi.publicationReports.list;
      const payload = await listLoader(params);
      const nextRows = getItems(payload);
      setRows(nextRows);
      setMeta(getMeta(payload, nextRows.length));
    } catch (requestError) {
      setRows([]);
      setError(getApiErrorMessage(requestError, 'Could not load publication reports.'));
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    void load();
  }, [load]);

  const openReport = (report, tab = 'review') => {
    setSelected(report);
    setResponse(report.adminNote || '');
    setReportStatus(String(report.status || 'REVIEWING').toUpperCase());
    setModerationAction('NONE');
    setPublisherMessage('');
    setNotifyReporter(true);
    setReporterMessage('');
    setDrawerError('');
    setContextError('');
    setDrawerTab(tab);
    setIdeaDetail(null);
    setIdeaInsight(null);
  };

  const closeReport = useCallback(() => {
    if (busy) return;

    setSelected(null);
    setResponse('');
    setDrawerError('');
    setContextError('');
    setIdeaDetail(null);
    setIdeaInsight(null);
    setDrawerTab('review');
  }, [busy]);

  useEffect(() => {
    if (!selected) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') closeReport();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selected, closeReport]);


  const applySort = (field) => {
    setPage(1);
    if (field === sortBy) {
      setSortOrder((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortBy(field);
    setSortOrder(field === 'createdAt' || field === 'reviewedAt' ? 'desc' : 'asc');
  };

  const selectDrawerTab = async (tab) => {
    setDrawerTab(tab);
    setContextError('');
    if (tab === 'review' || !selected?.publication?.ideaId) return;

    const ideaId = selected.publication.ideaId;
    try {
      setContextLoading(true);
      if (tab === 'details' && !ideaDetail) {
        const payload = await adminApi.ideas.quickDetail(ideaId);
        setIdeaDetail(payload?.data && typeof payload.data === 'object' ? payload.data : payload);
      }
      if (tab === 'insights' && !ideaInsight) {
        const payload = await adminApi.ideas.publicationInsights(ideaId);
        setIdeaInsight(payload?.data && typeof payload.data === 'object' ? payload.data : payload);
      }
    } catch (requestError) {
      setContextError(getApiErrorMessage(requestError, `Could not load idea ${tab}.`));
    } finally {
      setContextLoading(false);
    }
  };

  const applyModerationDecision = async () => {
    if (!selected?.id) return;
    if (moderationAction === 'WARN_PUBLISHER' && publisherMessage.trim().length < 5) {
      setDrawerError('Write the notification that should be sent to the publisher.');
      return;
    }

    setBusy(true);
    setDrawerError('');

    try {
      const reviewResult = await adminApi.publicationReports.review(selected.id, {
        status: reportStatus,
        adminNote: response.trim() || undefined,
        moderationAction,
        publisherMessage: publisherMessage.trim() || undefined,
        notifyReporter,
        reporterMessage: notifyReporter ? (reporterMessage.trim() || undefined) : undefined,
      });

      const updatedReport = reviewResult?.report || reviewResult?.data?.report;
      if (updatedReport) {
        setSelected((current) => ({
          ...current,
          ...updatedReport,
          publication: current?.publication,
          reporter: current?.reporter,
          reviewedBy: updatedReport.reviewedBy || current?.reviewedBy,
        }));
        setReportStatus(String(updatedReport.status || reportStatus).toUpperCase());
        setModerationAction('NONE');
        setPublisherMessage('');
        setReporterMessage('');
      }

      const actionLabel =
        MODERATION_ACTIONS.find((item) => item.key === moderationAction)?.label ||
        titleCase(moderationAction);
      const publisherWasNotified = Boolean(
        reviewResult?.publisherNotifiedThisReview ??
        reviewResult?.data?.publisherNotifiedThisReview ??
        reviewResult?.publisherNotified ??
        reviewResult?.data?.publisherNotified,
      );
      const reporterWasNotified = Boolean(
        reviewResult?.reporterNotifiedThisReview ??
        reviewResult?.data?.reporterNotifiedThisReview ??
        reviewResult?.reporterNotified ??
        reviewResult?.data?.reporterNotified,
      );

      setNotice(
        [
          `${titleCase(reportStatus)} · ${actionLabel}`,
          publisherWasNotified ? 'publisher notified' : '',
          reporterWasNotified ? 'reporter notified' : '',
        ]
          .filter(Boolean)
          .join(' · '),
      );
      await Promise.all([load({ quiet: true }), loadSummary()]);
      window.setTimeout(() => setNotice(''), 3500);
    } catch (requestError) {
      setDrawerError(getApiErrorMessage(requestError, 'Could not apply the moderation decision.'));
    } finally {
      setBusy(false);
    }
  };

  const summaryValue = summary?.data && typeof summary.data === 'object' ? summary.data : summary || {};

  return (
    <div className="admin-page admin-publication-reports-page">
      <section className="admin-publication-reports-hero">
        <div>
          <span><ShieldCheck size={14} /> TRUST & SAFETY</span>
          <h2>Publication report center</h2>
          <p>One moderation queue for reports raised against community publications.</p>
        </div>
        <div className="admin-publication-reports-hero__pulse">
          <Flag size={20} />
          <strong>{summaryLoading ? '…' : Number(summaryValue.pendingReports || 0)}</strong>
          <span>need review</span>
        </div>
      </section>

      <section className="admin-publication-report-summary-strip" aria-label="Publication report summary">
        <article className="is-featured">
          <i />
          <span className="admin-report-stat__icon"><Flag size={19} /></span>
          <div><small>Total reports</small><strong>{summaryLoading ? '…' : Number(summaryValue.totalReports || 0)}</strong><span>Current moderation snapshot</span></div>
        </article>
        <article className="is-pending">
          <i />
          <span className="admin-report-stat__icon"><Clock3 size={19} /></span>
          <div><small>Pending</small><strong>{summaryLoading ? '…' : Number(summaryValue.pendingReports || 0)}</strong><span>Waiting for review</span></div>
        </article>
        <article className="is-reviewing">
          <i />
          <span className="admin-report-stat__icon"><ShieldCheck size={19} /></span>
          <div><small>Reviewing</small><strong>{summaryLoading ? '…' : Number(summaryValue.reviewingReports || 0)}</strong><span>Currently in moderation</span></div>
        </article>
        <article className="is-resolved">
          <i />
          <span className="admin-report-stat__icon"><BadgeCheck size={19} /></span>
          <div><small>Resolved</small><strong>{summaryLoading ? '…' : Number(summaryValue.resolvedReports || 0)}</strong><span>Completed reviews</span></div>
        </article>
        <article className="is-publications">
          <i />
          <span className="admin-report-stat__icon"><Globe2 size={19} /></span>
          <div><small>Affected publications</small><strong>{summaryLoading ? '…' : Number(summaryValue.affectedPublications || 0)}</strong><span>Unique reported items</span></div>
        </article>
      </section>

      <section className="admin-publication-reports-workspace">
        <header>
          <div>
            <span>MODERATION QUEUE</span>
            <h3>Reports</h3>
            <p>{meta.total} matching reports</p>
          </div>
          <button type="button" onClick={() => { void load({ quiet: true, fresh: true }); void loadSummary({ fresh: true }); }}>
            <RefreshCw size={14} /> Refresh
          </button>
        </header>

        {notice
          ? createPortal(
            <div className="admin-publication-reports-toast" role="status">
              <BadgeCheck size={17} />
              <div>
                <strong>Moderation updated</strong>
                <span>{notice}</span>
              </div>
            </div>,
            document.body,
          )
          : null}

        <div className="admin-publication-reports-controls">
          <div className="admin-publication-report-tabs">
            {STATUS_FILTERS.map((item) => (
              <button
                key={item.key || 'all'}
                type="button"
                className={status === item.key ? 'is-active' : ''}
                onClick={() => {
                  setStatus(item.key);
                  setPage(1);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>

          <ReportSortPicker
            value={sortBy}
            order={sortOrder}
            onChange={(field) => {
              setPage(1);
              setSortBy(field);
              setSortOrder(field === 'createdAt' || field === 'reviewedAt' ? 'desc' : 'asc');
            }}
            onToggleOrder={() => {
              setPage(1);
              setSortOrder((current) => current === 'asc' ? 'desc' : 'asc');
            }}
          />

          <label>
            <Search size={15} />
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search title, reporter or details…"
            />
          </label>
        </div>

        {error ? (
          <div className="admin-publication-reports-error">
            <AlertCircle size={16} />
            <span>{error}</span>
            <button type="button" onClick={() => load()}>Try again</button>
          </div>
        ) : null}

        {loading ? (
          <div className="admin-publication-reports-loading">
            <LoaderCircle className="admin-spin" size={18} /> Loading reports…
          </div>
        ) : rows.length ? (
          <div className="admin-publication-reports-table-wrap">
            <table className="admin-publication-reports-table">
              <thead>
                <tr>
                  <SortHead field="publication" label="Publication" sortBy={sortBy} sortOrder={sortOrder} onSort={applySort} />
                  <SortHead field="reporter" label="Reporter" sortBy={sortBy} sortOrder={sortOrder} onSort={applySort} />
                  <SortHead field="reason" label="Reason" sortBy={sortBy} sortOrder={sortOrder} onSort={applySort} />
                  <SortHead field="status" label="Status" sortBy={sortBy} sortOrder={sortOrder} onSort={applySort} />
                  <th>Latest decision</th>
                  <SortHead field="createdAt" label="Submitted" sortBy={sortBy} sortOrder={sortOrder} onSort={applySort} />
                  <th className="admin-publication-reports-actions-head">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((report) => {
                  const statusKey = String(report.status || 'PENDING').toLowerCase();
                  const reporterName = report?.reporter?.fullName || 'Community member';
                  const reporterEmail = report?.reporter?.email || 'No email available';
                  const publisher = report?.publication?.publisher?.fullName || report?.publication?.publisher?.email || 'Publisher';

                  return (
                    <tr
                      key={report.id}
                      className={`admin-report-row is-${statusKey}`}
                      onClick={() => openReport(report)}
                      tabIndex={0}
                      onKeyDown={(event) => { if (event.key === 'Enter') openReport(report); }}
                    >
                      <td>
                        <div className="admin-report-publication-cell">
                          <span className="admin-report-publication-icon"><Flag size={15} /></span>
                          <div>
                            <strong>{report?.publication?.publicTitle || 'Untitled publication'}</strong>
                            <small>Published by {publisher}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="admin-report-reporter-cell">
                          <span className="admin-report-reporter-avatar">{String(reporterName).slice(0, 1).toUpperCase()}</span>
                          <div>
                            <strong>{reporterName}</strong>
                            <small>{reporterEmail}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="admin-report-reason-cell">
                          <span>{titleCase(report.reason)}</span>
                          <small>{report.details || 'No additional details.'}</small>
                        </div>
                      </td>
                      <td>
                        <span className={`admin-report-status-pill is-${statusKey}`}>
                          <i aria-hidden="true" />
                          {titleCase(report.status)}
                        </span>
                      </td>
                      <td>
                        <div className="admin-report-decision-cell">
                          <ShieldCheck size={14} />
                          <div>
                            <strong>{getReportActionLabel(report)}</strong>
                            <small>{report.reviewedAt ? `Reviewed ${formatDate(report.reviewedAt)}` : 'Awaiting moderation'}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="admin-report-date-cell"><Clock3 size={13} /> {formatDate(report.createdAt)}</span>
                      </td>
                      <td>
                        <div className="admin-report-row-actions" onClick={(event) => event.stopPropagation()}>
                          <button type="button" className="is-primary" onClick={() => openReport(report, 'review')} title="Review report">
                            <Flag size={14} /><span>Review</span>
                          </button>
                          <button type="button" onClick={() => openReport(report, 'details')} title="View idea details" aria-label="View idea details">
                            <Eye size={15} />
                          </button>
                          <button type="button" onClick={() => openReport(report, 'insights')} title="View publication insights" aria-label="View publication insights">
                            <Sparkles size={15} />
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
          <div className="admin-publication-reports-empty">No reports match this view.</div>
        ) : null}

        {!loading && meta.totalPages > 1 ? (
          <footer className="admin-publication-reports-pagination">
            <span>Page {meta.page} of {meta.totalPages}</span>
            <div>
              <button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft size={14} /> Previous</button>
              <button type="button" disabled={page >= meta.totalPages} onClick={() => setPage((current) => Math.min(meta.totalPages, current + 1))}>Next <ChevronRight size={14} /></button>
            </div>
          </footer>
        ) : null}
      </section>

      {selected ? createPortal(
        <div className="admin-report-review-backdrop" role="presentation" onMouseDown={closeReport}>
          <aside className="admin-report-review-drawer" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span><Flag size={14} /> REPORT REVIEW</span>
                <h3>{selected?.publication?.publicTitle || 'Publication report'}</h3>
                <p>{titleCase(selected.reason)} · submitted {formatDate(selected.createdAt)}</p>
              </div>
              <button type="button" onClick={closeReport}><X size={18} /></button>
            </header>

            <nav className="admin-report-drawer-tabs" aria-label="Report context">
              <button type="button" className={drawerTab === 'review' ? 'is-active' : ''} onClick={() => selectDrawerTab('review')}>
                <Flag size={14} /> Review
              </button>
              <button type="button" className={drawerTab === 'details' ? 'is-active' : ''} onClick={() => selectDrawerTab('details')}>
                <Eye size={14} /> Idea details
              </button>
              <button type="button" className={drawerTab === 'insights' ? 'is-active' : ''} onClick={() => selectDrawerTab('insights')}>
                <Sparkles size={14} /> Insights
              </button>
            </nav>

            <div className="admin-report-review-drawer__body">
              {contextLoading ? (
                <div className="admin-report-context-loading"><LoaderCircle className="admin-spin" size={17} /> Loading idea context…</div>
              ) : null}
              {contextError ? <div className="admin-report-context-error"><AlertCircle size={14} /> {contextError}</div> : null}

              {drawerTab === 'review' ? (
                <div className="admin-moderation-workbench">
                  <section className="admin-moderation-summary">
                    <div className="admin-moderation-summary__icon"><Flag size={16} /></div>
                    <div>
                      <small>Reported for</small>
                      <strong>{titleCase(selected.reason)}</strong>
                      <p>{selected.details || 'No additional details were provided.'}</p>
                    </div>
                  </section>

                  <div className="admin-report-people-grid">
                    <section>
                      <span>Reporter</span>
                      <strong>{selected?.reporter?.fullName || 'Member'}</strong>
                      <p>{selected?.reporter?.email || '—'}</p>
                    </section>
                    <section>
                      <span>Publisher</span>
                      <strong>{selected?.publication?.publisher?.fullName || 'Publisher'}</strong>
                      <p>{selected?.publication?.publisher?.email || '—'}</p>
                    </section>
                  </div>

                  {(selected?.reviewedAt || selected?.moderationAction || selected?.publisherMessage || selected?.reporterMessage) ? (
                    <section className="admin-moderation-history">
                      <header>
                        <div><ShieldCheck size={16} /></div>
                        <div>
                          <span>LAST ADMIN ACTION & COMMUNICATIONS</span>
                          <h4>
                            {getReportActionLabel(selected)}
                          </h4>
                          <div className="admin-moderation-history__badges">
                            <span className={`is-status is-${String(selected.status || '').toLowerCase()}`}>{titleCase(selected.status)}</span>
                            <span className={selected.publisherNotified ? 'is-sent' : 'is-muted'}>{selected.publisherNotified ? 'Publisher notified' : 'Publisher not notified'}</span>
                            <span className={selected.reporterNotified ? 'is-sent' : 'is-muted'}>{selected.reporterNotified ? 'Reporter notified' : 'Reporter not notified'}</span>
                          </div>
                          <p>
                            Reviewed {formatDate(selected.reviewedAt)}
                            {selected?.reviewedBy?.fullName ? ` by ${selected.reviewedBy.fullName}` : ''}
                          </p>
                        </div>
                      </header>

                      <div className="admin-moderation-history__grid">
                        <article>
                          <span>Message sent to publisher</span>
                          <strong>{selected.publisherNotified ? 'Sent' : 'Not sent'}</strong>
                          <p className={selected.publisherMessage ? 'has-message' : 'is-empty'}>{selected.publisherMessage || 'No message has been sent to the publisher yet.'}</p>
                        </article>
                        <article>
                          <span>Message sent to reporter</span>
                          <strong>{selected.reporterNotified ? 'Sent' : 'Not sent'}</strong>
                          <p className={selected.reporterMessage ? 'has-message' : 'is-empty'}>{selected.reporterMessage || 'No resolution message has been sent to the reporter yet.'}</p>
                        </article>
                        <article className="is-wide">
                          <span>Internal note</span>
                          <p>{selected.adminNote || 'No internal moderation note.'}</p>
                        </article>
                      </div>
                    </section>
                  ) : null}

                  <section className="admin-moderation-panel">
                    <header>
                      <div><Sparkles size={15} /><span>1</span></div>
                      <div><h4>Choose publication action</h4><p>Decide what should happen to the reported publication.</p></div>
                    </header>
                    <div className="admin-moderation-actions-grid">
                      {MODERATION_ACTIONS.map(({ key, label, description, icon: ActionIcon, tone }) => (
                        <button
                          key={key}
                          type="button"
                          className={`${moderationAction === key ? 'is-selected' : ''} is-${tone}`}
                          onClick={() => setModerationAction(key)}
                        >
                          <span><ActionIcon size={16} /></span>
                          <div><strong>{label}</strong><small>{description}</small></div>
                          <i>{moderationAction === key ? <BadgeCheck size={14} /> : null}</i>
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="admin-moderation-panel">
                    <header>
                      <div><BellRing size={15} /><span>2</span></div>
                      <div><h4>Notifications</h4><p>Keep the publisher and reporter informed.</p></div>
                    </header>

                    <div className="admin-moderation-notification-grid">
                      <label className="admin-moderation-message">
                        <span>Message to publisher</span>
                        <textarea
                          value={publisherMessage}
                          onChange={(event) => setPublisherMessage(event.target.value)}
                          placeholder={moderationAction === 'WARN_PUBLISHER' ? 'Write the warning the publisher will receive…' : 'Optional custom message for the publisher…'}
                          maxLength={1000}
                        />
                      </label>

                      <div className="admin-moderation-reporter-notice">
                        <button
                          type="button"
                          className={`admin-moderation-toggle ${notifyReporter ? 'is-on' : ''}`}
                          onClick={() => setNotifyReporter((value) => !value)}
                        >
                          <span><i /></span>
                          <div><strong>Notify reporter</strong><small>Resolved and dismissed reports notify the reporter automatically.</small></div>
                        </button>
                        {notifyReporter ? (
                          <textarea
                            value={reporterMessage}
                            onChange={(event) => setReporterMessage(event.target.value)}
                            placeholder="Optional: “Your report was reviewed and the issue was resolved.”"
                            maxLength={1000}
                          />
                        ) : null}
                      </div>
                    </div>
                  </section>

                  <section className="admin-moderation-panel">
                    <header>
                      <div><BadgeCheck size={15} /><span>3</span></div>
                      <div><h4>Report workflow</h4><p>Change status and keep an internal moderation note.</p></div>
                    </header>

                    <div className="admin-report-status-segments">
                      {REPORT_STATUS_OPTIONS.map((statusOption) => (
                        <button
                          key={statusOption}
                          type="button"
                          className={reportStatus === statusOption ? 'is-active' : ''}
                          onClick={() => setReportStatus(statusOption)}
                        >
                          <span className={`is-${statusOption.toLowerCase()}`} />
                          {titleCase(statusOption)}
                        </button>
                      ))}
                    </div>

                    <label className="admin-moderation-message is-internal">
                      <span>Internal moderation note</span>
                      <textarea
                        value={response}
                        onChange={(event) => setResponse(event.target.value)}
                        placeholder="Optional note for audit and future reviewers…"
                        maxLength={1000}
                      />
                    </label>
                  </section>

                  {drawerError ? <div className="admin-report-context-error"><AlertCircle size={14} /> {drawerError}</div> : null}

                  <footer className="admin-moderation-footer">
                    <div>
                      <small>Ready to apply</small>
                      <strong>{titleCase(reportStatus)} · {MODERATION_ACTIONS.find((item) => item.key === moderationAction)?.label}</strong>
                    </div>
                    <button type="button" disabled={busy} onClick={applyModerationDecision}>
                      {busy ? <LoaderCircle className="admin-spin" size={14} /> : <Send size={14} />}
                      Apply decision
                    </button>
                  </footer>
                </div>
              ) : null}

              {drawerTab === 'details' && !contextLoading ? (
                <div className="admin-report-idea-detail">
                  <section className="admin-report-idea-hero">
                    <div><Sparkles size={18} /></div>
                    <div>
                      <span>IDEA RECORD</span>
                      <h4>{ideaDetail?.title || selected?.publication?.publicTitle || 'Idea'}</h4>
                      <p>{ideaDetail?.domain?.name || 'Unassigned domain'} · {titleCase(ideaDetail?.generationType)}</p>
                    </div>
                  </section>
                  <div className="admin-report-idea-meta">
                    <div><span>Access</span><strong>{ideaDetail?.isUnlocked ? 'Unlocked' : 'Locked'}</strong></div>
                    <div><span>Pipeline</span><strong>{titleCase(ideaDetail?.generationRun?.status)}</strong></div>
                    <div><span>Created</span><strong>{formatDate(ideaDetail?.createdAt)}</strong></div>
                  </div>
                  <section><h4>Problem statement</h4><p>{ideaDetail?.problemStatement || 'No problem statement is available.'}</p></section>
                  <section><h4>Abstract</h4><p>{ideaDetail?.fullAbstract || ideaDetail?.partialAbstract || ideaDetail?.limitedAbstract || selected?.publication?.publicAbstract || 'No abstract is available.'}</p></section>
                  <section><h4>Objectives</h4><p>{Array.isArray(ideaDetail?.objectives) ? ideaDetail.objectives.join(' • ') : ideaDetail?.objectives || 'No objectives are available.'}</p></section>
                  <section><h4>Target users</h4><p>{Array.isArray(ideaDetail?.targetUsers) ? ideaDetail.targetUsers.join(' • ') : ideaDetail?.targetUsers || 'No target-user information is available.'}</p></section>
                </div>
              ) : null}

              {drawerTab === 'insights' && !contextLoading ? (
                <div className="admin-report-insights-view">
                  <section className="admin-report-insight-strip">
                    <div><Star size={15} /><strong>{Number(ideaInsight?.publication?.averageRating || 0).toFixed(1)}</strong><span>rating</span></div>
                    <div><ThumbsUp size={15} /><strong>{Number(ideaInsight?.publication?.upvotesCount || 0)}</strong><span>upvotes</span></div>
                    <div><ThumbsDown size={15} /><strong>{Number(ideaInsight?.publication?.downvotesCount || 0)}</strong><span>downvotes</span></div>
                    <div><MessageSquareText size={15} /><strong>{Number(ideaInsight?.publication?.feedbackCount || 0)}</strong><span>feedback</span></div>
                  </section>
                  <section className="admin-report-publication-snapshot">
                    <header><Globe2 size={16} /><div><h4>Publication snapshot</h4><p>Community-facing state for the reported idea.</p></div></header>
                    <dl>
                      <div><dt>Status</dt><dd>{titleCase(ideaInsight?.publication?.status)}</dd></div>
                      <div><dt>Visibility</dt><dd>{titleCase(ideaInsight?.publication?.visibility)}</dd></div>
                      <div><dt>Published</dt><dd>{formatDate(ideaInsight?.publication?.publishedAt)}</dd></div>
                      <div><dt>Reports</dt><dd>{Number(ideaInsight?.publication?.reportsCount || ideaInsight?.publication?._count?.reports || 0)}</dd></div>
                    </dl>
                    <p>{ideaInsight?.publication?.publicAbstract || selected?.publication?.publicAbstract || 'No public abstract is available.'}</p>
                  </section>
                  <section className="admin-report-feedback-preview">
                    <header><MessageSquareText size={15} /><h4>Recent feedback</h4></header>
                    {Array.isArray(ideaInsight?.publication?.feedback) && ideaInsight.publication.feedback.length ? (
                      ideaInsight.publication.feedback.slice(0, 5).map((item) => (
                        <article key={item.id}>
                          <strong>{item?.user?.fullName || 'Community member'}</strong>
                          <p>{item.comment}</p>
                        </article>
                      ))
                    ) : <p>No written feedback yet.</p>}
                  </section>
                </div>
              ) : null}
            </div>
          </aside>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}