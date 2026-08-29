import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  Fingerprint,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  SlidersHorizontal,
  Smartphone,
  UserRound,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useUserExperience } from '../../../../system/user-experience';
import { adminApi, getApiErrorMessage } from '../../shared/api/adminApi';
import '../../shared/styles/admin-pages.css';
import '../styles/admin-auth-security.css';

const PAGE_SIZE = 20;

const AUTH_SECURITY_DARK_ARABIC_COPY = {
  'All authentication events': 'كل أحداث المصادقة',
  'Register': 'تسجيل حساب',
  'Login success': 'نجاح تسجيل الدخول',
  'Login failed': 'فشل تسجيل الدخول',
  'Logout': 'تسجيل الخروج',
  'Refresh token': 'تحديث رمز الجلسة',
  'Change password': 'تغيير كلمة المرور',
  'Forgot password': 'طلب استعادة كلمة المرور',
  'Reset password': 'إعادة تعيين كلمة المرور',
  'Resend verification email': 'إعادة إرسال رسالة التحقق',
  'Account locked': 'تم قفل الحساب',
  'Account deactivated': 'تم تعطيل الحساب',
  'Email changed': 'تم تغيير البريد الإلكتروني',
  'Verification email sent': 'تم إرسال رسالة التحقق',
  'Verify email failed': 'فشل التحقق من البريد الإلكتروني',
  'Reset password failed': 'فشل إعادة تعيين كلمة المرور',
  'Refresh token failed': 'فشل تحديث رمز الجلسة',
  'All results': 'كل النتائج',
  'Successful': 'ناجحة',
  'Failed': 'فاشلة',
  'Event date': 'تاريخ الحدث',
  'Event type': 'نوع الحدث',
  'Email': 'البريد الإلكتروني',
  'Result': 'النتيجة',
  'Sort': 'الترتيب',
  'Toggle sort direction': 'تبديل اتجاه الترتيب',
  'AUTHENTICATION EVENT': 'حدث مصادقة',
  'Close security event details': 'إغلاق تفاصيل حدث الأمان',
  'Account': 'الحساب',
  'Unknown account': 'حساب غير معروف',
  'Network': 'الشبكة',
  'Unknown IP': 'عنوان IP غير معروف',
  'Recorded request address': 'عنوان الشبكة المسجل للطلب',
  'Device': 'الجهاز',
  'Unknown device': 'جهاز غير معروف',
  'No user agent stored': 'لا توجد معلومات جهاز محفوظة',
  'SECURITY RESULT': 'نتيجة الأمان',
  'Authentication event completed successfully': 'اكتمل حدث المصادقة بنجاح',
  'Authentication event failed': 'فشل حدث المصادقة',
  'No additional security message was recorded for this event.': 'لم يتم تسجيل رسالة أمان إضافية لهذا الحدث.',
  'Log ID': 'معرّف السجل',
  'User ID': 'معرّف المستخدم',
  'Role': 'الدور',
  'Account active': 'الحساب نشط',
  'Email verified': 'البريد موثّق',
  'Event result': 'نتيجة الحدث',
  'Yes': 'نعم',
  'No': 'لا',
  'Could not load authentication security activity.': 'تعذر تحميل نشاط أمان المصادقة.',
  'IDENTITY SECURITY': 'أمن الهوية',
  'Authentication': 'أمان',
  'security': 'المصادقة',
  'Inspect login, password, verification and token activity with account, device and network context.': 'افحص نشاط تسجيل الدخول وكلمات المرور والتحقق ورموز الجلسات ضمن سياق الحساب والجهاز والشبكة.',
  'View security insights': 'عرض مؤشرات الأمان',
  'Explore activity': 'استكشاف النشاط',
  'Refresh': 'تحديث',
  'Authentication security metrics': 'مقاييس أمان المصادقة',
  'Total events': 'مجموع الأحداث',
  'Current audit scope': 'نطاق التدقيق الحالي',
  'Verified activity': 'نشاط تم التحقق منه',
  'Risky attempts': 'محاولات محفوفة بالمخاطر',
  'Network sources': 'مصادر الشبكة',
  'network sources': 'مصادر شبكة',
  'successful': 'ناجح',
  'of activity': 'من النشاط',
  'identified users': 'مستخدمون محددون',
  'Authentication activity filters': 'مرشحات نشاط المصادقة',
  'ACTIVITY CONTROLS': 'عناصر التحكم بالنشاط',
  'Search and refine the security feed': 'ابحث وخصص سجل نشاط الأمان',
  'Close filters': 'إغلاق المرشحات',
  'Event': 'الحدث',
  'From': 'من',
  'To': 'إلى',
  'Search account, email, IP or device...': 'ابحث عن حساب أو بريد إلكتروني أو IP أو جهاز...',
  'Clear filters': 'مسح المرشحات',
  'Security overview': 'نظرة عامة على الأمان',
  'Security score': 'درجة الأمان',
  'Strong': 'قوي',
  'verified events': 'أحداث تم التحقق منها',
  'Good': 'جيد',
  'Monitoring': 'قيد المراقبة',
  'Active': 'نشط',
  'Attention': 'يتطلب الانتباه',
  'failed events': 'أحداث فاشلة',
  'Review': 'مراجعة',
  'Low': 'منخفض',
  'Recent activity': 'النشاط الأخير',
  'Filters': 'المرشحات',
  'Loading security activity…': 'جارٍ تحميل نشاط الأمان…',
  'No authentication events match these filters.': 'لا توجد أحداث مصادقة تطابق هذه المرشحات.',
  'Previous': 'السابق',
  'Next': 'التالي',
  'events': 'أحداث',
  'Risk map': 'خريطة المخاطر',
  'Dynamic authentication risk map': 'خريطة ديناميكية لمخاطر المصادقة',
  'risky sources': 'مصادر خطرة',
  'failed': 'فاشلة',
  'locked': 'مقفلة',
  'No network sources in this scope': 'لا توجد مصادر شبكة ضمن هذا النطاق',
  'NETWORK SOURCES': 'مصادر الشبكة',
  'FAILED EVENTS': 'الأحداث الفاشلة',
  'LOCK EVENTS': 'أحداث القفل',
  'Quick actions': 'إجراءات سريعة',
  'Review failed logins': 'مراجعة محاولات الدخول الفاشلة',
  'Account lock events': 'أحداث قفل الحساب',
  'Advanced filters': 'مرشحات متقدمة',
  'Reset activity view': 'إعادة ضبط عرض النشاط',
  'All security tools': 'كل أدوات الأمان',
  'Just now': 'الآن',
  'Unknown OS': 'نظام تشغيل غير معروف',
  'Unknown browser': 'متصفح غير معروف',
  'Android': 'أندرويد',
  'Windows': 'ويندوز',
  'Linux': 'لينكس',
  'Chrome': 'كروم',
  'Firefox': 'فايرفوكس',
  'Safari': 'سفاري',
  'Edge': 'إيدج',
  'macOS': 'ماك أو إس',
  'iOS': 'آي أو إس',
  'ADMIN': 'مشرف',
  'USER': 'مستخدم',
  'NORMAL_USER': 'مستخدم',
  'PREMIUM': 'مميز',
};

function useAuthSecurityCopy() {
  const { isArabic, isDark, t } = useUserExperience();
  const darkArabic = isArabic && isDark;
  const tr = (value) => {
    if (!darkArabic || typeof value !== 'string') return value;
    return AUTH_SECURITY_DARK_ARABIC_COPY[value] ?? t(value);
  };
  return { darkArabic, tr };
}

const RISK_MAP_SLOTS = [
  [54, 67], [78, 57], [101, 68], [124, 59], [71, 84], [108, 88],
  [135, 74], [165, 73], [188, 84], [181, 103], [198, 122], [211, 96],
  [278, 49], [306, 42], [333, 53], [360, 46], [389, 55], [416, 64],
  [298, 70], [326, 82], [352, 75], [381, 88], [411, 79], [357, 121],
  [376, 134], [392, 124],
];

function hashString(value) {
  let hash = 2166136261;
  const text = String(value || 'unknown');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function buildRiskMapPoints(sources) {
  const occupied = new Map();

  return (Array.isArray(sources) ? sources : []).map((source, index) => {
    const seed = hashString(source.ipAddress || index);
    const baseIndex = seed % RISK_MAP_SLOTS.length;
    const collisionCount = occupied.get(baseIndex) || 0;
    occupied.set(baseIndex, collisionCount + 1);

    const [baseX, baseY] = RISK_MAP_SLOTS[baseIndex];
    const angle = ((seed >>> 8) % 360) * (Math.PI / 180);
    const offset = Math.min(collisionCount, 3) * 4.5;
    const x = Math.max(20, Math.min(450, baseX + (Math.cos(angle) * offset)));
    const y = Math.max(24, Math.min(172, baseY + (Math.sin(angle) * offset)));
    const totalEvents = Number(source.totalEvents || 0);
    const radius = Math.max(4.2, Math.min(9.5, 4.2 + (Math.log2(totalEvents + 1) * 1.2)));

    return {
      ...source,
      x,
      y,
      radius,
    };
  });
}

const ACTION_OPTIONS = [
  { key: '', label: 'All authentication events' },
  { key: 'REGISTER', label: 'Register' },
  { key: 'LOGIN_SUCCESS', label: 'Login success' },
  { key: 'LOGIN_FAILED', label: 'Login failed' },
  { key: 'LOGOUT', label: 'Logout' },
  { key: 'REFRESH_TOKEN', label: 'Refresh token' },
  { key: 'CHANGE_PASSWORD', label: 'Change password' },
  { key: 'FORGOT_PASSWORD', label: 'Forgot password' },
  { key: 'RESET_PASSWORD', label: 'Reset password' },
  { key: 'EMAIL_VERIFIED', label: 'Email verified' },
  { key: 'RESEND_VERIFICATION_EMAIL', label: 'Resend verification email' },
  { key: 'ACCOUNT_LOCKED', label: 'Account locked' },
  { key: 'ACCOUNT_DEACTIVATED', label: 'Account deactivated' },
  { key: 'EMAIL_CHANGED', label: 'Email changed' },
  { key: 'VERIFICATION_EMAIL_SENT', label: 'Verification email sent' },
  { key: 'VERIFY_EMAIL_FAILED', label: 'Verify email failed' },
  { key: 'RESET_PASSWORD_FAILED', label: 'Reset password failed' },
  { key: 'REFRESH_TOKEN_FAILED', label: 'Refresh token failed' },
];

const RESULT_OPTIONS = [
  { key: '', label: 'All results' },
  { key: 'true', label: 'Successful' },
  { key: 'false', label: 'Failed' },
];

const SORT_OPTIONS = [
  { key: 'createdAt', label: 'Event date' },
  { key: 'action', label: 'Event type' },
  { key: 'email', label: 'Email' },
  { key: 'isSuccess', label: 'Result' },
];


function authenticationActionLabel(value, tr) {
  const option = ACTION_OPTIONS.find((item) => item.key === value);
  return tr(option?.label || humanize(value));
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unwrapRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!isObject(payload)) return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.items)) return payload.items;
  if (isObject(payload.data) && Array.isArray(payload.data.data)) return payload.data.data;
  return [];
}

function unwrapMeta(payload, count) {
  const source = payload?.meta || payload?.pagination || payload?.data?.meta || {};
  const total = Number(source.total ?? count) || 0;
  const page = Number(source.page ?? 1) || 1;
  const limit = Number(source.limit ?? PAGE_SIZE) || PAGE_SIZE;
  const totalPages = Math.max(1, Number(source.totalPages ?? Math.ceil(total / Math.max(limit, 1))) || 1);
  return { total, page, limit, totalPages };
}

function unwrapSummary(payload) {
  if (!isObject(payload)) return {};
  return isObject(payload.data) ? payload.data : payload;
}

function humanize(value) {
  return String(value || '')
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatDate(value, darkArabic = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(darkArabic ? 'ar-u-nu-latn' : undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatTimeAgo(value, darkArabic = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  const diff = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (darkArabic) {
    if (diff < minute) return 'الآن';
    if (diff < hour) return `قبل ${Math.max(1, Math.floor(diff / minute))} د`;
    if (diff < day) return `قبل ${Math.max(1, Math.floor(diff / hour))} س`;
    if (diff < 7 * day) return `قبل ${Math.max(1, Math.floor(diff / day))} ي`;
    return date.toLocaleDateString('ar-u-nu-latn', { month: 'short', day: 'numeric' });
  }

  if (diff < minute) return 'Just now';
  if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))} min ago`;
  if (diff < day) return `${Math.max(1, Math.floor(diff / hour))} hr ago`;
  if (diff < 7 * day) return `${Math.max(1, Math.floor(diff / day))} d ago`;

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function toStartOfDayIso(value) {
  if (!value) return undefined;
  return new Date(`${value}T00:00:00`).toISOString();
}

function toEndOfDayIso(value) {
  if (!value) return undefined;
  return new Date(`${value}T23:59:59.999`).toISOString();
}

function deviceLabel(userAgent, darkArabic = false) {
  if (!userAgent) return darkArabic ? 'جهاز غير معروف' : 'Unknown device';
  const platform = /Android/i.test(userAgent)
    ? (darkArabic ? 'أندرويد' : 'Android')
    : /iPhone|iPad|iPod/i.test(userAgent)
      ? (darkArabic ? 'آي أو إس' : 'iOS')
      : /Windows/i.test(userAgent)
        ? (darkArabic ? 'ويندوز' : 'Windows')
        : /Macintosh|Mac OS X/i.test(userAgent)
          ? (darkArabic ? 'ماك أو إس' : 'macOS')
          : /Linux/i.test(userAgent)
            ? (darkArabic ? 'لينكس' : 'Linux')
            : (darkArabic ? 'نظام تشغيل غير معروف' : 'Unknown OS');

  const browser = /Edg\//i.test(userAgent)
    ? (darkArabic ? 'إيدج' : 'Edge')
    : /Chrome\//i.test(userAgent)
      ? (darkArabic ? 'كروم' : 'Chrome')
      : /Firefox\//i.test(userAgent)
        ? (darkArabic ? 'فايرفوكس' : 'Firefox')
        : /Safari\//i.test(userAgent)
          ? (darkArabic ? 'سفاري' : 'Safari')
          : (darkArabic ? 'متصفح غير معروف' : 'Unknown browser');

  return darkArabic ? `${browser} على ${platform}` : `${browser} on ${platform}`;
}

function Sparkline({ variant = 'mint' }) {
  const points = variant === 'rose'
    ? '2,19 11,20 18,11 27,17 34,7 42,18 49,13 58,15 67,3 76,17 86,9 96,12'
    : '2,17 12,15 20,18 29,8 38,14 47,10 56,16 66,5 75,13 85,11 96,2';

  return (
    <svg className={`admin-auth-sparkline is-${variant}`} viewBox="0 0 100 24" aria-hidden="true">
      <polyline points={points} />
    </svg>
  );
}

function MetricCard({ icon: Icon, label, value, hint, tone = 'mint' }) {
  const { tr } = useAuthSecurityCopy();

  return (
    <article className={`admin-auth-stat is-${tone}`}>
      <span className="admin-auth-stat__icon"><Icon size={18} /></span>
      <div className="admin-auth-stat__copy">
        <small>{tr(label)}</small>
        <strong>{Number(value || 0).toLocaleString()}</strong>
        <span>{tr(hint)}</span>
      </div>
      <Sparkline variant={tone === 'rose' ? 'rose' : 'mint'} />
    </article>
  );
}

function Dropdown({ label, value, options, onChange, icon: Icon }) {
  const { tr } = useAuthSecurityCopy();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = options.find((item) => item.key === value) || options[0];

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className={`admin-auth-dropdown ${open ? 'is-open' : ''}`} ref={ref}>
      <button type="button" className="admin-auth-dropdown__trigger" onClick={() => setOpen((state) => !state)}>
        <Icon size={14} />
        <span><small>{tr(label)}</small><strong>{tr(current.label)}</strong></span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="admin-auth-dropdown__menu">
          {options.map((item) => (
            <button
              type="button"
              key={item.key}
              className={item.key === value ? 'is-active' : ''}
              onClick={() => {
                onChange(item.key);
                setOpen(false);
              }}
            >
              {tr(item.label)}
              {item.key === value && <Check size={13} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SortControl({ value, order, onChange, onToggle }) {
  const { tr } = useAuthSecurityCopy();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = SORT_OPTIONS.find((item) => item.key === value) || SORT_OPTIONS[0];

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="admin-auth-sort" ref={ref}>
      <button type="button" className="admin-auth-sort__main" onClick={() => setOpen((state) => !state)}>
        <Clock3 size={14} />
        <span><small>{tr('Sort')}</small><strong>{tr(current.label)}</strong></span>
        <ChevronDown size={13} />
      </button>
      <button type="button" className="admin-auth-sort__direction" onClick={onToggle} aria-label={tr('Toggle sort direction')}>
        {order === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
      </button>
      {open && (
        <div className="admin-auth-sort__menu">
          {SORT_OPTIONS.map((item) => (
            <button
              type="button"
              key={item.key}
              className={item.key === value ? 'is-active' : ''}
              onClick={() => {
                onChange(item.key);
                setOpen(false);
              }}
            >
              {tr(item.label)}
              {item.key === value && <Check size={13} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SecurityInspector({ row, onClose }) {
  const { darkArabic, tr } = useAuthSecurityCopy();
  if (!row || typeof document === 'undefined') return null;

  return createPortal(
    <div className="admin-auth-modal-layer">
      <div className="admin-auth-modal-backdrop" onMouseDown={onClose} />
      <section className="admin-auth-inspector" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header className="admin-auth-inspector__header">
          <span className={`admin-auth-inspector__mark ${row.isSuccess ? 'is-success' : 'is-failed'}`}>
            {row.isSuccess ? <ShieldCheck size={21} /> : <ShieldX size={21} />}
          </span>
          <div>
            <small>{tr('AUTHENTICATION EVENT')}</small>
            <h2>{authenticationActionLabel(row.action, tr)}</h2>
            <p>{formatDate(row.createdAt, darkArabic)}</p>
          </div>
          <button type="button" className="admin-auth-icon-button" onClick={onClose} aria-label={tr('Close security event details')}><X size={18} /></button>
        </header>

        <div className="admin-auth-inspector__body">
          <section className="admin-auth-inspector__summary">
            <article>
              <span><UserRound size={15} /></span>
              <div>
                <small>{tr('Account')}</small>
                <strong>{row.user?.fullName || row.email || tr('Unknown account')}</strong>
                <p>{row.user?.email || row.email || '—'}</p>
              </div>
            </article>
            <article>
              <span><Fingerprint size={15} /></span>
              <div>
                <small>{tr('Network')}</small>
                <strong>{row.ipAddress || tr('Unknown IP')}</strong>
                <p>{tr('Recorded request address')}</p>
              </div>
            </article>
            <article>
              <span><Smartphone size={15} /></span>
              <div>
                <small>{tr('Device')}</small>
                <strong>{deviceLabel(row.userAgent, darkArabic)}</strong>
                <p>{row.userAgent || tr('No user agent stored')}</p>
              </div>
            </article>
          </section>

          <section className="admin-auth-message-card">
            <header>
              <span>{row.isSuccess ? <CheckCircle2 size={15} /> : <CircleAlert size={15} />}</span>
              <div>
                <small>{tr('SECURITY RESULT')}</small>
                <h3>{tr(row.isSuccess ? 'Authentication event completed successfully' : 'Authentication event failed')}</h3>
              </div>
            </header>
            <p>{tr(row.message || 'No additional security message was recorded for this event.')}</p>
          </section>

          <section className="admin-auth-inspector__meta">
            <article><small>{tr('Log ID')}</small><strong>{row.id}</strong></article>
            <article><small>{tr('User ID')}</small><strong>{row.userId || row.user?.id || '—'}</strong></article>
            <article><small>{tr('Role')}</small><strong>{row.user?.role ? tr(row.user.role) : '—'}</strong></article>
            <article><small>{tr('Account active')}</small><strong>{row.user ? tr(row.user.isActive ? 'Yes' : 'No') : '—'}</strong></article>
            <article><small>{tr('Email verified')}</small><strong>{row.user ? tr(row.user.isVerified ? 'Yes' : 'No') : '—'}</strong></article>
            <article><small>{tr('Event result')}</small><strong>{tr(row.isSuccess ? 'Successful' : 'Failed')}</strong></article>
          </section>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export default function AdminAuthSecurityPage() {
  const { darkArabic, tr } = useAuthSecurityCopy();
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: PAGE_SIZE, totalPages: 1 });
  const [summary, setSummary] = useState({});
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [action, setAction] = useState('');
  const [result, setResult] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [controlsOpen, setControlsOpen] = useState(false);
  const insightsRef = useRef(null);
  const activityRef = useRef(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 280);
    return () => window.clearTimeout(timer);
  }, [search]);

  const commonParams = useMemo(() => ({
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(action ? { action } : {}),
    ...(fromDate ? { fromDate: toStartOfDayIso(fromDate) } : {}),
    ...(toDate ? { toDate: toEndOfDayIso(toDate) } : {}),
  }), [debouncedSearch, action, fromDate, toDate]);

  const listParams = useMemo(() => ({
    page,
    limit: PAGE_SIZE,
    ...commonParams,
    ...(result ? { isSuccess: result } : {}),
    sortBy,
    sortOrder,
  }), [page, commonParams, result, sortBy, sortOrder]);

  const load = useCallback(async ({ fresh = false, silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const listLoader = fresh && adminApi.authAudit.listFresh ? adminApi.authAudit.listFresh : adminApi.authAudit.list;
      const summaryLoader = fresh && adminApi.authAudit.summaryFresh ? adminApi.authAudit.summaryFresh : adminApi.authAudit.summary;
      const [listResult, summaryResult] = await Promise.all([
        listLoader(listParams),
        summaryLoader(commonParams),
      ]);
      const nextRows = unwrapRows(listResult);
      setRows(nextRows);
      setMeta(unwrapMeta(listResult, nextRows.length));
      setSummary(unwrapSummary(summaryResult));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, darkArabic ? 'تعذر تحميل نشاط أمان المصادقة.' : 'Could not load authentication security activity.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [listParams, commonParams, darkArabic]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load({ fresh: true, silent: true });
  };

  const clearFilters = () => {
    setSearch('');
    setDebouncedSearch('');
    setAction('');
    setResult('');
    setSortBy('createdAt');
    setSortOrder('desc');
    setFromDate('');
    setToDate('');
    setPage(1);
  };

  const total = Number(summary.totalEvents ?? meta.total ?? 0);
  const success = Number(summary.successfulEvents ?? 0);
  const failed = Number(summary.failedEvents ?? 0);
  const uniqueIps = Number(summary.uniqueIpAddresses ?? 0);
  const uniqueUsers = Number(summary.uniqueUsers ?? 0);
  const lockEvents = Number(summary.accountLockEvents ?? 0);
  const riskMapPoints = useMemo(() => buildRiskMapPoints(summary.riskSources), [summary.riskSources]);
  const riskyNetworkSources = riskMapPoints.filter((source) => source.failedEvents > 0 || source.lockEvents > 0).length;
  const securityScore = total > 0 ? Math.max(0, Math.min(100, Math.round((success / total) * 100))) : 0;
  const riskPercent = total > 0 ? Math.max(0, Math.min(100, Math.round((failed / total) * 100))) : 0;

  const paginationTotal = result === 'true'
    ? success
    : result === 'false'
      ? failed
      : total;
  const paginationTotalPages = Math.max(1, Math.ceil(paginationTotal / PAGE_SIZE));
  const paginationStart = paginationTotal > 0 ? ((page - 1) * PAGE_SIZE) + 1 : 0;
  const paginationEnd = paginationTotal > 0 ? Math.min(page * PAGE_SIZE, paginationTotal) : 0;

  const setQuickFilter = (nextAction = '', nextResult = '') => {
    setAction(nextAction);
    setResult(nextResult);
    setPage(1);
    activityRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className={`admin-auth-page${darkArabic ? ' admin-auth-page--dark-arabic' : ''}`}>
      <section className="admin-auth-hero">
        <div className="admin-auth-hero__content">
          <span className="admin-auth-eyebrow"><ShieldCheck size={14} /> {tr('IDENTITY SECURITY')}</span>
          <h1>{tr('Authentication')} <span>{tr('security')}</span></h1>
          <p>{tr('Inspect login, password, verification and token activity with account, device and network context.')}</p>

          <div className="admin-auth-hero__actions">
            <button type="button" className="admin-auth-primary" onClick={() => insightsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
              {tr('View security insights')} <span>→</span>
            </button>
            <button type="button" className="admin-auth-text-link" onClick={() => activityRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
              {tr('Explore activity')} <span>ⓘ</span>
            </button>
          </div>
        </div>

        <div className="admin-auth-hero__scene" aria-hidden="true">
          <span className="admin-auth-scene-grid" />
          <span className="admin-auth-scene-line admin-auth-scene-line--one" />
          <span className="admin-auth-scene-line admin-auth-scene-line--two" />
          <span className="admin-auth-scene-node admin-auth-scene-node--one" />
          <span className="admin-auth-scene-node admin-auth-scene-node--two" />
          <span className="admin-auth-scene-node admin-auth-scene-node--three" />

          <span className="admin-auth-scene-card admin-auth-scene-card--user"><UserRound size={17} /></span>
          <span className="admin-auth-scene-card admin-auth-scene-card--finger"><Fingerprint size={21} /></span>
          <span className="admin-auth-scene-card admin-auth-scene-card--signal"><ShieldAlert size={18} /></span>

          <div className="admin-auth-shield-model">
            <svg viewBox="0 0 360 300" role="presentation" focusable="false">
              <defs>
                <linearGradient id="authBaseSide" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#eefaf8" />
                  <stop offset="0.48" stopColor="#c8ebe7" />
                  <stop offset="1" stopColor="#8fd1ca" />
                </linearGradient>
                <linearGradient id="authBaseTop" x1="0.2" y1="0" x2="0.78" y2="1">
                  <stop offset="0" stopColor="#ffffff" />
                  <stop offset="0.58" stopColor="#f6fffd" />
                  <stop offset="1" stopColor="#d9f2ef" />
                </linearGradient>
                <linearGradient id="authShieldSide" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#86d2cc" />
                  <stop offset="0.55" stopColor="#5fb2ac" />
                  <stop offset="1" stopColor="#2d817a" />
                </linearGradient>
                <linearGradient id="authShieldWhite" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#ffffff" />
                  <stop offset="0.62" stopColor="#fbfffe" />
                  <stop offset="1" stopColor="#d8eeeb" />
                </linearGradient>
                <linearGradient id="authShieldFront" x1="0.08" y1="0.08" x2="0.94" y2="0.94">
                  <stop offset="0" stopColor="#8dd5cf" />
                  <stop offset="0.32" stopColor="#69beb8" />
                  <stop offset="0.7" stopColor="#5fb2ac" />
                  <stop offset="1" stopColor="#3c918b" />
                </linearGradient>
                <linearGradient id="authShieldGloss" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#ffffff" stopOpacity="0.58" />
                  <stop offset="0.45" stopColor="#ffffff" stopOpacity="0.13" />
                  <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
                </linearGradient>
                <linearGradient id="authLockFront" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#ffffff" />
                  <stop offset="0.62" stopColor="#fbfffe" />
                  <stop offset="1" stopColor="#e4f2f0" />
                </linearGradient>
                <filter id="authModelShadow" x="-40%" y="-40%" width="180%" height="200%">
                  <feDropShadow dx="0" dy="12" stdDeviation="11" floodColor="#2b7c75" floodOpacity="0.2" />
                </filter>
                <filter id="authLockShadow" x="-60%" y="-60%" width="220%" height="240%">
                  <feDropShadow dx="6" dy="8" stdDeviation="6" floodColor="#286f69" floodOpacity="0.22" />
                </filter>
              </defs>

              <ellipse cx="183" cy="272" rx="121" ry="18" fill="#4b9f98" opacity="0.12" />

              <path d="M48 242 C48 258 108 273 180 273 C252 273 312 258 312 242 L312 258 C312 275 252 289 180 289 C108 289 48 275 48 258 Z" fill="url(#authBaseSide)" />
              <ellipse cx="180" cy="242" rx="132" ry="31" fill="url(#authBaseTop)" stroke="#a9ddd8" strokeWidth="1.5" />
              <ellipse cx="180" cy="242" rx="111" ry="24" fill="none" stroke="#d7efec" strokeWidth="2" />

              <path d="M91 224 C91 238 131 249 180 249 C229 249 269 238 269 224 L269 237 C269 251 229 262 180 262 C131 262 91 251 91 237 Z" fill="url(#authBaseSide)" />
              <ellipse cx="180" cy="224" rx="89" ry="25" fill="url(#authBaseTop)" stroke="#8fd4cd" strokeWidth="1.6" />
              <ellipse cx="180" cy="223" rx="67" ry="17" fill="#e9f8f5" opacity="0.78" />

              <g filter="url(#authModelShadow)">
                <path d="M192 24 C171 37 145 45 120 56 L126 148 C129 189 153 219 189 243 C225 219 249 189 252 148 L258 56 C233 45 211 37 192 24 Z" fill="url(#authShieldSide)" />
                <path d="M185 18 C164 31 138 39 113 50 L119 143 C122 185 146 215 182 239 C218 215 242 185 245 143 L251 50 C226 39 204 31 185 18 Z" fill="url(#authShieldWhite)" stroke="#ffffff" strokeWidth="3" />
                <path d="M178 28 C159 40 137 47 116 57 L121 140 C124 178 145 205 178 227 C211 205 232 178 235 140 L240 57 C219 47 197 40 178 28 Z" fill="url(#authShieldFront)" stroke="#64bbb4" strokeWidth="1.7" />
                <path d="M178 29 C160 40 140 47 121 56 L125 107 C150 96 187 70 225 59 C209 48 193 40 178 29 Z" fill="url(#authShieldGloss)" opacity="0.72" />
                <path d="M237 61 L232 140 C229 176 210 201 181 221" fill="none" stroke="#2d817a" strokeWidth="4" strokeLinecap="round" opacity="0.28" />
                <path d="M119 60 L124 138 C127 175 148 202 178 222" fill="none" stroke="#b8ebe6" strokeWidth="2" strokeLinecap="round" opacity="0.34" />
              </g>

              <g filter="url(#authLockShadow)">
                <path d="M151 117 V99 C151 80 163 67 180 67 C197 67 209 80 209 99 V117" fill="none" stroke="#e5f2f0" strokeWidth="15" strokeLinecap="round" opacity="0.8" transform="translate(6 5)" />
                <path d="M151 117 V99 C151 80 163 67 180 67 C197 67 209 80 209 99 V117" fill="none" stroke="#ffffff" strokeWidth="12" strokeLinecap="round" />
                <rect x="143" y="109" width="80" height="68" rx="13" fill="#cfe7e4" opacity="0.78" transform="translate(6 6)" />
                <rect x="143" y="109" width="80" height="68" rx="13" fill="url(#authLockFront)" stroke="#ffffff" strokeWidth="2" />
                <circle cx="183" cy="138" r="8" fill="#5fb2ac" />
                <path d="M179 143 H187 L190 158 H176 Z" fill="#5fb2ac" />
                <path d="M151 120 C164 115 201 115 215 120" fill="none" stroke="#ffffff" strokeWidth="2.5" opacity="0.72" />
              </g>
            </svg>
          </div>
        </div>

        <button type="button" className="admin-auth-refresh" onClick={refresh} disabled={refreshing}>
          <RefreshCw className={refreshing ? 'admin-auth-spin' : ''} size={13} />
          {tr('Refresh')}
        </button>
      </section>

      {error && (
        <div className="admin-auth-feedback">
          <CircleAlert size={16} />
          <span>{error}</span>
          <button type="button" onClick={() => setError('')}><X size={14} /></button>
        </div>
      )}

      <section className="admin-auth-stats" aria-label={tr('Authentication security metrics')}>
        <MetricCard icon={ShieldCheck} label={tr('Total events')} value={total} hint={tr('Current audit scope')} />
        <MetricCard icon={LockKeyhole} label={tr('Verified activity')} value={success} hint={darkArabic ? `${securityScore}% ناجح` : `${securityScore}% successful`} />
        <MetricCard icon={ShieldAlert} label={tr('Risky attempts')} value={failed} hint={darkArabic ? `${riskPercent}% من النشاط` : `${riskPercent}% of activity`} tone="rose" />
        <MetricCard icon={Smartphone} label={tr('Network sources')} value={uniqueIps} hint={darkArabic ? `${uniqueUsers} مستخدمون محددون` : `${uniqueUsers} identified users`} />
      </section>

      {controlsOpen && (
        <section className="admin-auth-controls" aria-label={tr('Authentication activity filters')}>
          <div className="admin-auth-controls__topline">
            <div>
              <small>{tr('ACTIVITY CONTROLS')}</small>
              <strong>{tr('Search and refine the security feed')}</strong>
            </div>
            <button type="button" onClick={() => setControlsOpen(false)} aria-label={tr('Close filters')}><X size={15} /></button>
          </div>

          <div className="admin-auth-controls__grid">
            <Dropdown label={tr('Event')} value={action} options={ACTION_OPTIONS} onChange={(value) => { setAction(value); setPage(1); }} icon={KeyRound} />
            <Dropdown label={tr('Result')} value={result} options={RESULT_OPTIONS} onChange={(value) => { setResult(value); setPage(1); }} icon={ShieldCheck} />
            <SortControl
              value={sortBy}
              order={sortOrder}
              onChange={(value) => { setSortBy(value); setPage(1); }}
              onToggle={() => { setSortOrder((current) => current === 'asc' ? 'desc' : 'asc'); setPage(1); }}
            />

            <div className="admin-auth-date-range">
              <label><CalendarDays size={13} /><span><small>{tr('From')}</small><input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => { setFromDate(event.target.value); setPage(1); }} /></span></label>
              <label><CalendarDays size={13} /><span><small>{tr('To')}</small><input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => { setToDate(event.target.value); setPage(1); }} /></span></label>
            </div>

            <label className="admin-auth-search">
              <Search size={15} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={tr('Search account, email, IP or device...')} />
              {search && <button type="button" onClick={() => setSearch('')}><X size={13} /></button>}
            </label>

            <button type="button" className="admin-auth-clear" onClick={clearFilters}>{tr('Clear filters')}</button>
          </div>
        </section>
      )}

      <section className="admin-auth-dashboard" ref={insightsRef}>
        <article className="admin-auth-panel admin-auth-score-card">
          <header className="admin-auth-panel__header">
            <div><ShieldCheck size={13} /><strong>{tr('Security overview')}</strong></div>
          </header>

          <div className="admin-auth-score-card__body">
            <div className="admin-auth-score-ring" style={{ '--score': `${securityScore * 3.6}deg` }}>
              <div>
                <strong>{securityScore}</strong>
                <span>{tr('Security score')}</span>
              </div>
            </div>

            <div className="admin-auth-score-legend">
              <div><i className="is-strong" /><span><strong>{tr('Strong')}</strong><small>{success.toLocaleString()} {tr('verified events')}</small></span><b>{tr('Good')}</b></div>
              <div><i className="is-monitor" /><span><strong>{tr('Monitoring')}</strong><small>{uniqueIps.toLocaleString()} {tr('network sources')}</small></span><b>{tr('Active')}</b></div>
              <div><i className="is-alert" /><span><strong>{tr('Attention')}</strong><small>{failed.toLocaleString()} {tr('failed events')}</small></span><b>{tr(failed > 0 ? 'Review' : 'Low')}</b></div>
            </div>
          </div>
        </article>

        <article className="admin-auth-panel admin-auth-activity-card" ref={activityRef}>
          <header className="admin-auth-panel__header">
            <div><CircleAlert size={13} /><strong>{tr('Recent activity')}</strong></div>
            <button type="button" className="admin-auth-filter-button" onClick={() => setControlsOpen((current) => !current)}>
              <SlidersHorizontal size={13} /> {tr('Filters')}
            </button>
          </header>

          <div className="admin-auth-activity-list">
            {loading ? (
              <div className="admin-auth-state"><LoaderCircle className="admin-auth-spin" size={22} /><strong>{tr('Loading security activity…')}</strong></div>
            ) : rows.length === 0 ? (
              <div className="admin-auth-state"><LockKeyhole size={24} /><strong>{tr('No authentication events match these filters.')}</strong></div>
            ) : rows.map((row) => (
              <button type="button" className="admin-auth-activity-row" key={row.id} onClick={() => setSelected(row)}>
                <span className={`admin-auth-activity-dot ${row.isSuccess ? 'is-success' : 'is-failed'}`} />
                <span className="admin-auth-activity-copy">
                  <strong>{authenticationActionLabel(row.action, tr)}</strong>
                  <small>{row.user?.email || row.email || row.ipAddress || tr('Unknown account')}</small>
                </span>
                <span className="admin-auth-activity-meta">
                  <small>{formatTimeAgo(row.createdAt, darkArabic)}</small>
                  <b>{darkArabic ? deviceLabel(row.userAgent, true).split(' على ')[0] : deviceLabel(row.userAgent).split(' on ')[0]}</b>
                </span>
              </button>
            ))}
          </div>

          <footer className="admin-auth-activity-footer">
            <button
              type="button"
              disabled={loading || page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              {tr('Previous')}
            </button>
            <span>{paginationTotal ? darkArabic ? `${paginationStart}–${paginationEnd} من ${paginationTotal}` : `${paginationStart}–${paginationEnd} of ${paginationTotal}` : darkArabic ? '0 أحداث' : '0 events'}</span>
            <button
              type="button"
              disabled={loading || page >= paginationTotalPages}
              onClick={() => setPage((current) => Math.min(paginationTotalPages, current + 1))}
            >
              {tr('Next')}
            </button>
          </footer>
        </article>

        <article className="admin-auth-panel admin-auth-risk-card">
          <header className="admin-auth-panel__header">
            <div><Fingerprint size={13} /><strong>{tr('Risk map')}</strong></div>
          </header>

          <div className="admin-auth-map" aria-label={tr('Dynamic authentication risk map')}>
            <svg viewBox="0 0 470 210" role="img" aria-label={darkArabic
              ? `${riskMapPoints.length} مصادر شبكة، ${riskyNetworkSources} مصادر خطرة`
              : `${riskMapPoints.length} network sources, ${riskyNetworkSources} risky sources`}>
              <defs>
                <pattern id="auth-dot-pattern" width="8" height="8" patternUnits="userSpaceOnUse">
                  <circle cx="2" cy="2" r="1.35" />
                </pattern>
              </defs>
              <path className="admin-auth-map__land" d="M29 71l22-22 34-7 25 10 15-5 20 9 3 17-13 11-17 1-8 12-18-3-10 8-14-4-9-12-17-3-13-12zm119 5 18-17 25-3 11 11 15 4 7 16-12 16-1 23-16 11-11-15-9-21-16-10-11-15zm112-30 24-17 36 1 25 8 21-5 20 10 27 3 26 16-7 16-18 4-16 13-22-2-11 13-18-1-12-13-27 6-21-10-17-3-12-13-4-14 5-12zm91 70 22-8 19 7 10 15-8 14-20 9-17-8-12-15 6-14z" />
              <path className="admin-auth-map__outline" d="M29 71l22-22 34-7 25 10 15-5 20 9 3 17-13 11-17 1-8 12-18-3-10 8-14-4-9-12-17-3-13-12zm119 5 18-17 25-3 11 11 15 4 7 16-12 16-1 23-16 11-11-15-9-21-16-10-11-15zm112-30 24-17 36 1 25 8 21-5 20 10 27 3 26 16-7 16-18 4-16 13-22-2-11 13-18-1-12-13-27 6-21-10-17-3-12-13-4-14 5-12zm91 70 22-8 19 7 10 15-8 14-20 9-17-8-12-15 6-14z" />

              {riskMapPoints.map((source) => (
                <g
                  key={source.ipAddress}
                  className={`admin-auth-map__source is-${source.riskLevel || 'low'}`}
                  transform={`translate(${source.x} ${source.y})`}
                >
                  <title>{darkArabic
                    ? `${source.ipAddress} • ${Number(source.totalEvents || 0).toLocaleString()} أحداث • ${Number(source.failedEvents || 0).toLocaleString()} فاشلة • ${Number(source.lockEvents || 0).toLocaleString()} مقفلة`
                    : `${source.ipAddress} • ${Number(source.totalEvents || 0).toLocaleString()} events • ${Number(source.failedEvents || 0).toLocaleString()} failed • ${Number(source.lockEvents || 0).toLocaleString()} locked`}</title>
                  <circle className="admin-auth-map__source-halo" r={source.radius + 7} />
                  <circle className="admin-auth-map__source-ring" r={source.radius + 2.5} />
                  <circle className="admin-auth-map__source-dot" r={source.radius} />
                </g>
              ))}
            </svg>

            {!loading && riskMapPoints.length === 0 && (
              <div className="admin-auth-map__empty">
                <Fingerprint size={18} />
                <span>{tr('No network sources in this scope')}</span>
              </div>
            )}
          </div>

          <div className="admin-auth-risk-summary">
            <div><small>{tr('NETWORK SOURCES')}</small><strong>{uniqueIps.toLocaleString()}</strong></div>
            <div><small>{tr('FAILED EVENTS')}</small><strong>{failed.toLocaleString()}</strong></div>
            <div><small>{tr('LOCK EVENTS')}</small><strong>{lockEvents.toLocaleString()}</strong></div>
          </div>
        </article>

        <article className="admin-auth-panel admin-auth-actions-card">
          <header className="admin-auth-panel__header">
            <div><KeyRound size={13} /><strong>{tr('Quick actions')}</strong></div>
          </header>

          <div className="admin-auth-quick-actions">
            <button type="button" onClick={() => setQuickFilter('LOGIN_FAILED', 'false')}><ShieldAlert size={14} /><span>{tr('Review failed logins')}</span><ChevronDown size={12} className="admin-auth-action-chevron" /></button>
            <button type="button" onClick={() => setQuickFilter('', 'true')}><CheckCircle2 size={14} /><span>{tr('Verified activity')}</span><ChevronDown size={12} className="admin-auth-action-chevron" /></button>
            <button type="button" onClick={() => setQuickFilter('ACCOUNT_LOCKED', '')}><LockKeyhole size={14} /><span>{tr('Account lock events')}</span><ChevronDown size={12} className="admin-auth-action-chevron" /></button>
            <button type="button" onClick={() => setControlsOpen(true)}><SlidersHorizontal size={14} /><span>{tr('Advanced filters')}</span><ChevronDown size={12} className="admin-auth-action-chevron" /></button>
            <button type="button" onClick={clearFilters}><RefreshCw size={14} /><span>{tr('Reset activity view')}</span><ChevronDown size={12} className="admin-auth-action-chevron" /></button>
          </div>

          <button type="button" className="admin-auth-security-link" onClick={() => setControlsOpen(true)}>
            {tr('All security tools')} <span>→</span>
          </button>
        </article>
      </section>

      <SecurityInspector row={selected} onClose={() => setSelected(null)} />
    </div>
  );
}