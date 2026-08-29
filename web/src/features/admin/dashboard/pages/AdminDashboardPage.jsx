/**
 * Administrator overview dashboard for the web application.
 *
 * The existing overview period selector supports day, week, month, year, and
 * all-time views while retaining the dashboard's current UI and data flow.
 *
 * @author Eman
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  Coins,
  Lightbulb,
  RefreshCw,
  Sparkles,
  UsersRound,
  Gauge,
  TrendingUp,
  Zap,
} from 'lucide-react';

import { useUserExperience } from '../../../../system/user-experience';
import { adminApi, getApiErrorMessage } from '../../shared/api/adminApi';
import '../../shared/styles/admin-pages.css';
import '../styles/admin-dashboard.css';

const nf = new Intl.NumberFormat('en-US');
const moneyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

const money = (value) => moneyFormatter.format(Number(value || 0));
const fmt = (value) => nf.format(Number(value || 0));

const ARABIC_MONTHS = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];

const shortDate = (value, isArabic = false) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  if (isArabic) {
    return `${date.getDate()} ${ARABIC_MONTHS[date.getMonth()]}`;
  }

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
};

const shortTime = (value, isArabic = false) => {
  if (!value) return '';
  return value.toLocaleTimeString(isArabic ? 'ar-EG-u-nu-latn' : undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
};

const DASHBOARD_ARABIC = {
  'System intelligence': 'ذكاء النظام',
  'Platform Overview': 'نظرة عامة على المنصة',
  'See the health of Voxidence at a glance — people, ideas, revenue, AI performance and live platform activity in one clear operational view.':
    'شاهد صحة فوكسيدنس في لمحة واحدة — المستخدمون والأفكار والإيرادات وأداء الذكاء الاصطناعي ونشاط المنصة المباشر في عرض تشغيلي واضح.',
  'Live workspace': 'مساحة عمل مباشرة',
  'AI success': 'نجاح الذكاء الاصطناعي',
  Response: 'الاستجابة',
  People: 'المستخدمون',
  Ideas: 'الأفكار',
  Overview: 'نظرة عامة',
  'Core platform numbers': 'الأرقام الأساسية للمنصة',
  'Change overview period': 'تغيير فترة النظرة العامة',
  'This day': 'هذا اليوم',
  'This week': 'هذا الأسبوع',
  'This month': 'هذا الشهر',
  'This year': 'هذه السنة',
  'All time': 'كل الوقت',
  'Dashboard data could not be loaded': 'تعذر تحميل بيانات لوحة التحكم',
  'The page will not replace missing server data with fake zero values.':
    'لن تستبدل الصفحة بيانات الخادم المفقودة بقيم صفرية غير حقيقية.',
  'Retrying…': 'جارٍ إعادة المحاولة…',
  Retry: 'إعادة المحاولة',
  'Try again': 'حاول مرة أخرى',
  'Loading dashboard': 'جارٍ تحميل لوحة التحكم',
  'Platform users': 'مستخدمو المنصة',
  'Generated ideas': 'الأفكار المولدة',
  'Total revenue': 'إجمالي الإيرادات',
  'AI success rate': 'معدل نجاح الذكاء الاصطناعي',
  'Credits sold': 'الرصيد المباع',
  'Avg AI response': 'متوسط استجابة الذكاء الاصطناعي',
  'Open complaints': 'الشكاوى المفتوحة',
  'Generated outputs': 'المخرجات المولدة',
  premium: 'بريميوم',
  unlocked: 'مفتوحة',
  paid: 'مدفوعة',
  requests: 'طلبات',
  refunds: 'مستردات',
  'AI cost': 'تكلفة الذكاء الاصطناعي',
  'in progress': 'قيد المعالجة',
  today: 'اليوم',
  'Growth signal': 'مؤشر النمو',
  'User growth': 'نمو المستخدمين',
  'Recent account creation trend': 'اتجاه إنشاء الحسابات مؤخرًا',
  Updated: 'آخر تحديث',
  'Refreshing…': 'جارٍ التحديث…',
  Refresh: 'تحديث',
  'No chart data yet.': 'لا توجد بيانات للمخطط بعد.',
  'Right now': 'الآن',
  'Current pulse': 'نبض المنصة الحالي',
  'Today compared with this month': 'اليوم مقارنة بهذا الشهر',
  Live: 'مباشر',
  'Users today': 'مستخدمو اليوم',
  'Ideas today': 'أفكار اليوم',
  'Revenue today': 'إيرادات اليوم',
  'Users this month': 'مستخدمو هذا الشهر',
  'Ideas this month': 'أفكار هذا الشهر',
  'Revenue this month': 'إيرادات هذا الشهر',
  'new accounts': 'حسابات جديدة',
  generated: 'تم توليدها',
  captured: 'تم تحصيلها',
  accounts: 'حسابات',
  total: 'الإجمالي',
  Community: 'المجتمع',
  'Recent users': 'أحدث المستخدمين',
  'Newest registered accounts': 'أحدث الحسابات المسجلة',
  Operations: 'العمليات',
  'Recent system activity': 'أحدث نشاط للنظام',
  'Ideas, payments and complaints': 'الأفكار والمدفوعات والشكاوى',
  User: 'مستخدم',
  'Generated idea': 'فكرة مولدة',
  'No domain': 'بدون مجال',
  'Smart Transit Synapse': 'ترابط النقل الذكي',
  Complaint: 'شكوى',
  'The dashboard request took too long. The backend now uses a lighter cached dashboard query; press Retry after restarting the backend with the updated service.':
    'استغرق طلب لوحة التحكم وقتًا طويلًا. يستخدم النظام الخلفي الآن استعلامًا أخف مع التخزين المؤقت؛ أعد تشغيل الخادم بالخدمة المحدثة ثم اضغط إعادة المحاولة.',
  'Could not load the admin dashboard.': 'تعذر تحميل لوحة تحكم المشرف.',
};

const ADMIN_VALUE_ARABIC = {
  ACTIVE: 'نشط',
  INACTIVE: 'غير نشط',
  DISABLED: 'معطّل',
  SUSPENDED: 'موقوف',
  LOCKED: 'مقفل',
  OPEN: 'مفتوحة',
  CLOSED: 'مغلقة',
  PENDING: 'قيد الانتظار',
  IN_PROGRESS: 'قيد المعالجة',
  SUCCESS: 'ناجح',
  SUCCEEDED: 'ناجح',
  COMPLETED: 'مكتمل',
  FAILED: 'فشل',
  REFUNDED: 'مسترد',
  PAID: 'مدفوع',
  FREE: 'مجاني',
  PREMIUM: 'بريميوم',
  LOW: 'منخفضة',
  MEDIUM: 'متوسطة',
  HIGH: 'عالية',
  URGENT: 'عاجلة',
  CREDIT_PURCHASE: 'شراء رصيد',
  CREDITS_PURCHASE: 'شراء رصيد',
  BUY_CREDITS: 'شراء رصيد',
  BUY_CREDIT: 'شراء رصيد',
  PURCHASE_CREDITS: 'شراء رصيد',
  IDEA_UNLOCK: 'فتح فكرة',
  DIRECT_UNLOCK: 'فتح مباشر',
  PUBLICATION_UNLOCK: 'فتح منشور',
  PUBLICATION_ACCESS: 'الوصول إلى منشور',
  PREMIUM_UPGRADE: 'ترقية بريميوم',
  SUBSCRIPTION: 'اشتراك',
};

const dashboardText = (text, isArabic) =>
  isArabic ? DASHBOARD_ARABIC[text] || text : text;

const normalizeDashboardDynamicTextKey = (value) =>
  String(value || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/[.,:;!?"'`()[\]{}\-_–—]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const DASHBOARD_DYNAMIC_ARABIC = {
  'smart transit synapse': 'ترابط النقل الذكي',
  'veritas semantic grounding engine': 'محرك فيريتاس للارتكاز الدلالي',
  'logistics status synchronization and exception triage hub':
    'مركز مزامنة حالة الخدمات اللوجستية وفرز الاستثناءات',
};

const localizeDashboardDynamicText = (value, { isArabic, t, fallback }) => {
  const source = String(value || fallback || '').trim();
  if (!source) return '—';
  if (!isArabic) return source;

  const normalizedKey = normalizeDashboardDynamicTextKey(source);
  const curated = DASHBOARD_DYNAMIC_ARABIC[normalizedKey];
  if (curated) return curated;

  return t(source);
};

const ADMIN_DISPLAY_NAME_CORRECTIONS = {
  'ملاك قبالة': { ar: 'ملاك قبالا', en: 'Malak Qabala' },
  'ملاك قباله': { ar: 'ملاك قبالا', en: 'Malak Qabala' },
  'ملاك قبالا': { ar: 'ملاك قبالا', en: 'Malak Qabala' },
  'ملك قبالة': { ar: 'ملاك قبالا', en: 'Malak Qabala' },
  'ملك قباله': { ar: 'ملاك قبالا', en: 'Malak Qabala' },
  'ملك قبالا': { ar: 'ملاك قبالا', en: 'Malak Qabala' },
  'malak qabala': { ar: 'ملاك قبالا', en: 'Malak Qabala' },
  'malak qabalah': { ar: 'ملاك قبالا', en: 'Malak Qabala' },
  'eman ismail': { ar: 'إيمان إسماعيل', en: 'Eman Ismail' },
  'eman esmail': { ar: 'إيمان إسماعيل', en: 'Eman Ismail' },
  'eman ismael': { ar: 'إيمان إسماعيل', en: 'Eman Ismail' },
  'iman ismail': { ar: 'إيمان إسماعيل', en: 'Eman Ismail' },
  'iman esmail': { ar: 'إيمان إسماعيل', en: 'Eman Ismail' },
  'eiman ismail': { ar: 'إيمان إسماعيل', en: 'Eman Ismail' },
  'إيمان اسماعيل': { ar: 'إيمان إسماعيل', en: 'Eman Ismail' },
  'ايمان اسماعيل': { ar: 'إيمان إسماعيل', en: 'Eman Ismail' },
  'ايمان إسماعيل': { ar: 'إيمان إسماعيل', en: 'Eman Ismail' },
};

const adminDisplayName = (value, isArabic = false) => {
  if (!value) return value;
  const normalized = String(value)
    .normalize('NFKC')
    .replace(/[ـً-ٰٟۖ-ۭ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const lookupKey = /[A-Za-z]/.test(normalized) ? normalized.toLowerCase() : normalized;
  const correction = ADMIN_DISPLAY_NAME_CORRECTIONS[lookupKey];
  if (!correction) return normalized;
  return isArabic ? correction.ar : correction.en;
};

const DASHBOARD_ENGLISH_NATURAL_CORRECTIONS = {
  'منصة التحقق التشغيلي وإدارة الأدلة': 'Operational Verification and Evidence Management Platform',
};

const naturalEnglishTranslationCache = new Map();
let naturalEnglishTranslatorPromise = null;
let naturalEnglishTranslatorUnsupported = false;

const containsArabicText = (value) => /[\u0600-\u06FF]/.test(String(value || ''));

async function getNaturalEnglishTranslator() {
  if (naturalEnglishTranslatorUnsupported) return null;
  if (naturalEnglishTranslatorPromise) return naturalEnglishTranslatorPromise;

  const TranslatorApi = typeof window !== 'undefined' ? window.Translator : undefined;
  if (!TranslatorApi || typeof TranslatorApi.create !== 'function') {
    naturalEnglishTranslatorUnsupported = true;
    return null;
  }

  naturalEnglishTranslatorPromise = (async () => {
    try {
      if (typeof TranslatorApi.availability === 'function') {
        const availability = await TranslatorApi.availability({
          sourceLanguage: 'ar',
          targetLanguage: 'en',
        });

        if (availability === 'unavailable') {
          naturalEnglishTranslatorUnsupported = true;
          return null;
        }

        if (
          (availability === 'downloadable' || availability === 'downloading') &&
          navigator?.userActivation &&
          !navigator.userActivation.hasBeenActive
        ) {
          return null;
        }
      }

      return await TranslatorApi.create({
        sourceLanguage: 'ar',
        targetLanguage: 'en',
      });
    } catch {
      return null;
    }
  })();

  const translator = await naturalEnglishTranslatorPromise;
  if (!translator && !naturalEnglishTranslatorUnsupported) {
    naturalEnglishTranslatorPromise = null;
  }
  return translator;
}

async function requestNaturalEnglishTranslation(value) {
  const source = String(value || '').trim();
  if (!source || !containsArabicText(source)) return source;

  const corrected = DASHBOARD_ENGLISH_NATURAL_CORRECTIONS[source];
  if (corrected) return corrected;

  if (naturalEnglishTranslationCache.has(source)) {
    return naturalEnglishTranslationCache.get(source);
  }

  const request = (async () => {
    const translator = await getNaturalEnglishTranslator();
    if (!translator || typeof translator.translate !== 'function') return source;

    try {
      const translated = String(await translator.translate(source) || '').trim();
      return translated && !containsArabicText(translated) ? translated : source;
    } catch {
      return source;
    }
  })();

  naturalEnglishTranslationCache.set(source, request);
  return request;
}

function EnglishNaturalText({ value, fallback = '' }) {
  const source = String(value || fallback || '').trim();
  const immediate = DASHBOARD_ENGLISH_NATURAL_CORRECTIONS[source] || source;
  const [translated, setTranslated] = useState(immediate);

  useEffect(() => {
    let active = true;
    const nextImmediate = DASHBOARD_ENGLISH_NATURAL_CORRECTIONS[source] || source;
    setTranslated(nextImmediate);

    if (!source || !containsArabicText(source) || nextImmediate !== source) {
      return () => {
        active = false;
      };
    }

    void requestNaturalEnglishTranslation(source).then((result) => {
      if (active && result) setTranslated(result);
    });

    return () => {
      active = false;
    };
  }, [source]);

  return translated || fallback || '—';
}

const localizeAdminValue = (value, isArabic) => {
  if (!isArabic || value === null || value === undefined || value === '') return value || '—';
  const key = String(value).trim().toUpperCase().replace(/[\s-]+/g, '_');
  return ADMIN_VALUE_ARABIC[key] || value;
};

const PAYMENT_STATUS_ARABIC = {
  PENDING: 'بانتظار إتمام الدفع',
  SUCCEEDED: 'تم الدفع بنجاح',
  SUCCESS: 'تم الدفع بنجاح',
  COMPLETED: 'تم الدفع بنجاح',
  PAID: 'تم الدفع بنجاح',
  FAILED: 'فشلت عملية الدفع',
  REFUNDED: 'تم استرداد المبلغ',
};

const localizePaymentStatus = (value, isArabic) => {
  if (!isArabic || value === null || value === undefined || value === '') return value || '—';
  const key = String(value).trim().toUpperCase().replace(/[\s-]+/g, '_');
  return PAYMENT_STATUS_ARABIC[key] || localizeAdminValue(value, true);
};

const uniqueRecentPaymentsByUser = (payments = [], limit = 2) => {
  const seenUsers = new Set();

  return payments
    .filter((payment) => {
      const userKey =
        payment?.user?.id ||
        payment?.user?.email ||
        payment?.userId ||
        payment?.id;

      if (!userKey || seenUsers.has(userKey)) return false;
      seenUsers.add(userKey);
      return true;
    })
    .slice(0, limit);
};

const DASHBOARD_SESSION_KEY = 'voxidence:admin-dashboard:snapshot';
const DASHBOARD_SESSION_TTL_MS = 120000;
const DEFAULT_OVERVIEW_PERIOD = 'week';
const OVERVIEW_PERIOD_OPTIONS = [
  { value: 'day', label: 'This day' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'year', label: 'This year' },
  { value: 'all', label: 'All time' },
];

const dashboardSessionKey = (period) => `${DASHBOARD_SESSION_KEY}:${period}`;

function readDashboardSnapshot(period = DEFAULT_OVERVIEW_PERIOD) {
  try {
    const raw = window.sessionStorage.getItem(dashboardSessionKey(period));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.data || !parsed?.savedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeDashboardSnapshot(data, period = DEFAULT_OVERVIEW_PERIOD) {
  try {
    window.sessionStorage.setItem(
      dashboardSessionKey(period),
      JSON.stringify({ data, savedAt: Date.now() }),
    );
  } catch {
  }
}

function Stat({ icon: Icon, label, value, meta, tone = 'mint', featured = false }) {
  return (
    <article className={`admin-stat admin-stat--${tone} ${featured ? 'admin-stat--featured' : ''}`}>
      <div className="admin-stat__topline">
        <span className="admin-stat__icon">
          <Icon size={18} />
        </span>
        <span className="admin-stat__meta">{meta}</span>
      </div>
      <div className="admin-stat__body">
        <strong>{value}</strong>
        <small>{label}</small>
      </div>
      <span className="admin-stat__glow" aria-hidden="true" />
    </article>
  );
}

function StatSkeleton() {
  return (
    <article className="admin-stat admin-stat--skeleton" aria-hidden="true">
      <span className="admin-skeleton admin-skeleton--icon" />
      <span className="admin-skeleton admin-skeleton--value" />
      <span className="admin-skeleton admin-skeleton--label" />
    </article>
  );
}

function ActivityItem({
  icon: Icon,
  title,
  meta,
  tone = 'mint',
  titleDir = 'auto',
  metaDir = 'auto',
  autoTranslateTitle = false,
  autoTranslateMeta = false,
}) {
  return (
    <div className={`admin-activity__item admin-activity__item--${tone}`}>
      <span className="admin-activity__dot">
        <Icon size={15} />
      </span>
      <div>
        {/*
          Keep identity/payment values protected, while allowing generated idea
          titles/domains and complaint subjects to use the Arabic natural-text
          fallback when they do not have a curated translation yet.
        */}
        <strong
          data-no-auto-translate={autoTranslateTitle ? undefined : 'true'}
          dir={titleDir}
        >
          {title}
        </strong>
        <span
          data-no-auto-translate={autoTranslateMeta ? undefined : 'true'}
          dir={metaDir}
        >
          {meta}
        </span>
      </div>
    </div>
  );
}

function OverviewHeader({ period, onChange, loading, isArabic }) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);

  const activeOption =
    OVERVIEW_PERIOD_OPTIONS.find((option) => option.value === period) ||
    OVERVIEW_PERIOD_OPTIONS[1];

  useEffect(() => {
    if (!open) return undefined;

    const handleClickOutside = (event) => {
      if (!dropdownRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const handleSelect = (value) => {
    setOpen(false);
    if (value !== period) {
      onChange(value);
    }
  };

  return (
    <section className="admin-overview-head">
      <div className="admin-overview-head__title">
        <span className="admin-overview-head__icon">
          <CalendarDays size={18} />
        </span>
        <div>
          <h3>{dashboardText('Overview', isArabic)}</h3>
          <p>{dashboardText('Core platform numbers', isArabic)}</p>
        </div>
      </div>

      <div
        ref={dropdownRef}
        className={`admin-overview-period ${loading ? 'is-loading' : ''} ${open ? 'is-open' : ''}`}
      >
        <button
          type="button"
          className="admin-overview-period__trigger"
          onClick={() => !loading && setOpen((current) => !current)}
          disabled={loading}
          aria-label={dashboardText('Change overview period', isArabic)}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span>{dashboardText(activeOption.label, isArabic)}</span>
          <ChevronDown size={17} aria-hidden="true" />
        </button>

        {open ? (
          <div className="admin-overview-period__menu" role="listbox">
            {OVERVIEW_PERIOD_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={period === option.value}
                className={`admin-overview-period__option ${period === option.value ? 'is-active' : ''}`}
                onClick={() => handleSelect(option.value)}
              >
                {dashboardText(option.label, isArabic)}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function DashboardError({ message, onRetry, retrying, isArabic }) {
  return (
    <section className="admin-dashboard-error" role="alert">
      <span className="admin-dashboard-error__icon">
        <AlertTriangle size={20} />
      </span>
      <div>
        <strong>{dashboardText('Dashboard data could not be loaded', isArabic)}</strong>
        <p>{dashboardText(message, isArabic)}</p>
        <small>{dashboardText('The page will not replace missing server data with fake zero values.', isArabic)}</small>
      </div>
      <button
        type="button"
        className="admin-btn admin-btn--primary"
        onClick={onRetry}
        disabled={retrying}
      >
        <RefreshCw size={14} className={retrying ? 'is-spinning' : ''} />
        {dashboardText(retrying ? 'Retrying…' : 'Retry', isArabic)}
      </button>
    </section>
  );
}

export default function AdminDashboardPage() {
  const { isArabic, t } = useUserExperience();
  const initialSnapshot = useMemo(() => readDashboardSnapshot(DEFAULT_OVERVIEW_PERIOD), []);
  const requestIdRef = useRef(0);
  const overviewPeriodRef = useRef(DEFAULT_OVERVIEW_PERIOD);
  const [data, setData] = useState(initialSnapshot?.data || null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!initialSnapshot?.data);
  const [overviewPeriod, setOverviewPeriod] = useState(DEFAULT_OVERVIEW_PERIOD);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(
    initialSnapshot?.savedAt ? new Date(initialSnapshot.savedAt) : null,
  );

  const load = useCallback(async ({ background = false, period, fresh = false } = {}) => {
    const requestedPeriod = period || overviewPeriodRef.current;
    const requestId = ++requestIdRef.current;

    if (!background) setLoading(true);
    setError('');

    try {
      const dashboardLoader = fresh ? adminApi.getDashboardFresh : adminApi.getDashboard;
      const response = await dashboardLoader(requestedPeriod);
      if (requestId !== requestIdRef.current) return;
      setData(response);
      setLastUpdatedAt(new Date());
      writeDashboardSnapshot(response, requestedPeriod);
    } catch (requestError) {
      if (requestId !== requestIdRef.current) return;
      const isTimeout =
        requestError?.code === 'ECONNABORTED' ||
        /timeout/i.test(requestError?.message || '');

      setError(
        isTimeout
          ? 'The dashboard request took too long. The backend now uses a lighter cached dashboard query; press Retry after restarting the backend with the updated service.'
          : getApiErrorMessage(requestError, 'Could not load the admin dashboard.'),
      );
    } finally {
      if (requestId === requestIdRef.current && !background) setLoading(false);
    }
  }, []);

  const changeOverviewPeriod = useCallback((period) => {
    if (period === overviewPeriodRef.current || loading) return;

    overviewPeriodRef.current = period;
    setOverviewPeriod(period);
    setError('');

    const snapshot = readDashboardSnapshot(period);
    if (snapshot?.data) {
      setData(snapshot.data);
      setLastUpdatedAt(snapshot.savedAt ? new Date(snapshot.savedAt) : null);
    }

    const snapshotAge = snapshot?.savedAt ? Date.now() - snapshot.savedAt : Infinity;
    load({
      background: Boolean(snapshot?.data) && snapshotAge < DASHBOARD_SESSION_TTL_MS,
      period,
    });
  }, [load, loading]);

  useEffect(() => {
    const snapshotAge = initialSnapshot?.savedAt ? Date.now() - initialSnapshot.savedAt : Infinity;
    load({
      background: Boolean(initialSnapshot?.data) && snapshotAge < DASHBOARD_SESSION_TTL_MS,
      period: DEFAULT_OVERVIEW_PERIOD,
    });
  }, [initialSnapshot, load]);

  const chart = useMemo(
    () => (Array.isArray(data?.usersGrowthChart) ? data.usersGrowthChart.slice(-12) : []),
    [data],
  );

  const maxChart = Math.max(1, ...chart.map((point) => Number(point.count || 0)));
  const hasData = Boolean(data);
  const aiSuccess = Number(data?.aiSuccessRate || 0);
  const localizedError = dashboardText(error, isArabic);

  return (
    <div className="admin-page admin-dashboard-page">
      <section className="admin-command-hero">
        <div className="admin-command-hero__copy">
          <div className="admin-hero__eyebrow">
            <Sparkles size={14} /> {dashboardText('System intelligence', isArabic)}
          </div>
          <h2>{dashboardText('Platform Overview', isArabic)}</h2>
          <p>
            {dashboardText(
              'See the health of Voxidence at a glance — people, ideas, revenue, AI performance and live platform activity in one clear operational view.',
              isArabic,
            )}
          </p>

          <div className="admin-command-hero__chips">
            <span>
              <span className="admin-live-dot" />
              {dashboardText('Live workspace', isArabic)}
            </span>
            {hasData ? (
              <span>
                <Zap size={13} />
                {isArabic
                  ? `${fmt(data.todayStats?.ideas)} ${dashboardText('Ideas today', true)}`
                  : `${fmt(data.todayStats?.ideas)} ideas today`}
              </span>
            ) : null}
            {hasData ? (
              <span>
                <TrendingUp size={13} />
                {isArabic
                  ? `${dashboardText('Revenue today', true)} ${money(data.todayStats?.revenue)}`
                  : `${money(data.todayStats?.revenue)} today`}
              </span>
            ) : null}
          </div>
        </div>

        <div className="admin-command-hero__visual" aria-hidden={!hasData}>
          <div className="admin-overview-scene">
            <div className="admin-overview-scene__halo admin-overview-scene__halo--one" />
            <div className="admin-overview-scene__halo admin-overview-scene__halo--two" />

            <div className="admin-health-orbit">
              <div className="admin-health-orbit__ring" />
              <div className="admin-health-orbit__core">
                <span className="admin-health-orbit__icon"><BrainCircuit size={24} /></span>
                <strong>{hasData ? `${aiSuccess.toFixed(1)}%` : '—'}</strong>
                <small>{dashboardText('AI success', isArabic)}</small>
              </div>
              <span className="admin-orbit-node admin-orbit-node--one" />
              <span className="admin-orbit-node admin-orbit-node--two" />
              <span className="admin-orbit-node admin-orbit-node--three" />
            </div>

            <div className="admin-command-hero__mini admin-command-hero__mini--response">
              <Gauge size={16} />
              <div>
                <span>{dashboardText('Response', isArabic)}</span>
                <strong>{hasData ? `${Number(data.averageResponseTime || 0).toFixed(0)} ms` : '—'}</strong>
              </div>
            </div>

            <div className="admin-command-hero__mini admin-command-hero__mini--users">
              <UsersRound size={16} />
              <div>
                <span>{dashboardText('People', isArabic)}</span>
                <strong>{hasData ? fmt(data.users) : '—'}</strong>
              </div>
            </div>

            <div className="admin-command-hero__mini admin-command-hero__mini--ideas">
              <Lightbulb size={16} />
              <div>
                <span>{dashboardText('Ideas', isArabic)}</span>
                <strong>{hasData ? fmt(data.ideas) : '—'}</strong>
              </div>
            </div>
          </div>
        </div>
      </section>

      {error && !hasData ? (
        <DashboardError
          message={error}
          onRetry={() => load({ fresh: true })}
          retrying={loading}
          isArabic={isArabic}
        />
      ) : null}

      {error && hasData ? (
        <div className="admin-error admin-error--inline-refresh">
          <span>{localizedError}</span>
          <button type="button" className="admin-btn" onClick={() => load({ fresh: true })}>
            <RefreshCw size={13} /> {dashboardText('Try again', isArabic)}
          </button>
        </div>
      ) : null}

      <OverviewHeader
        period={overviewPeriod}
        onChange={changeOverviewPeriod}
        loading={loading}
        isArabic={isArabic}
      />

      {!hasData && loading ? (
        <section className="admin-stat-grid" aria-label={dashboardText('Loading dashboard', isArabic)}>
          {Array.from({ length: 8 }).map((_, index) => <StatSkeleton key={index} />)}
        </section>
      ) : null}

      {hasData ? (
        <>
          <section className="admin-stat-grid admin-stat-grid--mosaic">
            <Stat
              featured
              tone="aqua"
              icon={UsersRound}
              label={dashboardText('Platform users', isArabic)}
              value={fmt(data.users)}
              meta={isArabic ? `${fmt(data.premiumUsers)} ${dashboardText('premium', true)}` : `${fmt(data.premiumUsers)} premium`}
            />
            <Stat
              tone="sage"
              icon={Lightbulb}
              label={dashboardText('Generated ideas', isArabic)}
              value={fmt(data.ideas)}
              meta={isArabic ? `${fmt(data.unlockedIdeas)} ${dashboardText('unlocked', true)}` : `${fmt(data.unlockedIdeas)} unlocked`}
            />
            <Stat
              featured
              tone="rose"
              icon={CircleDollarSign}
              label={dashboardText('Total revenue', isArabic)}
              value={money(data.revenueTotal)}
              meta={isArabic ? `${fmt(data.successfulPaymentsCount)} ${dashboardText('paid', true)}` : `${fmt(data.successfulPaymentsCount)} paid`}
            />
            <Stat
              tone="mint"
              icon={BrainCircuit}
              label={dashboardText('AI success rate', isArabic)}
              value={`${aiSuccess.toFixed(1)}%`}
              meta={isArabic ? `${fmt(data.aiRequests)} ${dashboardText('requests', true)}` : `${fmt(data.aiRequests)} requests`}
            />
            <Stat
              tone="sage"
              icon={Coins}
              label={dashboardText('Credits sold', isArabic)}
              value={fmt(data.creditsSold)}
              meta={isArabic ? `${money(data.refundsTotal)} ${dashboardText('refunds', true)}` : `${money(data.refundsTotal)} refunds`}
            />
            <Stat
              tone="aqua"
              icon={Activity}
              label={dashboardText('Avg AI response', isArabic)}
              value={`${Number(data.averageResponseTime || 0).toFixed(0)} ms`}
              meta={isArabic ? `${dashboardText('AI cost', true)} ${money(data.aiCost)}` : `${money(data.aiCost)} AI cost`}
            />
            <Stat
              tone="rose"
              icon={AlertTriangle}
              label={dashboardText('Open complaints', isArabic)}
              value={fmt(data.openComplaints)}
              meta={isArabic ? `${fmt(data.inProgressComplaints)} ${dashboardText('in progress', true)}` : `${fmt(data.inProgressComplaints)} in progress`}
            />
            <Stat
              tone="mint"
              icon={Sparkles}
              label={dashboardText('Generated outputs', isArabic)}
              value={fmt(data.generatedOutputs)}
              meta={isArabic ? `${fmt(data.todayStats?.ideas)} ${dashboardText('today', true)}` : `${fmt(data.todayStats?.ideas)} today`}
            />
          </section>

          <section className="admin-dashboard-grid admin-dashboard-grid--insight">
            <article className="admin-panel admin-panel--growth">
              <header className="admin-panel__head admin-panel__head--airy">
                <div>
                  <span className="admin-panel__kicker">{dashboardText('Growth signal', isArabic)}</span>
                  <h3>{dashboardText('User growth', isArabic)}</h3>
                  <p>{dashboardText('Recent account creation trend', isArabic)}</p>
                </div>
                <div className="admin-dashboard-refresh-group">
                  {lastUpdatedAt ? (
                    <span className="admin-dashboard-updated">
                      {dashboardText('Updated', isArabic)} {shortTime(lastUpdatedAt, isArabic)}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="admin-btn admin-btn--soft"
                    onClick={() => load({ fresh: true })}
                    disabled={loading}
                  >
                    <RefreshCw size={14} className={loading ? 'is-spinning' : ''} />
                    {dashboardText(loading ? 'Refreshing…' : 'Refresh', isArabic)}
                  </button>
                </div>
              </header>

              <div className="admin-chart">
                <div className="admin-chart__guide admin-chart__guide--one" />
                <div className="admin-chart__guide admin-chart__guide--two" />
                <div className="admin-chart__bars">
                  {chart.length ? chart.map((point) => {
                    const pointCount = Number(point.count || 0);
                    const isZero = pointCount <= 0;
                    const barHeight = isZero
                      ? '4px'
                      : `${Math.max(8, (pointCount / maxChart) * 100)}%`;

                    return (
                      <div className="admin-chart__column" key={point.date}>
                        <div
                          className={`admin-chart__bar ${isZero ? 'is-zero' : ''}`}
                          title={`${point.date}: ${point.count}`}
                          style={{ height: barHeight }}
                        >
                          <b>{fmt(point.count)}</b>
                        </div>
                        <span>{shortDate(point.date, isArabic)}</span>
                      </div>
                    );
                  }) : (
                    <div className="admin-empty">
                      <p>{dashboardText('No chart data yet.', isArabic)}</p>
                    </div>
                  )}
                </div>
              </div>
            </article>

            <article className="admin-panel admin-panel--pulse">
              <header className="admin-panel__head admin-panel__head--airy">
                <div>
                  <span className="admin-panel__kicker">{dashboardText('Right now', isArabic)}</span>
                  <h3>{dashboardText('Current pulse', isArabic)}</h3>
                  <p>{dashboardText('Today compared with this month', isArabic)}</p>
                </div>
                <span className="admin-pulse-badge">
                  <span className="admin-live-dot" /> {dashboardText('Live', isArabic)}
                </span>
              </header>

              <div className="admin-summary-strip admin-summary-strip--cards">
                <article>
                  <small>{dashboardText('Users today', isArabic)}</small>
                  <strong>{fmt(data.todayStats?.users)}</strong>
                  <span>{dashboardText('new accounts', isArabic)}</span>
                </article>
                <article>
                  <small>{dashboardText('Ideas today', isArabic)}</small>
                  <strong>{fmt(data.todayStats?.ideas)}</strong>
                  <span>{dashboardText('generated', isArabic)}</span>
                </article>
                <article className="is-accent">
                  <small>{dashboardText('Revenue today', isArabic)}</small>
                  <strong>{money(data.todayStats?.revenue)}</strong>
                  <span>{dashboardText('captured', isArabic)}</span>
                </article>
                <article>
                  <small>{dashboardText('Users this month', isArabic)}</small>
                  <strong>{fmt(data.monthlyStats?.users)}</strong>
                  <span>{dashboardText('accounts', isArabic)}</span>
                </article>
                <article>
                  <small>{dashboardText('Ideas this month', isArabic)}</small>
                  <strong>{fmt(data.monthlyStats?.ideas)}</strong>
                  <span>{dashboardText('generated', isArabic)}</span>
                </article>
                <article className="is-accent">
                  <small>{dashboardText('Revenue this month', isArabic)}</small>
                  <strong>{money(data.monthlyStats?.revenue)}</strong>
                  <span>{dashboardText('total', isArabic)}</span>
                </article>
              </div>
            </article>
          </section>

          <section className="admin-dashboard-grid admin-dashboard-grid--activity">
            <article className="admin-panel admin-panel--activity-list">
              <header className="admin-panel__head admin-panel__head--airy">
                <div>
                  <span className="admin-panel__kicker">{dashboardText('Community', isArabic)}</span>
                  <h3>{dashboardText('Recent users', isArabic)}</h3>
                  <p>{dashboardText('Newest registered accounts', isArabic)}</p>
                </div>
                <UsersRound size={18} className="admin-panel__head-icon" />
              </header>
              <div className="admin-activity">
                {(data.recentActivity?.recentUsers || []).slice(0, 6).map((item, index) => (
                  <ActivityItem
                    key={item.id}
                    icon={UsersRound}
                    title={adminDisplayName(item.fullName, isArabic) || item.email}
                    meta={`${localizeAdminValue(item.accountStatus, isArabic)} · ${shortDate(item.createdAt, isArabic)}`}
                    tone={index === 0 ? 'aqua' : 'mint'}
                    titleDir="auto"
                    metaDir={isArabic ? 'rtl' : 'auto'}
                  />
                ))}
              </div>
            </article>

            <article className="admin-panel admin-panel--activity-list">
              <header className="admin-panel__head admin-panel__head--airy">
                <div>
                  <span className="admin-panel__kicker">{dashboardText('Operations', isArabic)}</span>
                  <h3>{dashboardText('Recent system activity', isArabic)}</h3>
                  <p>{dashboardText('Ideas, payments and complaints', isArabic)}</p>
                </div>
                <Activity size={18} className="admin-panel__head-icon" />
              </header>
              <div className="admin-activity admin-activity--timeline">
                {uniqueRecentPaymentsByUser(data.recentActivity?.recentPayments || [], 2).map((item) => (
                  <ActivityItem
                    key={item.id}
                    icon={CircleDollarSign}
                    title={`${money(item.amount)} · ${localizeAdminValue(item.paymentPurpose, isArabic)}`}
                    meta={`${adminDisplayName(item.user?.fullName, isArabic) || item.user?.email || dashboardText('User', isArabic)} · ${localizePaymentStatus(item.status, isArabic)}`}
                    tone="aqua"
                    titleDir={isArabic ? 'rtl' : 'auto'}
                    metaDir={isArabic ? 'rtl' : 'auto'}
                  />
                ))}
                {(data.recentActivity?.recentIdeas || []).slice(0, 2).map((item) => (
                  <ActivityItem
                    key={item.id}
                    icon={Lightbulb}
                    title={
                      isArabic ? (
                        localizeDashboardDynamicText(item.title, {
                          isArabic: true,
                          t,
                          fallback: dashboardText('Generated idea', true),
                        })
                      ) : (
                        <EnglishNaturalText
                          value={item.title}
                          fallback={dashboardText('Generated idea', false)}
                        />
                      )
                    }
                    meta={
                      isArabic ? (
                        `${item.domain?.name ? t(item.domain.name) : dashboardText('No domain', true)} · ${shortDate(item.createdAt, true)}`
                      ) : (
                        <>
                          <EnglishNaturalText
                            value={item.domain?.name}
                            fallback={dashboardText('No domain', false)}
                          />
                          {' · '}
                          {shortDate(item.createdAt, false)}
                        </>
                      )
                    }
                    tone="mint"
                    titleDir={isArabic ? 'rtl' : 'auto'}
                    metaDir={isArabic ? 'rtl' : 'auto'}
                    autoTranslateTitle={isArabic}
                    autoTranslateMeta={isArabic}
                  />
                ))}
                {(data.recentActivity?.recentComplaints || []).slice(0, 2).map((item) => (
                  <ActivityItem
                    key={item.id}
                    icon={AlertTriangle}
                    title={
                      isArabic ? (
                        t(item.subject || 'Complaint')
                      ) : (
                        <EnglishNaturalText
                          value={item.subject}
                          fallback={dashboardText('Complaint', false)}
                        />
                      )
                    }
                    meta={`${localizeAdminValue(item.priority, isArabic)} · ${localizeAdminValue(item.status, isArabic)}`}
                    tone="rose"
                    titleDir={isArabic ? 'rtl' : 'auto'}
                    metaDir={isArabic ? 'rtl' : 'auto'}
                    autoTranslateTitle={isArabic}
                  />
                ))}
              </div>
            </article>
          </section>
        </>
      ) : null}
    </div>
  );
}