import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Database,
  FileText,
  Layers3,
  LoaderCircle,
  MapPin,
  MessageSquareText,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useUserExperience } from '../../../../system/user-experience';
import { adminApi, getApiErrorMessage } from '../../shared/api/adminApi';
import '../../shared/styles/admin-pages.css';
import '../styles/admin-collection-runs.css';

const PAGE_SIZE = 20;

const COLLECTION_DARK_ARABIC_COPY = {
  'All runs': 'كل العمليات',
  'Pending': 'قيد الانتظار',
  'Running': 'قيد التشغيل',
  'Completed': 'مكتمل',
  'Failed': 'فشل',
  'Stopped': 'متوقف',
  'Created date': 'تاريخ الإنشاء',
  'Started date': 'تاريخ البدء',
  'Completed date': 'تاريخ الإكمال',
  'Posts collected': 'المنشورات المجموعة',
  'Comments collected': 'التعليقات المجموعة',
  'Not started': 'لم يبدأ',
  'Source': 'المصدر',
  'Unknown': 'غير معروف',
  'Select': 'اختر',
  'Sort runs': 'ترتيب العمليات',
  'Ascending order': 'ترتيب تصاعدي',
  'Descending order': 'ترتيب تنازلي',
  'No sources': 'لا توجد مصادر',
  'Collection run stopped.': 'تم إيقاف عملية الجمع.',
  'Could not stop this collection run.': 'تعذر إيقاف عملية الجمع هذه.',
  'A fresh collection run was started with the same configuration.': 'تم بدء عملية جمع جديدة بالإعدادات نفسها.',
  'Could not retry this collection run.': 'تعذر إعادة تشغيل عملية الجمع هذه.',
  'Collection run inspector': 'فحص عملية الجمع',
  'Collection run': 'عملية الجمع',
  'Close': 'إغلاق',
  'Pipeline status': 'حالة خط المعالجة',
  'Collection is currently processing.': 'عملية الجمع قيد التنفيذ حاليًا.',
  'Latest persisted run state.': 'آخر حالة محفوظة للعملية.',
  'Evidence collected': 'الأدلة المجموعة',
  'Duration': 'المدة',
  'Now': 'الآن',
  'Run context': 'سياق العملية',
  'Domain, language and collection scope': 'المجال واللغة ونطاق الجمع',
  'Domain': 'المجال',
  'Language': 'اللغة',
  'English': 'الإنجليزية',
  'ENGLISH': 'الإنجليزية',
  'EN': 'الإنجليزية',
  'en': 'الإنجليزية',
  'Arabic': 'العربية',
  'ARABIC': 'العربية',
  'AR': 'العربية',
  'ar': 'العربية',
  'Started by': 'بدأها',
  'Location': 'الموقع',
  'No location restriction': 'من دون تقييد للموقع',
  'Radius': 'نطاق نصف القطر',
  'Not set': 'غير محدد',
  'Run ID': 'معرّف العملية',
  'Keywords': 'الكلمات المفتاحية',
  'Source execution': 'تنفيذ المصادر',
  'Collector-level outcomes for this run': 'نتائج التنفيذ لكل جامع بيانات في هذه العملية',
  'No source execution records are attached to this run.': 'لا توجد سجلات تنفيذ مصادر مرتبطة بهذه العملية.',
  'collector': 'جامع بيانات',
  'Created': 'تاريخ الإنشاء',
  'Last update': 'آخر تحديث',
  'Run state': 'حالة العملية',
  'Sources': 'المصادر',
  'NLP analysis': 'تحليل اللغة الطبيعية',
  'Available': 'متوفر',
  'Not attached': 'غير مرفق',
  'Failure reason': 'سبب الفشل',
  'Operational controls': 'عناصر التحكم التشغيلية',
  'Stopping affects only running collection work. Retrying creates a new run and keeps this history intact.': 'الإيقاف يؤثر فقط في عمليات الجمع الجارية. إعادة المحاولة تنشئ عملية جديدة مع إبقاء هذا السجل محفوظًا.',
  'Retry collection': 'إعادة محاولة الجمع',
  'Start a fresh run': 'بدء عملية جديدة',
  'Confirm stop': 'تأكيد الإيقاف',
  'Stop run': 'إيقاف العملية',
  'Click again to stop now': 'اضغط مرة أخرى للإيقاف الآن',
  'End active collection': 'إنهاء عملية الجمع النشطة',
  'Could not load collection runs.': 'تعذر تحميل عمليات الجمع.',
  'All data sources': 'كل مصادر البيانات',
  'Could not open collection run details.': 'تعذر فتح تفاصيل عملية الجمع.',
  'Evidence pipeline': 'مسار الأدلة',
  'Collection runs': 'عمليات الجمع',
  'Monitor evidence ingestion, inspect source-level execution, stop unhealthy active work, and retry failed collection jobs without exposing raw database fields.': 'راقب استيعاب الأدلة، وافحص التنفيذ على مستوى المصادر، وأوقف العمل النشط غير السليم، وأعد محاولة مهام الجمع الفاشلة من دون إظهار حقول قاعدة البيانات الخام.',
  'Needs attention': 'يحتاج إلى عناية',
  'Pipeline operations': 'عمليات خط المعالجة',
  'Collection operations': 'عمليات جمع البيانات',
  'matching run in this view': 'عملية مطابقة في هذا العرض',
  'matching runs in this view': 'عملية مطابقة في هذا العرض',
  'Pipeline unavailable': 'خط المعالجة غير متاح',
  'Live pipeline': 'خط أنابيب مباشر',
  'Refresh': 'تحديث',
  'Total runs': 'إجمالي العمليات',
  'pending': 'قيد الانتظار',
  'Currently collecting evidence': 'يجري جمع الأدلة حاليًا',
  'Finished successfully': 'اكتمل بنجاح',
  'failed': 'فشل',
  'stopped': 'متوقف',
  'Filter collection runs by status': 'تصفية عمليات الجمع حسب الحالة',
  'Data source': 'مصدر البيانات',
  'Search domain, source or location...': 'ابحث عن مجال أو مصدر أو موقع...',
  'Clear search': 'مسح البحث',
  'Loading collection runs…': 'جارٍ تحميل عمليات الجمع…',
  'No collection runs match this view.': 'لا توجد عمليات جمع مطابقة لهذا العرض.',
  'Try another status, data source, or search term.': 'جرّب حالة أو مصدر بيانات أو عبارة بحث أخرى.',
  'Run': 'عملية',
  'User': 'مستخدم',
  'Internal / legacy': 'داخلي / قديم',
  'ANY': 'أي لغة',
  'Domain & scope': 'المجال والنطاق',
  'Unknown domain': 'مجال غير معروف',
  'Global scope': 'نطاق عالمي',
  'Pipeline sources': 'مصادر خط المعالجة',
  'Evidence': 'الأدلة',
  'evidence records': 'سجلات أدلة',
  'collection run': 'عملية جمع',
  'posts': 'منشورات',
  'comments': 'تعليقات',
  'Timing': 'التوقيت',
  'Ended': 'انتهت',
  'Started': 'بدأت',
  'Waiting to start': 'بانتظار البدء',
  'Inspect': 'فحص',
  'Showing': 'عرض',
  'of': 'من',
  'No records': 'لا توجد سجلات',
  'Previous': 'السابق',
  'Page': 'صفحة',
  'Next': 'التالي',
  's': 'ث',
  'm': 'د',
  'h': 'س',
};

function useCollectionRunsCopy() {
  const { isArabic, t } = useUserExperience();
  const enabled = isArabic;
  const tr = useCallback(
    (value) => {
      if (!enabled || typeof value !== 'string') return value;
      return COLLECTION_DARK_ARABIC_COPY[value] ?? t(value);
    },
    [enabled, t],
  );

  return {
    darkArabic: enabled,
    locale: enabled ? 'ar' : undefined,
    tr,
  };
}


const STATUS_FILTERS = [
  { key: 'all', label: 'All runs' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'RUNNING', label: 'Running' },
  { key: 'COMPLETED', label: 'Completed' },
  { key: 'FAILED', label: 'Failed' },
  { key: 'STOPPED', label: 'Stopped' },
];

const SORT_OPTIONS = [
  { key: 'createdAt', label: 'Created date' },
  { key: 'startedAt', label: 'Started date' },
  { key: 'completedAt', label: 'Completed date' },
  { key: 'totalPosts', label: 'Posts collected' },
  { key: 'totalComments', label: 'Comments collected' },
];

const STATUS_META = {
  PENDING: { label: 'Pending', className: 'is-pending' },
  RUNNING: { label: 'Running', className: 'is-running' },
  COMPLETED: { label: 'Completed', className: 'is-completed' },
  FAILED: { label: 'Failed', className: 'is-failed' },
  STOPPED: { label: 'Stopped', className: 'is-stopped' },
};

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unwrapRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!isObject(payload)) return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.jobs)) return payload.jobs;
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

function unwrapStatus(payload) {
  const root = isObject(payload?.data) ? payload.data : payload;
  return isObject(root) ? root : {};
}

function formatDate(value, compact = false, locale) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  if (compact) {
    return date.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  return date.toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDuration(startedAt, completedAt, status, tr = (value) => value) {
  if (!startedAt) return tr('Not started');
  const start = new Date(startedAt).getTime();
  const end = completedAt
    ? new Date(completedAt).getTime()
    : status === 'RUNNING'
      ? Date.now()
      : start;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '—';

  const totalSeconds = Math.max(0, Math.floor((end - start) / 1000));
  if (totalSeconds < 60) return `${totalSeconds}${tr('s')}`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}${tr('m')} ${seconds}${tr('s')}`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}${tr('h')} ${remainingMinutes}${tr('m')}`;
}

function shortId(value) {
  const text = String(value || '');
  if (!text) return '—';
  return text.length <= 10 ? text : `${text.slice(0, 8)}…`;
}

function normalizeKeywords(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function sourceName(source) {
  return source?.dataSource?.displayName || source?.dataSource?.key || 'Source';
}

function sourceKey(source) {
  return source?.dataSource?.key || '';
}

function statusInfo(status) {
  return STATUS_META[String(status || '').toUpperCase()] || {
    label: String(status || 'Unknown').replaceAll('_', ' '),
    className: 'is-pending',
  };
}

function StatusBadge({ status, compact = false }) {
  const { tr } = useCollectionRunsCopy();
  const meta = statusInfo(status);
  return (
    <span className={`admin-cr-status ${meta.className} ${compact ? 'is-compact' : ''}`}>
      <i />
      {tr(meta.label)}
    </span>
  );
}

function MetricCard({ icon: Icon, label, value, hint, tone = '' }) {
  const { locale, tr } = useCollectionRunsCopy();
  return (
    <article className={`admin-cr-metric ${tone}`}>
      <i aria-hidden="true" />
      <span className="admin-cr-metric__icon"><Icon size={20} /></span>
      <div>
        <small>{tr(label)}</small>
        <strong>{Number(value || 0).toLocaleString(locale)}</strong>
        <span>{tr(hint)}</span>
      </div>
    </article>
  );
}

function SelectMenu({ label, value, options, onChange, icon: Icon = SlidersHorizontal, minWidth = 220 }) {
  const { locale, tr } = useCollectionRunsCopy();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = options.find((option) => option.key === value) || options[0];

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);

  return (
    <div className={`admin-cr-picker ${open ? 'is-open' : ''}`} ref={ref} style={{ '--cr-picker-width': `${minWidth}px` }}>
      <button
        type="button"
        className="admin-cr-picker__trigger"
        onClick={() => setOpen((currentOpen) => !currentOpen)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Icon size={15} />
        <span><small>{tr(label)}</small><strong>{tr(current?.label || 'Select')}</strong></span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="admin-cr-picker__menu" role="listbox">
          {options.map((option) => (
            <button
              key={option.key}
              type="button"
              role="option"
              aria-selected={option.key === value}
              className={option.key === value ? 'is-active' : ''}
              onClick={() => {
                onChange(option.key);
                setOpen(false);
              }}
            >
              <span>{tr(option.label)}</span>
              {option.count !== undefined && <em>{Number(option.count || 0).toLocaleString(locale)}</em>}
              {option.key === value && <CheckCircle2 className="admin-cr-option-check" size={15} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SortControl({ sortBy, sortOrder, onChange, onToggle }) {
  const { tr } = useCollectionRunsCopy();
  const options = SORT_OPTIONS;
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = options.find((option) => option.key === sortBy) || options[0];

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);

  return (
    <div className={`admin-cr-sort ${open ? 'is-open' : ''}`} ref={ref}>
      <button type="button" className="admin-cr-sort__trigger" onClick={() => setOpen((value) => !value)}>
        <SlidersHorizontal size={15} />
        <span><small>{tr('Sort runs')}</small><strong>{tr(current.label)}</strong></span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="admin-cr-sort__menu">
          {options.map((option) => (
            <button
              key={option.key}
              type="button"
              className={sortBy === option.key ? 'is-active' : ''}
              onClick={() => {
                onChange(option.key);
                setOpen(false);
              }}
            >
              <span>{tr(option.label)}</span>
              {sortBy === option.key && <CheckCircle2 className="admin-cr-option-check" size={15} />}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className="admin-cr-sort__direction"
        onClick={onToggle}
        title={tr(sortOrder === 'asc' ? 'Ascending order' : 'Descending order')}
      >
        {sortOrder === 'asc' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
      </button>
    </div>
  );
}

function SourceChips({ sources }) {
  const { tr } = useCollectionRunsCopy();
  const visible = (sources || []).slice(0, 2);
  const hidden = Math.max(0, (sources || []).length - visible.length);
  if (!sources?.length) return <span className="admin-cr-muted">{tr('No sources')}</span>;
  return (
    <div className="admin-cr-source-chips">
      {visible.map((source) => (
        <span key={source.id || sourceKey(source)} title={sourceName(source)}>
          {sourceName(source)}
        </span>
      ))}
      {hidden > 0 && <span className="is-more">+{hidden}</span>}
    </div>
  );
}

function RunDetailsModal({ run, onClose, onChanged }) {
  const { locale, tr } = useCollectionRunsCopy();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirmStop, setConfirmStop] = useState(false);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [busy, onClose]);

  if (!run || typeof document === 'undefined') return null;

  const sources = Array.isArray(run.sources) ? run.sources : [];
  const keywords = normalizeKeywords(run.keywords);
  const isRunning = String(run.status).toUpperCase() === 'RUNNING';
  const canRetry = ['FAILED', 'STOPPED'].includes(String(run.status).toUpperCase());
  const location = [run.city, run.region, run.country].filter(Boolean).join(', ');

  const stopRun = async () => {
    if (!confirmStop) {
      setConfirmStop(true);
      return;
    }
    setBusy('stop');
    setError('');
    try {
      await adminApi.collection.stop(run.id);
      await onChanged(tr('Collection run stopped.'));
      onClose();
    } catch (requestError) {
      setError(tr(getApiErrorMessage(requestError, 'Could not stop this collection run.')));
    } finally {
      setBusy('');
      setConfirmStop(false);
    }
  };

  const retryRun = async () => {
    setBusy('retry');
    setError('');
    try {
      const body = {
        domainId: run.domainId || run.domain?.id,
        language: run.language,
        ...(run.country ? { country: run.country } : {}),
        ...(run.city ? { city: run.city } : {}),
        ...(run.region ? { region: run.region } : {}),
        ...(Number.isFinite(Number(run.radiusKm)) && Number(run.radiusKm) > 0 ? { radiusKm: Number(run.radiusKm) } : {}),
        ...(sources.length ? { dataSourceKeys: sources.map(sourceKey).filter(Boolean) } : {}),
        ...(keywords.length ? { keywords } : {}),
      };
      await adminApi.collection.run(body);
      await onChanged(tr('A fresh collection run was started with the same configuration.'));
      onClose();
    } catch (requestError) {
      setError(tr(getApiErrorMessage(requestError, 'Could not retry this collection run.')));
    } finally {
      setBusy('');
    }
  };

  return createPortal(
    <div className="admin-cr-modal-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section className="admin-cr-modal" role="dialog" aria-modal="true" aria-labelledby="admin-cr-modal-title">
        <header className="admin-cr-modal__head">
          <span className="admin-cr-modal__mark"><Database size={21} /></span>
          <div>
            <span>{tr('Collection run inspector')}</span>
            <h3 id="admin-cr-modal-title">{tr(run.domain?.name || 'Collection run')}</h3>
            <small>{tr('Run')} {run.id || '—'} · {formatDate(run.createdAt, false, locale)}</small>
          </div>
          <button type="button" className="admin-cr-modal__close" onClick={onClose} disabled={Boolean(busy)} aria-label={tr('Close')}><X size={18} /></button>
        </header>

        <div className="admin-cr-modal__body">
          <section className="admin-cr-modal__overview">
            <div className="admin-cr-overview-card is-status">
              <span>{tr('Pipeline status')}</span>
              <StatusBadge status={run.status} />
              <small>{run.failedReason || tr(isRunning ? 'Collection is currently processing.' : 'Latest persisted run state.')}</small>
            </div>
            <div className="admin-cr-overview-card">
              <span>{tr('Evidence collected')}</span>
              <strong>{(Number(run.totalPosts || 0) + Number(run.totalComments || 0)).toLocaleString(locale)}</strong>
              <small>{Number(run.totalPosts || 0).toLocaleString(locale)} {tr('posts')} · {Number(run.totalComments || 0).toLocaleString(locale)} {tr('comments')}</small>
            </div>
            <div className="admin-cr-overview-card">
              <span>{tr('Duration')}</span>
              <strong>{formatDuration(run.startedAt, run.completedAt, run.status, tr)}</strong>
              <small>{formatDate(run.startedAt, false, locale)} → {run.completedAt ? formatDate(run.completedAt, false, locale) : tr('Now')}</small>
            </div>
          </section>

          <div className="admin-cr-modal__columns">
            <div className="admin-cr-modal__main">
              <section className="admin-cr-detail-card">
                <div className="admin-cr-detail-card__title"><Layers3 size={15} /><span><strong>{tr('Run context')}</strong><small>{tr('Domain, language and collection scope')}</small></span></div>
                <div className="admin-cr-facts">
                  <div><span>{tr('Domain')}</span><strong>{run.domain?.name ? tr(run.domain.name) : '—'}</strong></div>
                  <div><span>{tr('Language')}</span><strong>{run.language ? tr(run.language) : '—'}</strong></div>
                  <div><span>{tr('Started by')}</span><strong>{run.createdBy?.fullName || run.createdBy?.email || (run.createdById ? shortId(run.createdById) : tr('Internal / legacy'))}</strong></div>
                  <div><span>{tr('Location')}</span><strong>{location || tr('No location restriction')}</strong></div>
                  <div><span>{tr('Radius')}</span><strong>{run.radiusKm ? `${run.radiusKm} km` : tr('Not set')}</strong></div>
                  <div><span>{tr('Run ID')}</span><strong className="is-mono">{run.id}</strong></div>
                </div>
                {keywords.length > 0 && (
                  <div className="admin-cr-keywords">
                    <span>{tr('Keywords')}</span>
                    <div>{keywords.slice(0, 12).map((keyword) => <em key={keyword}>{keyword}</em>)}</div>
                  </div>
                )}
              </section>

              <section className="admin-cr-detail-card">
                <div className="admin-cr-detail-card__title"><Database size={15} /><span><strong>{tr('Source execution')}</strong><small>{tr('Collector-level outcomes for this run')}</small></span></div>
                <div className="admin-cr-source-list">
                  {sources.length === 0 && <div className="admin-cr-source-empty">{tr('No source execution records are attached to this run.')}</div>}
                  {sources.map((source) => (
                    <article key={source.id || `${run.id}-${sourceKey(source)}`}>
                      <span className="admin-cr-source-list__mark">{sourceName(source).charAt(0).toUpperCase()}</span>
                      <div className="admin-cr-source-list__copy">
                        <strong>{sourceName(source)}</strong>
                        <small>{sourceKey(source) || tr('collector')}</small>
                      </div>
                      <StatusBadge status={source.status} compact />
                      <div className="admin-cr-source-list__counts">
                        <span><FileText size={12} /> {Number(source.totalPosts || 0).toLocaleString(locale)}</span>
                        <span><MessageSquareText size={12} /> {Number(source.totalComments || 0).toLocaleString(locale)}</span>
                      </div>
                      <div className="admin-cr-source-list__time">
                        <strong>{formatDuration(source.startedAt, source.completedAt, source.status, tr)}</strong>
                        <small>{source.failureReason ? tr(source.failureReason) : formatDate(source.completedAt || source.startedAt, true, locale)}</small>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </div>

            <aside className="admin-cr-modal__aside">
              <section className="admin-cr-side-card">
                <span className="admin-cr-side-card__icon"><Clock3 size={17} /></span>
                <div><small>{tr('Created')}</small><strong>{formatDate(run.createdAt, false, locale)}</strong></div>
                <div><small>{tr('Last update')}</small><strong>{formatDate(run.updatedAt, false, locale)}</strong></div>
                <div><small>{tr('Completed')}</small><strong>{formatDate(run.completedAt, false, locale)}</strong></div>
              </section>

              <section className="admin-cr-side-card">
                <span className="admin-cr-side-card__icon"><ShieldCheck size={17} /></span>
                <div><small>{tr('Run state')}</small><strong>{tr(statusInfo(run.status).label)}</strong></div>
                <div><small>{tr('Sources')}</small><strong>{sources.length.toLocaleString(locale)}</strong></div>
                <div><small>{tr('NLP analysis')}</small><strong>{tr(run.nlpAnalysis ? 'Available' : 'Not attached')}</strong></div>
              </section>

              {run.failedReason && (
                <section className="admin-cr-side-card is-warning">
                  <span className="admin-cr-side-card__icon"><AlertTriangle size={17} /></span>
                  <div><small>{tr('Failure reason')}</small><strong>{tr(run.failedReason)}</strong></div>
                </section>
              )}
            </aside>
          </div>
        </div>

        {error && <div className="admin-cr-modal__error"><AlertTriangle size={15} /> {error}</div>}

        <footer className="admin-cr-modal__footer">
          <div className="admin-cr-modal__safety">
            <ShieldCheck size={16} />
            <span><strong>{tr('Operational controls')}</strong><small>{tr('Stopping affects only running collection work. Retrying creates a new run and keeps this history intact.')}</small></span>
          </div>
          <div className="admin-cr-modal__actions">
            <button type="button" className="admin-cr-action is-secondary" onClick={onClose} disabled={Boolean(busy)}><X size={15} /> {tr('Close')}</button>
            {canRetry && (
              <button type="button" className="admin-cr-action is-retry" onClick={retryRun} disabled={Boolean(busy)}>
                {busy === 'retry' ? <LoaderCircle className="admin-spin" size={16} /> : <RotateCcw size={16} />}
                <span><strong>{tr('Retry collection')}</strong><small>{tr('Start a fresh run')}</small></span>
              </button>
            )}
            {isRunning && (
              <button type="button" className={`admin-cr-action is-stop ${confirmStop ? 'is-confirming' : ''}`} onClick={stopRun} disabled={Boolean(busy)}>
                {busy === 'stop' ? <LoaderCircle className="admin-spin" size={16} /> : <Square size={15} />}
                <span><strong>{tr(confirmStop ? 'Confirm stop' : 'Stop run')}</strong><small>{tr(confirmStop ? 'Click again to stop now' : 'End active collection')}</small></span>
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

export default function AdminCollectionRunsPage() {
  const { locale, tr } = useCollectionRunsCopy();
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: PAGE_SIZE, totalPages: 1 });
  const [statusPayload, setStatusPayload] = useState({});
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [detail, setDetail] = useState(null);
  const [openingId, setOpeningId] = useState('');
  const requestRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 280);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(''), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const onWorkspaceSearch = (event) => setSearchInput(String(event.detail || ''));
    window.addEventListener('voxidence:admin-search', onWorkspaceSearch);
    return () => window.removeEventListener('voxidence:admin-search', onWorkspaceSearch);
  }, []);

  const loadData = useCallback(async ({ quiet = false, fresh = false } = {}) => {
    const requestId = ++requestRef.current;
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
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
        ...(sourceFilter !== 'all' ? { dataSourceKey: sourceFilter } : {}),
      };

      const listLoader = fresh ? adminApi.collection.listFresh : adminApi.collection.list;
      const statusLoader = fresh ? adminApi.collection.statusFresh : adminApi.collection.status;
      const listPayload = await listLoader(params);
      if (requestId !== requestRef.current) return;
      const nextRows = unwrapRows(listPayload);
      setRows(nextRows);
      setMeta(unwrapMeta(listPayload, nextRows.length));

      statusLoader()
        .then((payload) => {
          if (requestId === requestRef.current) setStatusPayload(unwrapStatus(payload));
        })
        .catch(() => null);
    } catch (requestError) {
      if (requestId !== requestRef.current) return;
      setRows([]);
      setError(tr(getApiErrorMessage(requestError, 'Could not load collection runs.')));
    } finally {
      if (requestId === requestRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [page, search, sortBy, sortOrder, sourceFilter, statusFilter, tr]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const metrics = useMemo(() => {
    const jobsStatus = statusPayload?.jobs || {};
    const running = Number(jobsStatus.running || 0);
    const completed = Number(jobsStatus.completed || 0);
    const failed = Number(jobsStatus.failed || 0);
    const stopped = Number(jobsStatus.stopped || 0);
    const pending = Number(jobsStatus.pending || 0);
    const total = Number(
      jobsStatus.total ?? (running + completed + failed + stopped + pending),
    );

    return { total, running, completed, failed, stopped, pending };
  }, [statusPayload?.jobs]);

  const sourceOptions = useMemo(() => {
    const dataSources = Array.isArray(statusPayload?.dataSources) ? statusPayload.dataSources : [];
    return [
      { key: 'all', label: tr('All data sources') },
      ...dataSources.map((source) => ({ key: source.key, label: source.displayName || source.key })),
    ];
  }, [statusPayload, tr]);

  const openDetails = async (row) => {
    setOpeningId(row.id);
    setError('');
    try {
      const payload = await adminApi.collection.detail(row.id);
      const value = isObject(payload?.data) ? payload.data : payload;
      setDetail(value);
    } catch (requestError) {
      setError(tr(getApiErrorMessage(requestError, 'Could not open collection run details.')));
    } finally {
      setOpeningId('');
    }
  };

  const start = meta.total === 0 ? 0 : ((meta.page - 1) * meta.limit) + 1;
  const end = Math.min(meta.page * meta.limit, meta.total);

  return (
    <div className="admin-page admin-cr-page">
      <section className="admin-hero admin-cr-hero">
        <div className="admin-cr-hero__copy">
          <div className="admin-hero__eyebrow"><Database size={14} /> {tr('Evidence pipeline')}</div>
          <h2>{tr('Collection runs')}</h2>
          <p>{tr('Monitor evidence ingestion, inspect source-level execution, stop unhealthy active work, and retry failed collection jobs without exposing raw database fields.')}</p>
        </div>

        <div className="admin-cr-hero__visual" aria-hidden="true">
          <span className="admin-cr-hero__orbit admin-cr-hero__orbit--one" />
          <span className="admin-cr-hero__orbit admin-cr-hero__orbit--two" />
          <span className="admin-cr-hero__spark admin-cr-hero__spark--one" />
          <span className="admin-cr-hero__spark admin-cr-hero__spark--two" />
          <span className="admin-cr-hero__spark admin-cr-hero__spark--three" />

          <div className="admin-cr-hero__source-card">
            <FileText size={23} />
            <span className="admin-cr-hero__source-line" />
            <span className="admin-cr-hero__source-line is-short" />
            <span className="admin-cr-hero__source-search"><Search size={15} /></span>
          </div>

          <div className="admin-cr-hero__database">
            <span />
            <span />
            <span />
            <Database size={35} />
          </div>

          <div className="admin-cr-hero__status-card">
            <span><i className="is-running" /> {tr('Running')}</span>
            <span><i className="is-completed" /> {tr('Completed')}</span>
            <span><i className="is-attention" /> {tr('Needs attention')}</span>
          </div>

          <div className="admin-cr-hero__check"><CheckCircle2 size={20} /></div>
          <div className="admin-cr-hero__chart">
            <span className="is-one" />
            <span className="is-two" />
            <span className="is-three" />
            <i />
          </div>
        </div>
      </section>

      <section className="admin-cr-panel">
        <header className="admin-cr-panel__head">
          <div>
            <span className="admin-cr-kicker"><Database size={13} /> {tr('Pipeline operations')}</span>
            <h3>{tr('Collection operations')}</h3>
            <p>{meta.total.toLocaleString(locale)} {tr(meta.total === 1 ? 'matching run in this view' : 'matching runs in this view')}</p>
          </div>
          <div className="admin-cr-head-state">
            <span className={`admin-cr-live ${statusPayload?.available === false ? 'is-offline' : ''}`}><i /> {tr(statusPayload?.available === false ? 'Pipeline unavailable' : 'Live pipeline')}</span>
            <button type="button" className="admin-cr-refresh" onClick={() => loadData({ quiet: true, fresh: true })} disabled={refreshing}>
              <RefreshCw size={14} className={refreshing ? 'admin-spin' : ''} /> {tr('Refresh')}
            </button>
          </div>
        </header>

        {!loading && (
          <div className="admin-cr-metrics">
            <MetricCard icon={Database} label={tr('Total runs')} value={metrics.total} hint={`${metrics.pending.toLocaleString(locale)} ${tr('pending')}`} tone="is-primary" />
            <MetricCard icon={Play} label={tr('Running')} value={metrics.running} hint={tr('Currently collecting evidence')} tone="is-running" />
            <MetricCard icon={CheckCircle2} label={tr('Completed')} value={metrics.completed} hint={tr('Finished successfully')} tone="is-completed" />
            <MetricCard icon={AlertTriangle} label={tr('Needs attention')} value={metrics.failed + metrics.stopped} hint={`${metrics.failed.toLocaleString(locale)} ${tr('failed')} · ${metrics.stopped.toLocaleString(locale)} ${tr('stopped')}`} tone="is-attention" />
          </div>
        )}

        <div className="admin-cr-status-tabs" role="tablist" aria-label={tr('Filter collection runs by status')}>
          {STATUS_FILTERS.map((option) => (
            <button
              key={option.key}
              type="button"
              className={statusFilter === option.key ? 'is-active' : ''}
              onClick={() => {
                setStatusFilter(option.key);
                setPage(1);
              }}
            >
              {tr(option.label)}
            </button>
          ))}
        </div>

        <div className="admin-cr-tools">
          <SortControl
            sortBy={sortBy}
            sortOrder={sortOrder}
            onChange={(value) => {
              setSortBy(value);
              setSortOrder('desc');
              setPage(1);
            }}
            onToggle={() => {
              setSortOrder((current) => (current === 'asc' ? 'desc' : 'asc'));
              setPage(1);
            }}
          />

          <SelectMenu
            label={tr('Data source')}
            value={sourceFilter}
            options={sourceOptions}
            onChange={(value) => {
              setSourceFilter(value);
              setPage(1);
            }}
            icon={Database}
            minWidth={210}
          />

          <label className="admin-cr-search">
            <Search size={17} />
            <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder={tr('Search domain, source or location...')} />
            {searchInput && <button type="button" onClick={() => setSearchInput('')} aria-label={tr('Clear search')}><X size={14} /></button>}
          </label>
        </div>

        {notice && <div className="admin-cr-notice"><CheckCircle2 size={15} /> {notice}</div>}
        {error && <div className="admin-cr-error"><AlertTriangle size={15} /> {error}</div>}

        <div className="admin-cr-runs-grid">
          {loading && (
            <div className="admin-cr-runs-state">
              <div className="admin-cr-empty">
                <LoaderCircle size={23} className="admin-spin" />
                <strong>{tr('Loading collection runs…')}</strong>
              </div>
            </div>
          )}

          {!loading && !error && rows.length === 0 && (
            <div className="admin-cr-runs-state">
              <div className="admin-cr-empty">
                <Database size={25} />
                <strong>{tr('No collection runs match this view.')}</strong>
                <span>{tr('Try another status, data source, or search term.')}</span>
              </div>
            </div>
          )}

          {!loading && rows.map((row) => {
            const totalEvidence = Number(row.totalPosts || 0) + Number(row.totalComments || 0);
            const isOpening = openingId === row.id;
            const currentStatus = statusInfo(row.status);

            return (
              <article key={row.id} className={`admin-cr-run-card ${currentStatus.className}`}>
                <header className="admin-cr-run-card__head">
                  <div className="admin-cr-run-cell">
                    <span className={`admin-cr-run-mark ${currentStatus.className}`} aria-label={`${tr(currentStatus.label)} ${tr('collection run')}`}>
                      <Database size={16} />
                    </span>
                    <div>
                      <strong>{tr('Run')} {row.id || '—'}</strong>
                      <small>{row.createdBy?.fullName || row.createdBy?.email || (row.createdById ? `${tr('User')} ${shortId(row.createdById)}` : tr('Internal / legacy'))}</small>
                      <span>{tr(row.language || 'ANY')} · {formatDate(row.createdAt, true, locale)}</span>
                    </div>
                  </div>
                  <StatusBadge status={row.status} />
                </header>

                <div className="admin-cr-run-card__body">
                  <div className="admin-cr-run-card__section admin-cr-run-card__section--domain">
                    <span className="admin-cr-run-card__label"><Layers3 size={12} /> {tr('Domain & scope')}</span>
                    <div className="admin-cr-domain-cell">
                      <strong>{tr(row.domain?.name || 'Unknown domain')}</strong>
                      {(row.city || row.region || row.country) ? (
                        <span><MapPin size={11} /> {[row.city, row.region, row.country].filter(Boolean).join(', ')}</span>
                      ) : (
                        <span><Layers3 size={11} /> {tr('Global scope')}</span>
                      )}
                    </div>
                  </div>

                  <div className="admin-cr-run-card__section admin-cr-run-card__section--pipeline">
                    <span className="admin-cr-run-card__label"><Database size={12} /> {tr('Pipeline sources')}</span>
                    <div className="admin-cr-pipeline-cell">
                      <SourceChips sources={row.sources} />
                    </div>
                  </div>

                  <div className="admin-cr-run-card__section admin-cr-run-card__section--evidence">
                    <span className="admin-cr-run-card__label"><FileText size={12} /> {tr('Evidence')}</span>
                    <div className="admin-cr-evidence-cell">
                      <strong>{totalEvidence.toLocaleString(locale)}</strong>
                      <div>
                        <span><FileText size={11} /> {Number(row.totalPosts || 0).toLocaleString(locale)} {tr('posts')}</span>
                        <span><MessageSquareText size={11} /> {Number(row.totalComments || 0).toLocaleString(locale)} {tr('comments')}</span>
                      </div>
                    </div>
                  </div>

                  <div className="admin-cr-run-card__section admin-cr-run-card__section--timing">
                    <span className="admin-cr-run-card__label"><Clock3 size={12} /> {tr('Timing')}</span>
                    <div className="admin-cr-time-cell">
                      <strong>{formatDuration(row.startedAt, row.completedAt, row.status, tr)}</strong>
                      <span><Clock3 size={11} /> {row.completedAt ? `${tr('Ended')} ${formatDate(row.completedAt, true, locale)}` : row.startedAt ? `${tr('Started')} ${formatDate(row.startedAt, true, locale)}` : tr('Waiting to start')}</span>
                    </div>
                  </div>
                </div>

                <footer className="admin-cr-run-card__footer">
                  <div className="admin-cr-run-card__summary">
                    <span className={`admin-cr-run-card__pulse ${currentStatus.className}`} />
                    <span>{tr(currentStatus.label)}</span>
                    <i />
                    <span>{totalEvidence.toLocaleString(locale)} {tr('evidence records')}</span>
                  </div>
                  <button type="button" className="admin-cr-inspect" onClick={() => openDetails(row)} disabled={Boolean(openingId)}>
                    {isOpening ? <LoaderCircle size={14} className="admin-spin" /> : <Search size={14} />}
                    <span>{tr('Inspect')}</span>
                  </button>
                </footer>
              </article>
            );
          })}
        </div>

        <footer className="admin-cr-pagination">
          <span>{meta.total ? `${tr('Showing')} ${start.toLocaleString(locale)}-${end.toLocaleString(locale)} ${tr('of')} ${meta.total.toLocaleString(locale)}` : tr('No records')}</span>
          <div>
            <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft size={14} /> {tr('Previous')}</button>
            <strong>{tr('Page')} {meta.page.toLocaleString(locale)} {tr('of')} {meta.totalPages.toLocaleString(locale)}</strong>
            <button type="button" disabled={page >= meta.totalPages || loading} onClick={() => setPage((current) => Math.min(meta.totalPages, current + 1))}>{tr('Next')} <ChevronRight size={14} /></button>
          </div>
        </footer>
      </section>

      {detail && (
        <RunDetailsModal
          run={detail}
          onClose={() => setDetail(null)}
          onChanged={async (message) => {
            setNotice(message);
            await loadData({ quiet: true });
          }}
        />
      )}
    </div>
  );
}