import {
  AlertCircle,
  CheckCircle2,
  ClipboardCheck,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Clock3,
  Download,
  Eye,
  Flag,
  Inbox,
  LoaderCircle,
  MessageCircleMore,
  MessageSquareReply,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCheck,
  UserRound,
  X,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { adminApi, getApiErrorMessage } from '../../shared/api/adminApi';
import AdminSupportSelect from '../../shared/components/AdminSupportSelect';
import AdminSupportSortPicker from '../../shared/components/AdminSupportSortPicker';
import '../../shared/styles/admin-pages.css';
import '../../shared/styles/admin-support-workspaces.css';
import '../styles/admin-complaints.css';

const PAGE_SIZE = 20;

const STATUS_OPTIONS = [
  { value: '', label: 'All cases' },
  { value: 'OPEN', label: 'Open' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'REJECTED', label: 'Rejected' },
];

const COMPLAINT_STATUS_CHOICES = [
  { value: 'OPEN', label: 'Open', tone: 'is-open', description: 'Waiting for administrator review' },
  { value: 'IN_PROGRESS', label: 'In progress', tone: 'is-progress', description: 'The case is currently being handled' },
  { value: 'RESOLVED', label: 'Resolved', tone: 'is-success', description: 'The issue has been completed' },
  { value: 'REJECTED', label: 'Rejected', tone: 'is-danger', description: 'No further action will be taken' },
];

const COMPLAINT_PRIORITY_CHOICES = [
  { value: 'LOW', label: 'Low', tone: 'is-low', description: 'Routine follow-up' },
  { value: 'MEDIUM', label: 'Medium', tone: 'is-medium', description: 'Normal review priority' },
  { value: 'HIGH', label: 'High', tone: 'is-high', description: 'Requires quicker attention' },
];

const SORT_OPTIONS = [
  { value: 'createdAt', label: 'Submitted date' },
  { value: 'updatedAt', label: 'Last activity' },
  { value: 'status', label: 'Status' },
  { value: 'priority', label: 'Priority' },
  { value: 'resolvedAt', label: 'Resolution date' },
];

function rowsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  return payload?.data ?? payload?.items ?? payload?.complaints ?? [];
}

function metaFrom(payload, count) {
  const meta = payload?.meta ?? payload?.pagination ?? {};
  const total = Number(meta.total ?? payload?.total ?? count) || 0;
  const page = Number(meta.page ?? 1) || 1;
  const limit = Number(meta.limit ?? PAGE_SIZE) || PAGE_SIZE;
  return {
    total,
    page,
    limit,
    totalPages: Math.max(1, Number(meta.totalPages ?? Math.ceil(total / Math.max(1, limit))) || 1),
  };
}

function summaryFrom(payload) {
  return payload?.data && !Array.isArray(payload.data) ? payload.data : payload ?? {};
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

function compact(value, max = 86) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '—';
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function readable(value) {
  return String(value || '')
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function statusTone(status) {
  switch (status) {
    case 'RESOLVED': return 'is-success';
    case 'REJECTED': return 'is-danger';
    case 'IN_PROGRESS': return 'is-progress';
    default: return 'is-open';
  }
}

function priorityTone(priority) {
  switch (priority) {
    case 'HIGH': return 'is-high';
    case 'LOW': return 'is-low';
    default: return 'is-medium';
  }
}

function Metric({ icon: Icon, label, value, hint, tone = '' }) {
  return (
    <article className={`admin-support-metric ${tone}`}>
      <i aria-hidden="true" />
      <span className="admin-support-metric__icon"><Icon size={20} /></span>
      <div>
        <small>{label}</small>
        <strong>{Number(value || 0).toLocaleString()}</strong>
        <span>{hint}</span>
      </div>
      <span className="admin-complaint-metric__signal" aria-hidden="true">
        <b />
        <b />
        <b />
      </span>
      <span className="admin-complaint-metric__dot" aria-hidden="true" />
    </article>
  );
}

function StatusPill({ value }) {
  return <span className={`admin-support-status ${statusTone(value)}`}>{readable(value || 'OPEN')}</span>;
}

function PriorityPill({ value }) {
  return <span className={`admin-support-priority ${priorityTone(value)}`}><Flag size={11} />{readable(value || 'MEDIUM')}</span>;
}

function ComplaintModal({ complaint, saving, onClose, onSave }) {
  const [status, setStatus] = useState(complaint.status || 'OPEN');
  const [priority, setPriority] = useState(complaint.priority || 'MEDIUM');
  const [reply, setReply] = useState(complaint.adminReply || '');

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    document.body.classList.add('admin-support-modal-open');
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.classList.remove('admin-support-modal-open');
    };
  }, [onClose, saving]);

  const submit = (event) => {
    event.preventDefault();
    const trimmedReply = reply.trim();
    onSave({
      status,
      priority,
      ...(trimmedReply ? { adminReply: trimmedReply } : {}),
    });
  };

  return createPortal(
    <div className="admin-support-modal-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <section className="admin-support-modal admin-support-modal--complaint" role="dialog" aria-modal="true" aria-labelledby="complaint-dialog-title">
        <header className="admin-support-modal__header">
          <div className="admin-support-modal__heading">
            <span className="admin-support-modal__mark"><ShieldCheck size={20} /></span>
            <div>
              <small>Complaint resolution workspace</small>
              <h2 id="complaint-dialog-title">{complaint.subject}</h2>
            </div>
          </div>
          <button type="button" className="admin-support-icon-button" onClick={onClose} disabled={saving} aria-label="Close complaint"><X size={19} /></button>
        </header>

        <div className="admin-support-modal__body">
          <div className="admin-support-case-pane">
            <div className="admin-support-case-topline">
              <StatusPill value={complaint.status} />
              <PriorityPill value={complaint.priority} />
            </div>

            <div className="admin-support-sender-card">
              <span><UserRound size={18} /></span>
              <div>
                <small>Submitted by</small>
                <strong>{complaint.user?.fullName || 'Registered user'}</strong>
                <p>{complaint.user?.email || 'Email unavailable'}</p>
              </div>
            </div>

            {complaint.idea ? (
              <div className="admin-support-context-card">
                <small>Related idea</small>
                <strong>{complaint.idea.title || 'Untitled idea'}</strong>
                <span>Idea #{String(complaint.idea.id || '').slice(0, 8).toUpperCase()}</span>
              </div>
            ) : null}

            <article className="admin-support-message-card">
              <div><Inbox size={16} /><span>Original complaint</span></div>
              <p>{complaint.message}</p>
            </article>

            <div className="admin-support-timeline">
              <div><CircleDot size={14} /><span>Submitted</span><strong>{formatDate(complaint.createdAt)}</strong></div>
              <div><Clock3 size={14} /><span>Last activity</span><strong>{formatDate(complaint.updatedAt)}</strong></div>
              {complaint.resolvedAt ? <div><CheckCircle2 size={14} /><span>Resolved</span><strong>{formatDate(complaint.resolvedAt)}</strong></div> : null}
            </div>
          </div>

          <form className="admin-support-action-pane" onSubmit={submit}>
            <div className="admin-support-action-pane__intro">
              <span><MessageSquareReply size={19} /></span>
              <div>
                <small>Administrative action</small>
                <h3>Resolve, reply and keep the user informed.</h3>
                <p>Status and response changes are saved together. User-visible complaint updates are also delivered as an in-app notification.</p>
              </div>
            </div>

            <div className="admin-support-form-grid">
              <div className="admin-support-field">
                <span>Status</span>
                <AdminSupportSelect
                  value={status}
                  options={COMPLAINT_STATUS_CHOICES}
                  onChange={setStatus}
                  disabled={saving}
                  ariaLabel="Complaint status"
                />
              </div>
              <div className="admin-support-field">
                <span>Priority</span>
                <AdminSupportSelect
                  value={priority}
                  options={COMPLAINT_PRIORITY_CHOICES}
                  onChange={setPriority}
                  disabled={saving}
                  ariaLabel="Complaint priority"
                />
              </div>
            </div>

            <label className="admin-support-reply-field">
              <span>Reply to user</span>
              <textarea
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                placeholder="Write a clear response explaining what was reviewed, what action was taken, and what happens next…"
                maxLength={1000}
                disabled={saving}
              />
              <small>{reply.length}/1000</small>
            </label>

            {complaint.adminReply ? (
              <div className="admin-support-previous-reply">
                <span>Current saved response</span>
                <p>{complaint.adminReply}</p>
              </div>
            ) : null}

            <footer className="admin-support-modal__actions">
              <button type="button" className="admin-support-secondary-button" onClick={onClose} disabled={saving}>
                <X size={16} />
                Cancel
              </button>
              <button type="submit" className="admin-support-primary-button" disabled={saving || (reply.trim().length > 0 && reply.trim().length < 5)}>
                <span className="admin-support-primary-button__icon">
                  {saving ? <LoaderCircle className="is-spinning" size={16} /> : <CheckCircle2 size={16} />}
                </span>
                <span className="admin-support-primary-button__copy">
                  <strong>{saving ? 'Saving…' : 'Save case update'}</strong>
                  <small>{saving ? 'Applying changes' : 'Update status, priority and reply'}</small>
                </span>
              </button>
            </footer>
          </form>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export default function AdminComplaintsPage() {
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({});
  const [meta, setMeta] = useState({ page: 1, total: 0, totalPages: 1, limit: PAGE_SIZE });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  const query = useMemo(() => ({
    page,
    limit: PAGE_SIZE,
    search: search || undefined,
    status: status || undefined,
    sortBy,
    sortOrder,
  }), [page, search, sortBy, sortOrder, status]);

  const summaryQuery = useMemo(() => ({ search: search || undefined }), [search]);

  const load = useCallback(async ({ quiet = false, fresh = false } = {}) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const listLoader = fresh ? adminApi.complaints.listFresh : adminApi.complaints.list;
      const summaryLoader = fresh ? adminApi.complaints.summaryFresh : adminApi.complaints.summary;
      const [listPayload, summaryPayload] = await Promise.all([
        listLoader(query),
        summaryLoader(summaryQuery),
      ]);
      const nextRows = rowsFrom(listPayload);
      setItems(Array.isArray(nextRows) ? nextRows : []);
      setMeta(metaFrom(listPayload, nextRows?.length || 0));
      setSummary(summaryFrom(summaryPayload));
    } catch (loadError) {
      setError(getApiErrorMessage(loadError, 'Unable to load complaints.'));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [query, summaryQuery]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setSearch(searchInput.trim());
    }, 320);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const applyGlobalSearch = (event) => setSearchInput(String(event.detail || ''));
    window.addEventListener('voxidence:admin-search', applyGlobalSearch);
    return () => window.removeEventListener('voxidence:admin-search', applyGlobalSearch);
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(''), 3400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const saveComplaint = async (body) => {
    if (!selected) return;
    setSaving(true);
    setError('');
    try {
      const result = await adminApi.complaints.update(selected.id, body);
      const updated = result?.complaint ?? { ...selected, ...body };
      setSelected(updated);
      setNotice(result?.message || 'Complaint updated successfully.');
      await load({ quiet: true });
      setSelected(null);
    } catch (saveError) {
      setError(getApiErrorMessage(saveError, 'Unable to update the complaint.'));
    } finally {
      setSaving(false);
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    setError('');
    try {
      await adminApi.complaints.exportCsv({
        search: search || undefined,
        status: status || undefined,
        sortBy,
        sortOrder,
      });
    } catch (exportError) {
      setError(getApiErrorMessage(exportError, 'Unable to export complaints.'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="admin-page admin-support-page admin-support-page--complaints">
      <section className="admin-support-hero">
        <div className="admin-complaint-hero__copy">
          <span><ShieldCheck size={16} /> Trust & safety</span>
          <h2>Complaints center</h2>
          <p>Review user complaints, prioritize cases, reply directly and keep every resolution state clear.</p>
        </div>

        <div className="admin-complaint-hero__visual" aria-hidden="true">
          <span className="admin-complaint-hero__orbit admin-complaint-hero__orbit--one" />
          <span className="admin-complaint-hero__orbit admin-complaint-hero__orbit--two" />
          <span className="admin-complaint-hero__float admin-complaint-hero__float--one" />
          <span className="admin-complaint-hero__float admin-complaint-hero__float--two" />
          <div className="admin-complaint-hero__tile admin-complaint-hero__tile--clipboard"><ClipboardCheck size={42} strokeWidth={1.65} /></div>
          <div className="admin-complaint-hero__tile admin-complaint-hero__tile--message"><MessageCircleMore size={31} strokeWidth={1.7} /></div>
          <div className="admin-complaint-hero__tile admin-complaint-hero__tile--user"><UserCheck size={34} strokeWidth={1.65} /></div>
        </div>

        <div className="admin-support-hero__pulse">
          <AlertCircle size={24} />
          <strong>{Number(summary.openComplaints || 0).toLocaleString()}</strong>
          <span>open cases</span>
        </div>
      </section>

      <section className="admin-support-summary-grid admin-support-summary-grid--five">
        <Metric icon={Inbox} label="Total" value={summary.totalComplaints} hint="All active complaints" tone="is-featured" />
        <Metric icon={AlertCircle} label="Open" value={summary.openComplaints} hint="Awaiting review" />
        <Metric icon={Clock3} label="In progress" value={summary.inProgressComplaints} hint="Currently being handled" tone="is-progress" />
        <Metric icon={CheckCircle2} label="Resolved" value={summary.resolvedComplaints} hint="Successfully completed" tone="is-success" />
        <Metric icon={Flag} label="High priority" value={summary.highPriorityComplaints} hint="Needs closer attention" tone="is-danger" />
      </section>

      <section className="admin-support-panel">
        <header className="admin-support-panel__header">
          <div>
            <span>Case management</span>
            <h3>Complaint directory</h3>
            <p>{meta.total.toLocaleString()} records available</p>
          </div>
          <div className="admin-support-header-actions">
            <span className="admin-support-live-chip"><i /> Live queue</span>
            <button type="button" onClick={() => load({ fresh: true })} disabled={loading}><RefreshCw size={15} /> Refresh</button>
            <button type="button" onClick={exportCsv} disabled={exporting}>{exporting ? <LoaderCircle className="is-spinning" size={15} /> : <Download size={15} />} Export CSV</button>
          </div>
        </header>

        <div className="admin-support-filters">
          <div className="admin-support-tabs">
            {STATUS_OPTIONS.map((option) => (
              <button key={option.value || 'ALL'} type="button" className={status === option.value ? 'is-active' : ''} onClick={() => { setStatus(option.value); setPage(1); }}>{option.label}</button>
            ))}
          </div>

          <div className="admin-support-tools">
            <AdminSupportSortPicker
              label="Sort complaints"
              value={sortBy}
              order={sortOrder}
              options={SORT_OPTIONS}
              onChange={(nextSortBy) => { setSortBy(nextSortBy); setPage(1); }}
              onToggleOrder={() => setSortOrder((value) => value === 'asc' ? 'desc' : 'asc')}
            />
            <label className="admin-support-search"><Search size={17} /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search subject, user, idea or reply…" /></label>
          </div>
        </div>

        {error ? <div className="admin-support-alert is-error"><XCircle size={16} />{error}</div> : null}
        {notice ? <div className="admin-support-toast"><CheckCircle2 size={16} />{notice}</div> : null}

        <div className="admin-support-table-wrap">
          <table className="admin-support-table admin-support-table--complaints">
            <thead><tr><th>Complaint</th><th>Submitter</th><th>Related idea</th><th>Priority</th><th>Status</th><th>Last activity</th><th>Action</th></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="7"><div className="admin-support-empty"><LoaderCircle className="is-spinning" size={23} /><strong>Loading complaints…</strong></div></td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan="7"><div className="admin-support-empty"><Inbox size={25} /><strong>No complaints match these filters.</strong><span>Try another status or search term.</span></div></td></tr>
              ) : items.map((complaint) => (
                <tr key={complaint.id}>
                  <td><div className="admin-support-primary-cell"><span className="admin-support-row-icon"><AlertCircle size={16} /></span><div><strong>{complaint.subject || 'Untitled complaint'}</strong><p>{compact(complaint.message)}</p></div></div></td>
                  <td><div className="admin-support-person"><strong>{complaint.user?.fullName || 'User'}</strong><span>{complaint.user?.email || '—'}</span></div></td>
                  <td>{complaint.idea ? <div className="admin-support-person"><strong>{compact(complaint.idea.title, 44)}</strong><span>Linked idea</span></div> : <span className="admin-support-muted">General</span>}</td>
                  <td><PriorityPill value={complaint.priority} /></td>
                  <td><StatusPill value={complaint.status} /></td>
                  <td><div className="admin-support-date"><strong>{formatDate(complaint.updatedAt || complaint.createdAt)}</strong><span>Created {formatDate(complaint.createdAt)}</span></div></td>
                  <td><button type="button" className="admin-support-view-button" onClick={() => setSelected(complaint)}><Eye size={15} /> Review</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer className="admin-support-pagination">
          <span>Page {meta.page} of {meta.totalPages}</span>
          <div><button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1 || loading}><ChevronLeft size={16} /> Previous</button><button type="button" onClick={() => setPage((value) => Math.min(meta.totalPages, value + 1))} disabled={page >= meta.totalPages || loading}>Next <ChevronRight size={16} /></button></div>
        </footer>
      </section>

      {selected ? <ComplaintModal complaint={selected} saving={saving} onClose={() => setSelected(null)} onSave={saveComplaint} /> : null}
    </div>
  );
}