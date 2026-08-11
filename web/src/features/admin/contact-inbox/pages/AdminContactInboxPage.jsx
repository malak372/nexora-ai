/**
 * Administrator Contact Us inbox.
 *
 * @author Eman
 */
import {
  ArrowDown,
  ArrowUp,
  BadgeCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Eye,
  Inbox,
  LoaderCircle,
  Mail,
  MailCheck,
  MessageSquareReply,
  RefreshCw,
  Search,
  SlidersHorizontal,
  UserRound,
  UserRoundCheck,
  X,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { adminApi, getApiErrorMessage } from '../../shared/api/adminApi';
import AdminSupportSelect from '../../shared/components/AdminSupportSelect';
import '../../shared/styles/admin-pages.css';
import '../../shared/styles/admin-support-workspaces.css';

const PAGE_SIZE = 20;

const STATUS_OPTIONS = [
  { value: '', label: 'All messages' },
  { value: 'NEW', label: 'New' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'REPLIED', label: 'Replied' },
  { value: 'CLOSED', label: 'Closed' },
];

const CONTACT_STATUS_CHOICES = [
  { value: 'NEW', label: 'New', tone: 'is-open', description: 'Waiting for the first review' },
  { value: 'IN_PROGRESS', label: 'In progress', tone: 'is-progress', description: 'A support response is being prepared' },
  { value: 'REPLIED', label: 'Replied', tone: 'is-success', description: 'A response has been delivered' },
  { value: 'CLOSED', label: 'Closed', tone: 'is-closed', description: 'No further action is required' },
];

const SORT_OPTIONS = [
  { value: 'createdAt', label: 'Received date' },
  { value: 'updatedAt', label: 'Last activity' },
  { value: 'status', label: 'Status' },
];

function rowsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  return payload?.data ?? payload?.items ?? payload?.messages ?? [];
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
    case 'REPLIED': return 'is-success';
    case 'CLOSED': return 'is-closed';
    case 'IN_PROGRESS': return 'is-progress';
    default: return 'is-open';
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
    </article>
  );
}

function StatusPill({ value }) {
  return <span className={`admin-support-status ${statusTone(value)}`}>{readable(value || 'NEW')}</span>;
}

function SenderType({ message }) {
  const registered = Boolean(message.user?.id);
  return (
    <span className={`admin-support-sender-type ${registered ? 'is-registered' : 'is-guest'}`}>
      {registered ? <BadgeCheck size={12} /> : <UserRound size={12} />}
      {registered ? 'Registered' : 'Guest'}
    </span>
  );
}

function ContactModal({ message, saving, onClose, onSave }) {
  const [status, setStatus] = useState(message.status || 'NEW');
  const [reply, setReply] = useState(message.adminReply || '');
  const registered = Boolean(message.user?.id);
  const recipientEmail = registered ? message.user?.email : message.email;
  const recipientName = registered ? message.user?.fullName : message.fullName;

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
      ...(trimmedReply ? { adminReply: trimmedReply } : {}),
    });
  };

  return createPortal(
    <div className="admin-support-modal-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <section className="admin-support-modal admin-support-modal--contact" role="dialog" aria-modal="true" aria-labelledby="contact-dialog-title">
        <header className="admin-support-modal__header">
          <div className="admin-support-modal__heading">
            <span className="admin-support-modal__mark"><Mail size={20} /></span>
            <div>
              <small>Contact inbox response</small>
              <h2 id="contact-dialog-title">{message.subject}</h2>
            </div>
          </div>
          <button type="button" className="admin-support-icon-button" onClick={onClose} disabled={saving} aria-label="Close contact message"><X size={19} /></button>
        </header>

        <div className="admin-support-modal__body">
          <div className="admin-support-case-pane">
            <div className="admin-support-case-topline"><StatusPill value={message.status} /><SenderType message={message} /></div>

            <div className="admin-support-sender-card">
              <span>{registered ? <UserRoundCheck size={18} /> : <UserRound size={18} />}</span>
              <div>
                <small>{registered ? 'Registered account' : 'Guest sender'}</small>
                <strong>{recipientName || message.fullName || 'Contact sender'}</strong>
                <p>{recipientEmail || 'Email unavailable'}</p>
              </div>
            </div>

            <div className="admin-support-recipient-note">
              <MailCheck size={17} />
              <div>
                <strong>Email reply destination</strong>
                <p>{registered ? 'The reply uses the user account’s current email address.' : 'The reply uses the email stored with this guest submission.'}</p>
              </div>
            </div>

            <article className="admin-support-message-card">
              <div><Inbox size={16} /><span>Original contact message</span></div>
              <p>{message.message}</p>
            </article>

            <div className="admin-support-timeline">
              <div><Clock3 size={14} /><span>Received</span><strong>{formatDate(message.createdAt)}</strong></div>
              <div><RefreshCw size={14} /><span>Last activity</span><strong>{formatDate(message.updatedAt)}</strong></div>
            </div>
          </div>

          <form className="admin-support-action-pane" onSubmit={submit}>
            <div className="admin-support-action-pane__intro">
              <span><MessageSquareReply size={19} /></span>
              <div>
                <small>Support response</small>
                <h3>Reply by email and manage the inbox state.</h3>
                <p>A changed reply is emailed after the database update succeeds. Status-only changes do not send another email.</p>
              </div>
            </div>

            <div className="admin-support-form-grid admin-support-form-grid--single">
              <div className="admin-support-field">
                <span>Status</span>
                <AdminSupportSelect
                  value={status}
                  options={CONTACT_STATUS_CHOICES}
                  onChange={setStatus}
                  disabled={saving}
                  ariaLabel="Contact message status"
                />
              </div>
            </div>

            <label className="admin-support-reply-field">
              <span>Email response</span>
              <textarea
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                placeholder="Write the support response that should be delivered to the sender’s email…"
                maxLength={1000}
                disabled={saving}
              />
              <small>{reply.length}/1000</small>
            </label>

            <div className="admin-support-email-preview">
              <span><Mail size={15} /> Delivery preview</span>
              <strong>{recipientEmail || 'No email available'}</strong>
              <p>Subject: Voxidence Support - {message.subject || 'Contact Request'}</p>
            </div>

            {message.adminReply ? (
              <div className="admin-support-previous-reply">
                <span>Current saved response</span>
                <p>{message.adminReply}</p>
              </div>
            ) : null}

            <footer className="admin-support-modal__actions">
              <button type="button" className="admin-support-secondary-button" onClick={onClose} disabled={saving}>
                <X size={16} />
                Cancel
              </button>
              <button type="submit" className="admin-support-primary-button" disabled={saving || (reply.trim().length > 0 && reply.trim().length < 5)}>
                <span className="admin-support-primary-button__icon">
                  {saving ? <LoaderCircle className="is-spinning" size={16} /> : reply.trim() && reply.trim() !== (message.adminReply || '').trim() ? <MailCheck size={16} /> : <CheckCircle2 size={16} />}
                </span>
                <span className="admin-support-primary-button__copy">
                  <strong>{saving ? 'Saving…' : reply.trim() && reply.trim() !== (message.adminReply || '').trim() ? 'Save & send email' : 'Save status'}</strong>
                  <small>{saving ? 'Applying changes' : reply.trim() && reply.trim() !== (message.adminReply || '').trim() ? 'Update the case and email the sender' : 'Update this inbox state only'}</small>
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

export default function AdminContactInboxPage() {
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

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const [listPayload, summaryPayload] = await Promise.all([
        adminApi.contactMessages.list(query),
        adminApi.contactMessages.summary(summaryQuery),
      ]);
      const nextRows = rowsFrom(listPayload);
      setItems(Array.isArray(nextRows) ? nextRows : []);
      setMeta(metaFrom(listPayload, nextRows?.length || 0));
      setSummary(summaryFrom(summaryPayload));
    } catch (loadError) {
      setError(getApiErrorMessage(loadError, 'Unable to load the contact inbox.'));
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
    const timer = window.setTimeout(() => setNotice(''), 3800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const saveMessage = async (body) => {
    if (!selected) return;
    setSaving(true);
    setError('');
    try {
      const result = await adminApi.contactMessages.update(selected.id, body);
      const updated = result?.contactMessage ?? { ...selected, ...body };
      setSelected(updated);
      const recipient = result?.emailRecipient ? ` to ${result.emailRecipient}` : '';
      setNotice(result?.emailSent ? `Reply saved and email sent${recipient}.` : (result?.message || 'Contact message updated successfully.'));
      await load({ quiet: true });
      setSelected(null);
    } catch (saveError) {
      setError(getApiErrorMessage(saveError, 'Unable to update the contact message.'));
    } finally {
      setSaving(false);
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    setError('');
    try {
      await adminApi.contactMessages.exportCsv({
        search: search || undefined,
        status: status || undefined,
        sortBy,
        sortOrder,
      });
    } catch (exportError) {
      setError(getApiErrorMessage(exportError, 'Unable to export contact messages.'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="admin-page admin-support-page">
      <section className="admin-support-hero admin-support-hero--contact">
        <div>
          <span><Mail size={16} /> Support operations</span>
          <h2>Contact inbox</h2>
          <p>Handle guest and registered-user messages from one support queue, reply by email and keep each conversation state organized.</p>
        </div>
        <div className="admin-support-hero__pulse">
          <Mail size={24} />
          <strong>{Number(summary.newMessages || 0).toLocaleString()}</strong>
          <span>new messages</span>
        </div>
      </section>

      <section className="admin-support-summary-grid">
        <Metric icon={Inbox} label="Total" value={summary.totalMessages} hint="Active inbox records" tone="is-featured" />
        <Metric icon={Mail} label="New" value={summary.newMessages} hint="Waiting for first review" />
        <Metric icon={Clock3} label="In progress" value={summary.inProgressMessages} hint="Currently being handled" tone="is-progress" />
        <Metric icon={MailCheck} label="Replied" value={summary.repliedMessages} hint="Response delivered" tone="is-success" />
      </section>

      <section className="admin-support-panel">
        <header className="admin-support-panel__header">
          <div>
            <span>Support queue</span>
            <h3>Contact message directory</h3>
            <p>{meta.total.toLocaleString()} records available</p>
          </div>
          <div className="admin-support-header-actions">
            <span className="admin-support-live-chip"><i /> Live inbox</span>
            <button type="button" onClick={() => load()} disabled={loading}><RefreshCw size={15} /> Refresh</button>
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
            <label className="admin-support-sort">
              <SlidersHorizontal size={15} />
              <span><small>Sort messages</small>
                <select value={sortBy} onChange={(event) => { setSortBy(event.target.value); setPage(1); }}>
                  {SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </span>
            </label>
            <button type="button" className="admin-support-sort-direction" onClick={() => setSortOrder((value) => value === 'asc' ? 'desc' : 'asc')} aria-label="Toggle sort direction">
              {sortOrder === 'asc' ? <ArrowUp size={17} /> : <ArrowDown size={17} />}
            </button>
            <label className="admin-support-search"><Search size={17} /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search sender, email, subject or reply…" /></label>
          </div>
        </div>

        {error ? <div className="admin-support-alert is-error"><XCircle size={16} />{error}</div> : null}
        {notice ? <div className="admin-support-toast"><CheckCircle2 size={16} />{notice}</div> : null}

        <div className="admin-support-table-wrap">
          <table className="admin-support-table admin-support-table--contact">
            <thead><tr><th>Message</th><th>Sender</th><th>Email destination</th><th>Type</th><th>Status</th><th>Received</th><th>Action</th></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="7"><div className="admin-support-empty"><LoaderCircle className="is-spinning" size={23} /><strong>Loading contact messages…</strong></div></td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan="7"><div className="admin-support-empty"><Inbox size={25} /><strong>No contact messages match these filters.</strong><span>Try another status or search term.</span></div></td></tr>
              ) : items.map((message) => {
                const registered = Boolean(message.user?.id);
                const email = registered ? message.user?.email : message.email;
                const name = registered ? message.user?.fullName : message.fullName;
                return (
                  <tr key={message.id}>
                    <td><div className="admin-support-primary-cell"><span className="admin-support-row-icon"><Mail size={16} /></span><div><strong>{message.subject || 'Contact request'}</strong><p>{compact(message.message)}</p></div></div></td>
                    <td><div className="admin-support-person"><strong>{name || 'Contact sender'}</strong><span>{registered ? 'Linked account' : 'Guest submission'}</span></div></td>
                    <td><div className="admin-support-person"><strong>{email || '—'}</strong><span>{registered ? 'Current account email' : 'Submission email'}</span></div></td>
                    <td><SenderType message={message} /></td>
                    <td><StatusPill value={message.status} /></td>
                    <td><div className="admin-support-date"><strong>{formatDate(message.createdAt)}</strong><span>Updated {formatDate(message.updatedAt)}</span></div></td>
                    <td><button type="button" className="admin-support-view-button" onClick={() => setSelected(message)}><Eye size={15} /> Open</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <footer className="admin-support-pagination">
          <span>Page {meta.page} of {meta.totalPages}</span>
          <div><button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1 || loading}><ChevronLeft size={16} /> Previous</button><button type="button" onClick={() => setPage((value) => Math.min(meta.totalPages, value + 1))} disabled={page >= meta.totalPages || loading}>Next <ChevronRight size={16} /></button></div>
        </footer>
      </section>

      {selected ? <ContactModal message={selected} saving={saving} onClose={() => setSelected(null)} onSave={saveMessage} /> : null}
    </div>
  );
}