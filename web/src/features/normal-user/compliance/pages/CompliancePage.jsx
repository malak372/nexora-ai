/**
 * Voxidence normal-user complaint and compliance workspace.
 *
 * The page provides:
 * - A cinematic compliance hero with live case statistics.
 * - Search and status filtering for submitted cases.
 * - A master-detail review queue with administration replies.
 * - A polished modal for creating a new case.
 * - Accessible keyboard and screen-reader behavior.
 *
 * @author Malak
 */
import {
  Activity,
  AlertCircle,
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  FileText,
  Filter,
  Inbox,
  LoaderCircle,
  MessageSquareReply,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { getMyIdeas } from '../../ideas/api/userIdeasApi';
import NormalPageHero from '../../shared/components/NormalPageHero';
import { useUserExperience } from '../../../../system/user-experience';
import {
  createComplaint,
  getComplaintById,
  getMyComplaints,
} from '../api/complaintsApi';
import '../styles/compliance.css';

const EMPTY_FORM = {
  subject: '',
  message: '',
  ideaId: '',
};

const STATUS_META = {
  OPEN: {
    label: 'Received',
    description: 'Your case is safely in the review queue.',
    icon: Inbox,
  },
  IN_PROGRESS: {
    label: 'In review',
    description: 'The compliance team is actively reviewing this case.',
    icon: Activity,
  },
  RESOLVED: {
    label: 'Resolved',
    description: 'A final decision or resolution has been recorded.',
    icon: BadgeCheck,
  },
  REJECTED: {
    label: 'Closed',
    description: 'The case was reviewed and closed without further action.',
    icon: X,
  },
};

const FILTERS = [
  { value: 'ALL', label: 'All cases' },
  { value: 'OPEN', label: 'Received' },
  { value: 'IN_PROGRESS', label: 'In review' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'REJECTED', label: 'Closed' },
];

function formatDate(value, options = {}) {
  if (!value) return 'Not available';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';

  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...options,
  }).format(date);
}

function formatDateTime(value) {
  return formatDate(value, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getStatus(value) {
  const normalized = String(value || 'OPEN').toUpperCase();
  return STATUS_META[normalized] ? normalized : 'OPEN';
}

function getPriority(value) {
  const normalized = String(value || 'MEDIUM').toUpperCase();
  return ['LOW', 'MEDIUM', 'HIGH'].includes(normalized) ? normalized : 'MEDIUM';
}

function shorten(value, length = 94) {
  const text = String(value || '').trim();
  if (text.length <= length) return text;
  return `${text.slice(0, length).trim()}…`;
}

function CaseStatus({ status, compact = false }) {
  const normalized = getStatus(status);
  const meta = STATUS_META[normalized];
  const Icon = meta.icon;

  return (
    <span className={`compliance-status is-${normalized.toLowerCase()}`}>
      <Icon size={compact ? 12 : 14} />
      {meta.label}
    </span>
  );
}

function EmptySelection() {
  return (
    <div className="compliance-empty-selection">
      <div className="compliance-empty-selection__orb" aria-hidden="true">
        <FileText size={34} />
        <span />
        <span />
      </div>
      <span className="compliance-kicker">Case workspace</span>
      <h2>Select a case to open its review timeline.</h2>
      <p>
        Details, linked ideas, administration replies, status changes, and the
        final resolution will appear here.
      </p>
    </div>
  );
}

function CaseDetail({ complaint, loading }) {
  if (loading) {
    return (
      <div className="compliance-detail-loading">
        <LoaderCircle className="compliance-spin" size={28} />
        <span>Opening secure case record…</span>
      </div>
    );
  }

  if (!complaint) return <EmptySelection />;

  const status = getStatus(complaint.status);
  const statusMeta = STATUS_META[status];

  const timeline = [
    {
      key: 'submitted',
      title: 'Case submitted',
      detail: 'Your concern was securely added to the compliance queue.',
      date: complaint.createdAt,
      complete: true,
    },
    {
      key: 'review',
      title: status === 'OPEN' ? 'Awaiting review' : 'Compliance review',
      detail:
        status === 'OPEN'
          ? 'A reviewer will inspect the information you provided.'
          : 'The administration reviewed the case and its linked context.',
      date: status === 'OPEN' ? null : complaint.updatedAt,
      complete: status !== 'OPEN',
    },
    {
      key: 'resolution',
      title: status === 'REJECTED' ? 'Case closed' : 'Resolution',
      detail:
        status === 'RESOLVED' || status === 'REJECTED'
          ? 'The final outcome has been recorded below.'
          : 'The final decision will appear here when the review is complete.',
      date: complaint.resolvedAt,
      complete: status === 'RESOLVED' || status === 'REJECTED',
    },
  ];

  return (
    <div className="compliance-detail__inner">
      <header className="compliance-detail__header">
        <div>
          <span className="compliance-kicker">Secure case record</span>
          <h2 dir="auto" data-no-auto-translate="true">{complaint.subject}</h2>
        </div>
        <CaseStatus status={status} />
      </header>

      <div className="compliance-detail__meta">
        <div>
          <CalendarDays size={16} />
          <span>
            Submitted
            <strong>{formatDateTime(complaint.createdAt)}</strong>
          </span>
        </div>
        <div>
          <Clock3 size={16} />
          <span>
            Last updated
            <strong>{formatDateTime(complaint.updatedAt)}</strong>
          </span>
        </div>
        <div>
          <AlertCircle size={16} />
          <span>
            Priority
            <strong className={`is-${getPriority(complaint.priority).toLowerCase()}`}>
              {getPriority(complaint.priority)}
            </strong>
          </span>
        </div>
      </div>

      <section className="compliance-message-card">
        <div className="compliance-section-title">
          <span><FileText size={17} /></span>
          <div>
            <small>Your submission</small>
            <strong>Concern details</strong>
          </div>
        </div>
        <p dir="auto" data-no-auto-translate="true">{complaint.message}</p>

        {complaint.idea ? (
          <div className="compliance-related-idea">
            <Sparkles size={16} />
            <span>
              Related idea
              <strong dir="auto" data-idea-content="true">{complaint.idea.title || 'Untitled idea'}</strong>
            </span>
          </div>
        ) : null}
      </section>

      <section className="compliance-timeline-card">
        <div className="compliance-section-title">
          <span><Activity size={17} /></span>
          <div>
            <small>Live progress</small>
            <strong>Review timeline</strong>
          </div>
        </div>

        <div className="compliance-timeline">
          {timeline.map((step, index) => (
            <div
              className={`compliance-timeline__step ${step.complete ? 'is-complete' : ''}`}
              key={step.key}
            >
              <div className="compliance-timeline__marker">
                {step.complete ? <CheckCircle2 size={18} /> : <CircleDot size={18} />}
              </div>
              <div>
                <strong>{step.title}</strong>
                <p>{step.detail}</p>
                <small>{step.date ? formatDateTime(step.date) : 'Pending'}</small>
              </div>
              {index < timeline.length - 1 ? <span aria-hidden="true" /> : null}
            </div>
          ))}
        </div>
      </section>

      <section className={`compliance-reply-card ${complaint.adminReply ? 'has-reply' : ''}`}>
        <div className="compliance-reply-card__icon">
          {complaint.adminReply ? <MessageSquareReply size={23} /> : <ShieldCheck size={23} />}
        </div>
        <div>
          <span>{complaint.adminReply ? 'Administration response' : 'Protected review'}</span>
          <h3>{complaint.adminReply ? 'The compliance team replied.' : statusMeta.description}</h3>
          <p>
            {complaint.adminReply ? (
              <span dir="auto" data-no-auto-translate="true">{complaint.adminReply}</span>
            ) : (
              'A response will appear in this secure record as soon as the review team posts an update.'
            )}
          </p>
          {complaint.resolvedAt ? (
            <small>Finalized {formatDateTime(complaint.resolvedAt)}</small>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function NewCaseModal({ ideas, form, setForm, onClose, onSubmit, submitting }) {
  const messageLength = form.message.length;

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !submitting) onClose();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, submitting]);

  return (
    <div className="compliance-modal" role="presentation" onMouseDown={onClose}>
      <div
        className="compliance-modal__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-case-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="compliance-modal__visual" aria-hidden="true">
          <span />
          <span />
          <ShieldCheck size={48} />
        </div>

        <div className="compliance-modal__content">
          <header>
            <div>
              <span className="compliance-kicker">New secure case</span>
              <h2 id="new-case-title">Tell us what needs review.</h2>
              <p>
                Clear context helps the compliance team investigate fairly and
                respond with the right next step.
              </p>
            </div>
            <button type="button" className="compliance-modal__close" onClick={onClose}>
              <X size={20} />
              <span className="sr-only">Close</span>
            </button>
          </header>

          <form onSubmit={onSubmit}>
            <label>
              <span>Case subject</span>
              <input
                dir="auto"
                autoFocus
                value={form.subject}
                minLength={3}
                maxLength={150}
                onChange={(event) =>
                  setForm((current) => ({ ...current, subject: event.target.value }))
                }
                placeholder="Example: Unexpected publication visibility"
                required
              />
            </label>

            <label>
              <span>What happened?</span>
              <textarea
                dir="auto"
                rows={7}
                value={form.message}
                minLength={10}
                maxLength={2000}
                onChange={(event) =>
                  setForm((current) => ({ ...current, message: event.target.value }))
                }
                placeholder="Describe what happened, where you noticed it, and the outcome you expected."
                required
              />
              <small className={messageLength > 1800 ? 'is-warning' : ''}>
                {messageLength.toLocaleString()} / 2,000 characters
              </small>
            </label>

            <label>
              <span>Related idea <em>optional</em></span>
              <select
                value={form.ideaId}
                onChange={(event) =>
                  setForm((current) => ({ ...current, ideaId: event.target.value }))
                }
              >
                <option value="">This case is not related to a specific idea</option>
                {ideas.map((idea) => (
                  <option key={idea.id} value={idea.id} dir="auto" data-idea-content="true">
                    {idea.title || idea.name || 'Untitled idea'}
                  </option>
                ))}
              </select>
              <small>Choose by title—no IDs or technical values are shown.</small>
            </label>

            <div className="compliance-modal__actions">
              <button type="button" className="is-secondary" onClick={onClose} disabled={submitting}>
                Keep for later
              </button>
              <button type="submit" className="is-primary" disabled={submitting}>
                {submitting ? (
                  <LoaderCircle className="compliance-spin" size={18} />
                ) : (
                  <Send size={18} />
                )}
                {submitting ? 'Submitting securely…' : 'Submit secure case'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}


const revealVariants = {
  hidden: {
    opacity: 0,
    y: 34,
    scale: 0.985,
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.68,
      ease: [0.22, 1, 0.36, 1],
    },
  },
};

export default function CompliancePage() {
  const shouldReduceMotion = useReducedMotion();
  const { t } = useUserExperience();
  const [form, setForm] = useState(EMPTY_FORM);
  const [ideas, setIdeas] = useState([]);
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [selectedComplaint, setSelectedComplaint] = useState(null);
  const [filter, setFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const revealProps = shouldReduceMotion
    ? {}
    : {
      initial: 'hidden',
      whileInView: 'visible',
      viewport: { once: true, amount: 0.14 },
      variants: revealVariants,
    };


  const loadPageData = useCallback(async ({ preserveSelection = true } = {}) => {
    setLoading(true);
    setError('');

    try {
      // The complaint queue is the first-paint data. Load it first so the page
      // does not wait for the much larger idea dropdown request.
      const complaintsResult = await getMyComplaints({
        page: 1,
        limit: 100,
        sortBy: 'updatedAt',
        sortOrder: 'desc',
      });

      const nextItems = complaintsResult.items ?? [];
      setItems(nextItems);

      if (preserveSelection && selectedId) {
        const freshSelected = nextItems.find((item) => item.id === selectedId);
        if (freshSelected) setSelectedComplaint(freshSelected);
      }

      setLoading(false);

      // Ideas are only required by the Create Case form. Hydrate them after
      // the visible compliance queue is already interactive.
      void getMyIdeas({
        page: 1,
        limit: 100,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      })
        .then((ideasResult) => setIdeas(ideasResult.items ?? []))
        .catch(() => setIdeas([]));
    } catch (requestError) {
      setError(requestError.message || 'The compliance workspace could not be loaded.');
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    loadPageData({ preserveSelection: false });
  }, [loadPageData]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(''), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const filteredItems = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return items.filter((complaint) => {
      const matchesFilter = filter === 'ALL' || getStatus(complaint.status) === filter;
      const matchesSearch =
        !normalizedSearch ||
        complaint.subject?.toLowerCase().includes(normalizedSearch) ||
        complaint.message?.toLowerCase().includes(normalizedSearch) ||
        complaint.adminReply?.toLowerCase().includes(normalizedSearch) ||
        complaint.idea?.title?.toLowerCase().includes(normalizedSearch);

      return matchesFilter && matchesSearch;
    });
  }, [filter, items, search]);

  const stats = useMemo(() => {
    const count = (status) => items.filter((item) => getStatus(item.status) === status).length;
    return {
      total: items.length,
      live: count('OPEN') + count('IN_PROGRESS'),
      resolved: count('RESOLVED'),
      replies: items.filter((item) => Boolean(item.adminReply)).length,
    };
  }, [items]);

  const openComplaint = async (complaint) => {
    setSelectedId(complaint.id);
    setSelectedComplaint(complaint);
    setDetailLoading(true);
    setError('');

    try {
      const detail = await getComplaintById(complaint.id);
      setSelectedComplaint(detail || complaint);
    } catch (requestError) {
      setError(requestError.message || 'The selected case could not be opened.');
    } finally {
      setDetailLoading(false);
    }
  };

  const submitComplaint = async (event) => {
    event.preventDefault();

    try {
      setSubmitting(true);
      setError('');
      setNotice('');

      const created = await createComplaint({
        subject: form.subject.trim(),
        message: form.message.trim(),
        ...(form.ideaId ? { ideaId: form.ideaId } : {}),
      });

      setForm(EMPTY_FORM);
      setModalOpen(false);
      setNotice('Your case was submitted securely and added to the review queue.');
      await loadPageData({ preserveSelection: false });

      if (created?.id) {
        setSelectedId(created.id);
        setSelectedComplaint(created);
      }
    } catch (requestError) {
      setError(requestError.message || 'Your case could not be submitted.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="compliance-page reveal-page">
      <NormalPageHero
        variant="compliance"
        eyebrow={t('Trust and resolution')}
        title={t('Raise a concern in a protected review space.')}
        description={t('Submit a private case, follow every review step, and receive a clear administration response in one protected workspace.')}
        chips={[t('Private intake'), t('Traceable review'), t('Human response')]}
        stats={[
          { label: t('In review'), value: stats.live },
          { label: t('Resolved'), value: stats.resolved },
        ]}
        actions={(
          <button type="button" className="compliance-hero-launch" onClick={() => setModalOpen(true)}>
            <Plus size={17} /> {t('New case')}
          </button>
        )}
        compact
      />

      <motion.section className="compliance-principles" {...revealProps}>
        <div className="compliance-principles__intro">
          <span><Sparkles size={14} /> Review standards</span>
          <h2>What happens after you submit?</h2>
        </div>
        <div className="compliance-principles__cards">
          {[
            ['01', ShieldCheck, 'Protected intake', 'Your report is scoped to your account and authorized reviewers.'],
            ['02', Activity, 'Structured review', 'The team reviews context, linked ideas, and platform records fairly.'],
            ['03', MessageSquareReply, 'Visible resolution', 'Status changes and the final administration response stay in your case.'],
          ].map(([number, Icon, title, description], index) => (
            <motion.article
              key={title}
              style={{ '--principle-index': index }}
              initial={shouldReduceMotion ? undefined : { opacity: 0, y: 24 }}
              whileInView={shouldReduceMotion ? undefined : { opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.22 }}
              transition={{ duration: 0.5, delay: shouldReduceMotion ? 0 : index * 0.08 }}
            >
              <i><Icon size={20} /></i>
              <div>
                <small>{number}</small>
                <strong>{title}</strong>
                <p>{description}</p>
              </div>
              <ArrowRight size={17} />
            </motion.article>
          ))}
        </div>
      </motion.section>

      <motion.section className="compliance-workspace" {...revealProps}>
        <aside className="compliance-rail">
          <header>
            <div>
              <span>Your cases</span>
              <h2>Review queue</h2>
              <p>{filteredItems.length} visible record{filteredItems.length === 1 ? '' : 's'}</p>
            </div>
            <div className="compliance-rail__actions">
              <button
                type="button"
                className="is-icon"
                onClick={() => loadPageData()}
                disabled={loading}
                title="Refresh cases"
              >
                <RefreshCw className={loading ? 'compliance-spin' : ''} size={17} />
              </button>
              <button type="button" className="is-new" onClick={() => setModalOpen(true)}>
                <Plus size={17} /> New case
              </button>
            </div>
          </header>

          <div className="compliance-rail__tools">
            <label className="compliance-search">
              <Search size={17} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search cases"
              />
              {search ? (
                <button type="button" onClick={() => setSearch('')} aria-label="Clear search">
                  <X size={14} />
                </button>
              ) : null}
            </label>

            <label className="compliance-filter">
              <Filter size={16} />
              <select value={filter} onChange={(event) => setFilter(event.target.value)}>
                {FILTERS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="compliance-rail__list">
            {loading ? (
              <div className="compliance-list-state">
                <LoaderCircle className="compliance-spin" size={24} />
                <strong>Loading your secure records</strong>
                <span>This usually takes only a moment.</span>
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="compliance-list-state">
                <div className="compliance-list-state__icon"><Inbox size={25} /></div>
                <strong>{items.length ? 'No matching cases' : 'No cases submitted'}</strong>
                <span>
                  {items.length
                    ? 'Try another search or status filter.'
                    : 'Your first case will appear here with its live status.'}
                </span>
                {!items.length ? (
                  <button
                    type="button"
                    className="compliance-list-state__create"
                    onClick={() => setModalOpen(true)}
                  >
                    <Plus size={17} strokeWidth={2.35} />
                    <span>Create a case</span>
                  </button>
                ) : null}
              </div>
            ) : (
              filteredItems.map((complaint, index) => (
                <button
                  type="button"
                  key={complaint.id}
                  className={`compliance-case-card ${selectedId === complaint.id ? 'is-selected' : ''}`}
                  onClick={() => openComplaint(complaint)}
                  style={{ '--case-index': index }}
                >
                  <div className="compliance-case-card__top">
                    <CaseStatus status={complaint.status} compact />
                    <span>{formatDate(complaint.updatedAt || complaint.createdAt)}</span>
                  </div>
                  <strong dir="auto" data-no-auto-translate="true">{complaint.subject}</strong>
                  <p dir="auto" data-no-auto-translate="true">{shorten(complaint.message)}</p>
                  <div className="compliance-case-card__footer">
                    <span className={`priority-${getPriority(complaint.priority).toLowerCase()}`}>
                      {getPriority(complaint.priority)} priority
                    </span>
                    {complaint.adminReply ? (
                      <span className="has-reply"><MessageSquareReply size={13} /> Reply received</span>
                    ) : (
                      <span>Case #{complaint.id.slice(0, 6).toUpperCase()}</span>
                    )}
                    <ChevronRight size={17} />
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="compliance-detail" aria-live="polite">
          <CaseDetail complaint={selectedComplaint} loading={detailLoading} />
        </section>
      </motion.section>

      {notice ? (
        <div className="compliance-toast is-success" role="status">
          <CheckCircle2 size={18} />
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')}><X size={15} /></button>
        </div>
      ) : null}

      {error ? (
        <div className="compliance-toast is-error" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
          <button type="button" onClick={() => setError('')}><X size={15} /></button>
        </div>
      ) : null}

      {modalOpen ? (
        <NewCaseModal
          ideas={ideas}
          form={form}
          setForm={setForm}
          onClose={() => !submitting && setModalOpen(false)}
          onSubmit={submitComplaint}
          submitting={submitting}
        />
      ) : null}
    </main>
  );
}