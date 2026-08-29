import {
  Activity,
  ArrowDown,
  ArrowUp,
  BarChart3,
  BrainCircuit,
  CalendarRange,
  Check,
  ChevronDown,
  CircleDollarSign,
  Coins,
  Cpu,
  Gauge,
  RefreshCw,
  Search,
  ServerCog,
  Sparkles,
  Timer,
  TriangleAlert,
  X,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useUserExperience } from '../../../../system/user-experience';
import { adminApi, getApiErrorMessage } from '../../shared/api/adminApi';
import '../../shared/styles/admin-pages.css';
import '../styles/admin-ai-analytics.css';

const PROVIDER_OPTIONS = [
  { key: '', label: 'All providers' },
  { key: 'google', label: 'Google AI' },
  { key: 'openrouter', label: 'OpenRouter' },
  { key: 'ollama', label: 'Ollama (Local)' },
];

const REQUEST_TYPE_OPTIONS = [
  { key: '', label: 'All request types' },
  { key: 'IDEA_GENERATION', label: 'Idea generation' },
  { key: 'AI_CHAT', label: 'AI chat' },
  { key: 'COMMENT_ANALYSIS', label: 'Comment analysis' },
  { key: 'NLP_ENHANCEMENT', label: 'NLP enhancement' },
  { key: 'DATA_COLLECTION', label: 'Data collection' },
  { key: 'OTHER', label: 'Other' },
];

const SORT_OPTIONS = [
  { key: 'requests', label: 'Request volume' },
  { key: 'successRate', label: 'Success rate' },
  { key: 'averageResponseTimeMs', label: 'Average latency' },
  { key: 'tokens', label: 'Token usage' },
  { key: 'cost', label: 'Estimated cost' },
  { key: 'modelName', label: 'Model name' },
];

const AI_ANALYTICS_AR = Object.freeze({
  'All providers': 'جميع المزوّدين',
  'Google AI': 'Google للذكاء الاصطناعي',
  'OpenRouter': 'أوبن راوتر',
  'Ollama (Local)': 'أولاما (محلي)',
  'All request types': 'جميع أنواع الطلبات',
  'Idea generation': 'توليد الأفكار',
  'AI chat': 'محادثة الذكاء الاصطناعي',
  'Comment analysis': 'تحليل التعليقات',
  'NLP enhancement': 'تحسين معالجة اللغة الطبيعية',
  'Data collection': 'جمع البيانات',
  'Other': 'أخرى',
  'Request volume': 'حجم الطلبات',
  'Success rate': 'معدل النجاح',
  'Average latency': 'متوسط زمن الاستجابة',
  'Token usage': 'استخدام الرموز',
  'Estimated cost': 'التكلفة التقديرية',
  'Model name': 'اسم النموذج',
  'Unmapped model': 'نموذج غير مربوط',
  'Unknown provider': 'مزوّد غير معروف',
  'All': 'الكل',
  'AI': 'ذكاء',
  'Provider attempts': 'محاولات المزوّد',
  'Aggregated AI traffic': 'حركة الذكاء الاصطناعي المجمّعة',
  'Model reliability': 'موثوقية النموذج',
  'Success across attempts': 'النجاح عبر المحاولات',
  'models': 'نماذج',
  'Could not load AI usage analytics.': 'تعذر تحميل تحليلات استخدام الذكاء الاصطناعي.',
  'From date must be earlier than or equal to To date.': 'يجب أن يكون تاريخ البداية أسبق من تاريخ النهاية أو مساويًا له.',
  'AI intelligence': 'رؤى الذكاء الاصطناعي',
  'AI analytics': 'تحليلات الذكاء الاصطناعي',
  'Understand model reliability, provider traffic, latency, token consumption and estimated AI spend from one operational view.': 'افهم موثوقية النماذج وحركة المزوّدين وزمن الاستجابة واستهلاك الرموز والإنفاق التقديري على الذكاء الاصطناعي من عرض تشغيلي واحد.',
  'Refresh analytics': 'تحديث التحليلات',
  'Provider telemetry aggregated': 'تم تجميع قياسات المزوّدين',
  'Usage, latency & cost in one view': 'الاستخدام وزمن الاستجابة والتكلفة في عرض واحد',
  'Usage overview': 'نظرة عامة على الاستخدام',
  'AI economics & performance': 'تكلفة وأداء الذكاء الاصطناعي',
  'Aggregated provider attempts, including retries, repairs and fallbacks.': 'محاولات المزوّدين المجمّعة، بما فيها إعادة المحاولة والإصلاح والمسارات البديلة.',
  'Aggregated metrics': 'المؤشرات المجمّعة',
  'Refresh': 'تحديث',
  'AI requests': 'طلبات الذكاء الاصطناعي',
  'successful attempts': 'محاولات ناجحة',
  'failed attempts': 'محاولات فاشلة',
  'Across matching provider attempts': 'عبر محاولات المزوّد المطابقة',
  'Estimated AI cost': 'تكلفة الذكاء الاصطناعي التقديرية',
  'Backend-calculated usage estimate': 'تقدير استخدام محسوب من النظام الخلفي',
  'input tokens': 'رموز الإدخال',
  'output tokens': 'رموز الإخراج',
  'fallback attempts': 'محاولات المسار البديل',
  'models represented': 'نماذج ممثّلة',
  'Analytics filters': 'فلاتر التحليلات',
  'Filter the backend aggregation before comparing model performance.': 'صفِّ التجميع من النظام الخلفي قبل مقارنة أداء النماذج.',
  'Clear': 'مسح',
  'Apply filters': 'تطبيق الفلاتر',
  'From date': 'من تاريخ',
  'To date': 'إلى تاريخ',
  'Provider': 'المزوّد',
  'Request type': 'نوع الطلب',
  'Model intelligence': 'رؤى النماذج',
  'Model usage': 'استخدام النماذج',
  'matching models': 'نماذج مطابقة',
  'total tokens': 'إجمالي الرموز',
  'Most used': 'الأكثر استخدامًا',
  'Fastest': 'الأسرع',
  'Sort models': 'ترتيب النماذج',
  'Descending': 'تنازلي',
  'Ascending': 'تصاعدي',
  'Search model, API model or provider...': 'ابحث عن نموذج أو نموذج API أو مزوّد...',
  'Legacy / unmapped': 'قديم / غير مربوط',
  'Requests': 'الطلبات',
  'success': 'ناجح',
  'failed': 'فاشل',
  'Latency': 'زمن الاستجابة',
  'Average response time': 'متوسط وقت الاستجابة',
  'Tokens': 'الرموز',
  'in': 'إدخال',
  'out': 'إخراج',
  'Cost': 'التكلفة',
  'Estimated usage cost': 'تكلفة الاستخدام التقديرية',
  'Traffic share': 'حصة الحركة',
  'No model usage found': 'لم يتم العثور على استخدام للنماذج',
  'Try changing the analytics filters or model search.': 'جرّب تغيير فلاتر التحليلات أو البحث عن نموذج.',
});

function translateAiAnalytics(text, isArabic) {
  if (!isArabic || text == null) return text;
  return AI_ANALYTICS_AR[String(text)] || text;
}

function number(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function compactNumber(value, isArabic = false) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return '0';
  const locale = isArabic ? 'ar-EG-u-nu-latn' : 'en-US';
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(numeric);
}

function money(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric === 0) return '$0';
  if (numeric < 0.01) return `$${numeric.toFixed(6)}`;
  return `$${numeric.toFixed(4)}`;
}

function latency(value, isArabic = false) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return isArabic ? '0 مللي ثانية' : '0 ms';
  if (numeric >= 1000) return `${(numeric / 1000).toFixed(numeric >= 10000 ? 1 : 2)}${isArabic ? ' ث' : 's'}`;
  return `${Math.round(numeric)} ${isArabic ? 'مللي ثانية' : 'ms'}`;
}

function percent(part, whole) {
  const denominator = Number(whole || 0);
  if (!denominator) return 0;
  return Math.max(0, Math.min(100, (Number(part || 0) / denominator) * 100));
}

function dateBoundaryIso(value, endOfDay = false) {
  if (!value) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  if (![year, month, day].every(Number.isFinite)) return undefined;
  const date = new Date(
    year,
    month - 1,
    day,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  );
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function modelName(item) {
  return item?.model?.modelName || item?.model?.apiModelId || 'Unmapped model';
}

function providerName(key, tr = (value) => value) {
  const normalized = String(key || '').toLowerCase();
  const label = PROVIDER_OPTIONS.find((item) => item.key === normalized)?.label || (key || 'Unknown provider');
  return tr(label);
}

function displayModelName(item, tr = (value) => value) {
  return item?.model?.modelName || item?.model?.apiModelId || tr('Unmapped model');
}

function MetricCard({ icon: Icon, label, value, hint, tone = '' }) {
  return (
    <article className={`admin-ai-analytics-metric ${tone}`}>
      <i aria-hidden="true" />
      <span className="admin-ai-analytics-metric__icon"><Icon size={19} /></span>
      <div className="admin-ai-analytics-metric__copy">
        <small>{label}</small>
        <strong>{value}</strong>
        <span>{hint}</span>
      </div>
    </article>
  );
}

function SelectMenu({ label, value, options, onChange, icon: Icon = ServerCog, tr = (text) => text }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = options.find((option) => option.key === value) || options[0];

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className={`admin-ai-analytics-picker ${open ? 'is-open' : ''}`} ref={ref}>
      <button
        type="button"
        className="admin-ai-analytics-picker__trigger"
        onClick={() => setOpen((state) => !state)}
        aria-expanded={open}
      >
        <Icon size={16} />
        <span>
          <small>{tr(label)}</small>
          <strong>{tr(current?.label || 'All')}</strong>
        </span>
        <ChevronDown size={15} className="admin-ai-analytics-picker__chevron" />
      </button>
      {open && (
        <div className="admin-ai-analytics-picker__menu" role="listbox">
          {options.map((option) => (
            <button
              type="button"
              key={option.key || 'all'}
              className={option.key === value ? 'is-active' : ''}
              onClick={() => {
                onChange(option.key);
                setOpen(false);
              }}
            >
              <span>{tr(option.label)}</span>
              {option.key === value && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ReliabilityBadge({ successRate }) {
  const rate = Number(successRate || 0);
  const tone = rate >= 90 ? 'is-strong' : rate >= 70 ? 'is-mid' : 'is-low';
  return (
    <span className={`admin-ai-analytics-reliability ${tone}`}>
      <i aria-hidden="true" />
      {rate.toFixed(1)}%
    </span>
  );
}

function AiAnalyticsHeroVisual({ totalRequests, successRate, modelCount, averageLatency, totalCost, tr, isArabic }) {
  return (
    <div className="admin-ai-analytics-hero-visual" aria-hidden="true">
      <div className="admin-ai-analytics-hero-visual__grid" />
      <div className="admin-ai-analytics-hero-visual__path is-one" />
      <div className="admin-ai-analytics-hero-visual__path is-two" />

      <span className="admin-ai-analytics-orbit is-provider"><ServerCog size={18} /></span>
      <span className="admin-ai-analytics-orbit is-speed"><Timer size={18} /></span>
      <span className="admin-ai-analytics-orbit is-token"><Coins size={18} /></span>

      <div className="admin-ai-analytics-core">
        <span className="admin-ai-analytics-core__ring is-outer" />
        <span className="admin-ai-analytics-core__ring is-middle" />
        <span className="admin-ai-analytics-core__ring is-inner" />
        <div className="admin-ai-analytics-core__chip">
          <BrainCircuit size={58} strokeWidth={1.55} />
          <span>{tr('AI')}</span>
        </div>
        <i className="admin-ai-analytics-core__node is-a" />
        <i className="admin-ai-analytics-core__node is-b" />
        <i className="admin-ai-analytics-core__node is-c" />
      </div>

      <article className="admin-ai-analytics-float-card is-requests">
        <span>{tr('Provider attempts')}</span>
        <strong>{number(totalRequests)}</strong>
        <small><Activity size={12} /> {tr('Aggregated AI traffic')}</small>
      </article>

      <article className="admin-ai-analytics-float-card is-health">
        <span>{tr('Model reliability')}</span>
        <strong>{Number(successRate || 0).toFixed(1)}%</strong>
        <small><Gauge size={12} /> {tr('Success across attempts')}</small>
      </article>

      <div className="admin-ai-analytics-hero-visual__stats">
        <span><Cpu size={13} /> {number(modelCount)} {tr('models')}</span>
        <span><Timer size={13} /> {latency(averageLatency, isArabic)}</span>
        <span><CircleDollarSign size={13} /> {money(totalCost)}</span>
      </div>
    </div>
  );
}

export default function AdminAiAnalyticsPage() {
  const { isArabic } = useUserExperience();
  const tr = useCallback((text) => translateAiAnalytics(text, isArabic), [isArabic]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const [filters, setFilters] = useState({
    fromDate: '',
    toDate: '',
    providerKey: '',
    requestType: '',
  });
  const [appliedFilters, setAppliedFilters] = useState(filters);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('requests');
  const [sortOrder, setSortOrder] = useState('desc');

  const buildParams = useCallback((source) => ({
    ...(source.fromDate ? { fromDate: dateBoundaryIso(source.fromDate, false) } : {}),
    ...(source.toDate ? { toDate: dateBoundaryIso(source.toDate, true) } : {}),
    ...(source.providerKey ? { providerKey: source.providerKey } : {}),
    ...(source.requestType ? { requestType: source.requestType } : {}),
  }), []);

  const load = useCallback(async (source = appliedFilters, fresh = false) => {
    setError('');
    if (fresh) setRefreshing(true);
    else setLoading(true);
    try {
      const params = buildParams(source);
      const payload = fresh && adminApi.aiAnalytics.summaryFresh
        ? await adminApi.aiAnalytics.summaryFresh(params)
        : await adminApi.aiAnalytics.summary(params);
      setData(payload || {});
    } catch (e) {
      setError(tr(getApiErrorMessage(e, 'Could not load AI usage analytics.')));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [appliedFilters, buildParams, tr]);

  useEffect(() => {
    load(appliedFilters, false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const applyFilters = () => {
    if (filters.fromDate && filters.toDate && filters.fromDate > filters.toDate) {
      setError(tr('From date must be earlier than or equal to To date.'));
      return;
    }
    setAppliedFilters(filters);
    load(filters, true);
  };

  const clearFilters = () => {
    const empty = { fromDate: '', toDate: '', providerKey: '', requestType: '' };
    setFilters(empty);
    setAppliedFilters(empty);
    setSearch('');
    load(empty, true);
  };

  const rawModels = useMemo(() => (Array.isArray(data?.models) ? data.models : []), [data]);

  const models = useMemo(() => {
    const query = search.trim().toLowerCase();
    const prepared = rawModels
      .filter((item) => {
        if (!query) return true;
        return [
          modelName(item),
          item?.model?.apiModelId,
          item?.model?.providerKey,
        ].some((value) => String(value || '').toLowerCase().includes(query));
      })
      .map((item) => {
        const requests = Number(item?.requests || 0);
        const successfulRequests = Number(item?.successfulRequests || 0);
        return {
          ...item,
          calculatedSuccessRate: percent(successfulRequests, requests),
          calculatedTokens: Number(item?.inputTokens || 0) + Number(item?.outputTokens || 0),
        };
      });

    const direction = sortOrder === 'asc' ? 1 : -1;
    return [...prepared].sort((a, b) => {
      if (sortBy === 'modelName') return modelName(a).localeCompare(modelName(b)) * direction;
      if (sortBy === 'successRate') return (a.calculatedSuccessRate - b.calculatedSuccessRate) * direction;
      if (sortBy === 'tokens') return (a.calculatedTokens - b.calculatedTokens) * direction;
      return (Number(a?.[sortBy] || 0) - Number(b?.[sortBy] || 0)) * direction;
    });
  }, [rawModels, search, sortBy, sortOrder]);

  const totalRequests = Number(data?.totalRequests || 0);
  const totalTokens = Number(data?.totalInputTokens || 0) + Number(data?.totalOutputTokens || 0);
  const topModel = useMemo(() => [...rawModels].sort((a, b) => Number(b.requests || 0) - Number(a.requests || 0))[0], [rawModels]);
  const fastestModel = useMemo(() => rawModels
    .filter((item) => Number(item.averageResponseTimeMs || 0) > 0)
    .sort((a, b) => Number(a.averageResponseTimeMs || 0) - Number(b.averageResponseTimeMs || 0))[0], [rawModels]);

  return (
    <div className="admin-page admin-ai-analytics-page">
      <section className="admin-ai-analytics-hero">
        <div className="admin-ai-analytics-hero__content">
          <div className="admin-ai-analytics-eyebrow"><Sparkles size={16} /> {tr('AI intelligence')}</div>
          <h1>{tr('AI analytics')}</h1>
          <p>{tr('Understand model reliability, provider traffic, latency, token consumption and estimated AI spend from one operational view.')}</p>

          <div className="admin-ai-analytics-hero__actions">
            <button type="button" className="admin-ai-analytics-hero-button" onClick={() => load(appliedFilters, true)} disabled={refreshing || loading}>
              <RefreshCw size={16} className={refreshing ? 'is-spinning' : ''} /> {tr('Refresh analytics')}
            </button>
          </div>

          <div className="admin-ai-analytics-hero__status">
            <span><BrainCircuit size={14} /> {tr('Provider telemetry aggregated')}</span>
            <i />
            <span><Coins size={14} /> {tr('Usage, latency & cost in one view')}</span>
          </div>
        </div>

        <AiAnalyticsHeroVisual
          totalRequests={totalRequests}
          successRate={data?.successRate}
          modelCount={rawModels.length}
          averageLatency={data?.averageResponseTimeMs}
          totalCost={data?.totalCost}
          tr={tr}
          isArabic={isArabic}
        />
      </section>

      {error && <div className="admin-error">{error}</div>}

      <section className="admin-ai-analytics-panel">
        <header className="admin-ai-analytics-panel__head">
          <div>
            <span className="admin-ai-analytics-panel__kicker"><BarChart3 size={13} /> {tr('Usage overview')}</span>
            <h3>{tr('AI economics & performance')}</h3>
            <p>{tr('Aggregated provider attempts, including retries, repairs and fallbacks.')}</p>
          </div>
          <div className="admin-ai-analytics-panel__actions">
            <span className="admin-ai-analytics-live"><i /> {tr('Aggregated metrics')}</span>
            <button type="button" className="admin-ai-analytics-action" onClick={() => load(appliedFilters, true)} disabled={refreshing || loading}>
              <RefreshCw size={15} className={refreshing ? 'is-spinning' : ''} /> {tr('Refresh')}
            </button>
          </div>
        </header>

        {loading ? (
          <div className="admin-ai-analytics-loading"><div className="admin-spinner" /></div>
        ) : (
          <>
            <div className="admin-ai-analytics-metrics">
              <MetricCard icon={BrainCircuit} label={tr('AI requests')} value={number(data?.totalRequests)} hint={`${number(data?.successfulRequests)} ${tr('successful attempts')}`} tone="is-primary" />
              <MetricCard icon={Gauge} label={tr('Success rate')} value={`${Number(data?.successRate || 0).toFixed(2)}%`} hint={`${number(data?.failedRequests)} ${tr('failed attempts')}`} tone={Number(data?.successRate || 0) < 70 ? 'is-warning' : ''} />
              <MetricCard icon={Timer} label={tr('Average latency')} value={latency(data?.averageResponseTimeMs, isArabic)} hint={tr('Across matching provider attempts')} tone="is-latency" />
              <MetricCard icon={CircleDollarSign} label={tr('Estimated AI cost')} value={money(data?.totalCost)} hint={tr('Backend-calculated usage estimate')} tone="is-cost" />
            </div>

            <div className="admin-ai-analytics-signal-strip">
              <span><Coins size={13} /><b>{compactNumber(data?.totalInputTokens, isArabic)}</b> {tr('input tokens')}</span>
              <span><Zap size={13} /><b>{compactNumber(data?.totalOutputTokens, isArabic)}</b> {tr('output tokens')}</span>
              <span><TriangleAlert size={13} /><b>{number(data?.fallbackAttempts)}</b> {tr('fallback attempts')}</span>
              <span><Cpu size={13} /><b>{rawModels.length}</b> {tr('models represented')}</span>
            </div>

            <div className="admin-ai-analytics-filterbar">
              <div className="admin-ai-analytics-filterbar__top">
                <div>
                  <span className="admin-ai-analytics-panel__kicker"><CalendarRange size={13} /> {tr('Analytics filters')}</span>
                  <p>{tr('Filter the backend aggregation before comparing model performance.')}</p>
                </div>
                <div className="admin-ai-analytics-filterbar__buttons">
                  {(filters.fromDate || filters.toDate || filters.providerKey || filters.requestType) && (
                    <button type="button" className="admin-ai-analytics-clear" onClick={clearFilters}><X size={14} /> {tr('Clear')}</button>
                  )}
                  <button type="button" className="admin-ai-analytics-apply" onClick={applyFilters} disabled={refreshing}>
                    <RefreshCw size={14} /> {tr('Apply filters')}
                  </button>
                </div>
              </div>

              <div className="admin-ai-analytics-filter-grid">
                <label className="admin-ai-analytics-date-field">
                  <CalendarRange size={16} />
                  <span><small>{tr('From date')}</small><input type="date" value={filters.fromDate} max={filters.toDate || undefined} onChange={(event) => setFilters((old) => ({ ...old, fromDate: event.target.value }))} /></span>
                </label>
                <label className="admin-ai-analytics-date-field">
                  <CalendarRange size={16} />
                  <span><small>{tr('To date')}</small><input type="date" value={filters.toDate} min={filters.fromDate || undefined} onChange={(event) => setFilters((old) => ({ ...old, toDate: event.target.value }))} /></span>
                </label>
                <SelectMenu label="Provider" value={filters.providerKey} options={PROVIDER_OPTIONS} onChange={(value) => setFilters((old) => ({ ...old, providerKey: value }))} icon={ServerCog} tr={tr} />
                <SelectMenu label="Request type" value={filters.requestType} options={REQUEST_TYPE_OPTIONS} onChange={(value) => setFilters((old) => ({ ...old, requestType: value }))} icon={Activity} tr={tr} />
              </div>
            </div>
          </>
        )}
      </section>

      {!loading && (
        <section className="admin-ai-analytics-model-panel">
          <header className="admin-ai-analytics-model-head">
            <div>
              <span className="admin-ai-analytics-panel__kicker"><BrainCircuit size={13} /> {tr('Model intelligence')}</span>
              <h3>{tr('Model usage')}</h3>
              <p>{models.length} {tr('matching models')} · {compactNumber(totalTokens, isArabic)} {tr('total tokens')}</p>
            </div>
            <div className="admin-ai-analytics-highlights">
              <span><small>{tr('Most used')}</small><strong>{topModel ? displayModelName(topModel, tr) : '—'}</strong></span>
              <span><small>{tr('Fastest')}</small><strong>{fastestModel ? displayModelName(fastestModel, tr) : '—'}</strong></span>
            </div>
          </header>

          <div className="admin-ai-analytics-controls">
            <SelectMenu label="Sort models" value={sortBy} options={SORT_OPTIONS} onChange={setSortBy} icon={BarChart3} tr={tr} />
            <button type="button" className="admin-ai-analytics-sort-direction" onClick={() => setSortOrder((old) => (old === 'desc' ? 'asc' : 'desc'))} title={tr(sortOrder === 'desc' ? 'Descending' : 'Ascending')}>
              {sortOrder === 'desc' ? <ArrowDown size={17} /> : <ArrowUp size={17} />}
            </button>
            <label className="admin-ai-analytics-search">
              <Search size={17} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={tr('Search model, API model or provider...')} />
              {search && <button type="button" onClick={() => setSearch('')}><X size={14} /></button>}
            </label>
          </div>

          {models.length ? (
            <div className="admin-ai-analytics-model-grid">
              {models.map((item, index) => {
                const requests = Number(item.requests || 0);
                const traffic = percent(requests, totalRequests);
                return (
                  <article className="admin-ai-analytics-model-card" key={item.aiModelId || `${modelName(item)}-${index}`}>
                    <div className="admin-ai-analytics-model-card__head">
                      <div className="admin-ai-analytics-model-cell">
                        <span className="admin-ai-analytics-model-icon"><BrainCircuit size={18} /></span>
                        <div>
                          <strong>{displayModelName(item, tr)}</strong>
                          <span>{providerName(item?.model?.providerKey, tr)} · {item?.model?.apiModelId || tr('Legacy / unmapped')}</span>
                        </div>
                      </div>
                      <ReliabilityBadge successRate={item.calculatedSuccessRate} />
                    </div>

                    <div className="admin-ai-analytics-model-card__stats">
                      <div className="admin-ai-analytics-model-stat is-requests">
                        <span>{tr('Requests')}</span>
                        <strong>{number(requests)}</strong>
                        <small>{number(item.successfulRequests)} {tr('success')} · {number(item.failedRequests)} {tr('failed')}</small>
                      </div>

                      <div className="admin-ai-analytics-model-stat is-latency">
                        <span>{tr('Latency')}</span>
                        <strong><Timer size={14} /> {latency(item.averageResponseTimeMs, isArabic)}</strong>
                        <small>{tr('Average response time')}</small>
                      </div>

                      <div className="admin-ai-analytics-model-stat is-tokens">
                        <span>{tr('Tokens')}</span>
                        <strong>{compactNumber(item.calculatedTokens, isArabic)}</strong>
                        <small>{compactNumber(item.inputTokens, isArabic)} {tr('in')} · {compactNumber(item.outputTokens, isArabic)} {tr('out')}</small>
                      </div>

                      <div className="admin-ai-analytics-model-stat is-cost">
                        <span>{tr('Cost')}</span>
                        <strong>{money(item.cost)}</strong>
                        <small>{tr('Estimated usage cost')}</small>
                      </div>
                    </div>

                    <div className="admin-ai-analytics-model-card__traffic">
                      <div className="admin-ai-analytics-model-card__traffic-copy">
                        <span>{tr('Traffic share')}</span>
                        <strong>{traffic.toFixed(1)}%</strong>
                      </div>
                      <div className="admin-ai-analytics-share">
                        <div><i style={{ width: `${traffic}%` }} /></div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="admin-ai-analytics-empty">
              <BrainCircuit size={28} />
              <strong>{tr('No model usage found')}</strong>
              <p>{tr('Try changing the analytics filters or model search.')}</p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}