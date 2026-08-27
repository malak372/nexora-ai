import {
  Activity,
  ArrowDown,
  ArrowUp,
  Braces,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  ClipboardCopy,
  Clock3,
  Code2,
  Eye,
  FileClock,
  FileText,
  Fingerprint,
  Hash,
  Layers3,
  LoaderCircle,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { adminApi, getApiErrorMessage } from '../../shared/api/adminApi';
import '../../shared/styles/admin-pages.css';
import '../styles/admin-prompts.css';

const PAGE_SIZE = 12;

const REQUIRED_PLACEHOLDERS = [
  'domain',
  'country',
  'city',
  'region',
  'platforms',
  'commentsCount',
  'sentimentStats',
  'keywords',
  'topics',
  'recurringProblems',
  'extractedNeeds',
  'featureRequests',
  'opportunities',
  'insights',
  'dataQuality',
  'samplePosts',
  'sampleComments',
  'existingIdea',
  'requestedOutputFormat',
];

const PROMPT_TYPES = [
  { key: '', label: 'All prompt types' },
  { key: 'IDEA_GENERATION', label: 'Idea generation' },
  { key: 'IDEA_UNLOCK', label: 'Idea unlock' },
  { key: 'CHAT_RESPONSE', label: 'Chat response' },
  { key: 'NLP_ANALYSIS', label: 'NLP analysis' },
  { key: 'ABSTRACT_GENERATION', label: 'Abstract generation' },
  { key: 'IDEA_EVALUATION', label: 'Idea evaluation' },
];

const SORT_OPTIONS = [
  { key: 'createdAt', label: 'Newest activity' },
  { key: 'promptType', label: 'Prompt type' },
  { key: 'estimatedInputTokens', label: 'Estimated tokens' },
];

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unwrapTemplate(payload) {
  if (!isObject(payload)) return '';
  const source = isObject(payload.data) ? payload.data : payload;
  return source.ideaPromptTemplate || source.template || source.content || source.prompt || '';
}

function unwrapRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!isObject(payload)) return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.history)) return payload.history;
  if (Array.isArray(payload.records)) return payload.records;
  if (isObject(payload.data)) {
    if (Array.isArray(payload.data.data)) return payload.data.data;
    if (Array.isArray(payload.data.items)) return payload.data.items;
  }
  return [];
}

function unwrapMeta(payload, count) {
  const source =
    payload?.meta ||
    payload?.pagination ||
    payload?.data?.meta ||
    payload?.data?.pagination ||
    {};

  const total = Number(source.total ?? source.totalItems ?? payload?.total ?? count) || 0;
  const page = Number(source.page ?? source.currentPage ?? 1) || 1;
  const limit = Number(source.limit ?? source.pageSize ?? PAGE_SIZE) || PAGE_SIZE;
  const totalPages = Math.max(
    1,
    Number(source.totalPages ?? source.pages ?? Math.ceil(total / Math.max(1, limit))) || 1,
  );

  return { total, page, limit, totalPages };
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

function formatType(value) {
  if (!value) return 'Unknown';
  return String(value)
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function compactNumber(value) {
  const number = Number(value) || 0;
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1).replace('.0', '')}M`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(1).replace('.0', '')}K`;
  return number.toLocaleString();
}

function hashPreview(value) {
  if (!value) return 'No template hash';
  const text = String(value);
  return text.length > 14 ? `${text.slice(0, 8)}…${text.slice(-5)}` : text;
}

function requesterLabel(row) {
  if (row?.user?.fullName) return row.user.fullName;
  if (row?.user?.email) return row.user.email;
  if (row?.guestSessionId || row?.guestSession) return 'Guest session';
  return 'Internal operation';
}

function requesterSubtitle(row) {
  if (row?.user?.email) return row.user.email;
  if (row?.guestSession?.id) return `Guest ${String(row.guestSession.id).slice(0, 8)}…`;
  if (row?.guestSessionId) return `Guest ${String(row.guestSessionId).slice(0, 8)}…`;
  return 'System generated';
}

function contextLabel(row) {
  if (row?.idea?.title) return row.idea.title;
  if (row?.collectionJob?.domain?.name) return row.collectionJob.domain.name;
  if (row?.ideaId) return `Idea ${String(row.ideaId).slice(0, 8)}…`;
  if (row?.collectionJobId) return `Collection ${String(row.collectionJobId).slice(0, 8)}…`;
  return 'No linked context';
}

function extractPlaceholders(text) {
  return Array.from(String(text || '').matchAll(/{{([a-zA-Z0-9_]+)}}/g), (match) => match[1]);
}

function validateTemplate(text) {
  const placeholders = extractPlaceholders(text);
  const counts = placeholders.reduce((map, key) => {
    map.set(key, (map.get(key) || 0) + 1);
    return map;
  }, new Map());

  const missing = REQUIRED_PLACEHOLDERS.filter((key) => !counts.has(key));
  const duplicated = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key);
  const unsupported = [...new Set(placeholders.filter((key) => !REQUIRED_PLACEHOLDERS.includes(key)))];

  return {
    placeholders,
    uniqueCount: new Set(placeholders).size,
    missing,
    duplicated,
    unsupported,
    valid: missing.length === 0 && duplicated.length === 0 && unsupported.length === 0,
  };
}

function toStartOfDayIso(value) {
  if (!value) return undefined;
  return new Date(`${value}T00:00:00`).toISOString();
}

function toEndOfDayIso(value) {
  if (!value) return undefined;
  return new Date(`${value}T23:59:59.999`).toISOString();
}

function MetricCard({ icon: Icon, label, value, hint, tone = '' }) {
  return (
    <article className={`admin-prompt-metric ${tone}`}>
      <i aria-hidden="true" />
      <span className="admin-prompt-metric__icon"><Icon size={19} /></span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <span>{hint}</span>
      </div>
      <span className="admin-prompt-metric__sparkline" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
    </article>
  );
}

function Dropdown({ label, value, options, onChange, icon: Icon }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const current = options.find((option) => option.key === value) || options[0];

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className={`admin-prompt-dropdown ${open ? 'is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="admin-prompt-dropdown__trigger"
        onClick={() => setOpen((currentOpen) => !currentOpen)}
      >
        <Icon size={15} />
        <span>
          <small>{label}</small>
          <strong>{current?.label || label}</strong>
        </span>
        <ChevronDown size={14} />
      </button>

      {open && (
        <div className="admin-prompt-dropdown__menu">
          {options.map((option) => (
            <button
              type="button"
              key={option.key}
              className={value === option.key ? 'is-active' : ''}
              onClick={() => {
                onChange(option.key);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {value === option.key && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SortControl({ value, order, onChange, onToggle }) {
  const options = SORT_OPTIONS;
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const current = options.find((option) => option.key === value) || options[0];

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className={`admin-prompt-sort ${open ? 'is-open' : ''}`} ref={rootRef}>
      <button type="button" className="admin-prompt-sort__main" onClick={() => setOpen((state) => !state)}>
        <FileClock size={15} />
        <span>
          <small>Sort history</small>
          <strong>{current.label}</strong>
        </span>
        <ChevronDown size={14} />
      </button>
      <button
        type="button"
        className="admin-prompt-sort__direction"
        onClick={onToggle}
        title={order === 'asc' ? 'Ascending' : 'Descending'}
      >
        {order === 'asc' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
      </button>

      {open && (
        <div className="admin-prompt-sort__menu">
          {options.map((option) => (
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

function PromptInspector({ row, onClose }) {
  const [copied, setCopied] = useState(false);

  if (!row || typeof document === 'undefined') return null;

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(row.promptText || '');
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  const sources = Array.isArray(row?.collectionJob?.sources) ? row.collectionJob.sources : [];

  return createPortal(
    <div className="admin-prompt-modal-layer" role="presentation">
      <div className="admin-prompt-modal-backdrop" onMouseDown={onClose} />
      <section
        className="admin-prompt-inspector"
        role="dialog"
        aria-modal="true"
        aria-label="Prompt execution details"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="admin-prompt-inspector__header">
          <span className="admin-prompt-inspector__mark"><Code2 size={21} /></span>
          <div>
            <small>RENDERED PROMPT RECORD</small>
            <h2>{formatType(row.promptType)}</h2>
            <p>{formatDate(row.createdAt)} · {requesterLabel(row)}</p>
          </div>
          <button type="button" className="admin-prompt-icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="admin-prompt-inspector__body">
          <section className="admin-prompt-inspector__summary">
            <article>
              <span><UserRound size={15} /></span>
              <div>
                <small>Requester</small>
                <strong>{requesterLabel(row)}</strong>
                <p>{requesterSubtitle(row)}</p>
              </div>
            </article>
            <article>
              <span><Layers3 size={15} /></span>
              <div>
                <small>Linked context</small>
                <strong>{contextLabel(row)}</strong>
                <p>{row?.collectionJob?.status || row?.idea?.generationType || 'Prompt execution'}</p>
              </div>
            </article>
            <article>
              <span><Hash size={15} /></span>
              <div>
                <small>Estimated input</small>
                <strong>{compactNumber(row.estimatedInputTokens || 0)} tokens</strong>
                <p>{hashPreview(row.templateHash)}</p>
              </div>
            </article>
          </section>

          <section className="admin-prompt-inspector__prompt">
            <header>
              <div>
                <small>FULL RENDERED PROMPT</small>
                <h3>Provider-ready content</h3>
              </div>
              <button type="button" onClick={copyPrompt}>
                {copied ? <CheckCircle2 size={15} /> : <ClipboardCopy size={15} />}
                {copied ? 'Copied' : 'Copy prompt'}
              </button>
            </header>
            <pre>{row.promptText || 'No prompt text was returned.'}</pre>
          </section>

          <section className="admin-prompt-inspector__details">
            <article>
              <small>Prompt ID</small>
              <strong>{row.id || '—'}</strong>
            </article>
            <article>
              <small>Template hash</small>
              <strong>{row.templateHash || '—'}</strong>
            </article>
            <article>
              <small>Generation run</small>
              <strong>{row.generationRunId || '—'}</strong>
            </article>
            <article>
              <small>Collection job</small>
              <strong>{row.collectionJobId || row?.collectionJob?.id || '—'}</strong>
            </article>
          </section>

          {row?.collectionJob && (
            <section className="admin-prompt-inspector__context">
              <header>
                <span><Layers3 size={16} /></span>
                <div>
                  <small>EVIDENCE CONTEXT</small>
                  <h3>{row.collectionJob.domain?.name || 'Collection context'}</h3>
                </div>
              </header>
              <div className="admin-prompt-inspector__context-grid">
                <span><strong>{row.collectionJob.totalPosts || 0}</strong><small>Posts</small></span>
                <span><strong>{row.collectionJob.totalComments || 0}</strong><small>Comments</small></span>
                <span><strong>{row.collectionJob.language || 'ANY'}</strong><small>Language</small></span>
                <span>
                  <strong>{[row.collectionJob.city, row.collectionJob.region, row.collectionJob.country].filter(Boolean).join(', ') || 'Any location'}</strong>
                  <small>Location</small>
                </span>
              </div>
              {sources.length > 0 && (
                <div className="admin-prompt-source-list">
                  {sources.map((source, index) => (
                    <span key={source?.dataSource?.id || index}>
                      {source?.dataSource?.displayName || source?.dataSource?.key || 'Source'}
                    </span>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}

export default function AdminPromptsPage() {
  const [savedTemplate, setSavedTemplate] = useState('');
  const [text, setText] = useState('');
  const [history, setHistory] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: PAGE_SIZE, totalPages: 1 });

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [promptType, setPromptType] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const [loadingTemplate, setLoadingTemplate] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedPrompt, setSelectedPrompt] = useState(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 280);
    return () => window.clearTimeout(timer);
  }, [search]);

  const validation = useMemo(() => validateTemplate(text), [text]);
  const savedValidation = useMemo(() => validateTemplate(savedTemplate), [savedTemplate]);
  const dirty = text !== savedTemplate;

  const historyParams = useMemo(
    () => ({
      page,
      limit: PAGE_SIZE,
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...(promptType ? { promptType } : {}),
      ...(fromDate ? { fromDate: toStartOfDayIso(fromDate) } : {}),
      ...(toDate ? { toDate: toEndOfDayIso(toDate) } : {}),
      sortBy,
      sortOrder,
    }),
    [page, debouncedSearch, promptType, fromDate, toDate, sortBy, sortOrder],
  );

  const loadTemplate = useCallback(async ({ fresh = false } = {}) => {
    setLoadingTemplate(true);
    try {
      const loader =
        fresh && adminApi.prompts.templateFresh
          ? adminApi.prompts.templateFresh
          : adminApi.prompts.template;
      const result = await loader();
      const nextTemplate = unwrapTemplate(result);
      setSavedTemplate(nextTemplate);
      setText(nextTemplate);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Could not load the active prompt template.'));
    } finally {
      setLoadingTemplate(false);
    }
  }, []);

  const loadHistory = useCallback(async ({ fresh = false, silent = false } = {}) => {
    if (!silent) setLoadingHistory(true);
    try {
      const loader =
        fresh && adminApi.prompts.historyFresh
          ? adminApi.prompts.historyFresh
          : adminApi.prompts.history;
      const result = await loader(historyParams);
      const rows = unwrapRows(result);
      setHistory(rows);
      setMeta(unwrapMeta(result, rows.length));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Could not load prompt execution history.'));
    } finally {
      setLoadingHistory(false);
    }
  }, [historyParams]);

  useEffect(() => {
    setError('');
    loadTemplate();
  }, [loadTemplate]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(''), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const refreshAll = async () => {
    setRefreshing(true);
    setError('');
    await Promise.all([
      loadTemplate({ fresh: true }),
      loadHistory({ fresh: true, silent: true }),
    ]);
    setRefreshing(false);
  };

  const save = async () => {
    if (!validation.valid || !dirty || saving) return;
    setSaving(true);
    setError('');
    try {
      const result = await adminApi.prompts.update({ ideaPromptTemplate: text });
      const nextTemplate = unwrapTemplate(result) || text.trim();
      setSavedTemplate(nextTemplate);
      setText(nextTemplate);
      setNotice('Production prompt template updated successfully.');
      await loadHistory({ fresh: true, silent: true });
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Could not update the prompt template.'));
    } finally {
      setSaving(false);
    }
  };

  const resetEditor = () => {
    setText(savedTemplate);
  };

  const totalTokensOnPage = useMemo(
    () => history.reduce((sum, row) => sum + (Number(row.estimatedInputTokens) || 0), 0),
    [history],
  );

  const clearDates = () => {
    setFromDate('');
    setToDate('');
    setPage(1);
  };

  return (
    <div className="admin-prompt-page">
      <section className="admin-prompt-hero">
        <div className="admin-prompt-hero__copy">
          <span className="admin-prompt-eyebrow"><Sparkles size={16} /> GENERATION GOVERNANCE</span>
          <h1>Prompt control</h1>
          <p>Safely manage the production idea-generation template and inspect the rendered prompts sent through the AI pipeline.</p>
        </div>

        <div className="admin-prompt-hero__visual" aria-hidden="true">
          <span className="admin-prompt-orbit admin-prompt-orbit--one" />
          <span className="admin-prompt-orbit admin-prompt-orbit--two" />
          <span className="admin-prompt-orbit-dot admin-prompt-orbit-dot--one" />
          <span className="admin-prompt-orbit-dot admin-prompt-orbit-dot--two" />
          <span className="admin-prompt-orbit-dot admin-prompt-orbit-dot--three" />

          <div className="admin-prompt-visual-card">
            <span className="admin-prompt-visual-card__badge"><Braces size={25} /></span>
            <div className="admin-prompt-visual-card__lines">
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
            <span className="admin-prompt-visual-card__spark"><Sparkles size={17} /></span>
          </div>

          <div className="admin-prompt-visual-sliders">
            <span><i /><b /></span>
            <span><i /><b /></span>
            <span><i /><b /></span>
          </div>

          <span className="admin-prompt-visual-shield"><ShieldCheck size={42} /></span>
        </div>

        <div className="admin-prompt-hero__actions">
          <button type="button" className="admin-prompt-button is-quiet" onClick={refreshAll} disabled={refreshing}>
            <RefreshCw className={refreshing ? 'admin-prompt-spin' : ''} size={16} />
            Refresh
          </button>
        </div>
      </section>

      {error && (
        <div className="admin-prompt-alert is-error">
          <CircleAlert size={16} />
          <span>{error}</span>
          <button type="button" onClick={() => setError('')}><X size={14} /></button>
        </div>
      )}

      {notice && (
        <div className="admin-prompt-alert is-success">
          <CheckCircle2 size={16} />
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')}><X size={14} /></button>
        </div>
      )}

      <section className="admin-prompt-metrics">
        <MetricCard
          icon={FileText}
          label="Template size"
          value={compactNumber(text.length)}
          hint="Characters in editor"
        />
        <MetricCard
          icon={Braces}
          label="Required placeholders"
          value={`${validation.uniqueCount}/${REQUIRED_PLACEHOLDERS.length}`}
          hint={validation.valid ? 'Template structure valid' : 'Template needs attention'}
          tone={validation.valid ? 'is-green' : 'is-rose'}
        />
        <MetricCard
          icon={Activity}
          label="Prompt executions"
          value={meta.total.toLocaleString()}
          hint="Matching history records"
          tone="is-mint"
        />
        <MetricCard
          icon={Hash}
          label="Tokens on page"
          value={compactNumber(totalTokensOnPage)}
          hint="Estimated input tokens"
        />
      </section>

      <section className="admin-prompt-workspace">
        <header className="admin-prompt-workspace__header">
          <div>
            <small>PRODUCTION TEMPLATE</small>
            <h2>Active idea-generation prompt</h2>
            <p>Changes affect future generation runs only. Existing prompt history remains immutable.</p>
          </div>
          <div className="admin-prompt-workspace__status">
            <span className={`admin-prompt-status ${validation.valid ? 'is-valid' : 'is-invalid'}`}>
              {validation.valid ? <ShieldCheck size={14} /> : <CircleAlert size={14} />}
              {validation.valid ? 'Valid template' : 'Needs attention'}
            </span>
            {dirty && <span className="admin-prompt-unsaved"><i /> Unsaved changes</span>}
          </div>
        </header>

        <div className="admin-prompt-editor-layout">
          <article className="admin-prompt-editor">
            <header>
              <div>
                <span className="admin-prompt-editor__icon"><Code2 size={17} /></span>
                <div>
                  <small>PROMPT EDITOR</small>
                  <strong>Provider-independent template</strong>
                </div>
              </div>
              <span className="admin-prompt-editor__count">{text.length.toLocaleString()} characters</span>
            </header>

            {loadingTemplate ? (
              <div className="admin-prompt-loading">
                <LoaderCircle className="admin-prompt-spin" size={24} />
                <strong>Loading production template…</strong>
              </div>
            ) : (
              <textarea
                className="admin-prompt-editor__textarea"
                value={text}
                onChange={(event) => setText(event.target.value)}
                spellCheck={false}
                aria-label="Idea generation prompt template"
              />
            )}

            <footer>
              <div>
                <span>{validation.placeholders.length} placeholder references</span>
                <span>Saved structure: {savedValidation.valid ? 'valid' : 'invalid'}</span>
              </div>
              <div className="admin-prompt-editor__actions">
                <button type="button" className="admin-prompt-button is-quiet" onClick={resetEditor} disabled={!dirty || saving}>
                  <RefreshCw size={15} />
                  Discard changes
                </button>
                <button
                  type="button"
                  className="admin-prompt-button is-primary"
                  onClick={save}
                  disabled={!dirty || !validation.valid || saving}
                >
                  {saving ? <LoaderCircle className="admin-prompt-spin" size={16} /> : <Save size={16} />}
                  <span>
                    <strong>Save production prompt</strong>
                    <small>{validation.valid ? 'Apply to future runs' : 'Fix validation first'}</small>
                  </span>
                </button>
              </div>
            </footer>
          </article>

          <aside className="admin-prompt-placeholder-panel">
            <header>
              <span><Braces size={17} /></span>
              <div>
                <small>TEMPLATE CONTRACT</small>
                <h3>Required placeholders</h3>
                <p>Every placeholder must appear exactly once.</p>
              </div>
            </header>

            <div className="admin-prompt-placeholder-list">
              {REQUIRED_PLACEHOLDERS.map((key) => {
                const count = validation.placeholders.filter((item) => item === key).length;
                const state = count === 1 ? 'is-valid' : count === 0 ? 'is-missing' : 'is-duplicate';
                return (
                  <span key={key} className={`admin-prompt-placeholder ${state}`}>
                    <code>{`{{${key}}}`}</code>
                    {count === 1 ? <Check size={12} /> : <CircleAlert size={12} />}
                  </span>
                );
              })}
            </div>

            {(validation.unsupported.length > 0 || validation.duplicated.length > 0 || validation.missing.length > 0) && (
              <div className="admin-prompt-validation-note">
                <CircleAlert size={15} />
                <div>
                  {validation.missing.length > 0 && <span>Missing: {validation.missing.join(', ')}</span>}
                  {validation.duplicated.length > 0 && <span>Duplicated: {validation.duplicated.join(', ')}</span>}
                  {validation.unsupported.length > 0 && <span>Unsupported: {validation.unsupported.join(', ')}</span>}
                </div>
              </div>
            )}
          </aside>
        </div>
      </section>

      <section className="admin-prompt-history">
        <header className="admin-prompt-history__header">
          <div>
            <small>AI TRACEABILITY</small>
            <h2>Prompt execution history</h2>
            <p>Rendered provider-ready prompts created by generation, unlock, chat and internal AI operations.</p>
          </div>
          <span className="admin-prompt-readonly"><ShieldCheck size={14} /> Read-only history</span>
        </header>

        <div className="admin-prompt-history__toolbar">
          <Dropdown
            label="Prompt type"
            value={promptType}
            options={PROMPT_TYPES}
            onChange={(value) => {
              setPromptType(value);
              setPage(1);
            }}
            icon={Layers3}
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

          <div className="admin-prompt-date-range">
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

          <label className="admin-prompt-search">
            <Search size={17} />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search rendered prompt text..."
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="Clear search">
                <X size={14} />
              </button>
            )}
          </label>
        </div>

        <div className="admin-prompt-table-wrap">
          {loadingHistory ? (
            <div className="admin-prompt-table-state">
              <LoaderCircle className="admin-prompt-spin" size={24} />
              <strong>Loading prompt history…</strong>
            </div>
          ) : history.length === 0 ? (
            <div className="admin-prompt-table-state">
              <FileClock size={26} />
              <strong>No prompt executions match these filters.</strong>
              <span>Try another prompt type, date range or search phrase.</span>
            </div>
          ) : (
            <table className="admin-prompt-table">
              <colgroup>
                <col className="admin-prompt-col-record" />
                <col className="admin-prompt-col-requester" />
                <col className="admin-prompt-col-context" />
                <col className="admin-prompt-col-tokens" />
                <col className="admin-prompt-col-created" />
                <col className="admin-prompt-col-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th>PROMPT</th>
                  <th>REQUESTER</th>
                  <th>CONTEXT</th>
                  <th>TOKENS</th>
                  <th>CREATED</th>
                  <th className="is-actions">ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="admin-prompt-record">
                        <span className="admin-prompt-record__icon"><Code2 size={17} /></span>
                        <div>
                          <strong>{formatType(row.promptType)}</strong>
                          <span>{String(row.promptText || '').replace(/\s+/g, ' ').slice(0, 82) || 'No prompt text'}</span>
                          <small><Fingerprint size={11} /> {hashPreview(row.templateHash)}</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="admin-prompt-requester">
                        <strong>{requesterLabel(row)}</strong>
                        <span>{requesterSubtitle(row)}</span>
                      </div>
                    </td>
                    <td>
                      <div className="admin-prompt-context">
                        <strong>{contextLabel(row)}</strong>
                        <span>{row?.collectionJob?.domain?.name ? 'Evidence-backed run' : row?.idea ? 'Idea linked' : 'Prompt operation'}</span>
                      </div>
                    </td>
                    <td>
                      <div className="admin-prompt-token">
                        <strong>{compactNumber(row.estimatedInputTokens || 0)}</strong>
                        <span>estimated</span>
                      </div>
                    </td>
                    <td>
                      <div className="admin-prompt-created">
                        <strong>{formatShortDate(row.createdAt)}</strong>
                        <span><Clock3 size={11} /> {row.createdAt ? new Date(row.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'}</span>
                      </div>
                    </td>
                    <td className="is-actions">
                      <button type="button" className="admin-prompt-inspect" onClick={() => setSelectedPrompt(row)}>
                        <Eye size={15} />
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <footer className="admin-prompt-pagination">
          <span>
            Showing {history.length ? (meta.page - 1) * meta.limit + 1 : 0}
            {'–'}
            {Math.min(meta.page * meta.limit, meta.total)} of {meta.total}
          </span>
          <div>
            <button type="button" disabled={meta.page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
              Previous
            </button>
            <span>Page {meta.page} of {meta.totalPages}</span>
            <button type="button" disabled={meta.page >= meta.totalPages} onClick={() => setPage((current) => current + 1)}>
              Next
            </button>
          </div>
        </footer>
      </section>

      <PromptInspector row={selectedPrompt} onClose={() => setSelectedPrompt(null)} />
    </div>
  );
}