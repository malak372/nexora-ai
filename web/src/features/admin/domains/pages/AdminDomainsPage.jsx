import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleOff,
  Database,
  FolderKanban,
  Eye,
  EyeOff,
  Languages,
  Layers3,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Tag,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { adminApi, getApiErrorMessage } from '../../shared/api/adminApi';
import '../../shared/styles/admin-pages.css';
import '../styles/admin-domains.css';

const PAGE_SIZE = 20;
const LANGUAGE_OPTIONS = ['ANY', 'EN', 'AR', 'FR', 'ES', 'DE', 'TR'];

const SORT_OPTIONS = [
  { key: 'name', label: 'Domain name' },
  { key: 'updatedAt', label: 'Last updated' },
  { key: 'createdAt', label: 'Created date' },
  { key: 'isActive', label: 'Status' },
];

const FILTER_OPTIONS = [
  { key: 'all', label: 'All domains' },
  { key: 'hiddenGenerated', label: 'Hidden AI-discovered' },
  { key: 'active', label: 'Active' },
  { key: 'inactive', label: 'Inactive' },
];

const EMPTY_FORM = {
  name: '',
  isActive: true,
  isVisible: true,
  keywords: [],
};

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unwrapRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!isObject(payload)) return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.domains)) return payload.domains;
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

function unwrapSummary(payload) {
  if (!isObject(payload)) return {};
  return isObject(payload.data) ? payload.data : payload;
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

function domainInitial(domain) {
  return String(domain?.name || 'D').trim().charAt(0).toUpperCase() || 'D';
}

function metricValue(summary, key, fallback = 0) {
  const value = Number(summary?.[key]);
  return Number.isFinite(value) ? value : fallback;
}

function normalizeKeyword(item) {
  return {
    keyword: String(item?.keyword || '').trim(),
    language: LANGUAGE_OPTIONS.includes(String(item?.language || '').toUpperCase())
      ? String(item.language).toUpperCase()
      : 'ANY',
  };
}

function MetricCard({ icon: Icon, label, value, hint, tone = '' }) {
  return (
    <article className={`admin-domain-metric ${tone}`}>
      <i aria-hidden="true" />
      <span className="admin-domain-metric__icon"><Icon size={20} /></span>
      <div>
        <small>{label}</small>
        <strong>{Number(value || 0).toLocaleString()}</strong>
        <span>{hint}</span>
      </div>
    </article>
  );
}

function SortPicker({ value, order, onChange, onToggleOrder }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const current = SORT_OPTIONS.find((option) => option.key === value) || SORT_OPTIONS[0];

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className={`admin-domain-sort ${open ? 'is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="admin-domain-sort__trigger"
        onClick={() => setOpen((currentOpen) => !currentOpen)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <SlidersHorizontal size={15} />
        <span>
          <small>Sort domains</small>
          <strong>{current.label}</strong>
        </span>
        <ChevronDown size={14} />
      </button>

      {open && (
        <div className="admin-domain-sort__menu" role="listbox" aria-label="Sort domains">
          {SORT_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              role="option"
              aria-selected={value === option.key}
              className={value === option.key ? 'is-active' : ''}
              onClick={() => {
                onChange(option.key);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {value === option.key && <CheckCircle2 size={14} />}
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        className="admin-domain-sort__direction"
        onClick={onToggleOrder}
        title={order === 'asc' ? 'Ascending order' : 'Descending order'}
      >
        {order === 'asc' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
      </button>
    </div>
  );
}

function LanguagePicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className={`admin-domain-language-picker ${open ? 'is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="admin-domain-language-picker__trigger"
        onClick={() => setOpen((currentOpen) => !currentOpen)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Languages size={14} />
        <strong>{value}</strong>
        <ChevronDown size={13} />
      </button>

      {open && (
        <div className="admin-domain-language-picker__menu" role="listbox">
          {LANGUAGE_OPTIONS.map((language) => (
            <button
              key={language}
              type="button"
              className={value === language ? 'is-active' : ''}
              onClick={() => {
                onChange(language);
                setOpen(false);
              }}
            >
              <span>{language}</span>
              {value === language && <Check size={13} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusSwitch({ checked, onChange, disabled = false }) {
  return (
    <button
      type="button"
      className={`admin-domain-switch ${checked ? 'is-on' : 'is-off'}`}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="admin-domain-switch__track"><i /></span>
      <span>
        <strong>{checked ? 'Active' : 'Inactive'}</strong>
        <small>{checked ? 'Enabled for new generation requests' : 'Disabled for new generation requests'}</small>
      </span>
    </button>
  );
}

function VisibilitySwitch({ checked, onChange, disabled = false, autoGenerated = false }) {
  return (
    <button
      type="button"
      className={`admin-domain-switch admin-domain-visibility-switch ${checked ? 'is-on' : 'is-off'}`}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="admin-domain-switch__visibility-icon">
        {checked ? <Eye size={17} /> : <EyeOff size={17} />}
      </span>
      <span className="admin-domain-switch__track"><i /></span>
      <span>
        <strong>{checked ? 'Visible to users' : 'Hidden from users'}</strong>
        <small>
          {checked
            ? 'Shown in the domain list users can choose from.'
            : autoGenerated
              ? 'Kept internal until an admin decides to publish it.'
              : 'Not shown in the public domain selector.'}
        </small>
      </span>
    </button>
  );
}

function DomainModal({ open, mode, domain, busy, onClose, onSave }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    if (mode === 'edit' && domain) {
      setForm({
        name: domain.name || '',
        isActive: domain.isActive !== false,
        isVisible: domain.isVisible !== false,
        keywords: Array.isArray(domain.domainKeywords)
          ? domain.domainKeywords.map(normalizeKeyword)
          : [],
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [open, mode, domain]);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, busy, onClose]);

  if (!open) return null;

  const addKeyword = () => {
    setForm((current) => ({
      ...current,
      keywords: [...current.keywords, { keyword: '', language: 'ANY' }],
    }));
  };

  const updateKeyword = (index, patch) => {
    setForm((current) => ({
      ...current,
      keywords: current.keywords.map((item, itemIndex) => (
        itemIndex === index ? { ...item, ...patch } : item
      )),
    }));
  };

  const removeKeyword = (index) => {
    setForm((current) => ({
      ...current,
      keywords: current.keywords.filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const submit = async () => {
    const name = form.name.trim();
    const keywords = form.keywords
      .map(normalizeKeyword)
      .filter((item) => item.keyword.length > 0);

    if (name.length < 2) {
      setError('Domain name must contain at least 2 characters.');
      return;
    }

    const invalidKeyword = keywords.find((item) => item.keyword.length < 2);
    if (invalidKeyword) {
      setError('Every keyword must contain at least 2 characters.');
      return;
    }

    setError('');
    try {
      await onSave({ name, isActive: form.isActive, isVisible: form.isVisible, keywords });
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Unable to save domain.'));
    }
  };

  return createPortal(
    <div className="admin-domain-modal-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section className="admin-domain-modal" role="dialog" aria-modal="true" aria-labelledby="admin-domain-modal-title">
        <header className="admin-domain-modal__head">
          <div className="admin-domain-modal__identity">
            <span className="admin-domain-modal__mark">
              {mode === 'edit' ? domainInitial(domain) : <Plus size={20} />}
            </span>
            <div>
              <small>{mode === 'edit' ? 'DOMAIN CONFIGURATION' : 'NEW DISCOVERY DOMAIN'}</small>
              <h3 id="admin-domain-modal-title">{mode === 'edit' ? domain?.name : 'Add domain'}</h3>
              <p>{mode === 'edit' ? 'Update availability and discovery keywords.' : 'Create a domain users can select during idea generation.'}</p>
            </div>
          </div>
          <button type="button" className="admin-domain-modal__close" onClick={onClose} disabled={busy} aria-label="Close">
            <X size={19} />
          </button>
        </header>

        <div className="admin-domain-modal__body">
          <aside className="admin-domain-modal__aside">
            <div className="admin-domain-aside-card">
              <span className="admin-domain-aside-card__icon"><FolderKanban size={18} /></span>
              <div>
                <small>Discovery behavior</small>
                <strong>Control what users can generate.</strong>
                <p>Inactive domains remain in historical records but are removed from new selection flows.</p>
              </div>
            </div>

            <div className="admin-domain-aside-card">
              <span className="admin-domain-aside-card__icon"><Tag size={18} /></span>
              <div>
                <small>Keyword coverage</small>
                <strong>{form.keywords.length.toLocaleString()} configured keywords</strong>
                <p>Keywords help collection and domain matching discover relevant evidence.</p>
              </div>
            </div>

            {mode === 'edit' && (
              <div className="admin-domain-aside-meta">
                <span><small>Created</small><strong>{formatDate(domain?.createdAt)}</strong></span>
                <span><small>Updated</small><strong>{formatDate(domain?.updatedAt)}</strong></span>
                <span><small>Idea usage</small><strong>{Number(domain?._count?.ideas || 0).toLocaleString()} ideas</strong></span>
              </div>
            )}
          </aside>

          <div className="admin-domain-editor">
            <div className="admin-domain-editor__intro">
              <span><Database size={18} /></span>
              <div>
                <small>DOMAIN SETTINGS</small>
                <h4>Name, availability and discovery vocabulary.</h4>
                <p>Changes are applied to future discovery and generation requests without removing historical data.</p>
              </div>
            </div>

            <div className="admin-domain-field">
              <label htmlFor="admin-domain-name">Domain name</label>
              <input
                id="admin-domain-name"
                value={form.name}
                maxLength={100}
                disabled={busy}
                placeholder="e.g. Artificial Intelligence"
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              />
              <span>{form.name.length}/100</span>
            </div>

            <div className="admin-domain-field">
              <label>Availability</label>
              <StatusSwitch
                checked={form.isActive}
                disabled={busy}
                onChange={(isActive) => setForm((current) => ({ ...current, isActive }))}
              />
            </div>

            {mode === 'edit' && domain?.isAutoGenerated && (
              <div className={`admin-domain-auto-note ${form.isVisible ? 'is-visible' : 'is-hidden'}`}>
                <Sparkles size={17} />
                <div>
                  <strong>AI-discovered domain</strong>
                  <span>
                    {form.isVisible
                      ? 'This inferred domain is currently published to users.'
                      : 'This domain was inferred from a user description and is still hidden from user selectors.'}
                  </span>
                </div>
              </div>
            )}

            <div className="admin-domain-field">
              <label>User visibility</label>
              <VisibilitySwitch
                checked={form.isVisible}
                disabled={busy}
                autoGenerated={Boolean(domain?.isAutoGenerated)}
                onChange={(isVisible) => setForm((current) => ({ ...current, isVisible }))}
              />
            </div>

            <div className="admin-domain-keywords-head">
              <div>
                <small>DISCOVERY KEYWORDS</small>
                <h5>Search vocabulary</h5>
                <p>Keep the terms focused on the real problems, products and communities inside this domain.</p>
              </div>
              <button type="button" onClick={addKeyword} disabled={busy}>
                <Plus size={14} /> Add keyword
              </button>
            </div>

            <div className="admin-domain-keywords">
              {form.keywords.length === 0 ? (
                <div className="admin-domain-keywords__empty">
                  <Tag size={18} />
                  <strong>No keywords yet</strong>
                  <span>Add focused terms to improve domain matching and collection.</span>
                </div>
              ) : (
                form.keywords.map((item, index) => (
                  <div className="admin-domain-keyword-row" key={`${index}-${item.language}`}>
                    <span className="admin-domain-keyword-row__index">{index + 1}</span>
                    <input
                      value={item.keyword}
                      maxLength={100}
                      disabled={busy}
                      placeholder="Keyword or phrase"
                      onChange={(event) => updateKeyword(index, { keyword: event.target.value })}
                    />
                    <LanguagePicker
                      value={item.language}
                      onChange={(language) => updateKeyword(index, { language })}
                    />
                    <button
                      type="button"
                      className="admin-domain-keyword-row__remove"
                      onClick={() => removeKeyword(index)}
                      disabled={busy}
                      aria-label="Remove keyword"
                    >
                      <X size={15} />
                    </button>
                  </div>
                ))
              )}
            </div>

            {error && <div className="admin-domain-form-error">{error}</div>}
          </div>
        </div>

        <footer className="admin-domain-modal__footer">
          <div>
            <small>{mode === 'edit' ? 'SAVE DOMAIN CHANGES' : 'CREATE DOMAIN'}</small>
            <span>{mode === 'edit' ? 'Name, status and keyword updates are saved together.' : 'The domain becomes available immediately when Active is enabled.'}</span>
          </div>
          <div className="admin-domain-modal__footer-actions">
            <button type="button" className="admin-domain-btn admin-domain-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="admin-domain-btn admin-domain-btn--primary" onClick={submit} disabled={busy}>
              {busy ? <LoaderCircle size={16} className="admin-spin" /> : mode === 'edit' ? <Check size={16} /> : <Plus size={16} />}
              {mode === 'edit' ? 'Save domain' : 'Create domain'}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

export default function AdminDomainsPage() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: PAGE_SIZE, totalPages: 1 });
  const [summary, setSummary] = useState({});
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState({ open: false, mode: 'create', domain: null });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 280);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filter, sortBy, sortOrder]);

  const listParams = useMemo(() => ({
    page,
    limit: PAGE_SIZE,
    search: debouncedSearch || undefined,
    isActive: filter === 'active' ? 'true' : filter === 'inactive' ? 'false' : undefined,
    isVisible: filter === 'hiddenGenerated' ? 'false' : undefined,
    isAutoGenerated: filter === 'hiddenGenerated' ? 'true' : undefined,
    sortBy,
    sortOrder,
  }), [page, debouncedSearch, filter, sortBy, sortOrder]);

  const summaryParams = useMemo(() => ({
    search: debouncedSearch || undefined,
  }), [debouncedSearch]);

  const load = useCallback(async ({ silent = false, fresh = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError('');

    try {
      const listLoader = fresh ? adminApi.domains.listFresh : adminApi.domains.list;
      const summaryLoader = fresh ? adminApi.domains.summaryFresh : adminApi.domains.summary;
      const [listPayload, summaryPayload] = await Promise.all([
        listLoader(listParams),
        summaryLoader(summaryParams),
      ]);
      const nextRows = unwrapRows(listPayload);
      setRows(nextRows);
      setMeta(unwrapMeta(listPayload, nextRows.length));
      setSummary(unwrapSummary(summaryPayload));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Unable to load domains.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [listParams, summaryParams]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(''), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const openCreate = () => setModal({ open: true, mode: 'create', domain: null });
  const openEdit = (domain) => setModal({ open: true, mode: 'edit', domain });
  const closeModal = useCallback(() => {
    if (!saving) setModal({ open: false, mode: 'create', domain: null });
  }, [saving]);

  const saveDomain = async (body) => {
    setSaving(true);
    try {
      if (modal.mode === 'edit' && modal.domain?.id) {
        await adminApi.domains.update(modal.domain.id, body);
        setNotice('Domain updated successfully.');
      } else {
        await adminApi.domains.create(body);
        setNotice('Domain created successfully.');
      }
      setModal({ open: false, mode: 'create', domain: null });
      await load({ silent: true });
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Unable to save domain.'));
      throw requestError;
    } finally {
      setSaving(false);
    }
  };

  const totalDomains = metricValue(summary, 'totalDomains', meta.total);
  const activeDomains = metricValue(summary, 'activeDomains');
  const inactiveDomains = metricValue(summary, 'inactiveDomains');
  const domainsWithIdeas = metricValue(summary, 'domainsWithIdeas');

  return (
    <div className="admin-page admin-domain-page">
      <section className="admin-page-hero admin-domain-hero">
        <div className="admin-domain-hero__content">
          <span className="admin-page-hero__eyebrow"><Layers3 size={15} /> DISCOVERY CONFIGURATION</span>
          <h2>Domains</h2>
          <p>Manage the fields users can discover and generate ideas in, together with the vocabulary that guides evidence collection.</p>
        </div>

        <div className="admin-domain-hero__visual" aria-hidden="true">
          <span className="admin-domain-hero__orbit admin-domain-hero__orbit--one" />
          <span className="admin-domain-hero__orbit admin-domain-hero__orbit--two" />
          <span className="admin-domain-hero__dot admin-domain-hero__dot--one" />
          <span className="admin-domain-hero__dot admin-domain-hero__dot--two" />
          <span className="admin-domain-hero__dot admin-domain-hero__dot--three" />

          <span className="admin-domain-hero__node admin-domain-hero__node--tag"><Tag size={17} /></span>
          <span className="admin-domain-hero__node admin-domain-hero__node--data"><Database size={18} /></span>
          <span className="admin-domain-hero__node admin-domain-hero__node--spark"><Sparkles size={17} /></span>

          <div className="admin-domain-hero__globe">
            <span className="admin-domain-hero__globe-line admin-domain-hero__globe-line--v1" />
            <span className="admin-domain-hero__globe-line admin-domain-hero__globe-line--v2" />
            <span className="admin-domain-hero__globe-line admin-domain-hero__globe-line--h1" />
            <span className="admin-domain-hero__globe-line admin-domain-hero__globe-line--h2" />
          </div>

          <div className="admin-domain-hero__search-lens"><Search size={26} /></div>

          <div className="admin-domain-hero__directory-card">
            <span className="admin-domain-hero__directory-icon"><FolderKanban size={18} /></span>
            <span className="admin-domain-hero__directory-line is-wide" />
            <span className="admin-domain-hero__directory-line" />
            <span className="admin-domain-hero__directory-line is-short" />
          </div>

          <span className="admin-domain-hero__scan" />
        </div>
      </section>

      <section className="admin-domain-panel">
        <header className="admin-domain-panel__head">
          <div>
            <span className="admin-domain-panel__kicker"><Database size={13} /> DOMAIN DIRECTORY</span>
            <h3>Discovery domains</h3>
            <p>{meta.total.toLocaleString()} matching domains</p>
          </div>
          <div className="admin-domain-panel__actions">
            <span className="admin-domain-live"><i /> Live configuration</span>
            <button type="button" className="admin-domain-btn admin-domain-btn--refresh" onClick={() => load({ silent: true, fresh: true })} disabled={refreshing}>
              <RefreshCw size={15} className={refreshing ? 'admin-spin' : ''} /> Refresh
            </button>
            <button type="button" className="admin-domain-btn admin-domain-btn--primary" onClick={openCreate}>
              <Plus size={16} /> Add domain
            </button>
          </div>
        </header>

        <div className="admin-domain-metrics">
          <MetricCard icon={Layers3} label="Total domains" value={totalDomains} hint="Configured discovery areas" tone="is-primary" />
          <MetricCard icon={CheckCircle2} label="Active domains" value={activeDomains} hint="Available to users" tone="is-active" />
          <MetricCard icon={CircleOff} label="Inactive domains" value={inactiveDomains} hint="Hidden from new generation" tone="is-inactive" />
          <MetricCard icon={Sparkles} label="Used by ideas" value={domainsWithIdeas} hint="Domains with generated ideas" />
        </div>

        <div className="admin-domain-filter-row">
          <div className="admin-domain-filter-tabs" role="tablist" aria-label="Domain status filter">
            {FILTER_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={filter === option.key ? 'is-active' : ''}
                onClick={() => setFilter(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="admin-domain-tools">
          <SortPicker
            value={sortBy}
            order={sortOrder}
            onChange={setSortBy}
            onToggleOrder={() => setSortOrder((current) => current === 'asc' ? 'desc' : 'asc')}
          />

          <label className="admin-domain-search">
            <Search size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search domains..."
              aria-label="Search domains"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="Clear search"><X size={14} /></button>
            )}
          </label>
        </div>

        {notice && <div className="admin-domain-notice"><CheckCircle2 size={15} /> {notice}</div>}
        {error && <div className="admin-domain-error">{error}</div>}

        <div className="admin-domain-card-shell">
          {loading ? (
            <div className="admin-domain-state admin-domain-state--cards"><LoaderCircle size={20} className="admin-spin" /> Loading domains...</div>
          ) : rows.length === 0 ? (
            <div className="admin-domain-state admin-domain-state--cards"><Database size={20} /> No domains match these filters.</div>
          ) : (
            <div className="admin-domain-card-grid">
              {rows.map((domain) => {
                const keywords = Array.isArray(domain.domainKeywords) ? domain.domainKeywords : [];
                const ideas = Number(domain?._count?.ideas || 0);
                const isVisible = domain.isVisible !== false;
                const isAutoGenerated = domain.isAutoGenerated === true;
                return (
                  <article className={`admin-domain-card ${domain.isActive ? 'is-active' : 'is-inactive'} ${isVisible ? 'is-visible' : 'is-hidden'}`} key={domain.id}>
                    <div className="admin-domain-card__visual">
                      <span className="admin-domain-card__pattern" aria-hidden="true" />
                      <span className="admin-domain-card__avatar">{domainInitial(domain)}</span>
                      <div>
                        <small>{isAutoGenerated ? 'AI-discovered domain' : 'Discovery domain'}</small>
                        <strong>{domain.name || 'Unnamed domain'}</strong>
                        <div className="admin-domain-card__badges">
                          <span className={`admin-domain-status ${domain.isActive ? 'is-active' : 'is-inactive'}`}>
                            {domain.isActive ? <CheckCircle2 size={12} /> : <CircleOff size={12} />}
                            {domain.isActive ? 'Active' : 'Inactive'}
                          </span>
                          <span className={`admin-domain-status admin-domain-visibility-status ${isVisible ? 'is-visible' : 'is-hidden'}`}>
                            {isVisible ? <Eye size={12} /> : <EyeOff size={12} />}
                            {isVisible ? 'Visible to users' : 'Hidden from users'}
                          </span>
                          {isAutoGenerated && (
                            <span className="admin-domain-status admin-domain-auto-status">
                              <Sparkles size={12} /> AI-discovered
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="admin-domain-card__body">
                      <div className="admin-domain-card__head">
                        <div>
                          <small>Created {formatShortDate(domain.createdAt)}</small>
                          <h4>{domain.name || 'Unnamed domain'}</h4>
                        </div>
                        <button type="button" className="admin-domain-manage" onClick={() => openEdit(domain)}>
                          <Pencil size={14} /> Manage
                        </button>
                      </div>

                      <div className="admin-domain-card__section">
                        <div className="admin-domain-card__section-title">
                          <span>Discovery keywords</span>
                          <strong>{keywords.length.toLocaleString()}</strong>
                        </div>
                        <div className="admin-domain-card__keywords">
                          {keywords.slice(0, 4).map((keyword) => (
                            <span key={keyword.id || `${keyword.keyword}-${keyword.language}`}>
                              {keyword.keyword}
                              <small>{keyword.language}</small>
                            </span>
                          ))}
                          {keywords.length > 4 && <em>+{keywords.length - 4} more</em>}
                          {keywords.length === 0 && <em>No keywords configured</em>}
                        </div>
                      </div>

                      <div className="admin-domain-card__stats">
                        <div>
                          <small>Idea usage</small>
                          <strong>{ideas.toLocaleString()}</strong>
                          <span>generated idea{ideas === 1 ? '' : 's'}</span>
                        </div>
                        <div>
                          <small>Last updated</small>
                          <strong>{formatShortDate(domain.updatedAt)}</strong>
                          <span>{formatDate(domain.updatedAt)}</span>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <footer className="admin-domain-pagination">
          <span>Showing {rows.length ? ((meta.page - 1) * meta.limit) + 1 : 0}–{Math.min(meta.page * meta.limit, meta.total)} of {meta.total.toLocaleString()}</span>
          <div>
            <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
            <span>Page {meta.page} of {meta.totalPages}</span>
            <button type="button" disabled={page >= meta.totalPages || loading} onClick={() => setPage((current) => Math.min(meta.totalPages, current + 1))}>Next</button>
          </div>
        </footer>
      </section>

      <DomainModal
        open={modal.open}
        mode={modal.mode}
        domain={modal.domain}
        busy={saving}
        onClose={closeModal}
        onSave={saveDomain}
      />
    </div>
  );
}