import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ban, CalendarDays, Check, CirclePlus, Coins, Download, Eye, FileText, Inbox, Lightbulb, Mail, Play, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Trash2, User, UserCheck, UserX, X } from 'lucide-react';
import { adminApi, getApiErrorMessage } from '../api/adminApi';
import '../styles/admin-pages.css';

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};
const humanize = (value) => String(value ?? '—').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
const compact = (value) => {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
  if (typeof value === 'object') return value.fullName || value.name || value.email || value.title || value.key || JSON.stringify(value);
  return String(value);
};
const getPath = (obj, path) => path.split('.').reduce((acc, key) => acc?.[key], obj);
const statusClass = (value) => {
  const text = String(value || '').toUpperCase();
  if (/FAILED|REJECT|INACTIVE|DELETED|HIDDEN|ERROR|BLOCK/.test(text)) return 'admin-status admin-status--danger';
  if (/PENDING|OPEN|IN_PROGRESS|WARNING|ARCHIVED/.test(text)) return 'admin-status admin-status--warning';
  if (/ACTIVE|SUCCEEDED|RESOLVED|VERIFIED|PREMIUM|COMPLETED|APPROVED/.test(text)) return 'admin-status';
  return 'admin-status admin-status--neutral';
};


const DETAIL_LABELS = {
  id: 'Record ID', fullName: 'Full name', email: 'Email address', role: 'Role', accountStatus: 'Account plan',
  userType: 'User type', creditBalance: 'Credit balance', freeGenerationsUsed: 'Free generations used',
  freeGenerationLimit: 'Free generation limit', isActive: 'Active account', isVerified: 'Verified email',
  createdAt: 'Created', updatedAt: 'Last updated', title: 'Title', generationType: 'Generation type',
  isUnlocked: 'Unlocked', selectedRegion: 'Region', requestType: 'Operation', provider: 'Provider', model: 'Model',
  isSuccess: 'Success', responseTimeMs: 'Response time', costEstimate: 'Estimated cost', status: 'Status',
  sourceKey: 'Source', region: 'Region', language: 'Language', country: 'Country', city: 'City',
};

const detailLabel = (key) => DETAIL_LABELS[key] || humanize(key);
const isDateKey = (key) => /(?:At|Date|Timestamp)$/i.test(key);
const isStatusKey = (key) => /status|role|type|verified|active|success|unlocked|default/i.test(key);

function DetailValue({ name, value }) {
  if (value === null || value === undefined || value === '') return <span className="admin-detail-empty">Not available</span>;
  if (Array.isArray(value)) return <span className="admin-detail-count">{value.length} {value.length === 1 ? 'record' : 'records'}</span>;
  if (typeof value === 'object') return <span>{compact(value)}</span>;
  if (typeof value === 'boolean' || isStatusKey(name)) return <span className={statusClass(value)}>{typeof value === 'boolean' ? (value ? 'Yes' : 'No') : humanize(value)}</span>;
  if (isDateKey(name)) return <span>{formatDate(value)}</span>;
  if (/responseTimeMs/i.test(name)) return <span>{compact(value)} ms</span>;
  if (/costEstimate/i.test(name)) return <span>${Number(value || 0).toFixed(4)}</span>;
  return <span>{compact(value)}</span>;
}

function DetailGrid({ data, fields }) {
  const available = fields.filter((key) => data?.[key] !== undefined);
  if (!available.length) return null;
  return <div className="admin-detail-grid">{available.map((key) => <div className="admin-detail-field" key={key}><small>{detailLabel(key)}</small><div><DetailValue name={key} value={data[key]}/></div></div>)}</div>;
}

function RecordDetail({ section, data }) {
  const counts = data?._count || {};
  const initials = String(data?.fullName || data?.email || data?.title || 'R').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  if (section === 'users') return <div className="admin-record-detail">
    <div className="admin-record-identity">
      <div className="admin-record-avatar">{initials}</div>
      <div className="admin-record-identity__copy"><span>User profile</span><h4>{data.fullName || 'Unnamed user'}</h4><p>{data.email || 'No email available'}</p><div className="admin-record-badges"><span className={statusClass(data.role)}>{humanize(data.role)}</span><span className={statusClass(data.accountStatus)}>{humanize(data.accountStatus)}</span>{data.isVerified && <span className="admin-status">Verified</span>}</div></div>
    </div>
    <div className="admin-record-metrics">
      <article><Coins size={18}/><div><small>Credits</small><strong>{compact(data.creditBalance ?? 0)}</strong></div></article>
      <article><Sparkles size={18}/><div><small>Free generations</small><strong>{compact(data.freeGenerationsUsed ?? 0)} / {compact(data.freeGenerationLimit ?? 0)}</strong></div></article>
      <article><Lightbulb size={18}/><div><small>Ideas</small><strong>{compact(counts.ideas ?? data.ideas?.length ?? 0)}</strong></div></article>
      <article><FileText size={18}/><div><small>Payments</small><strong>{compact(counts.payments ?? data.payments?.length ?? 0)}</strong></div></article>
    </div>
    <section className="admin-detail-section"><div className="admin-detail-section__title"><User size={16}/><div><h5>Account details</h5><p>Identity, permissions and current account state.</p></div></div><DetailGrid data={data} fields={['id','fullName','email','role','accountStatus','userType','isActive','isVerified','creditBalance','freeGenerationsUsed','freeGenerationLimit']}/></section>
    <section className="admin-detail-section"><div className="admin-detail-section__title"><CalendarDays size={16}/><div><h5>Timeline</h5><p>Account creation and latest update.</p></div></div><DetailGrid data={data} fields={['createdAt','updatedAt']}/></section>
  </div>;

  const presets = {
    ideas: { icon: <Lightbulb size={18}/>, label: 'Idea record', title: data?.title || 'Generated idea', fields: ['id','title','generationType','isUnlocked','selectedRegion','createdAt','updatedAt'] },
    aiMonitoring: { icon: <Sparkles size={18}/>, label: 'AI request', title: data?.requestType ? humanize(data.requestType) : 'AI request details', fields: ['id','requestType','provider','model','isSuccess','responseTimeMs','costEstimate','createdAt'] },
    collection: { icon: <FileText size={18}/>, label: 'Collection job', title: data?.status ? `${humanize(data.status)} collection` : 'Collection job', fields: ['id','status','sourceKey','region','country','city','language','createdAt','updatedAt'] },
  };
  const preset = presets[section];
  if (preset) return <div className="admin-record-detail"><div className="admin-record-identity admin-record-identity--compact"><div className="admin-record-avatar admin-record-avatar--icon">{preset.icon}</div><div className="admin-record-identity__copy"><span>{preset.label}</span><h4>{preset.title}</h4><p>Administrative record details from the backend.</p></div></div><section className="admin-detail-section"><div className="admin-detail-section__title"><FileText size={16}/><div><h5>Record information</h5><p>Structured values returned by the API.</p></div></div><DetailGrid data={data} fields={preset.fields}/></section>{Object.keys(data || {}).filter((key) => !preset.fields.includes(key) && !['_count'].includes(key) && ['string','number','boolean'].includes(typeof data[key])).length > 0 && <section className="admin-detail-section"><div className="admin-detail-section__title"><Settings2 size={16}/><div><h5>Additional information</h5><p>Other useful attributes attached to this record.</p></div></div><DetailGrid data={data} fields={Object.keys(data || {}).filter((key) => !preset.fields.includes(key) && ['string','number','boolean'].includes(typeof data[key])).slice(0, 12)}/></section>}</div>;

  const scalarKeys = Object.keys(data || {}).filter((key) => ['string','number','boolean'].includes(typeof data[key]) || data[key] == null).slice(0, 18);
  return <div className="admin-record-detail"><section className="admin-detail-section"><div className="admin-detail-section__title"><FileText size={16}/><div><h5>Record details</h5><p>Structured information returned by the backend.</p></div></div><DetailGrid data={data || {}} fields={scalarKeys}/></section></div>;
}

const configs = {
  users: { title: 'Users', eyebrow: 'Identity & access', description: 'Search, inspect, activate or deactivate accounts, trigger password recovery and safely soft-delete users.', api: adminApi.users, columns: [['fullName','User'],['email','Email'],['role','Role'],['accountStatus','Plan'],['isActive','Active'],['isVerified','Verified'],['creditBalance','Credits'],['createdAt','Joined']], export: true },
  ideas: { title: 'Ideas', eyebrow: 'Idea intelligence', description: 'Inspect every generated idea, generation type, owner, domain and unlock state across the platform.', api: adminApi.ideas, columns: [['title','Idea'],['user.fullName','Owner'],['domain.name','Domain'],['generationType','Generation'],['isUnlocked','Unlocked'],['selectedRegion','Region'],['createdAt','Created']], export: true },
  payments: { title: 'Payments', eyebrow: 'Revenue operations', description: 'Monitor checkout activity, payment purposes, providers, credit purchases, failures and refunds.', api: adminApi.payments, columns: [['user.fullName','User'],['amount','Amount'],['currency','Currency'],['paymentPurpose','Purpose'],['providerKey','Provider'],['paymentMethodKey','Method'],['status','Status'],['createdAt','Created']], export: true },
  credits: { title: 'Credits', eyebrow: 'Credit ledger', description: 'Audit credit movements, view balances and perform administrator-authorized manual adjustments.', api: adminApi.credits, columns: [['user.fullName','User'],['type','Type'],['amount','Amount'],['balanceAfter','Balance after'],['description','Description'],['createdAt','Created']], export: true, create: 'credit' },
  domains: { title: 'Domains', eyebrow: 'Discovery taxonomy', description: 'Manage software domains and their discovery vocabulary used throughout idea generation.', api: adminApi.domains, columns: [['name','Domain'],['isActive','Active'],['ideasCount','Ideas'],['createdAt','Created']], create: 'domain' },
  comments: { title: 'Community comments', eyebrow: 'Signal corpus', description: 'Inspect collected community comments that feed evidence extraction and discovery analytics.', api: adminApi.comments, columns: [['content','Comment'],['authorName','Author'],['sourceKey','Source'],['sentiment','Sentiment'],['language','Language'],['createdAt','Collected']] },
  feedback: { title: 'Feedback & ratings', eyebrow: 'Community quality', description: 'Review publication feedback and rating activity from the product community.', api: adminApi.feedback, columns: [['user.fullName','User'],['publication.idea.title','Publication'],['comment','Feedback'],['rating','Rating'],['createdAt','Created']], tabs: ['comments','ratings'], export: true },
  complaints: { title: 'Complaints', eyebrow: 'Support operations', description: 'Triage incoming complaints, change status and priority, and record administrator resolutions.', api: adminApi.complaints, columns: [['subject','Subject'],['user.fullName','User'],['category','Category'],['priority','Priority'],['status','Status'],['createdAt','Created']], update: 'complaint', export: true },
  contactMessages: { title: 'Contact inbox', eyebrow: 'Inbound messages', description: 'Central inbox for contact requests with status tracking and internal administrative notes.', api: adminApi.contactMessages, columns: [['name','Sender'],['email','Email'],['subject','Subject'],['status','Status'],['createdAt','Received']], update: 'contact', export: true },
  publicationReports: { title: 'Publication reports', eyebrow: 'Moderation queue', description: 'Review user-submitted publication reports and execute moderation decisions from the same queue.', api: adminApi.publicationReports, columns: [['publication.idea.title','Publication'],['reporter.fullName','Reporter'],['reason','Reason'],['status','Status'],['createdAt','Reported']], update: 'report' },
  alerts: { title: 'Alerts', eyebrow: 'Communication center', description: 'Broadcast in-app alerts or targeted email communication using the platform alert infrastructure.', api: adminApi.alerts, columns: [['title','Title'],['type','Type'],['audience','Audience'],['status','Status'],['createdAt','Created']], create: 'alert' },
  dataSources: { title: 'Data sources', eyebrow: 'Collection infrastructure', description: 'Create, configure, activate and synchronize the external sources powering evidence discovery.', api: adminApi.dataSources, columns: [['displayName','Source'],['key','Key'],['implementationState','Implementation'],['isActive','Active'],['updatedAt','Updated']], create: 'source', sync: true },
  aiModels: { title: 'AI models', eyebrow: 'Model routing', description: 'Control model inventory, provider mapping, activation and the default model used by the AI layer.', api: adminApi.aiModels, columns: [['modelName','Model'],['providerKey','Provider'],['apiModelId','API model ID'],['isDefault','Default'],['isActive','Active'],['updatedAt','Updated']], create: 'model' },
  aiMonitoring: { title: 'AI monitoring', eyebrow: 'AI observability', description: 'Inspect request logs, operation traces, success rates, latency, token usage and estimated costs.', api: adminApi.aiMonitoring, columns: [['requestType','Operation'],['provider','Provider'],['model','Model'],['isSuccess','Success'],['responseTimeMs','Latency ms'],['costEstimate','Cost'],['createdAt','Created']], export: true },
  authAudit: { title: 'Auth security', eyebrow: 'Authentication audit', description: 'Inspect authentication security events and account access activity recorded by the backend.', api: adminApi.authAudit, columns: [['action','Event'],['user.email','User'],['ipAddress','IP'],['userAgent','Client'],['createdAt','Created']] },
  auditLogs: { title: 'Audit trail', eyebrow: 'Accountability', description: 'Immutable operational trail for administrator actions and sensitive system changes.', api: adminApi.auditLogs, columns: [['action','Action'],['user.fullName','Actor'],['entityType','Entity'],['entityId','Entity ID'],['ipAddress','IP'],['createdAt','Created']], export: true },
  collection: { title: 'Data collection', eyebrow: 'Evidence ingestion', description: 'Run and observe collection jobs, then inspect collected posts and comments from the evidence pipeline.', api: adminApi.collection, columns: [['id','Record ID'],['status','Status'],['domain.name','Domain'],['sourceKey','Source'],['region','Region'],['createdAt','Created']], create: 'collection', tabs: ['jobs','posts','comments'] },
};

function Modal({ title, subtitle, children, onClose, onSubmit, busy, submitLabel = 'Save changes', tone = 'default', wide = false }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [busy, onClose]);

  return createPortal(
    <div
      className="admin-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}
    >
      <section className={`admin-modal ${wide ? 'admin-modal--wide' : ''} ${tone === 'danger' ? 'admin-modal--danger' : ''}`}>
        <header className="admin-modal__head">
          <div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div>
          <button className="admin-mini-btn" onClick={onClose} disabled={busy} aria-label="Close dialog"><X size={15}/></button>
        </header>
        <div className="admin-modal__body">{children}</div>
        <footer className="admin-modal__foot">
          <button className="admin-btn" onClick={onClose} disabled={busy}>Cancel</button>
          {onSubmit && <button className="admin-btn admin-btn--primary" disabled={busy} onClick={onSubmit}>{busy ? 'Working…' : submitLabel}</button>}
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function Summary({ value }) {
  if (!value || typeof value !== 'object') return null;
  const entries = Object.entries(value).filter(([,v]) => ['string','number','boolean'].includes(typeof v)).slice(0, 10);
  if (!entries.length) return null;
  return <div className="admin-summary-strip">{entries.map(([key,val]) => <article key={key}><small>{humanize(key)}</small><strong>{compact(val)}</strong></article>)}</div>;
}

function extractRows(payload, section, tab) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const likely = [section, tab, 'items','records','results','data','users','ideas','payments','transactions','domains','comments','ratings','complaints','messages','reports','alerts','dataSources','models','logs','auditLogs','jobs','history'];
  for (const key of likely) if (Array.isArray(payload[key])) return payload[key];
  return Object.values(payload).find(Array.isArray) || [];
}
function extractPagination(payload) { return payload?.pagination || payload?.meta || { page: payload?.page, totalPages: payload?.totalPages, total: payload?.total }; }

export default function AdminResourcePage({ section }) {
  const config = configs[section];
  const [payload, setPayload] = useState(null); const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [query, setQuery] = useState(''); const [page, setPage] = useState(1); const [tab, setTab] = useState(config?.tabs?.[0] || '');
  const [modal, setModal] = useState(null); const [form, setForm] = useState({}); const [busy, setBusy] = useState(false); const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    if (!config) return; setLoading(true); setError('');
    const params = { page, limit: 20, ...(query ? { search: query } : {}) };
    try {
      const listPromise = config.api.list ? config.api.list(params, tab) : Promise.resolve([]);
      const summaryPromise = config.api.summary ? config.api.summary(params).catch(() => null) : Promise.resolve(null);
      const [list, sum] = await Promise.all([listPromise, summaryPromise]); setPayload(list); setSummary(sum);
    } catch (e) { setError(getApiErrorMessage(e, `Could not load ${config.title.toLowerCase()}.`)); } finally { setLoading(false); }
  }, [config, page, query, tab]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const handler = (e) => { setQuery(e.detail || ''); setPage(1); }; window.addEventListener('voxidence:admin-search', handler); return () => window.removeEventListener('voxidence:admin-search', handler); }, []);

  const rows = useMemo(() => extractRows(payload, section, tab), [payload, section, tab]);
  const pagination = extractPagination(payload);
  const totalPages = Number(pagination?.totalPages || pagination?.pages || 1);

  const toast = (message) => { setNotice(message); window.setTimeout(() => setNotice(''), 3200); };
  const openForm = (type, row = null) => {
    const next = row ? { ...row } : {};
    if ((type === 'domainEdit' || type === 'domain') && Array.isArray(next.keywords)) {
      next.keywords = next.keywords.map((item) => item?.keyword || item).filter(Boolean).join(', ');
      next.keywordLanguage = row?.keywords?.[0]?.language || 'EN';
    }
    if ((type === 'sourceEdit' || type === 'source') && next.configuration && typeof next.configuration === 'object') {
      next.configurationText = JSON.stringify(next.configuration, null, 2);
    }
    setForm(next);
    setModal({ type, row });
  };
  const set = (key) => (e) => setForm((old) => ({ ...old, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const perform = async (fn, success) => {
    setBusy(true); setError('');
    try { await fn(); setModal(null); toast(success); await load(); } catch (e) { setError(getApiErrorMessage(e, 'The administrative action failed.')); } finally { setBusy(false); }
  };

  const primaryCreate = () => openForm(config.create);
  const exportCsv = async () => {
    if (!config.api.exportCsv) return;
    setExporting(true); setError('');
    try {
      const params = query ? { search: query } : {};
      if (section === 'feedback') await config.api.exportCsv(tab, params);
      else await config.api.exportCsv(params);
      toast('CSV export downloaded.');
    } catch (e) { setError(getApiErrorMessage(e, 'CSV export failed.')); }
    finally { setExporting(false); }
  };

  const openDetail = async (id, detailApi = config.api.detail) => {
    if (!id || !detailApi) return;
    setBusy(true); setError('');
    try {
      const detail = await detailApi(id);
      setForm(detail || {});
      setModal({ type: 'view', row: detail || {} });
    } catch (e) { setError(getApiErrorMessage(e, 'Could not load record details.')); }
    finally { setBusy(false); }
  };

  const openConfirm = ({ row, title, message, submitLabel, action, success, tone = 'default' }) => {
    setModal({ type: 'confirmAction', row, title, message, submitLabel, action, success, tone });
  };

  const rowActions = (row) => {
    const id = row.id || row.ideaId || row.publicationId;
    if (section === 'users') return <>
      <button title="View user" className="admin-mini-btn" onClick={() => openDetail(id)}><Eye size={14}/></button>
      <button title={row.isActive ? 'Deactivate user' : 'Activate user'} className="admin-mini-btn" onClick={() => openConfirm({ row, title: row.isActive ? 'Deactivate this user?' : 'Activate this user?', message: row.isActive ? 'The user will no longer be able to use protected platform features until reactivated.' : 'The user will regain access to the platform according to their current role and plan.', submitLabel: row.isActive ? 'Deactivate user' : 'Activate user', action: () => config.api.status(id, !row.isActive), success: `User ${row.isActive ? 'deactivated' : 'activated'}.`, tone: row.isActive ? 'danger' : 'default' })}>{row.isActive ? <UserX size={14}/> : <UserCheck size={14}/>}</button>
      <button title="Send password reset" className="admin-mini-btn" onClick={() => openConfirm({ row, title: 'Send password reset?', message: `A password reset message will be sent to ${row.email || 'this user'}.`, submitLabel: 'Send reset email', action: () => config.api.resetPassword(id), success: 'Password reset email sent.' })}><Mail size={14}/></button>
      <button title="Soft delete user" className="admin-mini-btn" onClick={() => openForm('deleteUser', row)}><Trash2 size={14}/></button>
    </>;
    if (section === 'ideas' || section === 'aiMonitoring') return <button className="admin-mini-btn" title="View details" onClick={() => openDetail(id)}><Eye size={14}/></button>;
    if (section === 'collection') { if (tab !== 'jobs') return null; return <><button className="admin-mini-btn" title="View details" onClick={() => openDetail(id)}><Eye size={14}/></button>{/RUNNING|PENDING|PROCESSING/i.test(String(row.status||''))&&<button className="admin-mini-btn" title="Stop job" onClick={() => openConfirm({ row, title: 'Stop this collection job?', message: 'No new content will be collected after the backend stops this active job.', submitLabel: 'Stop collection', action: () => config.api.stop(id), success: 'Collection job stopped.', tone: 'danger' })}><Ban size={14}/></button>}</>; }
    if (section === 'domains') return <><button className="admin-mini-btn" title="Edit domain" onClick={() => openForm('domainEdit', row)}><Settings2 size={14}/></button><button className="admin-mini-btn" title="Deactivate domain" onClick={() => openForm('deleteDomain', row)}><Ban size={14}/></button></>;
    if (section === 'complaints') return <button title="Review complaint" className="admin-mini-btn" onClick={() => openForm('complaint', row)}><ShieldCheck size={14}/></button>;
    if (section === 'contactMessages') return <button title="Process message" className="admin-mini-btn" onClick={() => openForm('contact', row)}><Inbox size={14}/></button>;
    if (section === 'publicationReports') return <button title="Review report" className="admin-mini-btn" onClick={() => openForm('report', row)}><ShieldCheck size={14}/></button>;
    if (section === 'dataSources') return <><button className="admin-mini-btn" title="Edit source" onClick={() => openForm('sourceEdit', row)}><Settings2 size={14}/></button><button className="admin-mini-btn" title={row.isActive ? 'Deactivate source' : 'Activate source'} onClick={() => openConfirm({ row, title: `${row.isActive ? 'Deactivate' : 'Activate'} this data source?`, message: row.isActive ? 'New collection runs will no longer use this source while it is inactive.' : 'The source will become available to eligible collection runs.', submitLabel: row.isActive ? 'Deactivate source' : 'Activate source', action: () => config.api.status(id, !row.isActive), success: `Data source ${row.isActive ? 'deactivated' : 'activated'}.`, tone: row.isActive ? 'danger' : 'default' })}>{row.isActive ? <Ban size={14}/> : <Check size={14}/>}</button></>;
    if (section === 'aiModels') return <><button className="admin-mini-btn" title="Edit model" onClick={() => openForm('modelEdit', row)}><Settings2 size={14}/></button><button className="admin-mini-btn" title={row.isDefault ? 'Current default model' : 'Set default'} disabled={Boolean(row.isDefault)} onClick={() => openConfirm({ row, title: 'Set as default AI model?', message: `${row.displayName || row.modelName || 'This model'} will become the default model selected by the AI routing layer.`, submitLabel: 'Set as default', action: () => config.api.setDefault(id), success: 'Default AI model updated.' })}><Check size={14}/></button><button className="admin-mini-btn" title={row.isActive ? 'Deactivate model' : 'Activate model'} onClick={() => openConfirm({ row, title: `${row.isActive ? 'Deactivate' : 'Activate'} this AI model?`, message: row.isActive ? 'The routing layer will stop selecting this model for new requests.' : 'The model will become eligible for routing according to its configured priority and weight.', submitLabel: row.isActive ? 'Deactivate model' : 'Activate model', action: () => row.isActive ? config.api.deactivate(id) : config.api.activate(id), success: `Model ${row.isActive ? 'deactivated' : 'activated'}.`, tone: row.isActive ? 'danger' : 'default' })}>{row.isActive ? <Ban size={14}/> : <Play size={14}/>}</button></>;
    return null;
  };

  const parseConfiguration = () => {
    if (!form.configurationText?.trim()) return undefined;
    try { return JSON.parse(form.configurationText); }
    catch { throw new Error('Configuration must be valid JSON.'); }
  };

  const submitModal = () => {
    const type = modal?.type; const row = modal?.row; const id = row?.id || row?.publicationId;
    if (type === 'credit') return perform(() => config.api.adjust({ userId: form.userId, amount: Number(form.amount), description: form.reason }), 'Credit balance adjusted.');
    if (type === 'domain') return perform(() => config.api.create({ name: form.name, isActive: true, keywords: form.keywords ? form.keywords.split(',').map((x) => x.trim()).filter(Boolean).map((keyword) => ({ keyword, language: form.keywordLanguage || 'EN' })) : undefined }), 'Domain created.');
    if (type === 'domainEdit') return perform(() => config.api.update(id, { name: form.name, isActive: typeof form.isActive === 'boolean' ? form.isActive : undefined, keywords: form.keywords ? form.keywords.split(',').map((x) => x.trim()).filter(Boolean).map((keyword) => ({ keyword, language: form.keywordLanguage || 'EN' })) : undefined }), 'Domain updated.');
    if (type === 'deleteDomain') return perform(() => config.api.remove(id), 'Domain deactivated.');
    if (type === 'deleteUser') return perform(() => config.api.remove(id), 'User soft-deleted.');
    if (type === 'complaint') return perform(() => config.api.update(id, { status: form.status, priority: form.priority, adminReply: form.adminResponse || undefined }), 'Complaint updated.');
    if (type === 'contact') return perform(() => config.api.update(id, { status: form.status, adminReply: form.adminNotes || undefined }), 'Contact message updated.');
    if (type === 'report') return perform(async () => { await config.api.review(id, { status: form.status, adminNote: form.adminNotes || undefined }); if (form.moderationAction && form.moderationAction !== 'NONE') { const pub = row.publicationId || row.publication?.id; if (pub) { if (form.moderationAction === 'HIDE') await adminApi.publications.hide(pub, (form.adminNotes || `Reviewed ${row.reason || 'publication report'}`).trim()); if (form.moderationAction === 'RESTORE') await adminApi.publications.restore(pub); if (form.moderationAction === 'ARCHIVE') await adminApi.publications.archive(pub, (form.adminNotes || `Reviewed ${row.reason || 'publication report'}`).trim()); } } }, 'Publication report reviewed.');
    if (type === 'alert') return perform(() => (form.channel === 'EMAIL' ? config.api.email({ subject: form.title, message: form.message, userId: form.userId || undefined }) : config.api.create({ title: form.title, message: form.message, type: form.alertType || 'SYSTEM', userId: form.userId || undefined })), 'Alert sent.');
    if (type === 'source') return perform(() => config.api.create({ displayName: form.name, key: form.key, description: form.description || undefined, isActive: form.isActive !== false, supportsPosts: Boolean(form.supportsPosts), supportsComments: Boolean(form.supportsComments), supportsRegion: Boolean(form.supportsRegion), supportsLanguage: Boolean(form.supportsLanguage), configuration: parseConfiguration() }), 'Data source created.');
    if (type === 'sourceEdit') return perform(() => config.api.update(id, { displayName: form.displayName || form.name, description: form.description || undefined, supportsPosts: Boolean(form.supportsPosts), supportsComments: Boolean(form.supportsComments), supportsRegion: Boolean(form.supportsRegion), supportsLanguage: Boolean(form.supportsLanguage), configuration: parseConfiguration() }), 'Data source updated.');
    if (type === 'model') return perform(() => config.api.create({ modelName: form.name, providerKey: form.provider, apiModelId: form.modelKey, displayName: form.displayName || undefined, description: form.description || undefined, priority: form.priority === '' || form.priority == null ? undefined : Number(form.priority), weight: form.weight === '' || form.weight == null ? undefined : Number(form.weight), maxOutputTokens: form.maxOutputTokens === '' || form.maxOutputTokens == null ? undefined : Number(form.maxOutputTokens), supportsJsonOutput: Boolean(form.supportsJsonOutput), supportsTools: Boolean(form.supportsTools), supportsVision: Boolean(form.supportsVision), contextWindow: form.contextWindow === '' || form.contextWindow == null ? undefined : Number(form.contextWindow), inputCostPerMillion: form.inputCostPerMillion === '' || form.inputCostPerMillion == null ? undefined : Number(form.inputCostPerMillion), outputCostPerMillion: form.outputCostPerMillion === '' || form.outputCostPerMillion == null ? undefined : Number(form.outputCostPerMillion), isActive: form.isActive !== false }), 'AI model created.');
    if (type === 'modelEdit') return perform(() => config.api.update(id, { modelName: form.modelName || form.name, providerKey: form.providerKey || form.provider, apiModelId: form.apiModelId || form.modelKey, displayName: form.displayName || undefined, description: form.description || undefined, priority: form.priority === '' || form.priority == null ? undefined : Number(form.priority), weight: form.weight === '' || form.weight == null ? undefined : Number(form.weight), maxOutputTokens: form.maxOutputTokens === '' || form.maxOutputTokens == null ? undefined : Number(form.maxOutputTokens), supportsJsonOutput: Boolean(form.supportsJsonOutput), supportsTools: Boolean(form.supportsTools), supportsVision: Boolean(form.supportsVision), contextWindow: form.contextWindow === '' || form.contextWindow == null ? undefined : Number(form.contextWindow), inputCostPerMillion: form.inputCostPerMillion === '' || form.inputCostPerMillion == null ? undefined : Number(form.inputCostPerMillion), outputCostPerMillion: form.outputCostPerMillion === '' || form.outputCostPerMillion == null ? undefined : Number(form.outputCostPerMillion) }), 'AI model updated.');
    if (type === 'collection') return perform(() => config.api.run({ domainId: form.domainId, language: form.language || 'EN', country: form.country || undefined, city: form.city || undefined, region: form.region || undefined, radiusKm: form.radiusKm ? Number(form.radiusKm) : undefined, dataSourceKeys: form.dataSourceKeys ? form.dataSourceKeys.split(',').map((x) => x.trim()).filter(Boolean) : undefined, keywords: form.keywords ? form.keywords.split(',').map((x) => x.trim()).filter(Boolean) : undefined }), 'Collection job started.');
  };

  if (!config) return <div className="admin-error">Unknown admin section.</div>;
  return <div className="admin-page">
    <section className="admin-hero"><div className="admin-hero__eyebrow"><ShieldCheck size={14}/> {config.eyebrow}</div><h2>{config.title}</h2><p>{config.description}</p></section>
    {error && <div className="admin-error">{error}</div>}{notice && <div className="admin-status" style={{padding:'10px 13px',borderRadius:12}}>{notice}</div>}
    <section className="admin-panel">
      <header className="admin-panel__head"><div><h3>{config.title} workspace</h3><p>Live data from the administrative API</p></div><div className="admin-toolbar">
        {config.sync && <button className="admin-btn" onClick={() => perform(config.api.synchronize, 'Data sources synchronized.')}><RefreshCw size={13}/> Synchronize</button>}
        {config.export && <button className="admin-btn" onClick={exportCsv} disabled={exporting}><Download size={13}/> {exporting ? 'Exporting…' : 'Export CSV'}</button>}
        {config.create && <button className="admin-btn admin-btn--primary" onClick={primaryCreate}><CirclePlus size={13}/> {config.create === 'credit' ? 'Adjust credits' : config.create === 'alert' ? 'New alert' : 'Create new'}</button>}
      </div></header>
      <Summary value={summary}/>
      <div className="admin-filterbar"><div className="admin-searchbox"><Search size={14}/><input value={query} onChange={(e) => {setQuery(e.target.value);setPage(1);}} placeholder={`Search ${config.title.toLowerCase()}…`}/></div>{config.tabs && <div className="admin-tabs">{config.tabs.map((item) => <button key={item} onClick={() => {setTab(item);setPage(1);}} className={`admin-tab ${tab === item ? 'is-active':''}`}>{humanize(item)}</button>)}</div>}<button className="admin-btn" onClick={load}><RefreshCw size={13}/> Refresh</button></div>
      {loading ? <div className="admin-loading"><div className="admin-spinner"/></div> : rows.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr>{config.columns.map(([,label]) => <th key={label}>{label}</th>)}<th style={{textAlign:'right'}}>Actions</th></tr></thead><tbody>{rows.map((row,index) => <tr key={row.id || index}>{config.columns.map(([path,label]) => { const value = getPath(row,path); const statusLike = /status|active|verified|unlocked|default|success|role|plan|generation|priority/i.test(label); const dateLike = /created|updated|joined|received|collected|started/i.test(label); return <td key={path}>{statusLike ? <span className={statusClass(value)}>{humanize(value)}</span> : dateLike ? formatDate(value) : <strong>{compact(value)}</strong>}</td>;})}<td><div className="admin-table__actions">{rowActions(row) || <span style={{color:'#a3aea9'}}>—</span>}</div></td></tr>)}</tbody></table></div> : <div className="admin-empty"><Inbox size={28}/><h4>No records found</h4><p>Try another filter or refresh the workspace.</p></div>}
      <div className="admin-pagination"><span>Page {page}{pagination?.total ? ` · ${pagination.total} total` : ''}</span><div className="admin-toolbar"><button className="admin-btn" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1,p-1))}>Previous</button><button className="admin-btn" disabled={page >= totalPages} onClick={() => setPage((p) => p+1)}>Next</button></div></div>
    </section>

    {modal?.type === 'confirmAction' && <Modal title={modal.title} subtitle="Review the action before applying it." onClose={() => setModal(null)} onSubmit={() => perform(modal.action, modal.success)} busy={busy} submitLabel={modal.submitLabel || 'Confirm'} tone={modal.tone}><div className={`admin-action-review ${modal.tone === 'danger' ? 'admin-action-review--danger' : ''}`}><div className="admin-action-review__icon">{modal.tone === 'danger' ? <ShieldCheck size={20}/> : <Check size={20}/>}</div><div><strong>{modal.row?.fullName || modal.row?.displayName || modal.row?.modelName || modal.row?.name || modal.row?.email || 'Selected record'}</strong><p>{modal.message}</p></div></div></Modal>}
    {modal?.type === 'view' && <Modal title={section === 'users' ? 'User details' : section === 'ideas' ? 'Idea details' : section === 'aiMonitoring' ? 'AI request details' : section === 'collection' ? 'Collection job details' : 'Record details'} subtitle="A clear view of the information stored for this record." onClose={() => setModal(null)} wide><RecordDetail section={section} data={form}/></Modal>}
    {modal?.type === 'credit' && <Modal title="Adjust user credits" onClose={() => setModal(null)} onSubmit={submitModal} busy={busy} submitLabel="Apply adjustment"><div className="admin-form-grid"><div className="admin-field admin-field--wide"><label>User ID</label><input value={form.userId||''} onChange={set('userId')} placeholder="User UUID"/></div><div className="admin-field"><label>Amount</label><input type="number" value={form.amount||''} onChange={set('amount')} placeholder="e.g. 10 or -5"/></div><div className="admin-field admin-field--wide"><label>Reason</label><textarea value={form.reason||''} onChange={set('reason')} placeholder="Administrative adjustment reason"/></div></div></Modal>}
    {(modal?.type === 'domain' || modal?.type === 'domainEdit') && <Modal title={modal.type==='domain'?'Create domain':'Edit domain'} onClose={() => setModal(null)} onSubmit={submitModal} busy={busy}><div className="admin-form-grid"><div className="admin-field"><label>Name</label><input value={form.name||form.displayName||''} onChange={set('name')}/></div><div className="admin-field admin-field--wide"><label>Keywords (comma-separated)</label><input value={form.keywords||''} onChange={set('keywords')}/></div><div className="admin-field"><label>Keyword language</label><select value={form.keywordLanguage||'EN'} onChange={set('keywordLanguage')}><option>EN</option><option>AR</option><option>FR</option><option>ES</option><option>DE</option><option>TR</option></select></div></div></Modal>}
    {(modal?.type === 'deleteDomain' || modal?.type === 'deleteUser') && <Modal title={modal.type === 'deleteUser' ? 'Remove this user?' : 'Deactivate this domain?'} subtitle={modal.type === 'deleteUser' ? 'This performs a soft delete and keeps the audit trail intact.' : 'The domain will stop being available for active discovery flows.'} onClose={() => setModal(null)} onSubmit={submitModal} busy={busy} submitLabel={modal.type === 'deleteUser' ? 'Remove user' : 'Deactivate domain'} tone="danger"><div className="admin-confirm-card"><div className="admin-confirm-card__icon"><Trash2 size={20}/></div><div><strong>{modal.row?.fullName || modal.row?.name || modal.row?.email || 'Selected record'}</strong><p>This action is handled by the backend safety rules and will be recorded in the administrator audit trail.</p></div></div></Modal>}
    {modal?.type === 'complaint' && <Modal title="Update complaint" onClose={() => setModal(null)} onSubmit={submitModal} busy={busy}><div className="admin-form-grid"><div className="admin-field"><label>Status</label><select value={form.status||'OPEN'} onChange={set('status')}><option>OPEN</option><option>IN_PROGRESS</option><option>RESOLVED</option><option>REJECTED</option></select></div><div className="admin-field"><label>Priority</label><select value={form.priority||'MEDIUM'} onChange={set('priority')}><option>LOW</option><option>MEDIUM</option><option>HIGH</option></select></div><div className="admin-field admin-field--wide"><label>Admin response</label><textarea value={form.adminResponse||''} onChange={set('adminResponse')}/></div></div></Modal>}
    {modal?.type === 'contact' && <Modal title="Process contact message" onClose={() => setModal(null)} onSubmit={submitModal} busy={busy}><div className="admin-form-grid"><div className="admin-field"><label>Status</label><select value={form.status||'NEW'} onChange={set('status')}><option>NEW</option><option>IN_PROGRESS</option><option>REPLIED</option><option>CLOSED</option></select></div><div className="admin-field admin-field--wide"><label>Admin reply</label><textarea value={form.adminNotes||''} onChange={set('adminNotes')}/></div></div></Modal>}
    {modal?.type === 'report' && <Modal title="Review publication report" onClose={() => setModal(null)} onSubmit={submitModal} busy={busy}><div className="admin-form-grid"><div className="admin-field"><label>Review status</label><select value={form.status||'PENDING'} onChange={set('status')}><option>PENDING</option><option>REVIEWING</option><option>RESOLVED</option><option>DISMISSED</option></select></div><div className="admin-field"><label>Moderation action</label><select value={form.moderationAction||'NONE'} onChange={set('moderationAction')}><option>NONE</option><option>HIDE</option><option>RESTORE</option><option>ARCHIVE</option></select></div><div className="admin-field admin-field--wide"><label>Admin notes / moderation reason</label><textarea value={form.adminNotes||''} onChange={set('adminNotes')}/></div></div></Modal>}
    {modal?.type === 'alert' && <Modal title="Create alert" onClose={() => setModal(null)} onSubmit={submitModal} busy={busy} submitLabel="Send"><div className="admin-form-grid"><div className="admin-field"><label>Channel</label><select value={form.channel||'IN_APP'} onChange={set('channel')}><option value="IN_APP">In-app</option><option value="EMAIL">Email</option></select></div><div className="admin-field"><label>Type</label><select value={form.alertType||'SYSTEM'} onChange={set('alertType')}><option>SYSTEM</option><option>PAYMENT</option><option>CREDIT_LOW</option><option>CREDIT_EXHAUSTED</option><option>ADMIN</option></select></div><div className="admin-field admin-field--wide"><label>Title / subject</label><input value={form.title||''} onChange={set('title')}/></div><div className="admin-field admin-field--wide"><label>Message</label><textarea value={form.message||''} onChange={set('message')}/></div><div className="admin-field admin-field--wide"><label>Recipient user ID <span>(optional — blank broadcasts)</span></label><input value={form.userId||''} onChange={set('userId')} placeholder="User UUID or leave blank for broadcast"/></div></div></Modal>}
    {(modal?.type === 'source' || modal?.type === 'sourceEdit') && <Modal title={modal.type === 'source' ? 'Create data source' : 'Edit data source'} onClose={() => setModal(null)} onSubmit={submitModal} busy={busy}><div className="admin-form-grid"><div className="admin-field"><label>Name</label><input value={form.name||form.displayName||''} onChange={set('name')}/></div><div className="admin-field"><label>Key</label><input value={form.key||''} onChange={set('key')} disabled={modal.type==='sourceEdit'}/></div><div className="admin-field admin-field--wide"><label>Description</label><input value={form.description||''} onChange={set('description')}/></div><div className="admin-field"><label><input type="checkbox" checked={Boolean(form.supportsPosts)} onChange={set('supportsPosts')}/> Supports posts</label></div><div className="admin-field"><label><input type="checkbox" checked={Boolean(form.supportsComments)} onChange={set('supportsComments')}/> Supports comments</label></div><div className="admin-field"><label><input type="checkbox" checked={Boolean(form.supportsRegion)} onChange={set('supportsRegion')}/> Supports region</label></div><div className="admin-field"><label><input type="checkbox" checked={Boolean(form.supportsLanguage)} onChange={set('supportsLanguage')}/> Supports language</label></div><div className="admin-field"><label><input type="checkbox" checked={form.isActive !== false} onChange={set('isActive')} disabled={modal.type==='sourceEdit'}/> Active on creation</label></div><div className="admin-field admin-field--wide"><label>Non-secret configuration (JSON)</label><textarea value={form.configurationText||''} onChange={set('configurationText')} placeholder='{"example":"value"}'/></div></div></Modal>}
    {(modal?.type === 'model' || modal?.type === 'modelEdit') && <Modal title={modal.type === 'model' ? 'Register AI model' : 'Edit AI model'} onClose={() => setModal(null)} onSubmit={submitModal} busy={busy}><div className="admin-form-grid"><div className="admin-field"><label>Name</label><input value={form.name||form.modelName||''} onChange={set('name')}/></div><div className="admin-field"><label>Provider</label><select value={form.provider||form.providerKey||'google'} onChange={set('provider')}><option value="google">Google</option><option value="openrouter">OpenRouter</option></select></div><div className="admin-field admin-field--wide"><label>Provider model ID</label><input value={form.modelKey||form.apiModelId||''} onChange={set('modelKey')} placeholder="Exact API model identifier"/></div><div className="admin-field"><label>Display name</label><input value={form.displayName||''} onChange={set('displayName')}/></div><div className="admin-field"><label>Priority</label><input type="number" value={form.priority??''} onChange={set('priority')}/></div><div className="admin-field"><label>Weight</label><input type="number" min="1" value={form.weight??''} onChange={set('weight')}/></div><div className="admin-field"><label>Max output tokens</label><input type="number" min="1" value={form.maxOutputTokens??''} onChange={set('maxOutputTokens')}/></div><div className="admin-field"><label>Context window</label><input type="number" min="1" value={form.contextWindow??''} onChange={set('contextWindow')}/></div><div className="admin-field"><label>Input cost / 1M</label><input type="number" step="0.000001" min="0" value={form.inputCostPerMillion??''} onChange={set('inputCostPerMillion')}/></div><div className="admin-field"><label>Output cost / 1M</label><input type="number" step="0.000001" min="0" value={form.outputCostPerMillion??''} onChange={set('outputCostPerMillion')}/></div><div className="admin-field admin-field--wide"><label>Description</label><textarea value={form.description||''} onChange={set('description')}/></div><div className="admin-field"><label><input type="checkbox" checked={Boolean(form.supportsJsonOutput)} onChange={set('supportsJsonOutput')}/> JSON output</label></div><div className="admin-field"><label><input type="checkbox" checked={Boolean(form.supportsTools)} onChange={set('supportsTools')}/> Tools</label></div><div className="admin-field"><label><input type="checkbox" checked={Boolean(form.supportsVision)} onChange={set('supportsVision')}/> Vision</label></div>{modal.type==='model'&&<div className="admin-field"><label><input type="checkbox" checked={form.isActive !== false} onChange={set('isActive')}/> Active on creation</label></div>}</div></Modal>}

    {modal?.type === 'collection' && <Modal title="Start data collection" onClose={() => setModal(null)} onSubmit={submitModal} busy={busy} submitLabel="Start collection"><div className="admin-form-grid"><div className="admin-field admin-field--wide"><label>Domain ID</label><input value={form.domainId||''} onChange={set('domainId')} placeholder="Domain UUID"/></div><div className="admin-field"><label>Language</label><select value={form.language||'EN'} onChange={set('language')}><option>ANY</option><option>EN</option><option>AR</option><option>FR</option><option>ES</option><option>DE</option><option>TR</option></select></div><div className="admin-field"><label>Region</label><input value={form.region||''} onChange={set('region')}/></div><div className="admin-field"><label>Country</label><input value={form.country||''} onChange={set('country')}/></div><div className="admin-field"><label>City</label><input value={form.city||''} onChange={set('city')}/></div><div className="admin-field"><label>Radius (km)</label><input type="number" min="1" value={form.radiusKm||''} onChange={set('radiusKm')}/></div><div className="admin-field admin-field--wide"><label>Data source keys (comma-separated)</label><input value={form.dataSourceKeys||''} onChange={set('dataSourceKeys')} placeholder="youtube, github, dev-to"/></div><div className="admin-field admin-field--wide"><label>Custom keywords (comma-separated)</label><input value={form.keywords||''} onChange={set('keywords')}/></div></div></Modal>}
  </div>;
}