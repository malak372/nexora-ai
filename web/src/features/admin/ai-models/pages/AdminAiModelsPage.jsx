import {
  Activity,
  ArrowDown,
  ArrowUp,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleOff,
  Cpu,
  DatabaseZap,
  Eye,
  Gauge,
  KeyRound,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Star,
  Trash2,
  TriangleAlert,
  X,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { adminApi, getApiErrorMessage } from '../../shared/api/adminApi';
import '../../shared/styles/admin-pages.css';
import '../styles/admin-ai-models.css';

const PAGE_SIZE = 20;

const SORT_OPTIONS = [
  { key: 'priority', label: 'Priority' },
  { key: 'modelName', label: 'Model name' },
  { key: 'providerKey', label: 'Provider' },
  { key: 'healthStatus', label: 'Health status' },
  { key: 'updatedAt', label: 'Last updated' },
  { key: 'createdAt', label: 'Created date' },
];

const HEALTH_OPTIONS = [
  { key: '', label: 'All health states' },
  { key: 'HEALTHY', label: 'Healthy' },
  { key: 'DEGRADED', label: 'Degraded' },
  { key: 'UNKNOWN', label: 'Unknown' },
  { key: 'UNAVAILABLE', label: 'Unavailable' },
];

const STATUS_FILTERS = [
  { key: 'all', label: 'All models' },
  { key: 'active', label: 'Active' },
  { key: 'inactive', label: 'Inactive' },
  { key: 'default', label: 'Default' },
];

const EMPTY_FORM = {
  providerKey: '',
  modelName: '',
  apiModelId: '',
  displayName: '',
  description: '',
  priority: 0,
  weight: 1,
  maxOutputTokens: 2048,
  contextWindow: '',
  inputCostPerMillion: 0,
  outputCostPerMillion: 0,
  supportsJsonOutput: true,
  supportsTools: false,
  supportsVision: false,
  isActive: true,
};

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unwrapRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!isObject(payload)) return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.models)) return payload.models;
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
    Number(source.totalPages ?? source.pages ?? Math.ceil(total / Math.max(1, limit))) || 1,
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

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function compactNumber(value) {
  const number = numberValue(value);
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(number % 1_000_000 === 0 ? 0 : 1)}M`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(number % 1_000 === 0 ? 0 : 1)}K`;
  return number.toLocaleString();
}

function providerInitial(model) {
  const source = model?.providerKey || model?.displayName || model?.modelName || 'AI';
  return String(source).trim().charAt(0).toUpperCase() || 'A';
}

function healthTone(status) {
  switch (String(status || '').toUpperCase()) {
    case 'HEALTHY':
      return 'healthy';
    case 'DEGRADED':
      return 'degraded';
    case 'UNAVAILABLE':
      return 'unavailable';
    default:
      return 'unknown';
  }
}

function healthLabel(status) {
  const value = String(status || 'UNKNOWN').toUpperCase();
  return value.charAt(0) + value.slice(1).toLowerCase();
}

function statusParams(filter) {
  if (filter === 'active') return { isActive: true };
  if (filter === 'inactive') return { isActive: false };
  if (filter === 'default') return { isDefault: true };
  return {};
}

function toNullableNumber(value) {
  if (value === '' || value === null || value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function formFromModel(model) {
  return {
    providerKey: model?.providerKey || '',
    modelName: model?.modelName || '',
    apiModelId: model?.apiModelId || '',
    displayName: model?.displayName || '',
    description: model?.description || '',
    priority: numberValue(model?.priority),
    weight: numberValue(model?.weight, 1),
    maxOutputTokens: numberValue(model?.maxOutputTokens, 2048),
    contextWindow: model?.contextWindow ?? '',
    inputCostPerMillion: numberValue(model?.inputCostPerMillion),
    outputCostPerMillion: numberValue(model?.outputCostPerMillion),
    supportsJsonOutput: Boolean(model?.supportsJsonOutput),
    supportsTools: Boolean(model?.supportsTools),
    supportsVision: Boolean(model?.supportsVision),
    isActive: Boolean(model?.isActive),
  };
}

function formToPayload(form, creating) {
  const payload = {
    providerKey: String(form.providerKey || '').trim(),
    modelName: String(form.modelName || '').trim(),
    apiModelId: String(form.apiModelId || '').trim(),
    displayName: String(form.displayName || '').trim() || undefined,
    description: String(form.description || '').trim() || undefined,
    priority: numberValue(form.priority),
    weight: Math.max(1, numberValue(form.weight, 1)),
    maxOutputTokens: Math.max(1, numberValue(form.maxOutputTokens, 2048)),
    contextWindow: toNullableNumber(form.contextWindow),
    inputCostPerMillion: Math.max(0, numberValue(form.inputCostPerMillion)),
    outputCostPerMillion: Math.max(0, numberValue(form.outputCostPerMillion)),
    supportsJsonOutput: Boolean(form.supportsJsonOutput),
    supportsTools: Boolean(form.supportsTools),
    supportsVision: Boolean(form.supportsVision),
  };

  if (creating) payload.isActive = Boolean(form.isActive);
  if (payload.contextWindow === undefined) delete payload.contextWindow;
  return payload;
}

function MetricCard({ icon: Icon, label, value, hint, tone = '' }) {
  return (
    <article className={`admin-model-metric ${tone}`}>
      <i aria-hidden="true" />
      <span className="admin-model-metric__icon"><Icon size={19} /></span>
      <div>
        <small>{label}</small>
        <strong>{Number(value || 0).toLocaleString()}</strong>
        <span>{hint}</span>
      </div>
    </article>
  );
}

function SelectMenu({
  label,
  value,
  options,
  onChange,
  icon: Icon = ChevronDown,
  className = '',
  compact = false,
}) {
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
    <div className={`admin-model-select ${compact ? 'is-compact' : ''} ${open ? 'is-open' : ''} ${className}`} ref={rootRef}>
      <button
        type="button"
        className="admin-model-select__trigger"
        onClick={() => setOpen((currentOpen) => !currentOpen)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {!compact && <Icon size={15} />}
        <span>
          {!compact && <small>{label}</small>}
          <strong>{current?.label || label}</strong>
        </span>
        <ChevronDown size={14} />
      </button>

      {open && (
        <div className="admin-model-select__menu" role="listbox">
          {options.map((option) => (
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
              {value === option.key && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SortPicker({ value, order, onChange, onToggleOrder }) {
  const options = SORT_OPTIONS;
  const current = options.find((option) => option.key === value) || options[0];
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
    <div className={`admin-model-sort ${open ? 'is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="admin-model-sort__trigger"
        onClick={() => setOpen((currentOpen) => !currentOpen)}
      >
        <Gauge size={15} />
        <span>
          <small>Sort models</small>
          <strong>{current.label}</strong>
        </span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="admin-model-sort__menu">
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
      <button
        type="button"
        className="admin-model-sort__direction"
        title={order === 'asc' ? 'Ascending' : 'Descending'}
        onClick={onToggleOrder}
      >
        {order === 'asc' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
      </button>
    </div>
  );
}

function CapabilityChip({ active, icon: Icon, label }) {
  return (
    <span className={`admin-model-capability ${active ? 'is-on' : 'is-off'}`}>
      <Icon size={12} />
      {label}
    </span>
  );
}

function SwitchCard({ checked, onChange, title, description, icon: Icon, disabled = false }) {
  return (
    <button
      type="button"
      className={`admin-model-switch ${checked ? 'is-on' : ''} ${disabled ? 'is-disabled' : ''}`}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
    >
      <span className="admin-model-switch__icon"><Icon size={17} /></span>
      <span className="admin-model-switch__copy">
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <span className="admin-model-switch__track" aria-hidden="true">
        <i />
      </span>
    </button>
  );
}

function FormField({ label, hint, children, wide = false }) {
  return (
    <label className={`admin-model-field ${wide ? 'is-wide' : ''}`}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function ModelEditor({
  mode,
  model,
  providers,
  busy,
  onClose,
  onSave,
  onToggleActive,
  onSetDefault,
  onRequestDelete,
}) {
  const [form, setForm] = useState(() => (mode === 'create' ? { ...EMPTY_FORM } : formFromModel(model)));
  const creating = mode === 'create';

  useEffect(() => {
    setForm(creating ? { ...EMPTY_FORM } : formFromModel(model));
  }, [creating, model]);

  const providerOptions = useMemo(
    () => providers.map((provider) => ({
      key: provider.key,
      label: provider.displayName || provider.key,
    })),
    [providers],
  );

  useEffect(() => {
    if (creating && !form.providerKey && providerOptions[0]?.key) {
      setForm((current) => ({ ...current, providerKey: providerOptions[0].key }));
    }
  }, [creating, form.providerKey, providerOptions]);

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const submit = (event) => {
    event.preventDefault();
    onSave(formToPayload(form, creating));
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="admin-model-modal-layer" role="presentation">
      <div className="admin-model-modal-backdrop" onMouseDown={onClose} />
      <section
        className="admin-model-modal"
        role="dialog"
        aria-modal="true"
        aria-label={creating ? 'Add AI model' : `Manage ${model?.displayName || model?.modelName || 'AI model'}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="admin-model-modal__header">
          <div className="admin-model-modal__mark">
            <BrainCircuit size={22} />
          </div>
          <div>
            <small>{creating ? 'MODEL REGISTRATION' : 'MODEL OPERATIONS'}</small>
            <h2>{creating ? 'Add AI model' : model?.displayName || model?.modelName}</h2>
            <p>
              {creating
                ? 'Register a model that can participate in Voxidence AI routing.'
                : 'Update routing, capabilities, cost metadata and operational state.'}
            </p>
          </div>
          <button type="button" className="admin-model-modal__close" onClick={onClose} aria-label="Close">
            <X size={19} />
          </button>
        </header>

        <form className="admin-model-modal__body" onSubmit={submit}>
          <section className="admin-model-form-section">
            <div className="admin-model-form-section__heading">
              <span><KeyRound size={16} /></span>
              <div>
                <small>IDENTITY & PROVIDER</small>
                <h3>Model connection</h3>
              </div>
            </div>

            <div className="admin-model-form-grid">
              <FormField label="Provider">
                <SelectMenu
                  compact
                  value={form.providerKey}
                  options={providerOptions.length ? providerOptions : [{ key: '', label: 'No providers available' }]}
                  onChange={(value) => update('providerKey', value)}
                />
              </FormField>

              <FormField label="Internal model name">
                <input
                  value={form.modelName}
                  onChange={(event) => update('modelName', event.target.value)}
                  placeholder="Gemini 3.6 Flash"
                  maxLength={100}
                  required
                />
              </FormField>

              <FormField label="API model ID" wide>
                <input
                  value={form.apiModelId}
                  onChange={(event) => update('apiModelId', event.target.value)}
                  placeholder="google/gemini-3.6-flash"
                  maxLength={200}
                  required
                />
              </FormField>

              <FormField label="Display name">
                <input
                  value={form.displayName}
                  onChange={(event) => update('displayName', event.target.value)}
                  placeholder="Admin-facing display name"
                  maxLength={100}
                />
              </FormField>

              <FormField label="Description">
                <input
                  value={form.description}
                  onChange={(event) => update('description', event.target.value)}
                  placeholder="What this model is best used for"
                  maxLength={500}
                />
              </FormField>
            </div>
          </section>

          <section className="admin-model-form-section">
            <div className="admin-model-form-section__heading">
              <span><Gauge size={16} /></span>
              <div>
                <small>ROUTING & LIMITS</small>
                <h3>Execution policy</h3>
              </div>
            </div>

            <div className="admin-model-form-grid admin-model-form-grid--four">
              <FormField label="Priority" hint="Higher values are preferred first.">
                <input
                  type="number"
                  min="0"
                  max="10000"
                  value={form.priority}
                  onChange={(event) => update('priority', event.target.value)}
                />
              </FormField>
              <FormField label="Routing weight" hint="Used by balanced routing.">
                <input
                  type="number"
                  min="1"
                  max="10000"
                  value={form.weight}
                  onChange={(event) => update('weight', event.target.value)}
                />
              </FormField>
              <FormField label="Max output tokens">
                <input
                  type="number"
                  min="1"
                  max="1000000"
                  value={form.maxOutputTokens}
                  onChange={(event) => update('maxOutputTokens', event.target.value)}
                />
              </FormField>
              <FormField label="Context window">
                <input
                  type="number"
                  min="1"
                  max="10000000"
                  value={form.contextWindow}
                  onChange={(event) => update('contextWindow', event.target.value)}
                  placeholder="Optional"
                />
              </FormField>
            </div>
          </section>

          <section className="admin-model-form-section">
            <div className="admin-model-form-section__heading">
              <span><DatabaseZap size={16} /></span>
              <div>
                <small>CAPABILITIES & COST</small>
                <h3>Runtime profile</h3>
              </div>
            </div>

            <div className="admin-model-switch-grid">
              <SwitchCard
                checked={form.supportsJsonOutput}
                onChange={(value) => update('supportsJsonOutput', value)}
                icon={ShieldCheck}
                title="JSON output"
                description="Provider-native structured output"
              />
              <SwitchCard
                checked={form.supportsTools}
                onChange={(value) => update('supportsTools', value)}
                icon={Zap}
                title="Tool calls"
                description="Functions and provider tools"
              />
              <SwitchCard
                checked={form.supportsVision}
                onChange={(value) => update('supportsVision', value)}
                icon={Eye}
                title="Vision"
                description="Image and visual input"
              />
              {creating && (
                <SwitchCard
                  checked={form.isActive}
                  onChange={(value) => update('isActive', value)}
                  icon={Activity}
                  title="Active on creation"
                  description="Allow routing after registration"
                />
              )}
            </div>

            <div className="admin-model-form-grid admin-model-form-grid--costs">
              <FormField label="Input cost / 1M tokens">
                <div className="admin-model-money-input">
                  <span>$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.000001"
                    value={form.inputCostPerMillion}
                    onChange={(event) => update('inputCostPerMillion', event.target.value)}
                  />
                </div>
              </FormField>
              <FormField label="Output cost / 1M tokens">
                <div className="admin-model-money-input">
                  <span>$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.000001"
                    value={form.outputCostPerMillion}
                    onChange={(event) => update('outputCostPerMillion', event.target.value)}
                  />
                </div>
              </FormField>
            </div>
          </section>

          {!creating && (
            <section className="admin-model-form-section admin-model-form-section--operations">
              <div className="admin-model-form-section__heading">
                <span><Activity size={16} /></span>
                <div>
                  <small>OPERATIONAL CONTROLS</small>
                  <h3>Routing state</h3>
                </div>
              </div>

              <div className="admin-model-operation-grid">
                <article className={`admin-model-operation ${model?.isActive ? 'is-live' : 'is-paused'}`}>
                  <div>
                    <span className="admin-model-operation__icon"><Activity size={17} /></span>
                    <div>
                      <strong>{model?.isActive ? 'Model is active' : 'Model is inactive'}</strong>
                      <small>{model?.isActive ? 'Eligible for runtime routing.' : 'Excluded from runtime routing.'}</small>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="admin-model-operation__button"
                    disabled={busy || (model?.isDefault && model?.isActive)}
                    title={model?.isDefault && model?.isActive ? 'Choose another default model first.' : ''}
                    onClick={() => onToggleActive(model)}
                  >
                    {model?.isActive ? <CircleOff size={15} /> : <CheckCircle2 size={15} />}
                    {model?.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                </article>

                <article className={`admin-model-operation ${model?.isDefault ? 'is-default' : ''}`}>
                  <div>
                    <span className="admin-model-operation__icon"><Star size={17} /></span>
                    <div>
                      <strong>{model?.isDefault ? 'System default' : 'Not the default'}</strong>
                      <small>The default model is tried first by default routing.</small>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="admin-model-operation__button"
                    disabled={busy || model?.isDefault || !model?.isActive || model?.healthStatus === 'UNAVAILABLE'}
                    onClick={() => onSetDefault(model)}
                  >
                    <Star size={15} />
                    {model?.isDefault ? 'Current default' : 'Set default'}
                  </button>
                </article>

                <article className="admin-model-operation is-danger">
                  <div>
                    <span className="admin-model-operation__icon"><Trash2 size={17} /></span>
                    <div>
                      <strong>Remove model</strong>
                      <small>Historical execution logs remain preserved.</small>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="admin-model-operation__button is-danger"
                    disabled={busy || model?.isDefault}
                    title={model?.isDefault ? 'The default model cannot be deleted.' : ''}
                    onClick={() => onRequestDelete(model)}
                  >
                    <Trash2 size={15} />
                    Delete
                  </button>
                </article>
              </div>
            </section>
          )}

          <footer className="admin-model-modal__footer">
            <div>
              {!creating && (
                <span className="admin-model-modal__updated">
                  Last updated {formatDate(model?.updatedAt)}
                </span>
              )}
            </div>
            <div className="admin-model-modal__actions">
              <button type="button" className="admin-model-button is-quiet" onClick={onClose} disabled={busy}>
                <X size={15} />
                Cancel
              </button>
              <button type="submit" className="admin-model-button is-primary" disabled={busy}>
                {busy ? <LoaderCircle className="admin-model-spin" size={16} /> : <Save size={16} />}
                <span>
                  <strong>{creating ? 'Add model' : 'Save changes'}</strong>
                  <small>{creating ? 'Register configuration' : 'Update configuration'}</small>
                </span>
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>,
    document.body,
  );
}

function DeleteDialog({ model, busy, onClose, onConfirm }) {
  if (!model || typeof document === 'undefined') return null;

  return createPortal(
    <div className="admin-model-confirm-layer" role="presentation">
      <div className="admin-model-confirm-backdrop" onMouseDown={onClose} />
      <section className="admin-model-confirm" role="alertdialog" aria-modal="true" aria-label="Delete AI model">
        <span className="admin-model-confirm__icon"><TriangleAlert size={23} /></span>
        <small>PERMANENT MODEL REMOVAL</small>
        <h3>Delete {model.displayName || model.modelName}?</h3>
        <p>
          The configuration will be removed from routing. Historical AI logs and generated candidate records
          stay preserved and are detached from this configuration.
        </p>
        <div className="admin-model-confirm__note">
          <ShieldCheck size={16} />
          <span>The current system default can never be deleted. Select another default first.</span>
        </div>
        <footer>
          <button type="button" className="admin-model-button is-quiet" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="admin-model-button is-danger" onClick={onConfirm} disabled={busy}>
            {busy ? <LoaderCircle className="admin-model-spin" size={16} /> : <Trash2 size={16} />}
            Delete model
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

export default function AdminAiModelsPage() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: PAGE_SIZE, totalPages: 1 });
  const [summary, setSummary] = useState({});
  const [providers, setProviders] = useState([]);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [providerKey, setProviderKey] = useState('');
  const [healthStatus, setHealthStatus] = useState('');
  const [sortBy, setSortBy] = useState('priority');
  const [sortOrder, setSortOrder] = useState('desc');

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [editor, setEditor] = useState(null);
  const [editorModel, setEditorModel] = useState(null);
  const [deleteModel, setDeleteModel] = useState(null);
  const [mutationBusy, setMutationBusy] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 280);
    return () => window.clearTimeout(timer);
  }, [search]);

  const params = useMemo(
    () => ({
      page,
      limit: PAGE_SIZE,
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...statusParams(statusFilter),
      ...(providerKey ? { providerKey } : {}),
      ...(healthStatus ? { healthStatus } : {}),
      sortBy,
      sortOrder,
    }),
    [page, debouncedSearch, statusFilter, providerKey, healthStatus, sortBy, sortOrder],
  );

  const load = useCallback(async ({ fresh = false, silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError('');

    try {
      const listLoader = fresh && adminApi.aiModels.listFresh
        ? adminApi.aiModels.listFresh
        : adminApi.aiModels.list;
      const summaryLoader = fresh && adminApi.aiModels.summaryFresh
        ? adminApi.aiModels.summaryFresh
        : adminApi.aiModels.summary;

      const [listResult, summaryResult, providerResult] = await Promise.all([
        listLoader(params),
        summaryLoader(),
        adminApi.aiModels.providers(),
      ]);

      const nextRows = unwrapRows(listResult);
      setRows(nextRows);
      setMeta(unwrapMeta(listResult, nextRows.length));
      setSummary(unwrapSummary(summaryResult));
      setProviders(Array.isArray(providerResult) ? providerResult : unwrapRows(providerResult));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Could not load AI models.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [params]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(''), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const refresh = async () => {
    setRefreshing(true);
    await load({ fresh: true, silent: true });
  };

  const openCreate = () => {
    setEditorModel(null);
    setEditor('create');
  };

  const openEdit = async (model) => {
    setEditorModel(model);
    setEditor('edit');
    try {
      const detail = await adminApi.aiModels.detail(model.id);
      setEditorModel(detail?.data || detail || model);
    } catch {
      // The list record already contains every editable field.
    }
  };

  const closeEditor = () => {
    if (mutationBusy) return;
    setEditor(null);
    setEditorModel(null);
  };

  const runMutation = async (operation, successMessage, { close = false } = {}) => {
    setMutationBusy(true);
    setError('');
    try {
      const result = await operation();
      setNotice(successMessage);
      await load({ fresh: true, silent: true });
      if (close) {
        setEditor(null);
        setEditorModel(null);
      } else if (result && editorModel?.id) {
        setEditorModel(result?.data || result);
      }
      return result;
    } catch (mutationError) {
      setError(getApiErrorMessage(mutationError, 'The AI model change could not be saved.'));
      return null;
    } finally {
      setMutationBusy(false);
    }
  };

  const saveEditor = async (payload) => {
    if (editor === 'create') {
      const created = await runMutation(
        () => adminApi.aiModels.create(payload),
        'AI model added to the registry.',
        { close: true },
      );
      return created;
    }

    return runMutation(
      () => adminApi.aiModels.update(editorModel.id, payload),
      'AI model configuration updated.',
    );
  };

  const toggleActive = async (model) => {
    const activating = !model.isActive;
    const result = await runMutation(
      () => activating ? adminApi.aiModels.activate(model.id) : adminApi.aiModels.deactivate(model.id),
      activating ? 'AI model activated.' : 'AI model deactivated.',
    );
    if (result) setEditorModel(result?.data || result);
  };

  const setDefault = async (model) => {
    const result = await runMutation(
      () => adminApi.aiModels.setDefault(model.id),
      `${model.displayName || model.modelName} is now the default model.`,
    );
    if (result) setEditorModel(result?.data || result);
  };

  const confirmDelete = async () => {
    if (!deleteModel) return;
    const target = deleteModel;
    const result = await runMutation(
      () => adminApi.aiModels.remove(target.id),
      `${target.displayName || target.modelName} was removed from the model registry.`,
      { close: true },
    );
    if (result) setDeleteModel(null);
  };

  const providerOptions = useMemo(
    () => [
      { key: '', label: 'All providers' },
      ...providers.map((provider) => ({
        key: provider.key,
        label: provider.displayName || provider.key,
      })),
    ],
    [providers],
  );

  const total = numberValue(summary.totalModels, meta.total);
  const active = numberValue(summary.activeModels);
  const defaultCount = numberValue(summary.defaultModels);
  const attention = numberValue(summary.degradedModels) + numberValue(summary.unavailableModels);

  return (
    <div className="admin-model-page">
      <section className="admin-model-hero">
        <div>
          <span className="admin-model-eyebrow"><BrainCircuit size={16} /> MODEL OPERATIONS</span>
          <h1>AI model registry</h1>
          <p>Control provider models, routing priority, runtime capabilities and activation from one operational workspace.</p>
        </div>
        <div className="admin-model-hero__actions">
          <button type="button" className="admin-model-button is-quiet" onClick={refresh} disabled={refreshing}>
            <RefreshCw className={refreshing ? 'admin-model-spin' : ''} size={16} />
            Refresh
          </button>
          <button type="button" className="admin-model-button is-primary is-single-line" onClick={openCreate}>
            <Plus size={17} />
            Add model
          </button>
        </div>
      </section>

      {error && (
        <div className="admin-model-alert is-error">
          <TriangleAlert size={16} />
          <span>{error}</span>
          <button type="button" onClick={() => setError('')}><X size={14} /></button>
        </div>
      )}

      {notice && (
        <div className="admin-model-alert is-success">
          <CheckCircle2 size={16} />
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')}><X size={14} /></button>
        </div>
      )}

      <section className="admin-model-directory">
        <header className="admin-model-directory__header">
          <div>
            <small>MODEL REGISTRY</small>
            <h2>Configured models</h2>
            <p>{meta.total.toLocaleString()} matching {meta.total === 1 ? 'model' : 'models'}</p>
          </div>
          <span className="admin-model-live"><i /> Runtime registry</span>
        </header>

        <div className="admin-model-metrics">
          <MetricCard icon={BrainCircuit} label="Total models" value={total} hint="Registered configurations" />
          <MetricCard icon={Activity} label="Active" value={active} hint="Eligible for routing" tone="is-green" />
          <MetricCard icon={Star} label="Default" value={defaultCount} hint="Default-first routing" tone="is-mint" />
          <MetricCard icon={TriangleAlert} label="Needs attention" value={attention} hint="Degraded or unavailable" tone="is-rose" />
        </div>

        <div className="admin-model-status-tabs">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              className={statusFilter === filter.key ? 'is-active' : ''}
              onClick={() => {
                setStatusFilter(filter.key);
                setPage(1);
              }}
            >
              {filter.label}
              {filter.key === 'all' && <span>{total}</span>}
              {filter.key === 'active' && <span>{active}</span>}
              {filter.key === 'inactive' && <span>{numberValue(summary.inactiveModels)}</span>}
              {filter.key === 'default' && <span>{defaultCount}</span>}
            </button>
          ))}
        </div>

        <div className="admin-model-toolbar">
          <SelectMenu
            label="Provider"
            value={providerKey}
            options={providerOptions}
            onChange={(value) => {
              setProviderKey(value);
              setPage(1);
            }}
            icon={Cpu}
          />

          <SelectMenu
            label="Health"
            value={healthStatus}
            options={HEALTH_OPTIONS}
            onChange={(value) => {
              setHealthStatus(value);
              setPage(1);
            }}
            icon={Activity}
          />

          <SortPicker
            value={sortBy}
            order={sortOrder}
            onChange={(value) => {
              setSortBy(value);
              setPage(1);
            }}
            onToggleOrder={() => {
              setSortOrder((current) => current === 'asc' ? 'desc' : 'asc');
              setPage(1);
            }}
          />

          <label className="admin-model-search">
            <Search size={17} />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search model, provider or API model ID..."
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="Clear search">
                <X size={14} />
              </button>
            )}
          </label>
        </div>

        <div className="admin-model-card-shell">
          {loading ? (
            <div className="admin-model-state">
              <LoaderCircle className="admin-model-spin" size={24} />
              <strong>Loading model registry…</strong>
            </div>
          ) : rows.length === 0 ? (
            <div className="admin-model-state">
              <BrainCircuit size={26} />
              <strong>No AI models match these filters.</strong>
              <span>Clear filters or add a new model configuration.</span>
            </div>
          ) : (
            <div className="admin-model-card-grid">
              {rows.map((model) => (
                <article className={`admin-model-registry-card ${model.isActive ? 'is-active' : 'is-inactive'}`} key={model.id}>
                  <div className="admin-model-registry-card__visual">
                    <span className="admin-model-registry-card__pattern" aria-hidden="true" />
                    <span className="admin-model-registry-card__icon"><BrainCircuit size={28} /></span>
                    <span className="admin-model-registry-card__provider-initial">{providerInitial(model)}</span>
                    <div>
                      <small>{providers.find((provider) => provider.key === model.providerKey)?.displayName || model.providerKey}</small>
                      <strong title={model.displayName || model.modelName}>{model.displayName || model.modelName}</strong>
                      <span className={`admin-model-active-label ${model.isActive ? 'is-on' : 'is-off'}`}>
                        {model.isActive ? <CheckCircle2 size={12} /> : <CircleOff size={12} />}
                        {model.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  </div>

                  <div className="admin-model-registry-card__body">
                    <div className="admin-model-registry-card__head">
                      <div>
                        <span>{model.apiModelId}</span>
                        <small>{model.modelName}</small>
                      </div>
                      <button type="button" className="admin-model-manage" onClick={() => openEdit(model)}>
                        <Pencil size={15} /> Manage
                      </button>
                    </div>

                    <div className="admin-model-registry-card__status">
                      <span className={`admin-model-health__badge is-${healthTone(model.healthStatus)}`}>
                        <i /> {healthLabel(model.healthStatus)}
                      </span>
                      {model.isDefault && <span className="admin-model-default-badge"><Star size={12} /> Default</span>}
                      <small>{numberValue(model.consecutiveFailures)} consecutive {numberValue(model.consecutiveFailures) === 1 ? 'failure' : 'failures'}</small>
                    </div>

                    <div className="admin-model-registry-card__metrics">
                      <div>
                        <small>Priority</small>
                        <strong>{numberValue(model.priority)}</strong>
                        <span><Gauge size={12} /> routing priority</span>
                      </div>
                      <div>
                        <small>Weight</small>
                        <strong>{numberValue(model.weight, 1)}</strong>
                        <span><Zap size={12} /> routing weight</span>
                      </div>
                    </div>

                    <div className="admin-model-registry-card__capabilities">
                      <div>
                        <CapabilityChip active={model.supportsJsonOutput} icon={ShieldCheck} label="JSON" />
                        <CapabilityChip active={model.supportsTools} icon={Zap} label="Tools" />
                        <CapabilityChip active={model.supportsVision} icon={Eye} label="Vision" />
                      </div>
                      <small>
                        {compactNumber(model.maxOutputTokens)} output
                        {model.contextWindow ? ` · ${compactNumber(model.contextWindow)} context` : ''}
                      </small>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <footer className="admin-model-pagination">
          <span>
            Showing {rows.length ? (meta.page - 1) * meta.limit + 1 : 0}
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

      {editor && (
        <ModelEditor
          mode={editor}
          model={editorModel}
          providers={providers}
          busy={mutationBusy}
          onClose={closeEditor}
          onSave={saveEditor}
          onToggleActive={toggleActive}
          onSetDefault={setDefault}
          onRequestDelete={setDeleteModel}
        />
      )}

      {deleteModel && (
        <DeleteDialog
          model={deleteModel}
          busy={mutationBusy}
          onClose={() => !mutationBusy && setDeleteModel(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}