/**
 * Administrator data-source management page for the web application.
 *
 * Supports the existing create, edit, activation, synchronization, filtering,
 * and listing flows, plus safe data-source deletion from the table actions and management dialog.
 *
 * @author Eman
 */
import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleOff,
  Database,
  FileText,
  KeyRound,
  Languages,
  LoaderCircle,
  MapPin,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { adminApi, getApiErrorMessage } from '../../shared/api/adminApi';
import '../../shared/styles/admin-pages.css';
import '../styles/admin-data-sources.css';

const PAGE_SIZE = 20;

const SORT_OPTIONS = [
  { key: 'displayName', label: 'Display name' },
  { key: 'key', label: 'Registry key' },
  { key: 'updatedAt', label: 'Last updated' },
  { key: 'createdAt', label: 'Created date' },
];

const FILTER_OPTIONS = [
  { key: 'all', label: 'All sources' },
  { key: 'available', label: 'Available' },
  { key: 'active', label: 'Active' },
  { key: 'inactive', label: 'Inactive' },
  { key: 'implemented', label: 'Implemented' },
  { key: 'disabled', label: 'Implementation off' },
];

const EMPTY_FORM = {
  key: '',
  displayName: '',
  description: '',
  isActive: false,
  isImplemented: false,
  supportsPosts: true,
  supportsComments: false,
  supportsRegion: false,
  supportsLanguage: false,
  configurationText: '{}',
  runtimeImplemented: null,
};

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unwrapRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!isObject(payload)) return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.sources)) return payload.sources;
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
  const locale = typeof document !== 'undefined' && document.documentElement.lang === 'ar' ? 'ar' : undefined;
  return date.toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function deleteConfirmation(sourceName) {
  if (typeof document !== 'undefined' && document.documentElement.lang === 'ar') {
    return `حذف «${sourceName}»؟ يُسمح بذلك فقط عندما لا يرتبط المصدر بأي مهام جمع تاريخية أو منشورات أدلة.`;
  }
  return `Delete "${sourceName}"? This is only allowed when the source has no historical collection jobs or evidence posts.`;
}

function compactText(value, max = 72) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return 'No description provided.';
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function sourceInitial(source) {
  return String(source?.displayName || source?.key || 'D').trim().charAt(0).toUpperCase() || 'D';
}

function filterParams(filter) {
  if (filter === 'available') return { isActive: true, isImplemented: true };
  if (filter === 'active') return { isActive: true };
  if (filter === 'inactive') return { isActive: false };
  if (filter === 'implemented') return { isImplemented: true };
  if (filter === 'disabled') return { isImplemented: false };
  return {};
}

function metricValue(summary, key, fallback = 0) {
  const value = Number(summary?.[key]);
  return Number.isFinite(value) ? value : fallback;
}

function MetricCard({ icon: Icon, label, value, hint, tone = '' }) {
  return (
    <article className={`admin-ds-metric ${tone}`}>
      <i aria-hidden="true" />
      <span className="admin-ds-metric__icon"><Icon size={20} /></span>
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
    <div className={`admin-ds-sort ${open ? 'is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="admin-ds-sort__trigger"
        onClick={() => setOpen((currentOpen) => !currentOpen)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <SlidersHorizontal size={15} />
        <span><small>Sort sources</small><strong>{current.label}</strong></span>
        <ChevronDown size={14} />
      </button>

      {open && (
        <div className="admin-ds-sort__menu" role="listbox" aria-label="Sort data sources">
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
        className="admin-ds-sort__direction"
        onClick={onToggleOrder}
        title={order === 'asc' ? 'Ascending order' : 'Descending order'}
      >
        {order === 'asc' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
      </button>
    </div>
  );
}

function SwitchCard({ checked, onChange, title, description, icon: Icon, disabled = false, warning = '' }) {
  return (
    <button
      type="button"
      className={`admin-ds-switch-card ${checked ? 'is-on' : ''} ${disabled ? 'is-disabled' : ''}`}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      aria-pressed={checked}
    >
      <span className="admin-ds-switch-card__icon"><Icon size={17} /></span>
      <span className="admin-ds-switch-card__copy">
        <strong>{title}</strong>
        <small>{warning || description}</small>
      </span>
      <span className="admin-ds-switch-card__control"><i /></span>
    </button>
  );
}

function CapabilityToggle({ checked, onChange, icon: Icon, title, description }) {
  return (
    <button
      type="button"
      className={`admin-ds-capability ${checked ? 'is-on' : ''}`}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
    >
      <span><Icon size={16} /></span>
      <div><strong>{title}</strong><small>{description}</small></div>
      <i>{checked ? <Check size={12} /> : null}</i>
    </button>
  );
}

function DataSourceModal({ mode, source, onClose, onSaved }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!source) {
      setForm(EMPTY_FORM);
      return;
    }

    setForm({
      key: source.key || '',
      displayName: source.displayName || '',
      description: source.description || '',
      isActive: Boolean(source.isActive),
      isImplemented: Boolean(source.isImplemented),
      supportsPosts: source.supportsPosts !== false,
      supportsComments: Boolean(source.supportsComments),
      supportsRegion: Boolean(source.supportsRegion),
      supportsLanguage: Boolean(source.supportsLanguage),
      configurationText: JSON.stringify(source.configuration || {}, null, 2),
      runtimeImplemented: Boolean(source.runtimeImplemented),
    });
  }, [source]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, saving]);

  const setField = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError('');
  };

  const changeImplementation = (nextValue) => {
    setForm((current) => ({
      ...current,
      isImplemented: nextValue,
      isActive: nextValue ? current.isActive : false,
    }));
    setError('');
  };

  const submit = async () => {
    setError('');

    const key = form.key.trim().toLowerCase();
    const displayName = form.displayName.trim();

    if (mode === 'create' && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)) {
      setError('Registry key must use lowercase letters, numbers and single hyphens only.');
      return;
    }

    if (displayName.length < 2) {
      setError('Display name must contain at least 2 characters.');
      return;
    }

    if (form.isActive && !form.isImplemented) {
      setError('Enable the implementation switch before activating this source.');
      return;
    }

    let configuration;
    try {
      configuration = form.configurationText.trim()
        ? JSON.parse(form.configurationText)
        : {};
      if (!isObject(configuration)) {
        setError('Configuration must be a JSON object.');
        return;
      }
    } catch {
      setError('Configuration contains invalid JSON.');
      return;
    }

    const body = {
      displayName,
      description: form.description.trim(),
      isActive: form.isActive,
      isImplemented: form.isImplemented,
      supportsPosts: form.supportsPosts,
      supportsComments: form.supportsComments,
      supportsRegion: form.supportsRegion,
      supportsLanguage: form.supportsLanguage,
      configuration,
      ...(mode === 'create' ? { key } : {}),
    };

    setSaving(true);
    try {
      if (mode === 'create') await adminApi.dataSources.create(body);
      else await adminApi.dataSources.update(source.id, body);
      await onSaved(mode === 'create' ? 'Data source added successfully.' : 'Data source updated successfully.');
      onClose();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Could not save the data source.'));
    } finally {
      setSaving(false);
    }
  };

  const editing = mode === 'edit';

  /**
   * Requests permanent deletion of the selected data source after confirmation.
   * Backend validation prevents deletion when historical records reference it.
   */
  const removeSource = async () => {
    if (!editing || saving) return;

    const sourceName = source?.displayName || source?.key || 'this data source';
    const confirmed = window.confirm(deleteConfirmation(sourceName));

    if (!confirmed) return;

    setSaving(true);
    setError('');

    try {
      await adminApi.dataSources.remove(source.id);
      await onSaved('Data source deleted successfully.');
      onClose();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Could not delete the data source.'));
    } finally {
      setSaving(false);
    }
  };

  const runtimeBlocked = editing && form.runtimeImplemented === false;

  return createPortal(
    <div className="admin-ds-modal-backdrop" role="presentation" onMouseDown={() => !saving && onClose()}>
      <section
        className="admin-ds-modal"
        role="dialog"
        aria-modal="true"
        aria-label={editing ? 'Edit data source' : 'Add data source'}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="admin-ds-modal__head">
          <div className="admin-ds-modal__identity">
            <span><Database size={20} /></span>
            <div>
              <small>{editing ? 'Data source management workspace' : 'Collection infrastructure'}</small>
              <h3>{editing ? form.displayName || 'Data source' : 'Add a new data source'}</h3>
              <p>{editing ? form.key : 'Register source metadata and control its collection availability.'}</p>
            </div>
          </div>
          <button type="button" className="admin-ds-modal__close" onClick={onClose} disabled={saving} aria-label="Close">
            <X size={19} />
          </button>
        </header>

        <div className="admin-ds-modal__body">
          <div className="admin-ds-modal__column">
            <section className="admin-ds-form-section">
              <div className="admin-ds-form-section__head">
                <span><KeyRound size={16} /></span>
                <div><small>Source identity</small><strong>Registry details</strong></div>
              </div>

              <div className="admin-ds-field-grid">
                <label className="admin-ds-field">
                  <span>Registry key</span>
                  <input
                    value={form.key}
                    onChange={(event) => setField('key', event.target.value.toLowerCase().replace(/\s+/g, '-'))}
                    placeholder="example-source"
                    disabled={editing}
                    maxLength={100}
                  />
                  <small>{editing ? 'The key is immutable because collectors reference it.' : 'Must match the backend collector sourceKey.'}</small>
                </label>

                <label className="admin-ds-field">
                  <span>Display name</span>
                  <input
                    value={form.displayName}
                    onChange={(event) => setField('displayName', event.target.value)}
                    placeholder="Example Source"
                    maxLength={150}
                  />
                </label>
              </div>

              <label className="admin-ds-field">
                <span>Description</span>
                <textarea
                  value={form.description}
                  onChange={(event) => setField('description', event.target.value)}
                  placeholder="Describe what this source collects and how it is used..."
                  maxLength={1000}
                  rows={4}
                />
                <small>{form.description.length}/1000</small>
              </label>
            </section>

            <section className="admin-ds-form-section">
              <div className="admin-ds-form-section__head">
                <span><FileText size={16} /></span>
                <div><small>Non-secret configuration</small><strong>Collector options</strong></div>
              </div>

              <label className="admin-ds-field admin-ds-field--code">
                <span>Configuration JSON</span>
                <textarea
                  value={form.configurationText}
                  onChange={(event) => setField('configurationText', event.target.value)}
                  spellCheck="false"
                  rows={8}
                />
                <small>Do not store API keys or secrets here.</small>
              </label>
            </section>
          </div>

          <div className="admin-ds-modal__column admin-ds-modal__column--operations">
            <section className="admin-ds-form-section">
              <div className="admin-ds-form-section__head">
                <span><ShieldCheck size={16} /></span>
                <div><small>Operational state</small><strong>Availability controls</strong></div>
              </div>

              {editing && (
                <div className={`admin-ds-runtime-note ${form.runtimeImplemented ? 'is-ready' : 'is-missing'}`}>
                  <span>{form.runtimeImplemented ? <CheckCircle2 size={17} /> : <CircleOff size={17} />}</span>
                  <div>
                    <strong>{form.runtimeImplemented ? 'Runtime collector detected' : 'Runtime collector unavailable'}</strong>
                    <small>
                      {form.runtimeImplemented
                        ? 'This deployment contains a collector matching the registry key.'
                        : 'Implemented and Active cannot be enabled until a matching collector is deployed.'}
                    </small>
                  </div>
                </div>
              )}

              <div className="admin-ds-switch-stack">
                <SwitchCard
                  checked={form.isImplemented}
                  onChange={changeImplementation}
                  icon={Database}
                  title="Implemented"
                  description="Allow this configured source to participate in the evidence pipeline."
                  disabled={runtimeBlocked}
                  warning={runtimeBlocked ? 'Unavailable because no runtime collector is deployed.' : ''}
                />
                <SwitchCard
                  checked={form.isActive}
                  onChange={(value) => setField('isActive', value)}
                  icon={ShieldCheck}
                  title="Active"
                  description="Expose this source to new collection and generation runs."
                  disabled={!form.isImplemented || runtimeBlocked}
                  warning={!form.isImplemented ? 'Enable Implemented first.' : runtimeBlocked ? 'Runtime collector is unavailable.' : ''}
                />
              </div>
            </section>

            <section className="admin-ds-form-section">
              <div className="admin-ds-form-section__head">
                <span><SlidersHorizontal size={16} /></span>
                <div><small>Collection capabilities</small><strong>Supported data</strong></div>
              </div>

              <div className="admin-ds-capabilities">
                <CapabilityToggle
                  checked={form.supportsPosts}
                  onChange={(value) => setField('supportsPosts', value)}
                  icon={FileText}
                  title="Posts"
                  description="Post-like records"
                />
                <CapabilityToggle
                  checked={form.supportsComments}
                  onChange={(value) => setField('supportsComments', value)}
                  icon={MessageSquare}
                  title="Comments"
                  description="Replies and reviews"
                />
                <CapabilityToggle
                  checked={form.supportsRegion}
                  onChange={(value) => setField('supportsRegion', value)}
                  icon={MapPin}
                  title="Region"
                  description="Geographic filtering"
                />
                <CapabilityToggle
                  checked={form.supportsLanguage}
                  onChange={(value) => setField('supportsLanguage', value)}
                  icon={Languages}
                  title="Language"
                  description="Language filtering"
                />
              </div>
            </section>

            {editing && (
              <section className="admin-ds-form-section admin-ds-usage-section">
                <div className="admin-ds-form-section__head">
                  <span><Database size={16} /></span>
                  <div><small>Usage snapshot</small><strong>Historical references</strong></div>
                </div>
                <div className="admin-ds-usage-grid">
                  <div><small>Collection jobs</small><strong>{Number(source?.usage?.collectionJobs || 0).toLocaleString()}</strong></div>
                  <div><small>Evidence posts</small><strong>{Number(source?.usage?.socialPosts || 0).toLocaleString()}</strong></div>
                  <div><small>Created</small><strong>{formatDate(source?.createdAt)}</strong></div>
                  <div><small>Updated</small><strong>{formatDate(source?.updatedAt)}</strong></div>
                </div>
              </section>
            )}
          </div>
        </div>

        {error && <div className="admin-ds-modal__error">{error}</div>}

        <footer className="admin-ds-modal__footer">
          <div>
            <ShieldCheck size={16} />
            <span>
              <strong>Safe source management</strong>
              <small>Activation always requires an enabled implementation and a deployed runtime collector.</small>
            </span>
          </div>
          <div className="admin-ds-modal__actions">
            {editing && (
              <button type="button" className="admin-ds-action admin-ds-action--cancel" onClick={removeSource} disabled={saving}>
                <Trash2 size={15} /> Delete
              </button>
            )}
            <button type="button" className="admin-ds-action admin-ds-action--cancel" onClick={onClose} disabled={saving}>
              <X size={15} /> Cancel
            </button>
            <button type="button" className="admin-ds-action admin-ds-action--save" onClick={submit} disabled={saving}>
              {saving ? <LoaderCircle size={16} className="admin-spin" /> : editing ? <Save size={16} /> : <Plus size={16} />}
              <span><strong>{editing ? 'Save source changes' : 'Add data source'}</strong><small>{editing ? 'Apply configuration and state' : 'Register this source'}</small></span>
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

export default function AdminDataSourcesPage() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: PAGE_SIZE, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [sortBy, setSortBy] = useState('displayName');
  const [sortOrder, setSortOrder] = useState('asc');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 280);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(''), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

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
        ...filterParams(filter),
      };

      const listLoader = fresh ? adminApi.dataSources.listFresh : adminApi.dataSources.list;
      const summaryLoader = fresh ? adminApi.dataSources.summaryFresh : adminApi.dataSources.summary;
      const listPayload = await listLoader(params);
      if (requestId !== requestIdRef.current) return;

      const nextRows = unwrapRows(listPayload);
      setRows(nextRows);
      setMeta(unwrapMeta(listPayload, nextRows.length));

      summaryLoader()
        .then((payload) => {
          if (requestId === requestIdRef.current) setSummary(unwrapSummary(payload));
        })
        .catch(() => null);
    } catch (requestError) {
      if (requestId !== requestIdRef.current) return;
      setRows([]);
      setError(getApiErrorMessage(requestError, 'Could not load data sources.'));
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [filter, page, search, sortBy, sortOrder]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const metrics = useMemo(() => ({
    total: metricValue(summary, 'total', meta.total),
    active: metricValue(summary, 'active', rows.filter((row) => row.isActive).length),
    implemented: metricValue(summary, 'implemented', rows.filter((row) => row.isImplemented).length),
    available: metricValue(summary, 'available', rows.filter((row) => row.isAvailable).length),
  }), [meta.total, rows, summary]);



  const openEdit = async (row) => {
    setError('');
    try {
      const detail = await adminApi.dataSources.detail(row.id);
      setModal({ mode: 'edit', source: isObject(detail?.data) ? detail.data : detail });
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Could not open this data source.'));
    }
  };

  /**
   * Permanently deletes a source from the table after explicit confirmation.
   * Historical-reference validation remains enforced by the backend service.
   */
  const deleteSource = async (row) => {
    if (!row?.id || deletingId) return;

    const sourceName = row.displayName || row.key || 'this data source';
    const confirmed = window.confirm(deleteConfirmation(sourceName));

    if (!confirmed) return;

    setDeletingId(row.id);
    setError('');

    try {
      await adminApi.dataSources.remove(row.id);
      setNotice('Data source deleted successfully.');
      await loadData({ quiet: true, fresh: true });
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Could not delete the data source.'));
    } finally {
      setDeletingId(null);
    }
  };

  const synchronize = async () => {
    setSyncing(true);
    setError('');
    try {
      const result = await adminApi.dataSources.synchronize();
      const count = Number(result?.updatedCount ?? result?.data?.updatedCount ?? 0) || 0;
      setNotice(count ? `${count} source state${count === 1 ? '' : 's'} synchronized.` : 'Runtime states are already synchronized.');
      await loadData({ quiet: true });
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Could not synchronize runtime states.'));
    } finally {
      setSyncing(false);
    }
  };

  const start = meta.total === 0 ? 0 : ((meta.page - 1) * meta.limit) + 1;
  const end = Math.min(meta.page * meta.limit, meta.total);

  return (
    <div className="admin-page admin-ds-page">
      <section className="admin-hero admin-ds-hero">
        <div className="admin-ds-hero__copy">
          <div className="admin-hero__eyebrow"><Database size={14} /> Collection infrastructure</div>
          <h2>Data sources</h2>
          <p>
            Configure the external evidence sources used by the collection pipeline, control availability, and keep runtime collector state visible to administrators.
          </p>
        </div>

        <div className="admin-ds-hero__visual" aria-hidden="true">
          <span className="admin-ds-hero__grid" />
          <span className="admin-ds-hero__orbit admin-ds-hero__orbit--one" />
          <span className="admin-ds-hero__orbit admin-ds-hero__orbit--two" />

          <div className="admin-ds-hero__signal-card admin-ds-hero__signal-card--chart">
            <span><FileText size={18} /></span>
            <i />
            <i />
            <i />
            <i />
          </div>

          <div className="admin-ds-hero__database-stack">
            <span className="admin-ds-hero__database-top"><Database size={34} /></span>
            <span className="admin-ds-hero__database-tier"><i /><b /></span>
            <span className="admin-ds-hero__database-tier"><i /><b /></span>
            <span className="admin-ds-hero__database-tier"><i /><b /></span>
          </div>

          <div className="admin-ds-hero__signal-card admin-ds-hero__signal-card--search"><Search size={24} /></div>
          <div className="admin-ds-hero__signal-card admin-ds-hero__signal-card--shield"><ShieldCheck size={24} /></div>

          <span className="admin-ds-hero__link admin-ds-hero__link--left" />
          <span className="admin-ds-hero__link admin-ds-hero__link--right-top" />
          <span className="admin-ds-hero__link admin-ds-hero__link--right-bottom" />
          <span className="admin-ds-hero__node admin-ds-hero__node--one" />
          <span className="admin-ds-hero__node admin-ds-hero__node--two" />
          <span className="admin-ds-hero__node admin-ds-hero__node--three" />
        </div>
      </section>

      <section className="admin-ds-panel">
        <div className="admin-ds-panel__head">
          <div>
            <span className="admin-ds-panel__kicker"><Database size={13} /> Source registry</span>
            <h3>Data sources directory</h3>
            <p>{meta.total.toLocaleString()} matching source{meta.total === 1 ? '' : 's'}</p>
          </div>

          <div className="admin-ds-panel__actions">
            <button type="button" className="admin-ds-btn admin-ds-btn--secondary" onClick={synchronize} disabled={syncing}>
              <RefreshCw size={14} className={syncing ? 'admin-spin' : ''} /> Sync runtime
            </button>
            <button type="button" className="admin-ds-btn admin-ds-btn--primary" onClick={() => setModal({ mode: 'create', source: null })}>
              <Plus size={15} /> Add source
            </button>
          </div>
        </div>

        {!loading && !error && (
          <div className="admin-ds-metrics">
            <MetricCard icon={Database} label="Total sources" value={metrics.total} hint="Configured source records" tone="is-primary" />
            <MetricCard icon={ShieldCheck} label="Active" value={metrics.active} hint="Enabled for collection" />
            <MetricCard icon={CheckCircle2} label="Implemented" value={metrics.implemented} hint="Admin implementation switch on" />
            <MetricCard icon={RefreshCw} label="Available" value={metrics.available} hint="Active, implemented and deployed" tone="is-available" />
          </div>
        )}

        <div className="admin-ds-filter-row">
          <div className="admin-ds-filter-tabs" role="tablist" aria-label="Filter data sources">
            {FILTER_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={filter === option.key ? 'is-active' : ''}
                onClick={() => {
                  setFilter(option.key);
                  setPage(1);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="admin-ds-tools">
          <SortPicker
            value={sortBy}
            order={sortOrder}
            onChange={(field) => {
              setSortBy(field);
              setSortOrder(field === 'displayName' || field === 'key' ? 'asc' : 'desc');
              setPage(1);
            }}
            onToggleOrder={() => {
              setSortOrder((current) => (current === 'asc' ? 'desc' : 'asc'));
              setPage(1);
            }}
          />

          <label className="admin-ds-search">
            <Search size={17} />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search name, key or description..."
            />
            {searchInput && (
              <button type="button" onClick={() => setSearchInput('')} aria-label="Clear search"><X size={14} /></button>
            )}
          </label>

          <button type="button" className="admin-ds-refresh" onClick={() => loadData({ quiet: true, fresh: true })} disabled={refreshing}>
            <RefreshCw size={14} className={refreshing ? 'admin-spin' : ''} /> Refresh
          </button>
        </div>

        {notice && <div className="admin-ds-notice"><CheckCircle2 size={15} /> {notice}</div>}
        {error && <div className="admin-ds-error">{error}</div>}

        <div className="admin-ds-card-shell">
          {loading ? (
            <div className="admin-ds-empty admin-ds-empty--cards"><LoaderCircle className="admin-spin" size={22} /><strong>Loading data sources…</strong></div>
          ) : !error && rows.length === 0 ? (
            <div className="admin-ds-empty admin-ds-empty--cards"><Database size={24} /><strong>No data sources match this view.</strong><span>Try another filter or add a new source.</span></div>
          ) : (
            <div className="admin-ds-card-grid">
              {rows.map((row) => (
                <article className={`admin-ds-source-card ${row.isAvailable ? 'is-available' : 'is-unavailable'}`} key={row.id}>
                  <div className="admin-ds-source-card__visual">
                    <span className="admin-ds-source-card__pattern" aria-hidden="true" />
                    <span className="admin-ds-source-card__mark">{sourceInitial(row)}</span>
                    <div className="admin-ds-source-card__visual-copy">
                      <small>Evidence source</small>
                      <strong>{row.displayName || row.key}</strong>
                      <span className={`admin-ds-source-card__availability ${row.isAvailable ? 'is-on' : 'is-off'}`}>
                        {row.isAvailable ? <CheckCircle2 size={12} /> : <CircleOff size={12} />}
                        {row.isAvailable ? 'Operational' : 'Unavailable'}
                      </span>
                    </div>
                  </div>

                  <div className="admin-ds-source-card__body">
                    <div className="admin-ds-source-card__head">
                      <div>
                        <span className="admin-ds-source-key"><KeyRound size={10} /> {row.key}</span>
                        <p>{compactText(row.description, 118)}</p>
                      </div>
                      <div className="admin-ds-source-card__actions">
                        <button
                          type="button"
                          className="admin-ds-manage"
                          onClick={() => openEdit(row)}
                          aria-label={`Manage ${row.displayName || row.key || 'data source'}`}
                          title="Manage source"
                        >
                          <Pencil size={13} /> <span>Manage</span>
                        </button>
                        <button
                          type="button"
                          className="admin-ds-delete"
                          onClick={() => deleteSource(row)}
                          disabled={deletingId === row.id}
                          aria-label={`Delete ${row.displayName || row.key || 'data source'}`}
                          title="Delete source"
                        >
                          {deletingId === row.id ? <LoaderCircle size={14} className="admin-spin" /> : <Trash2 size={13.5} />}
                          <span>Delete</span>
                        </button>
                      </div>
                    </div>

                    <div className="admin-ds-source-card__status-row">
                      <span className={row.isActive ? 'is-on' : 'is-off'}><i /> Active</span>
                      <span className={row.isImplemented ? 'is-on' : 'is-off'}><i /> Build</span>
                      <span className={row.runtimeImplemented ? 'is-on' : 'is-off'}><i /> Runtime</span>
                    </div>

                    <div className="admin-ds-source-card__details">
                      <section>
                        <small>Capabilities</small>
                        <div className="admin-ds-capability-chips">
                          {row.supportsPosts && <span title="Supports posts"><FileText size={12} /><b>Posts</b></span>}
                          {row.supportsComments && <span title="Supports comments"><MessageSquare size={12} /><b>Comments</b></span>}
                          {row.supportsRegion && <span title="Supports region filtering"><MapPin size={12} /><b>Region</b></span>}
                          {row.supportsLanguage && <span title="Supports language filtering"><Languages size={12} /><b>Language</b></span>}
                          {!row.supportsPosts && !row.supportsComments && !row.supportsRegion && !row.supportsLanguage && <em>No special capabilities</em>}
                        </div>
                      </section>

                      <section>
                        <small>Activity</small>
                        <div className="admin-ds-source-card__usage">
                          <span><strong>{Number(row?.usage?.collectionJobs || 0).toLocaleString()}</strong><small>jobs</small></span>
                          <span><strong>{Number(row?.usage?.socialPosts || 0).toLocaleString()}</strong><small>evidence</small></span>
                        </div>
                      </section>
                    </div>

                    <div className="admin-ds-source-card__footer">
                      <span><RefreshCw size={11} /> Updated {formatDate(row.updatedAt)}</span>
                      <span className={row.isAvailable ? 'is-ready' : 'is-review'}>
                        {row.isAvailable ? <CheckCircle2 size={11} /> : <CircleOff size={11} />}
                        {row.isAvailable ? 'Ready for collection' : 'Review source state'}
                      </span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <footer className="admin-ds-pagination">
          <span>{meta.total ? `Showing ${start}-${end} of ${meta.total.toLocaleString()}` : 'No records'}</span>
          <div>
            <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
            <strong>Page {meta.page} of {meta.totalPages}</strong>
            <button type="button" disabled={page >= meta.totalPages || loading} onClick={() => setPage((current) => Math.min(meta.totalPages, current + 1))}>Next</button>
          </div>
        </footer>
      </section>

      {modal && (
        <DataSourceModal
          mode={modal.mode}
          source={modal.source}
          onClose={() => setModal(null)}
          onSaved={async (message) => {
            setNotice(message);
            await loadData({ quiet: true });
          }}
        />
      )}
    </div>
  );
}